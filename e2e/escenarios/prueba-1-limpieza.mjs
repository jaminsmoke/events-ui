import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { esperarCables } from "../cables.mjs";

const tablasOperativas = [
  "work_item_data", "work_item_node", "rejected_node", "roadmap_node", "verificacion_node",
  "revision_node", "work_item_fase", "work_item_requisito", "event",
];

async function geometria(page) {
  return page.evaluate(() => ({
    // Solo el Mapa de Trabajo: el Mapa de Git es otra vista y no se mide aquí.
    // El Historial cuelga de `.estacion-git`, así que se busca en cualquier
    // nivel de la línea y no solo entre los hijos directos.
    cabeceras: Array.from(
      document.querySelectorAll(".linea .node > .node-head"),
      (n) => {
        const { x, y } = n.getBoundingClientRect();
        return [x, y];
      },
    ),
    // Los cables de etapa se anclan a las cabeceras y no se mueven. El ramal
    // de revisión rechazada sí depende de la altura de las fichas abiertas.
    cables: Array.from(document.querySelectorAll(".wire:not(.rama)"), (n) => n.getAttribute("d")),
  }));
}

export default {
  nombre: "prueba-1-limpieza",
  descripcion: "La prueba manual mantiene los anclajes y limpia el laboratorio al salir",
  run: async ({ page, UI, esperar, expect, resultado, tmp, api }) => {
    const db = new DatabaseSync(path.join(tmp, "repos", "lab", ".EUI", "EUI_DATABASE.sqlite"), { readOnly: true });
    const protocolos = () => db.prepare("SELECT * FROM protocolo_flujo ORDER BY origen, destino").all();
    const reglas = JSON.stringify(protocolos());
    const comprobarLimpieza = () => {
      for (const tabla of tablasOperativas) {
        expect(db.prepare(`SELECT count(*) AS n FROM ${tabla}`).get().n === 0, `quedan filas en ${tabla}`);
      }
      expect(JSON.stringify(protocolos()) === reglas, "la limpieza ha cambiado los protocolos");
    };

    try {
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();
      await pruebas.waitFor();
      await esperarCables(page, esperar);
      const inicial = await geometria(page);
      // Nueve cabeceras: el cajón, seis carriles del flujo y los dos puentes
      // (Git y Documentos). El Historial ya no es un carril de esta fila: vive
      // en el Mapa de Documentos.
      expect(inicial.cabeceras.length === 9, "nueve nodos de la fila principal");
      await pruebas.click();
      const boton = (name) => page.getByRole("dialog", { name: "Pruebas del laboratorio" }).getByRole("button", { name, exact: true });
      await boton("Lanzar").click();
      await boton("Cerrar").click();
      const cola = page.locator(".lane-cola > .node-head");
      await esperar(async () => (await cola.innerText()).includes("7") &&
        (await page.locator(".lane-descartadas > .node-head").innerText()).includes("3"), "reparto visual 7/3", 45_000);
      const comprobarAnclajes = async () => {
        const actual = await geometria(page);
        expect(actual.cabeceras.every(([x, y], i) =>
          Math.abs(x - inicial.cabeceras[i][0]) < 0.1 && Math.abs(y - inicial.cabeceras[i][1]) < 0.1),
          "las cabeceras se desplazaron");
        expect(JSON.stringify(actual.cables) === JSON.stringify(inicial.cables), "cambió el trazado de un cable");
      };
      await comprobarAnclajes();
      await esperar(() => page.locator(".vuelo").count().then((n) => n === 0), "el aterrizaje de las filas");
      await page.screenshot({ path: resultado("prueba-1-reparto.png") });
      await cola.click();
      await comprobarAnclajes();
      await cola.click();
      await pruebas.click();
      await page.getByText(/Completada.*Laboratorio limpio/).waitFor();
      comprobarLimpieza();
      await page.getByText("Todavía no hay ítems en este repo.").waitFor();
      await comprobarAnclajes();
      await page.screenshot({ path: resultado("prueba-1-limpia.png") });

      // Los datos anteriores al lanzamiento también se retiran al detener la prueba.
      for (const status of ["roadmap", "verificacion", "revision_aprobada", "historial"]) {
        const r = await api("/ideas?repo=lab", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "Dato anterior", status }) });
        expect(r.status === 201, "sembrar las fichas anteriores");
      }
      await boton("Lanzar").click();
      await boton("Detener").click();
      await page.getByText(/Detenida.*Laboratorio limpio/).waitFor();
      comprobarLimpieza();

      await page.route("**/api/ideas?*", (ruta) => ruta.fulfill({ status: 503, body: "{}" }), { times: 1 });
      await page.route("**/api/reiniciar?*", (ruta) => ruta.fulfill({ status: 503, body: "{}" }), { times: 1 });
      await boton("Lanzar").click();
      await boton("Reintentar limpieza").click();
      await page.getByText(/Con error.*Laboratorio limpio/).waitFor();
      comprobarLimpieza();
    } finally {
      db.close();
    }
  },
};
