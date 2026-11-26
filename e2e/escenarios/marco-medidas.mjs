/** Las medidas del marco viven en variables CSS y la cámara usa la real.
 *
 *  A 2500×1400 el mapa no toca el suelo de encuadre, así que la escala
 *  depende del ancho visible: si el Resumen se descuenta con un 272 escrito a
 *  mano y el CSS dice otra cosa, la escala deja de cuadrar.
 */
export default {
  nombre: "marco-medidas",
  descripcion: "Resumen, rail y pane coinciden con sus variables CSS y la cámara descuenta el panel real",

  run: async ({ page, UI, expect }) => {
    await page.setViewportSize({ width: 2500, height: 1400 });
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("eui.repo"));
    await page.reload({ waitUntil: "domcontentloaded" });
    const lab = page.getByRole("button", { name: "lab", exact: true });
    await lab.waitFor({ timeout: 15_000 });
    await lab.click();
    await page.locator(".board").waitFor({ timeout: 15_000 });

    await page.getByRole("button", { name: "Resumen", exact: true }).click();
    await page.locator(".resumen").waitFor();
    await page.keyboard.press("f");
    await page.waitForTimeout(400);

    const datos = await page.evaluate(() => {
      const px = (nombre) =>
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(nombre));
      const board = document.querySelector(".board");
      const mapa = document.querySelector(".map");
      const cajaBoard = board.getBoundingClientRect();
      const cajaMapa = mapa.getBoundingClientRect();
      const resumen = document.querySelector(".resumen").getBoundingClientRect();
      const rail = document.querySelector(".actividad").getBoundingClientRect();
      const estilo = getComputedStyle(board);
      const altoVisible =
        cajaBoard.height -
        (Number.parseFloat(estilo.paddingTop) || 0) -
        (Number.parseFloat(estilo.paddingBottom) || 0);
      const k = cajaMapa.width / mapa.offsetWidth;
      const kEsperada = Math.max(
        0.5,
        Math.min(
          (cajaBoard.width - resumen.width - 64) / mapa.offsetWidth,
          altoVisible / mapa.offsetHeight,
        ),
      );
      return {
        vars: {
          rail: px("--ancho-rail"),
          pane: px("--ancho-pane"),
          resumen: px("--ancho-resumen"),
          minimo: px("--ancho-minimo-paneles"),
        },
        rail: rail.width,
        resumen: resumen.width,
        k,
        kEsperada,
      };
    });

    expect(datos.vars.resumen > 0, "no existe --ancho-resumen");
    expect(datos.vars.rail > 0, "no existe --ancho-rail");
    expect(datos.vars.pane > 0, "no existe --ancho-pane");
    expect(datos.vars.minimo > 0, "no existe --ancho-minimo-paneles");
    expect(
      Math.abs(datos.rail - datos.vars.rail) <= 1,
      `el rail mide ${datos.rail} y la variable ${datos.vars.rail}`,
    );
    expect(
      Math.abs(datos.resumen - datos.vars.resumen) <= 1,
      `el Resumen mide ${datos.resumen} y la variable ${datos.vars.resumen}`,
    );
    expect(
      Math.abs(datos.k - datos.kEsperada) < 0.01,
      `la cámara encuadra al ${(datos.k * 100).toFixed(1)} % y toca el ${(datos.kEsperada * 100).toFixed(1)} %`,
    );

    await page.getByRole("button", { name: "Mapas", exact: true }).click();
    const pane = await page.locator(".pane").evaluate((n) => n.getBoundingClientRect().width);
    expect(
      Math.abs(pane - datos.vars.pane) <= 1,
      `el pane mide ${pane} y la variable ${datos.vars.pane}`,
    );
  },
};
