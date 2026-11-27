// El árbol se refresca con el latido y ve lo que se crea fuera de la app.
//
// Que el latido no serialice el mapa entero y que un nivel quieto conserve su
// array lo mide packages/ui/tests/niveles.test.mjs; aquí queda el viaje: se
// despliega una carpeta, se escribe un archivo por detrás y aparece solo.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export default {
  nombre: "arbol-por-nivel",
  descripcion: "Lo creado fuera de la app aparece en el árbol con el siguiente latido",
  run: async ({ page, UI, esperar, tmp }) => {
    const lab = path.join(tmp, "repos", "lab");
    const carpeta = "arbol-vivo";

    try {
      mkdirSync(path.join(lab, carpeta), { recursive: true });
      writeFileSync(path.join(lab, carpeta, "uno.txt"), "uno\n", "utf8");

      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();

      await page.getByRole("button", { name: "Archivos", exact: true }).click();
      await page.locator(".arbol").waitFor();
      await page.getByRole("button", { name: carpeta, exact: true }).click();
      await page.locator(`.arbol-archivo[title="${carpeta}/uno.txt"]`).waitFor();

      // Lo creado fuera de la app aparece en el siguiente latido (2 s).
      writeFileSync(path.join(lab, carpeta, "nuevo.txt"), "nuevo\n", "utf8");
      await esperar(
        () =>
          page
            .locator(`.arbol-archivo[title="${carpeta}/nuevo.txt"]`)
            .count()
            .then((n) => n === 1),
        "el archivo creado fuera de la app",
        10_000,
      );
    } finally {
      rmSync(path.join(lab, carpeta), { recursive: true, force: true });
    }
  },
};
