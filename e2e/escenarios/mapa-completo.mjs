// El lanzador siembra todos los carriles con fases y dependencias: el mapa
// reparte las fichas, el roadmap enseña sus fases y sus dependencias, los
// cables son ortogonales y no se mueven al arrastrar, y la limpieza deja el
// laboratorio vacío.
//
// El puente de Git, el commit desde el panel y el guion `commit-panel` viven en
// git-local y vuelo-commit; el recuento de las nueve tablas tras reiniciar, en
// test_item_cola.py.
import { esperarCables } from "../cables.mjs";

export default {
  nombre: "mapa-completo",
  descripcion:
    "El lanzador siembra todos los carriles con fases y dependencias, el mapa los reparte y la limpieza lo deja vacío",
  run: async ({ page, UI, esperar, expect, resultado }) => {
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await pruebas.waitFor();
    // Los panes arrancan cerrados: «Mapas» es quien tiene las pestañas de mapa.
    await page.getByRole("button", { name: "Mapas", exact: true }).click();
    await page.locator('.pane[aria-label="Mapas"]').waitFor();
    await esperarCables(page, esperar);

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
    // no haya ningún ítem rechazado en ese momento.
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
    const transform = () => page.locator(".mapa-items").evaluate((el) => el.style.transform);
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

    // La limpieza del lanzador deja el laboratorio vacío.
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

    for (const lane of [
      "root",
      "cola",
      "roadmap",
      "verificacion",
      "revision_aprobada",
      "descartadas",
    ]) {
      expect((await cuenta(lane)).includes("0"), `el carril ${lane} no quedó vacío`);
    }
    await page.screenshot({ path: resultado("mapa-completo-limpio.png") });
  },
};
