// Regresión de la gramática de cables: al mover una idea solo se enciende el
// cable de llegada. El carril que la deja pulsa, pero su cable de entrada no
// recibe una chispa; al borrar tampoco hay chispa, solo pulso rojo.
import { esperarCables } from "../cables.mjs";

export default {
  nombre: "chispa-solo-llegada",
  descripcion:
    "Mover una idea enciende solo el cable de llegada; borrarla no lanza chispa",
  run: async ({ page, UI, api, esperar, expect }) => {
    const cabeceras = { "content-type": "application/json" };
    const creada = await api("/ideas?repo=lab", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({ title: "Chispa E2E", status: "proposed" }),
    });
    expect(creada.status === 201, `no se pudo crear la idea: ${creada.status}`);
    const uid = creada.data.uid;

    // La compuerta de roadmap exige al menos una fase; se añade antes de mover.
    // En cola la fase solo puede estar pendiente (0021): se completa en roadmap.
    const conFase = await api(`/ideas/${uid}?repo=lab`, {
      method: "PATCH",
      headers: cabeceras,
      body: JSON.stringify({
        fases: [
          {
            orden: 1,
            titulo: "Lista",
            nota: "",
            requisitos: [{ orden: 1, titulo: "Comprobar", hecho: false }],
          },
        ],
      }),
    });
    expect(conFase.status === 200, `no se pudo añadir la fase: ${conFase.status}`);

    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await page.getByText("Chispa E2E", { exact: true }).waitFor();
    await esperarCables(page, esperar);
    expect((await page.locator(".spark").count()) === 0, "la carga inicial no debe lanzar chispas");

    const movida = await api(`/ideas/${uid}?repo=lab`, {
      method: "PATCH",
      headers: cabeceras,
      body: JSON.stringify({ status: "roadmap" }),
    });
    expect(movida.status === 200, `no se pudo mover a roadmap: ${movida.status}`);

    await esperar(
      () => page.locator(".lane-roadmap .row", { hasText: "Chispa E2E" }).count(),
      "la fila en roadmap",
      15_000,
    );
    // Una sola: la del cable de llegada a roadmap. Si también se encendiera
    // el cable de entrada de la cola, aquí habría dos.
    await esperar(() => page.locator(".spark").count().then((n) => n === 1), "una sola chispa", 5_000);
    await esperar(() => page.locator(".spark").count().then((n) => n === 0), "la chispa se apaga", 5_000);

    // Borrar exige estar en Descartadas (62e5934) y desde roadmap no hay
    // vuelta al carril que descarta, así que el borrado se prueba con otra
    // ficha: nace en cola, se descarta y se borra.
    const otra = await api("/ideas?repo=lab", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({ title: "Chispa a borrar", status: "proposed" }),
    });
    expect(otra.status === 201, `no se pudo crear la ficha a borrar: ${otra.status}`);
    const uidBorrar = otra.data.uid;
    const descartada = await api(`/ideas/${uidBorrar}?repo=lab`, {
      method: "PATCH",
      headers: cabeceras,
      body: JSON.stringify({ status: "rejected", rejected_description: "Para borrar" }),
    });
    expect(descartada.status === 200, `no se pudo descartar: ${descartada.status}`);
    await esperar(
      () => page.locator(".lane-descartadas .row", { hasText: "Chispa a borrar" }).count(),
      "la ficha descartada",
      15_000,
    );
    // La chispa del descarte se apaga antes de borrar: si no, se contaría como
    // la del borrado, que es justo lo que este escenario vigila.
    await page.waitForTimeout(3_000);
    await esperar(
      () => page.locator(".spark").count().then((n) => n === 0),
      "la chispa del descarte se apaga",
      10_000,
    );

    const borrada = await api(`/ideas/${uidBorrar}?repo=lab`, { method: "DELETE" });
    expect([200, 204].includes(borrada.status), `no se pudo borrar: ${borrada.status}`);
    await esperar(
      () => page.locator(".row", { hasText: "Chispa a borrar" }).count().then((n) => n === 0),
      "la fila borrada",
      15_000,
    );
    // El pulso del nodo puede seguir, pero no debe aparecer una chispa.
    await page.waitForTimeout(300);
    expect((await page.locator(".spark").count()) === 0, "borrar no debe lanzar chispa");
  },
};
