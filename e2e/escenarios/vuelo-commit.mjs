// Revisión a ojo del nodo Commits y del vuelo: deja un cambio sin commit,
// commitea y comprueba que las fichas viajan y que el historial se actualiza.
// Las capturas quedan en e2e/resultados/.

import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

function git(carpeta, ...args) {
  return execFileSync("git", ["-C", carpeta, ...args], { encoding: "utf8" });
}

export default {
  nombre: "vuelo-commit",
  descripcion: "Un commit nuevo hace volar los cambios al nodo Commits y actualiza el historial",
  run: async ({ page, UI, esperar, expect, resultado, tmp }) => {
    const lab = path.join(tmp, "repos", "lab");
    const nota = path.join(lab, "nota.txt");

    try {
      git(lab, "init", "-b", "main");
      git(lab, "config", "user.email", "test@example.com");
      git(lab, "config", "user.name", "Test");
      writeFileSync(nota, "primera versión\n", "utf8");
      git(lab, "add", "-A");
      git(lab, "commit", "-m", "commit inicial del laboratorio");

      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();

      // Las pestañas de mapa viven en el pane de Mapas, que arranca cerrado.
      await page.getByRole("button", { name: "Mapas", exact: true }).click();
      const pestanaGit = page.getByRole("button", { name: "Mapa de Git", exact: true });
      await esperar(() => pestanaGit.isEnabled(), "la pestaña de Git habilitada", 20_000);
      await pestanaGit.click();

      const commits = page.locator(".nodo-commits");
      await esperar(
        () => page.locator(".nodo-commits .fila-commit").count().then((n) => n === 1),
        "el commit inicial en el nodo Commits",
        20_000,
      );
      expect(
        (await commits.innerText()).includes("commit inicial del laboratorio"),
        "el nodo debe listar el asunto del commit inicial",
      );

      // Un cambio sin commit: la fila que después tiene que volar.
      writeFileSync(nota, "segunda versión\n", "utf8");
      await esperar(
        () => page.locator(".nodo-cambios .fila-cambio").count().then((n) => n > 0),
        "el cambio sin commit en su nodo",
        20_000,
      );
      await page.waitForTimeout(400);
      await page.screenshot({ path: resultado("vuelo-commit-antes.png") });

      git(lab, "add", "-A");
      git(lab, "commit", "-m", "commit de prueba del vuelo");

      // El sondeo tarda hasta ~6 s en ver el HEAD nuevo; la ficha vive ~1 s.
      await esperar(
        () => page.locator(".vuelo-cambio").count().then((n) => n > 0),
        "las fichas del vuelo",
        25_000,
      );
      await page.screenshot({ path: resultado("vuelo-commit-en-vuelo.png") });

      await esperar(
        () => page.locator(".nodo-commits .fila-commit").count().then((n) => n === 2),
        "el commit nuevo en el nodo Commits",
        25_000,
      );
      expect(
        (await commits.innerText()).includes("commit de prueba del vuelo"),
        "el historial debe enseñar el asunto nuevo",
      );
      await esperar(
        () => page.locator(".vuelo-cambio").count().then((n) => n === 0),
        "el vuelo termina y no deja fichas colgadas",
        5_000,
      );
      await page.screenshot({ path: resultado("vuelo-commit-despues.png") });
    } finally {
      rmSync(path.join(lab, ".git"), { recursive: true, force: true });
      rmSync(nota, { force: true });
    }
  },
};
