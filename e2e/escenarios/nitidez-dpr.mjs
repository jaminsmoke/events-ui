/** La nitidez del mapa también a dpr 1,25.
 *
 *  N1 se midió a dpr 1 y solo en el navegador. Windows al 125 % —y la app de
 *  escritorio, que corre sobre WebView2 con la escala del sistema— redondea el
 *  píxel en múltiplos de 0,8: medio píxel de `translate` suaviza todo el texto.
 *  Este escenario abre un contexto propio a 1366×768 con
 *  `deviceScaleFactor: 1.25`, encuadra y comprueba escalón, suelo, píxel y
 *  tamaño efectivo del título, y guarda la captura.
 */
export default {
  nombre: "nitidez-dpr",
  descripcion: "A dpr 1,25 el translate cae al píxel, el zoom en escalones y el título se lee",

  run: async ({ page, UI, expect, resultado }) => {
    const navegador = page.context().browser();
    const contexto = await navegador.newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 1.25,
    });
    try {
      const alta = await contexto.newPage();
      await alta.goto(UI, { waitUntil: "domcontentloaded" });
      await alta.evaluate(() => localStorage.removeItem("eui.repo"));
      await alta.reload({ waitUntil: "domcontentloaded" });
      const lab = alta.getByRole("button", { name: "lab", exact: true });
      await lab.waitFor({ timeout: 15_000 });
      await lab.click();
      await alta.locator(".map").waitFor({ timeout: 15_000 });
      await alta.waitForTimeout(800);

      const datos = await alta.evaluate(() => {
        const mapa = document.querySelector(".map");
        const matriz = new DOMMatrix(getComputedStyle(mapa).transform);
        const titulo = document.querySelector(".node-title");
        const tamano = titulo ? parseFloat(getComputedStyle(titulo).fontSize) : 0;
        return {
          k: matriz.a,
          x: matriz.e,
          y: matriz.f,
          dpr: devicePixelRatio,
          tamano,
          efectivo: tamano * matriz.a,
        };
      });

      expect(
        Math.abs(datos.dpr - 1.25) < 1e-6,
        `el contexto no corrió a dpr 1,25 sino a ${datos.dpr}`,
      );
      const pasos = datos.k * 20;
      expect(
        Math.abs(pasos - Math.round(pasos)) < 1e-6,
        `el zoom ${datos.k} no está en un escalón del 5 %`,
      );
      expect(
        datos.k >= 0.75 - 1e-6,
        `el mapa se encuadró al ${(datos.k * 100).toFixed(1)} % (suelo 75 %)`,
      );
      const alPixel = (valor) =>
        Math.abs(valor - Math.round(valor * datos.dpr) / datos.dpr) < 1e-6;
      expect(
        alPixel(datos.x) && alPixel(datos.y),
        `translate no está al píxel de 1,25: ${datos.x}, ${datos.y}`,
      );
      expect(
        datos.efectivo >= 9.5,
        `el título mide ${datos.tamano}px y a ${(datos.k * 100).toFixed(0)} % queda en ${datos.efectivo.toFixed(2)}px`,
      );

      await alta.screenshot({ path: resultado("nitidez-dpr-125.png") });
    } finally {
      await contexto.close();
    }
  },
};
