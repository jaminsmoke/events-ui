import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Git del sistema, siempre dentro de la carpeta indicada. */
function git(carpeta, ...args) {
  return execFileSync("git", ["-C", carpeta, ...args], { encoding: "utf8" });
}

export default {
  nombre: "git-local",
  descripcion:
    "El puente se apaga si el lab solo está dentro de otro repo, se enciende con un git init propio y vuelve a apagarse al quitarlo",
  run: async ({ page, UI, esperar, expect, resultado, tmp }) => {
    const repos = path.join(tmp, "repos");
    const lab = path.join(repos, "lab");

    try {
      // El repo contenedor ignora el laboratorio, como en el proyecto real.
      git(repos, "init", "-b", "main");
      git(repos, "config", "user.email", "test@example.com");
      git(repos, "config", "user.name", "Test");
      writeFileSync(path.join(repos, ".gitignore"), "lab/\n");
      git(repos, "add", ".gitignore");
      git(repos, "commit", "-m", "ignorar laboratorio");

      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();
      await pruebas.waitFor();
      await esperar(() => page.locator(".wire").count().then((n) => n === 10), "los diez cables");

      // En el Mapa de Ideas solo vive el puente: apagado si el lab está ignorado.
      const puente = page.locator(".nodo-git");
      await esperar(
        () => puente.evaluate((el) => el.classList.contains("apagado")),
        "Git apagado en el lab ignorado",
        15_000,
      );
      expect(
        (await puente.innerText()).includes("Sin repositorio local"),
        "el puente apagado debe explicar que no hay work tree",
      );
      // Sin repo, la pestaña de Git se deshabilita y explica por qué.
      const pestanaGit = page.getByRole("button", { name: "Mapa de Git", exact: true });
      expect(await pestanaGit.isDisabled(), "la pestaña de Git debe estar deshabilitada sin repo");
      expect(
        (await pestanaGit.getAttribute("title")) === "Sin repositorio local",
        "la pestaña deshabilitada debe explicar que no hay work tree",
      );

      // `git init` en el propio lab gana al repo contenedor que lo ignora.
      git(lab, "init", "-b", "main");
      await esperar(
        () => puente.evaluate((el) => el.classList.contains("activo")),
        "Git activo tras git init",
        15_000,
      );
      const texto = await puente.innerText();
      expect(texto.includes("main"), "el puente activo debe mostrar la rama main");
      expect(texto.includes("sin commits"), "un repo vacío no debe inventar un commit");
      // El puente abre el Mapa de Git: el primer nodo muestra los cambios.
      const cambios = page.locator(".nodo-cambios");
      await page.getByRole("button", { name: /Abrir mapa de Git/ }).click();
      await esperar(
        () => page.locator(".linea-git").count().then((n) => n === 1),
        "el Mapa de Git",
        15_000,
      );
      await esperar(
        () => cambios.evaluate((el) => el.classList.contains("activo")),
        "los cambios activos con Git",
        15_000,
      );
      await esperar(
        () => page.locator(".nodo-cambios .fila-cambio").count().then((n) => n > 0),
        "los cambios sin commit en el primer nodo",
        15_000,
      );
      // La vista se funde al cambiar de mapa: se espera a que asiente.
      await page.waitForTimeout(900);
      await page.screenshot({ path: resultado("git-local.png") });

      // Sin repo propio vuelve a mandar el contenedor, que lo ignora.
      rmSync(path.join(lab, ".git"), { recursive: true, force: true });
      await esperar(
        () => cambios.evaluate((el) => el.classList.contains("apagado")),
        "los cambios apagados al quitar el repo",
        15_000,
      );
      await page.getByRole("button", { name: "Mapa de ideas", exact: true }).click();
      await esperar(
        () => puente.evaluate((el) => el.classList.contains("apagado")),
        "Git apagado al quitar el repo",
        15_000,
      );
    } finally {
      rmSync(path.join(lab, ".git"), { recursive: true, force: true });
      rmSync(path.join(repos, ".git"), { recursive: true, force: true });
      rmSync(path.join(repos, ".gitignore"), { force: true });
    }
  },
};
