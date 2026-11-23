import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";

import { esperarCables } from "../cables.mjs";

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
  descripcion:
    "El lanzador siembra todos los carriles con fases y dependencias, el commit se escribe en el panel " +
    "y el laboratorio queda vacío",
  run: async ({ page, UI, esperar, expect, resultado, tmp }) => {
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await pruebas.waitFor();
    // Los panes arrancan cerrados: «Mapas» es quien tiene las pestañas de mapa
    // (la de Git sale deshabilitada mientras no haya work tree).
    await page.getByRole("button", { name: "Mapas", exact: true }).click();
    await page.locator('.pane[aria-label="Mapas"]').waitFor();
    await esperarCables(page, esperar);
    // El puente a Documentos reusa la clase `nodo-git`: se nombra el de Git.
    const puenteGit = page.locator('.nodo-git[aria-label="Entregar a Git"]');

    // Git se simula con el lab vacío, antes de sembrar: la prueba se vacía sola
    // seis segundos después de sembrada y estas comprobaciones no caben a la vez.
    await esperar(
      () => puenteGit.evaluate((el) => el.classList.contains("apagado")),
      "el puente a Git apagado",
    );
    expect(
      (await puenteGit.innerText()).includes("Sin repositorio local"),
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
    // Sin autor, `git commit` se niega: el del panel da ese error tal cual.
    git(lab, "config", "user.email", "test@example.com");
    git(lab, "config", "user.name", "Test");
    // Un cambio de verdad en el work tree: el almacén de la app (`.EUI`) no
    // cuenta como cambio, así que sin esto el nodo sale vacío.
    writeFileSync(path.join(lab, "nota.txt"), "primera versión\n", "utf8");
    await esperar(
      () => puenteGit.evaluate((el) => el.classList.contains("activo")),
      "el puente a Git activo tras git init",
      15_000,
    );
    const puenteActivo = await puenteGit.innerText();
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
    expect(
      (await page.locator(".nodo-cambios").innerText()).includes("nota.txt"),
      "el nodo de cambios debe enseñar el archivo del work tree",
    );
    await page.waitForTimeout(900);
    await page.screenshot({ path: resultado("mapa-completo-git.png") });

    // La prueba manual nueva, «Commit desde el panel»: cambia sola al Mapa de
    // Git, escribe el commit y deja la rama con uno más.
    await pruebas.click();
    const dialogoPruebas = page.getByRole("dialog", { name: "Pruebas del laboratorio" });
    await dialogoPruebas.getByLabel("Prueba").selectOption("commit-panel");
    await dialogoPruebas.getByRole("button", { name: "Lanzar", exact: true }).click();
    await dialogoPruebas.getByRole("button", { name: "Cerrar", exact: true }).click();
    await esperar(
      () => page.locator(".nodo-commits .fila-commit").count().then((n) => n === 1),
      "el commit de la prueba manual",
      60_000,
    );
    expect(
      (await page.locator(".nodo-commits").innerText()).includes(
        "Prueba: commit desde el panel",
      ),
      "el historial debe enseñar el asunto con el que commitea la prueba",
    );
    // Al terminar se vacía sola: hay que dejarla acabar antes de sembrar ideas.
    await pruebas.click();
    await page.getByText(/Completada.*Laboratorio limpio/).waitFor({ timeout: 90_000 });
    await dialogoPruebas.getByRole("button", { name: "Cerrar", exact: true }).click();
    await page.screenshot({ path: resultado("mapa-completo-prueba.png") });

    // Y el mismo commit a mano en el panel, con un cambio nuevo: los cambios se
    // vacían y el historial suma el segundo.
    writeFileSync(path.join(lab, "nota.txt"), "segunda versión\n", "utf8");
    await esperar(
      () => page.locator(".nodo-cambios .fila-cambio").count().then((n) => n === 1),
      "el cambio nuevo tras el primer commit",
      15_000,
    );
    await page.getByRole("button", { name: "Control de código fuente", exact: true }).click();
    const panelGit = page.locator('.pane[aria-label="Control de código fuente"]');
    await panelGit.getByLabel("Mensaje del commit").fill("Commit desde el panel, en la prueba");
    await panelGit.getByRole("button", { name: "Commit", exact: true }).click();
    await esperar(
      () => page.locator(".nodo-cambios .fila-cambio").count().then((n) => n === 0),
      "los cambios vacíos al commitear",
      15_000,
    );
    await esperar(
      () => page.locator(".nodo-commits .fila-commit").count().then((n) => n === 2),
      "el segundo commit en el historial",
      15_000,
    );
    expect(
      (await page.locator(".nodo-commits").innerText()).includes(
        "Commit desde el panel, en la prueba",
      ),
      "el historial debe enseñar el asunto del commit",
    );
    expect(
      (await panelGit.innerText()).includes("Nada sin commit."),
      "el panel debe quedarse sin cambios al commitear",
    );
    await page.screenshot({ path: resultado("mapa-completo-commit.png") });
    // El pane de Git y el de Mapas son excluyentes: volver a Mapas deja las
    // pestañas de mapa donde estaban antes de commitear.
    await page.getByRole("button", { name: "Mapas", exact: true }).click();
    await page.getByRole("button", { name: "Mapa de Trabajo", exact: true }).click();
    await esperarCables(page, esperar, "de vuelta a Trabajo");

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
      (await cuenta("descartadas")).includes("3");
    await esperar(reparto, "el reparto completo por carriles", 90_000);

    // El Changelog ya no es un carril del Mapa de Trabajo: sus tres fichas se
    // comprueban en el Mapa de Documentos, que se abre desde su puente.
    await page.getByRole("button", { name: /Abrir mapa de Documentos/ }).click();
    await page.locator(".linea-documentos").waitFor();
    await esperar(
      () => page.locator(".lane-historial > .node-head").innerText().then((t) => t.includes("3")),
      "las tres fichas archivadas en Documentos",
    );
    const aTrabajo = page.getByRole("button", { name: "Mapa de Trabajo", exact: true });
    if (!(await aTrabajo.isVisible())) {
      await page.getByRole("button", { name: "Mapas", exact: true }).click();
    }
    await aTrabajo.click();
    await esperarCables(page, esperar, "de vuelta a Trabajo");

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
    await page.getByText("Todavía no hay ítems en este repo.").waitFor();
    // La proyección de la barra de estado se refresca aparte; sin esto la foto
    // de la limpieza conservaría los conteos viejos aunque el mapa ya esté a cero.
    await esperar(
      () => page.locator(".proyeccion").innerText().then((texto) => texto.includes("0 ítems")),
      "la proyección vacía",
      15_000,
    );

    for (const lane of ["root", "cola", "roadmap", "verificacion", "revision_aprobada", "descartadas"]) {
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
