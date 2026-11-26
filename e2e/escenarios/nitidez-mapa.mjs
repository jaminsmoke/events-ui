/** El mapa se encuadra con una sola regla en las dos apps: nunca por debajo
 *  del suelo legible (75 %) y centrado en el alto libre del lienzo. A 800×600
 *  antes caía al 29 % y quedaba pegado arriba. */
export default {
  nombre: "nitidez-mapa",
  descripcion:
    "El encuadre no baja del 75 % y centra el mapa en web y desktop a 800×600 y 1920×1080",

  run: async ({ page, web, UI, WEB, expect, resultado }) => {
    const medir = async (app) => {
      await app.keyboard.press("f");
      await app.waitForTimeout(400);
      return app.evaluate(() => {
        const mapa = document.querySelector(".map");
        const board = document.querySelector(".board");
        const cajaMapa = mapa.getBoundingClientRect();
        const cajaBoard = board.getBoundingClientRect();
        const estilo = getComputedStyle(board);
        const arriba = cajaBoard.top + (parseFloat(estilo.paddingTop) || 0);
        const abajo = cajaBoard.bottom - (parseFloat(estilo.paddingBottom) || 0);
        return {
          k: cajaMapa.width / mapa.offsetWidth,
          centroMapa: cajaMapa.top + cajaMapa.height / 2,
          centroLibre: arriba + (abajo - arriba) / 2,
          izquierdaMapa: cajaMapa.left,
          izquierdaLibre: cajaBoard.left + (parseFloat(estilo.paddingLeft) || 0),
        };
      });
    };

        try {
      for (const [etiqueta, app, base] of [
        ["desktop", page, UI],
        ["web", web, WEB],
      ]) {
        await app.setViewportSize({ width: 800, height: 600 });
        await app.goto(base, { waitUntil: "domcontentloaded" });
        // El runner comparte las pestañas: otro escenario pudo dejar un repo
        // abierto. Se olvida para arrancar siempre en el selector.
        await app.evaluate(() => localStorage.removeItem("eui.repo"));
        await app.reload({ waitUntil: "domcontentloaded" });
        const lab = app.getByRole("button", { name: "lab", exact: true });
        await lab.waitFor({ timeout: 15_000 });
        await lab.click();
        await app.locator(".board").waitFor({ timeout: 15_000 });

        const pequeno = await medir(app);
        expect(
          pequeno.k >= 0.75 - 1e-6,
          `${etiqueta} a 800×600 encuadró al ${(pequeno.k * 100).toFixed(1)} % (suelo 75 %)`,
        );
        expect(
          Math.abs(pequeno.centroMapa - pequeno.centroLibre) <= 2,
          `${etiqueta} a 800×600 no centra el mapa (${pequeno.centroMapa} vs ${pequeno.centroLibre})`,
        );
        expect(
          Math.abs(pequeno.izquierdaMapa - pequeno.izquierdaLibre) <= 2,
          `${etiqueta} a 800×600 recorta la Entrada (${pequeno.izquierdaMapa} vs ${pequeno.izquierdaLibre})`,
        );
        await app.screenshot({ path: resultado(`nitidez-${etiqueta}-800.png`) });

        await app.setViewportSize({ width: 1920, height: 1080 });
        const grande = await medir(app);
        await app.screenshot({ path: resultado(`nitidez-${etiqueta}-1920.png`) });
        expect(
          grande.k >= 0.75 && grande.k <= 1,
          `${etiqueta} a 1920×1080 encuadró al ${(grande.k * 100).toFixed(1)} %`,
        );
        expect(
          Math.abs(grande.centroMapa - grande.centroLibre) <= 2,
          `${etiqueta} a 1920×1080 no centra el mapa (${grande.centroMapa} vs ${grande.centroLibre})`,
        );
      }
    } finally {
      // El runner comparte estas dos páginas con el resto de escenarios: se
      // devuelven a su tamaño y sin repo recordado, o el siguiente arranca en
      // el mapa (y a 1920) en vez de en el selector.
      for (const app of [page, web]) {
        await app
          .evaluate(() => localStorage.removeItem("eui.repo"))
          .catch(() => {});
        await app.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
        await app.goto("about:blank").catch(() => {});
      }
    }
  },
};
