import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Git del sistema, siempre dentro de la carpeta indicada. */
function git(carpeta, ...args) {
  return execFileSync("git", ["-C", carpeta, ...args], { encoding: "utf8" });
}

/** Las fases de la idea como payload del PATCH: lo que llega es lo que queda. */
function fasesDe(idea) {
  return idea.fases.map((fase) => ({
    orden: fase.orden,
    titulo: fase.titulo,
    estado: fase.estado,
    requisitos: fase.requisitos.map((requisito) => ({
      orden: requisito.orden,
      titulo: requisito.titulo,
      hecho: requisito.hecho,
    })),
  }));
}

export default {
  nombre: "archivos-fase",
  descripcion:
    "Marcar un requisito y cerrar la fase anotan sus archivos, con el parche si hay Git",
  run: async ({ page, UI, api, esperar, expect, resultado, tmp }) => {
    const lab = path.join(tmp, "repos", "lab");
    const cabeceras = { "content-type": "application/json" };
    let uid = null;

    try {
      // Un repo propio con un archivo versionado: así el parche tiene contenido.
      git(lab, "init", "-b", "main");
      git(lab, "config", "user.email", "test@example.com");
      git(lab, "config", "user.name", "Test");
      writeFileSync(path.join(lab, "nota.txt"), "uno\n");
      git(lab, "add", "-A");
      git(lab, "commit", "-m", "inicial");

      const crear = await api("/items?repo=lab", {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({ title: "Archivos E2E", status: "proposed" }),
      });
      expect(crear.status === 201, `no se pudo crear la idea: ${crear.status}`);
      uid = crear.data.uid;

      const mover = async (body) =>
        api(`/items/${uid}?repo=lab`, {
          method: "PATCH",
          headers: cabeceras,
          body: JSON.stringify(body),
        });
      const idea = async () => (await api(`/items/${uid}?repo=lab`)).data;

      // Entrar en roadmap toma la foto de partida; lo que se toque después es
      // lo que toca el evento siguiente.
      const aRoadmap = await mover({
        status: "roadmap",
        fases: [{ titulo: "Diseño", requisitos: [{ titulo: "Cubre el borde" }] }],
      });
      expect(aRoadmap.status === 200, `no se pudo entrar en roadmap: ${aRoadmap.status}`);

      // Un requisito marcado es un evento: lo que cambió hasta ahí es lo suyo.
      writeFileSync(path.join(lab, "nota.txt"), "uno\ndos\n");
      const conRequisito = fasesDe(await idea());
      conRequisito[0].requisitos[0].hecho = true;
      const marcado = await mover({ fases: conRequisito });
      expect(marcado.status === 200, `no se pudo marcar el requisito: ${marcado.status}`);
      const requisito = (await idea()).fases[0].requisitos[0];
      expect(
        requisito.archivos.some(
          (archivo) => archivo.ruta === "nota.txt" && archivo.estado === "modificado",
        ),
        "el archivo modificado debe quedar anotado en el requisito",
      );

      // Cerrar la fase es otro evento: se lleva lo que quedó después.
      writeFileSync(path.join(lab, "nuevo.txt"), "hola\n");
      const aCerrar = fasesDe(await idea());
      aCerrar[0].estado = "completada";
      const cerrado = await mover({ fases: aCerrar });
      expect(cerrado.status === 200, `no se pudo cerrar la fase: ${cerrado.status}`);
      const archivos = (await idea()).fases[0].archivos;
      expect(
        archivos.some((archivo) => archivo.ruta === "nota.txt" && archivo.estado === "modificado"),
        "el archivo del requisito también cuenta en la fase",
      );
      expect(
        archivos.some((archivo) => archivo.ruta === "nuevo.txt" && archivo.estado === "nuevo"),
        "el archivo nuevo debe quedar anotado en la fase",
      );
      expect(
        archivos.every((archivo) => !archivo.ruta.startsWith(".EUI")),
        "la base del repo no es trabajo de la fase",
      );

      // La UI: el chip en la fila y el parche en la ficha, por requisito y fase.
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();
      const fila = page.locator(".row", { hasText: "Archivos E2E" }).first();
      const cabeza = fila.locator(".row-head");
      await cabeza.waitFor();
      if ((await cabeza.getAttribute("aria-expanded")) !== "true") await cabeza.click();
      await fila.locator(".fase-archivos").first().waitFor();
      expect(
        (await fila.locator(".fase-archivos").first().innerText()).includes("2 archivos"),
        "la fila debe resumir los archivos de la fase",
      );

      await fila.getByRole("button", { name: /Fases · 1\/1/ }).click();
      const ficha = page.getByRole("dialog", { name: "Fases del ítem" });
      await ficha.waitFor();
      const requisitoUI = ficha.locator(".ficha-requisito").first();
      await esperar(
        () => requisitoUI.locator("button.archivo-abrir").count().then((n) => n >= 1),
        "el archivo del requisito en la ficha",
        15_000,
      );
      expect(
        (await requisitoUI.locator(".ficha-archivo code").allInnerTexts()).includes("nota.txt"),
        "el requisito debe enseñar su archivo",
      );
      expect(
        (await ficha.locator(".ficha-fase > .ficha-archivos .ficha-archivo").count()) === 2,
        "la fase debe enseñar los dos archivos",
      );

      // El parche se pide al abrir la ficha: el botón llega con el contenido.
      const delRequisito = requisitoUI.locator(".ficha-archivo", { hasText: "nota.txt" }).first();
      await delRequisito.locator("button.archivo-abrir").click();
      const parche = delRequisito.locator(".ficha-parche");
      await parche.waitFor();
      expect(
        (await parche.innerText()).includes("+dos"),
        "el parche debe enseñar la línea añadida",
      );
      await page.screenshot({ path: resultado("archivos-fase.png") });
    } finally {
      if (uid) await api(`/items/${uid}?repo=lab`, { method: "DELETE" });
      rmSync(path.join(lab, ".git"), { recursive: true, force: true });
      rmSync(path.join(lab, "nota.txt"), { force: true });
      rmSync(path.join(lab, "nuevo.txt"), { force: true });
    }
  },
};
