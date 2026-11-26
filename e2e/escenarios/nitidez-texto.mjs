/** El texto del mapa no puede quedar muestreado desde una capa a 1×.
 *
 *  Tras el encuadre, `.map` y cada `.node` no deben conservar una animación
 *  con `fill: both`; el zoom debe caer en un escalón del 5 % y el título, a la
 *  escala efectiva, tiene que seguir por encima del suelo legible.
 */
export default {
  nombre: "nitidez-texto",
  descripcion: "Sin capas fill both, zoom en escalones y título legible al alejar",

  run: async ({ page, UI, expect, resultado }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("eui.repo"));
    await page.reload({ waitUntil: "domcontentloaded" });
    const lab = page.getByRole("button", { name: "lab", exact: true });
    await lab.waitFor({ timeout: 15_000 });
    await lab.click();
    await page.locator(".map").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);

    const datos = await page.evaluate(() => {
      const mapa = document.querySelector(".map");
      const nodos = [mapa, ...document.querySelectorAll(".node")];
      const transform = getComputedStyle(mapa).transform;
      const matriz = new DOMMatrix(transform);
      const titulo = document.querySelector(".node-title");
      const tamano = titulo ? parseFloat(getComputedStyle(titulo).fontSize) : 0;
      const animaciones = nodos.flatMap((nodo) =>
        nodo.getAnimations().map((animacion) => ({
          nombre: animacion.animationName,
          estado: animacion.playState,
          relleno: animacion.effect?.getTiming?.().fill ?? null,
        })),
      );
      return {
        k: matriz.a,
        x: matriz.e,
        y: matriz.f,
        dpr: devicePixelRatio,
        tamano,
        efectivo: tamano * matriz.a,
        animaciones,
      };
    });

    assertEscalon(datos.k);
    expect(
      datos.k >= 0.75 - 1e-6,
      `el mapa se encuadró al ${(datos.k * 100).toFixed(1)} % (suelo 75 %)`,
    );
    expect(
      !datos.animaciones.some((a) => a.relleno === "both"),
      `quedan animaciones con fill both: ${JSON.stringify(datos.animaciones)}`,
    );
    const alPixel = (valor) =>
      Math.abs(valor - Math.round(valor * datos.dpr) / datos.dpr) < 1e-6;
    expect(alPixel(datos.x) && alPixel(datos.y), `translate no está al píxel: ${datos.x}, ${datos.y}`);
    expect(
      datos.efectivo >= 9.5,
      `el título mide ${datos.tamano}px y a ${(datos.k * 100).toFixed(0)} % queda en ${datos.efectivo.toFixed(2)}px`,
    );

    await page.screenshot({ path: resultado("nitidez-texto-1366.png") });

    // El runner comparte la pestaña: se devuelve a su tamaño y sin repo.
    await page.evaluate(() => localStorage.removeItem("eui.repo"));
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto("about:blank");
  },
};

function assertEscalon(k) {
  const pasos = k * 20;
  if (Math.abs(pasos - Math.round(pasos)) > 1e-6) {
    throw new Error(`el zoom ${k} no está en un escalón del 5 %`);
  }
}
