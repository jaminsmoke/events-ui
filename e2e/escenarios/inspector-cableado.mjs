/** Lo que el Inspector necesita de la app entera: el icono del panel, la
 *  selección que llega desde el lienzo y el fondo que la suelta.
 *
 *  Las fichas (ítem, carril, cable, nudo y puente), las zonas de golpe y los
 *  atajos bajaron a pruebas de componente en jsdom
 *  (`shared/ui/tests/inspector-panel.test.mjs`, `mapa-seleccion.test.mjs` y
 *  `atajos-lienzo.test.mjs`); aquí queda solo el cableado de `App`, que no se
 *  puede montar sin navegador. */
export default {
  nombre: "inspector-cableado",
  descripcion:
    "El icono abre el Inspector, la selección del lienzo llega al panel y el fondo la suelta",
  run: async ({ page, UI, api, esperar, expect }) => {
    const cabeceras = { "content-type": "application/json" };
    const crear = await api("/items?repo=lab", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({ title: "Idea de inspector", status: "proposed" }),
    });
    expect(crear.status === 201, `no se pudo crear el ítem: ${crear.status}`);
    const uid = crear.data.uid;

    try {
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();
      await page.locator(".board").waitFor();

      // El icono abre el panel directamente en el Inspector, sin selección.
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
      // El panel se superpone al lienzo y la cámara se reencuadra.
      await page.waitForTimeout(300);

      // Pulsar la fila la marca y el panel pasa a su ficha.
      const fila = page.locator(`.row[data-uid="${uid}"]`);
      await fila.locator(".row-head").click();
      await esperar(
        () => fila.evaluate((el) => el.classList.contains("seleccionada")),
        "la fila del ítem seleccionado",
      );
      await esperar(
        () =>
          panel
            .locator(".inspector-asunto")
            .innerText()
            .then((t) => t === "Idea de inspector"),
        "la ficha del ítem en el inspector",
      );

      // El fondo del lienzo suelta la selección sin cerrar el panel.
      await page.locator(".board").click({ position: { x: 12, y: 12 } });
      await esperar(
        () => page.locator(".seleccionado, .seleccionada").count().then((n) => n === 0),
        "la selección suelta al pulsar el fondo",
      );
      expect(
        (await panel.innerText()).includes("Nada seleccionado"),
        "el panel debe volver al aviso sin selección",
      );

      // Y su ✕ cierra la vista.
      await page.getByRole("button", { name: "Cerrar panel derecho" }).click();
      await esperar(
        () => page.locator('.resumen[aria-label="Panel derecho"]').count().then((n) => n === 0),
        "el panel cerrado",
      );
    } finally {
      await api(`/items/${uid}?repo=lab`, { method: "DELETE" }).catch(() => {});
    }
  },
};
