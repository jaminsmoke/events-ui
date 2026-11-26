// El latido del árbol compara nivel a nivel: con 20 carpetas abiertas no
// serializa el mapa entero, y lo que se crea fuera de la app aparece igual.
//
// La prueba cuenta las serializaciones de objetos grandes (`JSON.stringify`
// con 10 claves o más) que hace la página: el mapa de 21 niveles entraba en
// cada latido de 2 s. Un nivel que no cambió conserva su array.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const CARPETAS = 20;

export default {
  nombre: "arbol-por-nivel",
  descripcion: "Con 20 carpetas abiertas el latido no serializa el mapa entero y ve lo nuevo",
  run: async ({ page, UI, esperar, expect, tmp }) => {
    const lab = path.join(tmp, "repos", "lab");
    const carpetas = Array.from(
      { length: CARPETAS },
      (_, i) => `arbol-${String(i).padStart(2, "0")}`,
    );

    // Antes de que cargue la app: cuenta las serializaciones de objetos con
    // muchas claves, que es la forma que tenía el mapa completo.
    await page.addInitScript(() => {
      window.__serializacionesGrandes = 0;
      const original = JSON.stringify;
      JSON.stringify = function (valor, ...resto) {
        if (
          valor !== null &&
          typeof valor === "object" &&
          !Array.isArray(valor) &&
          Object.keys(valor).length >= 10
        ) {
          window.__serializacionesGrandes += 1;
        }
        return original.call(this, valor, ...resto);
      };
    });

    try {
      for (const carpeta of carpetas) {
        mkdirSync(path.join(lab, carpeta), { recursive: true });
        writeFileSync(path.join(lab, carpeta, "uno.txt"), "uno\n", "utf8");
      }

      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();

      await page.getByRole("button", { name: "Archivos", exact: true }).click();
      await page.locator(".arbol").waitFor();

      // Los 20 niveles desplegados: raíz + 20 carpetas en el mapa.
      for (const carpeta of carpetas) {
        await page.getByRole("button", { name: carpeta, exact: true }).click();
      }
      await esperar(
        () =>
          page
            .locator('.arbol-archivo[title$="/uno.txt"]')
            .count()
            .then((n) => n === CARPETAS),
        `los ${CARPETAS} niveles desplegados`,
        20_000,
      );

      // Dos latidos con todo abierto: el mapa no se serializa entero.
      await page.evaluate(() => {
        window.__serializacionesGrandes = 0;
      });
      await page.waitForTimeout(4_500);
      const grandes = await page.evaluate(() => window.__serializacionesGrandes);
      expect(
        grandes === 0,
        `el latido serializó ${grandes} veces un objeto de 10 claves o más`,
      );

      // Lo creado fuera de la app sigue apareciendo en el siguiente latido.
      const nueva = path.join(lab, carpetas[7], "nuevo.txt");
      writeFileSync(nueva, "nuevo\n", "utf8");
      await esperar(
        () =>
          page
            .locator(`.arbol-archivo[title="${carpetas[7]}/nuevo.txt"]`)
            .count()
            .then((n) => n === 1),
        "el archivo creado fuera de la app",
        10_000,
      );
    } finally {
      for (const carpeta of carpetas) {
        rmSync(path.join(lab, carpeta), { recursive: true, force: true });
      }
    }
  },
};
