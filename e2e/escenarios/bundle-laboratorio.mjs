// El lanzador de pruebas es solo de desktop: su chunk no puede viajar en la
// entrada de la web publicada. El escenario construye la web en un directorio
// temporal y mira qué lleva cada chunk; después comprueba que el diálogo sigue
// abriendo en la UI real.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Un texto que solo existe en los guiones y que la minificación no parte.
const MARCA = "Marcha · cable";

export default {
  nombre: "bundle-laboratorio",
  descripcion: "El chunk de entrada de la web no lleva los guiones y el lanzador sigue abriendo",
  run: async ({ page, UI, esperar, expect }) => {
    const salida = mkdtempSync(path.join(os.tmpdir(), "eui-web-"));
    try {
      const build = spawnSync(
        "corepack",
        [
          "pnpm",
          "--filter",
          "events-ui-webapp",
          "exec",
          "vite",
          "build",
          "--outDir",
          salida,
          "--emptyOutDir",
        ],
        { cwd: ROOT, encoding: "utf8", shell: true, timeout: 180_000 },
      );
      expect(
        build.status === 0,
        `el build de la web falló: ${(build.stderr || build.stdout || "").trim()}`,
      );

      const html = readFileSync(path.join(salida, "index.html"), "utf8");
      const entrada = html.match(/<script[^>]*src="([^"]+)"/)?.[1];
      expect(entrada !== undefined, "index.html no referencia un script de entrada");
      const entradaJs = readFileSync(path.join(salida, entrada.replace(/^\//, "")), "utf8");
      expect(!entradaJs.includes(MARCA), "el chunk de entrada lleva los guiones");
      expect(
        !entradaJs.includes("Pruebas del laboratorio"),
        "el chunk de entrada lleva el diálogo de pruebas",
      );

      const assets = readdirSync(path.join(salida, "assets")).filter((n) => n.endsWith(".js"));
      const conGuiones = assets.filter((n) =>
        readFileSync(path.join(salida, "assets", n), "utf8").includes(MARCA),
      );
      expect(
        conGuiones.length === 1,
        `los guiones deberían ir en un chunk propio y están en ${conGuiones.length}`,
      );
      expect(
        !conGuiones.includes(path.basename(entrada)),
        "los guiones comparten chunk con la entrada",
      );

      // En desktop, el botón sigue abriendo el lanzador con sus nueve guiones.
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();
      await pruebas.click();
      const dialogo = page.getByRole("dialog", { name: "Pruebas del laboratorio" });
      await dialogo.waitFor();
      await esperar(
        () =>
          dialogo
            .getByLabel("Prueba")
            .locator("option")
            .count()
            .then((n) => n === 9),
        "los nueve guiones en el lanzador",
        10_000,
      );
      await dialogo.getByRole("button", { name: "Cerrar", exact: true }).click();
    } finally {
      rmSync(salida, { recursive: true, force: true });
    }
  },
};
