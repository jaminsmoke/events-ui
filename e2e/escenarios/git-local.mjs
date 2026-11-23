import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { esperarCables } from "../cables.mjs";

/** Git del sistema, siempre dentro de la carpeta indicada. */
function git(carpeta, ...args) {
  return execFileSync("git", ["-C", carpeta, ...args], { encoding: "utf8" });
}

export default {
  nombre: "git-local",
  descripcion:
    "El puente se apaga si el lab solo está dentro de otro repo, se enciende creándolo desde la UI y vuelve a apagarse al eliminarlo",
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
      await esperarCables(page, esperar);
      // El pane de Mapas arranca cerrado y las pestañas viven dentro de él.
      await page.getByRole("button", { name: "Mapas", exact: true }).click();

      // En el Mapa de Ideas solo vive el puente: apagado si el lab está ignorado.
      // El puente a Documentos reusa la clase `nodo-git`: se nombra el de Git.
      const puente = page.locator('.nodo-git[aria-label="Entregar a Git"]');
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

      // Crear el repo local desde el puente: pide confirmación y enciende.
      await page.getByRole("button", { name: "Crear repo local", exact: true }).click();
      const dialogoCrear = page.getByRole("dialog", { name: "Crear repo local" });
      await dialogoCrear.waitFor();
      await dialogoCrear.getByRole("button", { name: "Crear repo", exact: true }).click();
      await esperar(
        () => puente.evaluate((el) => el.classList.contains("activo")),
        "Git activo tras crear el repo local",
        15_000,
      );
      const texto = await puente.innerText();
      expect(texto.includes("main"), "el puente activo debe mostrar la rama main");
      expect(texto.includes("sin commits"), "un repo vacío no debe inventar un commit");
      // El puente abre el Mapa de Git: el primer nodo muestra los cambios. El
      // almacén `.EUI` no cuenta como cambio, así que hace falta un archivo.
      writeFileSync(path.join(lab, "nota.txt"), "hola\n", "utf8");
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

      // El Resumen enseña si el almacén se versiona y deja ignorarlo desde ahí.
      await page.getByRole("button", { name: "Resumen", exact: true }).click();
      const panelDerecho = page.locator('.resumen[aria-label="Panel derecho"]');
      await panelDerecho.waitFor();
      await esperar(
        () =>
          panelDerecho.innerText().then((t) => t.includes("se versiona con el repo")),
        "el almacén versionado en Resumen",
        15_000,
      );
      await panelDerecho.getByRole("button", { name: "Ignorar .EUI", exact: true }).click();
      await panelDerecho.getByRole("button", { name: "Confirmar", exact: true }).click();
      await esperar(
        () => panelDerecho.innerText().then((t) => t.includes("ignorado por Git")),
        "el almacén ignorado en Resumen",
        15_000,
      );
      expect(
        readFileSync(path.join(lab, ".gitignore"), "utf8").includes(".EUI/"),
        "el .gitignore de la raíz debe ignorar el almacén",
      );
      await page.getByRole("button", { name: "Cerrar panel derecho" }).click();

      // La ficha de un cambio abre su archivo en el visor.
      await page.locator(".nodo-cambios .node-head").click();
      await page.getByRole("button", { name: "Inspector", exact: true }).click();
      const fichaCambios = page.locator('.resumen[aria-label="Panel derecho"]');
      await fichaCambios.locator(".inspector-idea", { hasText: "nota.txt" }).click();
      await fichaCambios.getByRole("button", { name: "Abrir en el visor", exact: true }).click();
      const visor = page.locator(".visor");
      await visor.waitFor();
      await esperar(
        () => visor.innerText().then((t) => t.includes("hola")),
        "el visor lee el archivo del cambio",
        15_000,
      );
      await page.keyboard.press("Escape");
      await esperar(
        () => page.locator(".visor").count().then((n) => n === 0),
        "Escape cierra el visor",
      );
      await esperar(
        () => page.locator(".resumen").count().then((n) => n === 0),
        "Escape cierra el panel del visor",
      );

      // Eliminar desde el puente: pide confirmación y vuelve a apagarse.
      await page.getByRole("button", { name: "Mapa de trabajo", exact: true }).click();
      await page.getByRole("button", { name: "Eliminar repo…", exact: true }).click();
      const dialogoEliminar = page.getByRole("dialog", { name: "Eliminar repo local" });
      await dialogoEliminar.waitFor();
      await dialogoEliminar.getByRole("button", { name: "Eliminar repo", exact: true }).click();
      await esperar(
        () => puente.evaluate((el) => el.classList.contains("apagado")),
        "Git apagado al eliminar el repo",
        15_000,
      );
      expect(await pestanaGit.isDisabled(), "la pestaña de Git debe volver a deshabilitarse");
    } finally {
      rmSync(path.join(lab, ".git"), { recursive: true, force: true });
      rmSync(path.join(lab, ".gitignore"), { force: true });
      rmSync(path.join(repos, ".git"), { recursive: true, force: true });
      rmSync(path.join(repos, ".gitignore"), { force: true });
    }
  },
};
