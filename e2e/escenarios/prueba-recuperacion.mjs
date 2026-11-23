import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { esperarCables } from "../cables.mjs";

export default {
  nombre: "prueba-recuperacion",
  descripcion:
    "Reabrir el laboratorio cobra la limpieza pendiente y respeta otra ejecución viva",
  run: async ({ page, UI, esperar, expect, api, tmp }) => {
    const db = new DatabaseSync(
      path.join(tmp, "repos", "lab", ".EUI", "EUI_DATABASE.sqlite"),
      { readOnly: true },
    );
    const ideas = () => db.prepare("SELECT count(*) AS n FROM work_item_data").get().n;

    const abrirLab = async () => {
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();
      await pruebas.waitFor();
      await esperarCables(page, esperar);
    };

    /** Deja la marca de la prueba como la dejaría una ejecución: `latido`
     *  viejo = se cerró a medias; latido de ahora = sigue viva. */
    const marcar = (repo, latido) =>
      page.evaluate(
        ([clave, marca]) => localStorage.setItem(clave, JSON.stringify(marca)),
        [`eui.prueba:${repo}`, { ejecucion: "cerrada", prueba: "prueba-1", latido }],
      );

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
      await marcar(repo, Date.now() - 60_000);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText(/el laboratorio quedó vacío/).waitFor({ timeout: 20_000 });
      await esperar(() => Promise.resolve(ideas() === 0), "el vaciado pendiente", 20_000);
      expect(ideas() === 0, "quedaron ideas de la prueba interrumpida");

      // Otra ejecución viva: latido fresco. Reabrir no puede tocar su trabajo.
      await sembrar("Dato de otra ejecución");
      await marcar(repo, Date.now());
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.getByText("Dato de otra ejecución").waitFor({ timeout: 20_000 });
      // Más de un ciclo de sondeo: si la recuperación fuera a limpiar, ya lo habría hecho.
      await new Promise((r) => setTimeout(r, 4_000));
      expect(ideas() === 1, "se vació el laboratorio de otra ejecución activa");
      const marca = await page.evaluate(
        (clave) => localStorage.getItem(clave),
        `eui.prueba:${repo}`,
      );
      expect(marca !== null, "se soltó la marca de la ejecución ajena");

      await page.evaluate((clave) => localStorage.removeItem(clave), `eui.prueba:${repo}`);
    } finally {
      db.close();
    }
  },
};
