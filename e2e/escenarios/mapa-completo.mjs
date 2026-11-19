import { DatabaseSync } from "node:sqlite";
import path from "node:path";

const tablasOperativas = [
  "idea_data",
  "idea_node",
  "rejected_node",
  "roadmap_node",
  "verificacion_node",
  "revision_node",
  "idea_fase",
  "idea_requisito",
  "event",
];

export default {
  nombre: "mapa-completo",
  descripcion: "El lanzador siembra todos los carriles con fases y dependencias y lo deja vacío",
  run: async ({ page, UI, esperar, expect, resultado, tmp }) => {
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await pruebas.waitFor();
    await esperar(() => page.locator(".wire").count().then((n) => n === 6), "los seis cables");

    await pruebas.click();
    const dialogo = page.getByRole("dialog", { name: "Pruebas del laboratorio" });
    await dialogo.getByLabel("Prueba").selectOption("mapa-completo");
    await dialogo.getByRole("button", { name: "Lanzar", exact: true }).click();
    await dialogo.getByRole("button", { name: "Cerrar", exact: true }).click();

    const cuenta = async (lane) =>
      (await page.locator(`.lane-${lane} > .node-head`).innerText()).trim();
    const reparto = async () =>
      (await cuenta("root")).includes("4") &&
      (await cuenta("cola")).includes("3") &&
      (await cuenta("roadmap")).includes("1") &&
      (await cuenta("verificacion")).includes("2") &&
      (await cuenta("revision_aprobada")).includes("2") &&
      (await cuenta("historial")).includes("3") &&
      (await cuenta("descartadas")).includes("3");
    await esperar(reparto, "el reparto completo por carriles", 90_000);

    // La ficha de roadmap se abre sola y enseña los tres estados de fase.
    await esperar(
      () => page.locator(".lane-roadmap .row .fase").count().then((n) => n === 3),
      "las tres fases del roadmap",
    );
    await page.getByText("La API cambió a mitad del trabajo.").waitFor();
    await esperar(
      () => page.locator(".lane-roadmap .chip-depende").count().then((n) => n === 2),
      "las dos dependencias del roadmap",
    );
    const dependencias = await page.locator(".lane-roadmap .fila-depende").innerText();
    expect(
      dependencias.includes("Aprobada · firmada") && dependencias.includes("Cola · 1"),
      "faltan las dependencias aprobada y pendiente",
    );
    expect(
      (await page.locator(".lane-roadmap .chip-depende.aprobada").count()) === 1,
      "la dependencia aprobada debe verse en verde",
    );
    // En verificación la dependencia apunta al historial: también está aprobada.
    await esperar(
      () => page.locator(".lane-verificacion .chip-depende.aprobada").count().then((n) => n === 1),
      "la dependencia archivada en verde",
    );
    await page.screenshot({ path: resultado("mapa-completo.png") });

    await pruebas.click();
    await page.getByText(/Completada.*Laboratorio limpio/).waitFor({ timeout: 90_000 });
    await dialogo.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.getByText("Todavía no hay ideas en este repo.").waitFor();
    // La proyección de la barra de estado se refresca aparte; sin esto la foto
    // de la limpieza conservaría los conteos viejos aunque el mapa ya esté a cero.
    await esperar(
      () => page.locator(".proyeccion").innerText().then((texto) => texto.includes("0 ideas")),
      "la proyección vacía",
      15_000,
    );

    for (const lane of [
      "root",
      "cola",
      "roadmap",
      "verificacion",
      "revision_aprobada",
      "historial",
      "descartadas",
    ]) {
      expect((await cuenta(lane)).includes("0"), `el carril ${lane} no quedó vacío`);
    }
    await page.screenshot({ path: resultado("mapa-completo-limpio.png") });

    const db = new DatabaseSync(
      path.join(tmp, "repos", "lab", ".EUI", "EUI_DATABASE.sqlite"),
      { readOnly: true },
    );
    try {
      for (const tabla of tablasOperativas) {
        const n = db.prepare(`SELECT count(*) AS n FROM ${tabla}`).get().n;
        expect(n === 0, `la limpieza dejó ${n} filas en ${tabla}`);
      }
    } finally {
      db.close();
    }
  },
};
