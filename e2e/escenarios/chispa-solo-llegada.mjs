// Regresión de la gramática de cables: al mover un ítem solo se enciende el
// cable de llegada. El carril que la deja pulsa, pero su cable de entrada no
// recibe una chispa; al borrar tampoco hay chispa, solo pulso rojo.
import { esperarCables } from "../cables.mjs";

export default {
  nombre: "chispa-solo-llegada",
  descripcion:
    "Mover un ítem enciende solo el cable de llegada; borrarlo no lanza chispa",
  run: async ({ page, UI, api, esperar, expect }) => {
    const cabeceras = { "content-type": "application/json" };
    const creada = await api("/items?repo=lab", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({ title: "Chispa E2E", status: "proposed" }),
    });
    expect(creada.status === 201, `no se pudo crear el ítem: ${creada.status}`);
    const uid = creada.data.uid;

    // La compuerta de roadmap exige al menos una fase; se añade antes de mover.
    // En cola la fase solo puede estar pendiente (0021): se completa en roadmap.
    const conFase = await api(`/items/${uid}?repo=lab`, {
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

    const movida = await api(`/items/${uid}?repo=lab`, {
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

    // Que borrar no lance chispa, ni la del descarte ni la del borrado, lo
    // decide `actividadEntre` y lo prueba su unit sin DOM; aquí el viaje es la
    // chispa que sí viaja al mover.
  },
};
