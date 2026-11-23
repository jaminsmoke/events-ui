/** El inspector derecho: la selección del lienzo abre la ficha del carril y
 *  de la idea, y Escape o el fondo sueltan la selección. */
import { esperarCables } from "../cables.mjs";

export default {
  nombre: "inspector",
  descripcion:
    "Seleccionar una idea o un carril abre su ficha en el inspector, y Escape o el fondo sueltan la selección",
  run: async ({ page, UI, api, esperar, expect, resultado }) => {
    const cabeceras = { "content-type": "application/json" };
    const crear = await api("/ideas?repo=lab", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({
        title: "Idea de inspector",
        description: "Descripción que vive en el panel.",
        status: "proposed",
      }),
    });
    expect(crear.status === 201, `no se pudo crear la idea: ${crear.status}`);
    const uid = crear.data.uid;

    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await page.getByText("Idea de inspector", { exact: true }).first().waitFor();
    await esperarCables(page, esperar);

    // El panel arranca cerrado; su icono lo abre directamente en el Inspector.
    const iconoInspector = page.getByRole("button", { name: "Inspector", exact: true });
    await iconoInspector.click();
    const panel = page.locator('.resumen[aria-label="Panel derecho"]');
    await panel.waitFor();
    expect(
      (await iconoInspector.getAttribute("aria-pressed")) === "true",
      "el icono del Inspector debe quedar pulsado",
    );
    expect(
      (await panel.innerText()).includes("Nada seleccionado"),
      "sin selección el Inspector debe explicar cómo empezar",
    );
    // El panel se superpone al lienzo y la cámara se reencuadra: se espera.
    await page.waitForTimeout(900);

    // Una idea: su cabecera la selecciona y la ficha trae descripción y acciones.
    const fila = page.locator(`.row[data-uid="${uid}"]`);
    await fila.locator(".row-head").click();
    await esperar(
      () => fila.evaluate((el) => el.classList.contains("seleccionada")),
      "la fila de la idea seleccionada",
    );
    await esperar(
      () => panel.locator(".inspector-asunto").innerText().then((t) => t === "Idea de inspector"),
      "la ficha de la idea en el inspector",
    );
    // Los rótulos del panel se pintan en mayúsculas por CSS y `innerText` los
    // devuelve ya transformados: se compara sin caja.
    const ficha = (await panel.innerText()).toLowerCase();
    expect(
      ficha.includes("descripción que vive en el panel."),
      "la ficha de la idea debe traer la descripción",
    );
    expect(ficha.includes("acciones"), "la ficha de la idea debe ofrecer acciones");
    expect(ficha.includes("dependencias"), "la ficha de la idea debe enseñar dependencias");

    // Escape suelta lo seleccionado sin cerrar la vista del panel.
    await page.keyboard.press("Escape");
    await esperar(
      () => page.locator(".seleccionado, .seleccionada").count().then((n) => n === 0),
      "la selección suelta con Escape",
    );
    expect(
      (await panel.innerText()).includes("Nada seleccionado"),
      "el panel debe volver al aviso sin selección",
    );

    // El carril: su cabecera lo marca y la ficha lista ideas y salidas.
    const carril = page.locator(".node.lane-cola");
    await carril.locator(".node-head").click();
    await esperar(
      () => carril.evaluate((el) => el.classList.contains("seleccionado")),
      "el carril seleccionado",
    );
    await esperar(
      () =>
        panel
          .innerText()
          .then((t) => t.toLowerCase().includes("salidas del protocolo")),
      "la ficha del carril",
    );
    const fichaCarril = (await panel.innerText()).toLowerCase();
    expect(fichaCarril.includes("backlog"), "la ficha del carril debe nombrarlo");
    expect(fichaCarril.includes("→ roadmap"), "la ficha debe enseñar la salida a roadmap");
    expect(fichaCarril.includes("idea de inspector"), "la ficha debe listar sus ideas");

    // Pulsar la idea dentro de la propia ficha también la selecciona.
    await panel.locator(".inspector-idea", { hasText: "Idea de inspector" }).click();
    await esperar(
      () => panel.locator(".inspector-asunto").innerText().then((t) => t === "Idea de inspector"),
      "la idea elegida desde la ficha del carril",
    );
    await page.screenshot({ path: resultado("inspector.png") });

    // Un cable: la zona de golpe ancha lo hace pulsable y su ficha explica
    // la unión, sin tocar la compuerta del nudo.
    await page.waitForTimeout(300);
    const golpe = page.locator('.wire-hit[data-cable="etapa-cola"]');
    const caja = await golpe.boundingBox();
    expect(caja !== null, "el cable Entrada→Backlog debe tener zona de golpe");
    if (!caja) throw new Error("sin caja para el cable");
    await page.mouse.click(caja.x + caja.width * 0.2, caja.y + caja.height / 2);
    await esperar(
      () => page.locator(".wire.seleccionado").count().then((n) => n === 1),
      "el cable seleccionado",
    );
    await esperar(
      () => panel.innerText().then((t) => t.toLowerCase().includes("compuerta")),
      "la ficha del cable",
    );
    const fichaCable = (await panel.innerText()).toLowerCase();
    expect(fichaCable.includes("backlog"), "la ficha del cable debe nombrar su destino");
    expect(
      fichaCable.includes("paso libre") || fichaCable.includes("no está en"),
      "la ficha del cable debe explicar la compuerta",
    );

    // Un nudo: su rombo y sus celdas llevan a la ficha con todas las compuertas.
    const nudo = page.locator('.nudo-hit[data-nudo="entrada-cola"]');
    const cajaNudo = await nudo.boundingBox();
    expect(cajaNudo !== null, "el nudo de Entrada↔Backlog debe tener zona de golpe");
    if (!cajaNudo) throw new Error("sin caja para el nudo");
    await page.mouse.click(cajaNudo.x + cajaNudo.width / 2, cajaNudo.y + cajaNudo.height / 2);
    await esperar(
      () => page.locator(".nudo.seleccionado").count().then((n) => n === 1),
      "el nudo seleccionado",
    );
    await esperar(
      () => panel.innerText().then((t) => t.toLowerCase().includes("compuerta")),
      "la ficha del nudo",
    );
    const fichaNudo = (await panel.innerText()).toLowerCase();
    expect(
      fichaNudo.includes("paso libre") || fichaNudo.includes("no está en"),
      "el nudo debe explicar el estado de sus compuertas",
    );

    // El puente está a la derecha, bajo el panel: se elige con el panel cerrado
    // y se vuelve a abrir el Inspector para leer su ficha.
    await iconoInspector.click();
    // Sin panel el lienzo se ensancha y el mapa se vuelve a medir.
    await page.waitForTimeout(300);
    // Los dos puentes (Git y Documentos) comparten clase: se nombra el de Git.
    await page.locator('.nodo-puente[aria-label="Entregar a Git"] .node-head').click();
    await iconoInspector.click();
    await esperar(
      () => panel.innerText().then((t) => t.toLowerCase().includes("entregar a git")),
      "la ficha del puente",
    );
    const fichaPuente = (await panel.innerText()).toLowerCase();
    expect(
      fichaPuente.includes("sin repositorio local") || fichaPuente.includes("apagado"),
      "sin work tree el puente debe explicar por qué está apagado",
    );

    // Teclado: las flechas recorren las paradas del mapa y Enter abre en el
    // Inspector lo marcado. Se suelta el puente y se cierra el panel para
    // empezar sin foco en un control (si no, Enter activaría el icono).
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await esperar(
      () => page.locator('.resumen[aria-label="Panel derecho"]').count().then((n) => n === 0),
      "el panel cerrado antes de la prueba de teclado",
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await esperar(
      () =>
        page.locator(".node.lane-cola").evaluate((el) => el.classList.contains("seleccionado")),
      "dos flechas llevan al carril Backlog",
    );
    await page.keyboard.press("Enter");
    await esperar(() => panel.isVisible(), "Enter abre el Inspector de lo marcado");
    await esperar(
      () =>
        panel
          .locator(".inspector-asunto")
          .innerText()
          .then((t) => t === "Backlog"),
      "la ficha del carril abierta por teclado",
    );
    await page.keyboard.press("ArrowLeft");
    await esperar(
      () =>
        panel
          .locator(".inspector-asunto")
          .innerText()
          .then((t) => t === "Entrada"),
      "la flecha izquierda vuelve a la parada anterior",
    );

    // El fondo del lienzo suelta la selección.
    await page.locator(".board").click({ position: { x: 12, y: 12 } });
    await esperar(
      () => page.locator(".seleccionado, .seleccionada").count().then((n) => n === 0),
      "la selección suelta al pulsar el fondo",
    );
  },
};
