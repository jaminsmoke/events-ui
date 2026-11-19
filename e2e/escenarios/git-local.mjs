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
    "El nodo Git se apaga si el lab solo está dentro de otro repo, se enciende con un git init propio y vuelve a apagarse al quitarlo",
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

      const nodo = page.locator(".nodo-git");
      const rama = page.locator(".rama-git");
      await esperar(
        () => nodo.evaluate((el) => el.classList.contains("apagado")),
        "Git apagado en el lab ignorado",
        15_000,
      );
      expect(
        (await nodo.innerText()).includes("Sin repositorio local"),
        "el nodo apagado debe explicar que no hay work tree",
      );
      expect(
        (await rama.innerText()).includes("Sin repositorio local"),
        "la rama de cambios debe estar apagada sin Git",
      );

      // `git init` en el propio lab gana al repo contenedor que lo ignora.
      git(lab, "init", "-b", "main");
      await esperar(
        () => nodo.evaluate((el) => el.classList.contains("activo")),
        "Git activo tras git init",
        15_000,
      );
      const texto = await nodo.innerText();
      expect(texto.includes("main"), "el nodo activo debe mostrar la rama main");
      expect(texto.includes("sin commits"), "un repo vacío no debe inventar un commit");
      await esperar(
        () => rama.evaluate((el) => el.classList.contains("activo")),
        "la rama de cambios activa con Git",
        15_000,
      );
      await esperar(
        () => page.locator(".rama-git .fila-cambio").count().then((n) => n > 0),
        "los cambios sin commit en el primer nodo",
        15_000,
      );
      await page.screenshot({ path: resultado("git-local.png") });

      // Sin repo propio vuelve a mandar el contenedor, que lo ignora.
      rmSync(path.join(lab, ".git"), { recursive: true, force: true });
      await esperar(
        () => nodo.evaluate((el) => el.classList.contains("apagado")),
        "Git apagado al quitar el repo",
        15_000,
      );
      await esperar(
        () => rama.evaluate((el) => el.classList.contains("apagado")),
        "la rama de cambios apagada al quitar el repo",
        15_000,
      );
    } finally {
      rmSync(path.join(lab, ".git"), { recursive: true, force: true });
      rmSync(path.join(repos, ".git"), { recursive: true, force: true });
      rmSync(path.join(repos, ".gitignore"), { force: true });
    }
  },
};
