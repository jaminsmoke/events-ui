import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { esperarCables } from "../cables.mjs";

export default {
  nombre: "prueba-recuperacion",
  descripcion: "Reabrir el laboratorio cobra la limpieza que quedó pendiente",
  run: async ({ page, UI, esperar, expect, api, tmp }) => {
    const db = new DatabaseSync(
      path.join(tmp, "repos", "lab", ".EUI", "EUI_DATABASE.sqlite"),
      { readOnly: true },
    );
    const items = () => db.prepare("SELECT count(*) AS n FROM work_item_data").get().n;

    const abrirLab = async () => {
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();
      await pruebas.waitFor();
      await esperarCables(page, esperar);
    };

    const sembrar = async (title) => {
      const r = await api("/items?repo=lab", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, status: "draft" }),
      });
      expect(r.status === 201, `no se pudo sembrar «${title}»`);
    };

    try {
      await abrirLab();
      // La marca se guarda por la ruta tal como la abre la UI (la recordada).
      const repo = await page.evaluate(() => localStorage.getItem("eui.repo"));
      expect(typeof repo === "string" && repo.length > 0, "la UI no recordó el repo abierto");

      // Prueba interrumpida: datos en el laboratorio y una marca sin latido.
      await sembrar("Reparto · interrumpida");
      /* La marca se escribe en la carga siguiente, antes de que arranque la
       * app (`addInitScript`), no en la página viva. Escribirla aquí deja una
       * ventana de milisegundos en la que el panel de Pruebas la cobra en el
       * siguiente render —vacía el laboratorio, la suelta y pinta el aviso en
       * la página que se va a recargar— y el escenario fallaba ~1 de cada 9
       * veces esperando un aviso que ya no iba a salir. Medido: con 3 s de
       * retraso ahí, fallaba 3 de 3. Así la marca existe antes del primer
       * render y no hay orden posible que la cobre antes del reload. */
      await page.context().addInitScript(
        ([clave, marca]) => localStorage.setItem(clave, marca),
        [
          `eui.prueba:${repo}`,
          JSON.stringify({ ejecucion: "cerrada", prueba: "prueba-1", latido: Date.now() - 60_000 }),
        ],
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText(/el laboratorio quedó vacío/).waitFor({ timeout: 20_000 });
      await esperar(() => Promise.resolve(items() === 0), "el vaciado pendiente", 20_000);
      expect(items() === 0, "quedaron ítems de la prueba interrumpida");

      // Que un latido fresco respete la ejecución ajena lo decide
      // `estadoDeMarca` y lo prueba su unit: aquí solo viaja la UI.
      await page.evaluate((clave) => localStorage.removeItem(clave), `eui.prueba:${repo}`);
    } finally {
      db.close();
    }
  },
};
