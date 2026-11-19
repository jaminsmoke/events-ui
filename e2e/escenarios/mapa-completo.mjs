import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

/** Git del sistema, siempre dentro de la carpeta indicada. */
function git(carpeta, ...args) {
  return execFileSync("git", ["-C", carpeta, ...args], { encoding: "utf8" });
}

const tablasOperativas = [
  "idea_data",
  "idea_node",
  "rejected_node",
  "roadmap_node",
  "verificacion_node",
  "revision_node",
  "idea_fase",
  "idea_requisito",
  "event",
];

export default {
  nombre: "mapa-completo",
  descripcion: "El lanzador siembra todos los carriles con fases y dependencias y lo deja vacío",
  run: async ({ page, UI, esperar, expect, resultado, tmp }) => {
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await pruebas.waitFor();
    await esperar(() => page.locator(".wire").count().then((n) => n === 10), "los diez cables");

    // Git se simula con el lab vacío, antes de sembrar: la prueba se vacía sola
    // seis segundos después de sembrada y estas comprobaciones no caben a la vez.
    await esperar(
      () => page.locator(".nodo-git.apagado").count().then((n) => n === 1),
      "el puente a Git apagado",
    );
    expect(
      (await page.locator(".nodo-git").innerText()).includes("Sin repositorio local"),
      "el puente apagado debe explicar por qué",
    );
    const pestanaGit = page.getByRole("button", { name: "Mapa de Git", exact: true });
    expect(await pestanaGit.isDisabled(), "la pestaña de Git debe estar deshabilitada sin repo");
    expect(
      (await pestanaGit.getAttribute("title")) === "Sin repositorio local",
      "la pestaña deshabilitada debe explicar que no hay work tree",
    );
    // Un `git init` propio enciende el puente y el Mapa de Git con sus cambios.
    const lab = path.join(tmp, "repos", "lab");
    git(lab, "init", "-b", "main");
    await esperar(
      () => page.locator(".nodo-git.activo").count().then((n) => n === 1),
      "el puente a Git activo tras git init",
      15_000,
    );
    const puenteActivo = await page.locator(".nodo-git").innerText();
    expect(puenteActivo.includes("main"), "el puente activo debe mostrar la rama main");
    expect(puenteActivo.includes("sin commits"), "un repo vacío no debe inventar un commit");
    await page.getByRole("button", { name: /Abrir mapa de Git/ }).click();
    await esperar(
      () => page.locator(".linea-git").count().then((n) => n === 1),
      "el Mapa de Git",
      15_000,
    );
    await esperar(
      () => page.locator(".nodo-cambios.activo").count().then((n) => n === 1),
      "los cambios activos en el Mapa de Git",
      15_000,
    );
    await esperar(
      () => page.locator(".nodo-cambios .fila-cambio").count().then((n) => n > 0),
      "los cambios sin commit en el Mapa de Git",
      15_000,
    );
    // La vista se funde al cambiar de mapa: se espera a que asiente.
    await page.waitForTimeout(900);
    await page.screenshot({ path: resultado("mapa-completo-git.png") });
    await page.getByRole("button", { name: "Mapa de ideas", exact: true }).click();
    await esperar(() => page.locator(".wire").count().then((n) => n === 10), "de vuelta a Ideas");

    await pruebas.click();
    const dialogo = page.getByRole("dialog", { name: "Pruebas del laboratorio" });
    await dialogo.getByLabel("Prueba").selectOption("mapa-completo");
    await dialogo.getByRole("button", { name: "Lanzar", exact: true }).click();
    await dialogo.getByRole("button", { name: "Cerrar", exact: true }).click();

    const cuenta = async (lane) =>
      (await page.locator(`.lane-${lane} > .node-head`).innerText()).trim();
    const reparto = async () =>
      (await cuenta("root")).includes("4") &&
      (await cuenta("cola")).includes("3") &&
      (await cuenta("roadmap")).includes("1") &&
      (await cuenta("verificacion")).includes("2") &&
      (await cuenta("revision_aprobada")).includes("2") &&
      (await cuenta("historial")).includes("3") &&
      (await cuenta("descartadas")).includes("3");
    await esperar(reparto, "el reparto completo por carriles", 90_000);

    // La ficha de roadmap se abre sola y enseña los tres estados de fase.
    await esperar(
      () => page.locator(".lane-roadmap .row .fase").count().then((n) => n === 3),
      "las tres fases del roadmap",
    );
    await page.getByText("La API cambió a mitad del trabajo.").waitFor();
    await esperar(
      () => page.locator(".lane-roadmap .chip-depende").count().then((n) => n === 2),
      "las dos dependencias del roadmap",
    );
    const dependencias = await page.locator(".lane-roadmap .fila-depende").innerText();
    expect(
      dependencias.includes("Aprobada · firmada") && dependencias.includes("Cola · 1"),
      "faltan las dependencias aprobada y pendiente",
    );
    expect(
      (await page.locator(".lane-roadmap .chip-depende.aprobada").count()) === 1,
      "la dependencia aprobada debe verse en verde",
    );
    // El nudo de revisión rechazada y sus tres retornos están siempre, aunque
    // no haya ninguna idea rechazada en ese momento.
    expect((await page.locator(".rama-rechazo").count()) === 1, "falta el nudo de rechazo");
    expect(
      (await page.locator(".wire.rama").count()) === 3,
      "faltan los tres retornos de la revisión rechazada",
    );
    // Los cables son pistas ortogonales: ni curvas libres ni diagonales.
    const trazados = await page.locator(".wire").evaluateAll((nodos) =>
      nodos.map((nodo) => nodo.getAttribute("d") ?? ""),
    );
    expect(
      trazados.every((d) => !/[QC]/.test(d)),
      "los cables deben trazarse con tramos rectos y codos de 90°",
    );

    /* Arrastrar mueve la cámara, no la medida: los cables van en coordenadas
     * del mapa, así que ni el arrastre ni el zoom (que sí entra en la cuenta)
     * pueden mover un trazado. Antes, cada arrastre volvía a medir los nodos. */
    const trazadosAhora = () =>
      page.locator(".wire").evaluateAll((nodos) =>
        nodos.map((nodo) => nodo.getAttribute("d") ?? ""),
      );
    const cercanos = (a, b) =>
      a.length === b.length &&
      a.every((d, i) => {
        const na = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
        const nb = (b[i] ?? "").match(/-?\d+(?:\.\d+)?/g) ?? [];
        return (
          na.length === nb.length &&
          na.every((n, j) => Math.abs(Number(n) - Number(nb[j])) <= 0.75)
        );
      });
    const tablero = await page.locator(".board").boundingBox();
    const transform = () => page.locator(".mapa-ideas").evaluate((el) => el.style.transform);
    const vistaAntes = await transform();
    // Desde el fondo del tablero, lejos de nodos y mandos: ahí sí arrastra.
    const desde = { x: tablero.x + tablero.width / 2, y: tablero.y + tablero.height - 14 };
    await page.mouse.move(desde.x, desde.y);
    await page.mouse.down();
    await page.mouse.move(desde.x + 70, desde.y - 26, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    expect((await transform()) !== vistaAntes, "el arrastre debe mover la vista");
    expect(cercanos(trazados, await trazadosAhora()), "el arrastre no debe mover los cables");

    await page.getByRole("button", { name: "Acercar" }).click();
    await page.waitForTimeout(150);
    expect(cercanos(trazados, await trazadosAhora()), "el zoom no debe mover los cables");
    // En verificación la dependencia apunta al historial: también está aprobada.
    await esperar(
      () => page.locator(".lane-verificacion .chip-depende.aprobada").count().then((n) => n === 1),
      "la dependencia archivada en verde",
    );
    await page.screenshot({ path: resultado("mapa-completo.png") });

    // Fuera el repo propio: el puente y la pestaña vuelven a apagarse.
    rmSync(path.join(lab, ".git"), { recursive: true, force: true });
    await esperar(
      () => page.locator(".nodo-git.apagado").count().then((n) => n === 1),
      "el puente apagado al quitar el repo",
      15_000,
    );
    expect(
      await page.getByRole("button", { name: "Mapa de Git", exact: true }).isDisabled(),
      "la pestaña de Git debe volver a deshabilitarse",
    );

    await pruebas.click();
    await page.getByText(/Completada.*Laboratorio limpio/).waitFor({ timeout: 90_000 });
    await dialogo.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.getByText("Todavía no hay ideas en este repo.").waitFor();
    // La proyección de la barra de estado se refresca aparte; sin esto la foto
    // de la limpieza conservaría los conteos viejos aunque el mapa ya esté a cero.
    await esperar(
      () => page.locator(".proyeccion").innerText().then((texto) => texto.includes("0 ideas")),
      "la proyección vacía",
      15_000,
    );

    for (const lane of [
      "root",
      "cola",
      "roadmap",
      "verificacion",
      "revision_aprobada",
      "historial",
      "descartadas",
    ]) {
      expect((await cuenta(lane)).includes("0"), `el carril ${lane} no quedó vacío`);
    }
    await page.screenshot({ path: resultado("mapa-completo-limpio.png") });

    const db = new DatabaseSync(
      path.join(tmp, "repos", "lab", ".EUI", "EUI_DATABASE.sqlite"),
      { readOnly: true },
    );
    try {
      for (const tabla of tablasOperativas) {
        const n = db.prepare(`SELECT count(*) AS n FROM ${tabla}`).get().n;
        expect(n === 0, `la limpieza dejó ${n} filas en ${tabla}`);
      }
    } finally {
      db.close();
    }
  },
};
