/** Nitidez y legibilidad del mapa en tres juegos.
 *
 *  1. dpr 1: `.map` y cada `.node` sin animaciones con `fill: both`, zoom en
 *     escalones del 5 %, translate al píxel y título por encima del suelo.
 *  2. dpr 1,25: lo mismo en un contexto propio, que es como redondea Windows
 *     al 125 % y la app de escritorio sobre WebView2.
 *  3. al 75 %: con una ficha que tiene descripción y fase, cada rol de texto
 *     visible mide al menos 9,5 px efectivos, los títulos conservan su tamaño
 *     y los contadores de las cabeceras no se recortan.
 */
const SUELO = 9.5;

export default {
  nombre: "nitidez-texto",
  descripcion:
    "A dpr 1 y 1,25 y al 75 %: escalón, píxel, sin fill both y todo texto legible",

  run: async ({ page, UI, api, expect, resultado }) => {
    // Juego 1: dpr 1 en la pestaña del runner.
    await abrirLab(page, UI);
    const normal = await medir(page);
    expect(Math.abs(normal.dpr - 1) < 1e-6, `el runner corrió a dpr ${normal.dpr}`);
    comprobarNítidez(normal, expect);
    await page.screenshot({ path: resultado("nitidez-texto-1366.png") });

    // Juego 2: dpr 1,25 en un contexto propio.
    const contexto = await page.context().browser().newContext({
      viewport: { width: 1366, height: 768 },
      deviceScaleFactor: 1.25,
    });
    try {
      const alta = await contexto.newPage();
      await abrirLab(alta, UI);
      const altaDpr = await medir(alta);
      expect(
        Math.abs(altaDpr.dpr - 1.25) < 1e-6,
        `el contexto no corrió a dpr 1,25 sino a ${altaDpr.dpr}`,
      );
      comprobarNítidez(altaDpr, expect, " a 1,25");
      await alta.screenshot({ path: resultado("nitidez-dpr-125.png") });
    } finally {
      await contexto.close();
    }

    // Juego 3: al 75 % con todos los roles de texto.
    const cabeceras = { "content-type": "application/json" };
    let uid = null;
    try {
      const crear = await api("/items?repo=lab", {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({
          title: "Texto E2E",
          description: "Descripción que debe leerse o no pintarse al 75 %",
          status: "proposed",
        }),
      });
      expect(crear.status === 201, `no se pudo crear el ítem: ${crear.status}`);
      uid = crear.data.uid;
      const plan = await api(`/items/${uid}?repo=lab`, {
        method: "PATCH",
        headers: cabeceras,
        body: JSON.stringify({
          status: "roadmap",
          fases: [{ titulo: "Legibilidad", requisitos: [{ titulo: "Leer al 75 %" }] }],
        }),
      });
      expect(plan.status === 200, `roadmap: ${JSON.stringify(plan.data)}`);

      await abrirLab(page, UI);

      /* Cada hoja con texto legible dentro del mapa, a la escala del lienzo.
       * Se descartan los glifos sueltos (flechas, puntos, ×): no son texto. */
      const datos = await page.evaluate(() => {
        const mapa = document.querySelector(".map");
        if (!mapa) return null;
        const k = new DOMMatrix(getComputedStyle(mapa).transform).a;
        const roles = [...mapa.querySelectorAll("*")]
          .filter((el) => el.childElementCount === 0)
          .filter((el) => /[\p{L}\p{N}]/u.test(el.textContent ?? ""))
          .filter((el) => {
            const caja = el.getBoundingClientRect();
            return caja.width > 0.5 && caja.height > 0.5;
          })
          .map((el) => {
            const clase =
              typeof el.className === "string" ? el.className : (el.className?.baseVal ?? el.tagName);
            return {
              clase,
              texto: (el.textContent ?? "").trim().slice(0, 24),
              tamano: parseFloat(getComputedStyle(el).fontSize) || 0,
            };
          })
          .filter((rol) => rol.tamano > 0)
          .map((rol) => ({ ...rol, efectivo: rol.tamano * k }));
        return { k, roles };
      });

      expect(datos !== null, "no hay mapa que medir");
      expect(
        Math.abs(datos.k - 0.75) < 1e-6,
        `la cámara encuadra al ${(datos.k * 100).toFixed(1)} % y la prueba mide el 75 %`,
      );
      expect(datos.roles.length > 10, `solo se midieron ${datos.roles.length} roles de texto`);

      // El reflujo es solo del secundario: los títulos conservan su tamaño.
      const titulos = await page.evaluate(() => ({
        nodo: parseFloat(getComputedStyle(document.querySelector(".node-title")).fontSize),
        fila: parseFloat(getComputedStyle(document.querySelector(".fila-titulo")).fontSize),
      }));
      expect(
        Math.abs(titulos.nodo - 13) < 0.01,
        `el título del nodo mide ${titulos.nodo} px y debería seguir en 13`,
      );
      expect(
        Math.abs(titulos.fila - 14) < 0.01,
        `el título de la fila mide ${titulos.fila} px y debería seguir en 14`,
      );

      // Los contadores de las cabeceras no pueden salirse ni recortarse: al
      // refluir crecen y la cabecera tiene que seguir respirando.
      const mediasCabezas = await page.evaluate(() => {
        const cabezas = [...document.querySelectorAll(".map .node-head, .map .row-head")];
        return cabezas
          .filter((cabeza) => cabeza.querySelector(".count"))
          .map((cabeza) => {
            const caja = cabeza.getBoundingClientRect();
            const nodo = cabeza.closest(".node")?.getBoundingClientRect() ?? null;
            const estilo = getComputedStyle(cabeza);
            return {
              clase: cabeza.className,
              ancho: Math.round(caja.width),
              alto: Math.round(caja.height),
              relleno: estilo.padding,
              hueco: estilo.gap,
              cuentas: [...cabeza.querySelectorAll(".count")].map((cuenta) => {
                const r = cuenta.getBoundingClientRect();
                const propio = getComputedStyle(cuenta);
                return {
                  texto: cuenta.textContent,
                  ancho: Math.round(r.width),
                  alto: Math.round(r.height),
                  letra: propio.fontSize,
                  interlinea: propio.lineHeight,
                  recortado: cuenta.scrollWidth > cuenta.clientWidth + 1,
                  fueraCabeza: Math.round(r.right - caja.right),
                  fueraNodo: nodo ? Math.round(r.right - nodo.right) : null,
                  fueraAlto: Math.round(r.top - caja.top),
                  fueraAbajo: Math.round(r.bottom - caja.bottom),
                };
              }),
            };
          });
      });
      // Aire mínimo por cada lado: pegada al borde, la cifra parece cortada.
      const AIRE = 2;
      const apretados = mediasCabezas.flatMap((cabeza) =>
        cabeza.cuentas
          .filter(
            (cuenta) =>
              cuenta.recortado ||
              cuenta.fueraCabeza > -AIRE ||
              (cuenta.fueraNodo ?? 0) > -AIRE ||
              cuenta.fueraAlto < AIRE ||
              cuenta.fueraAbajo > -AIRE,
          )
          .map(
            (cuenta) =>
              `${cabeza.clase || "cabecera"} («${cuenta.texto}»): ` +
              (cuenta.recortado
                ? "recortado"
                : `aire arriba ${cuenta.fueraAlto}, abajo ${-cuenta.fueraAbajo}, derecha ${Math.min(cuenta.fueraCabeza, cuenta.fueraNodo ?? 0)}`),
          ),
      );
      expect(apretados.length === 0, `contadores apretados: ${apretados.join(" | ")}`);

      const pequenos = datos.roles.filter((rol) => rol.efectivo < SUELO - 1e-6);
      const resumen = [
        ...new Set(
          pequenos.map(
            (rol) => `${rol.clase || rol.texto}: ${rol.efectivo.toFixed(2)} px («${rol.texto}»)`,
          ),
        ),
      ].slice(0, 12);
      await page.screenshot({ path: resultado("texto-al-75.png") });
      expect(
        pequenos.length === 0,
        `${pequenos.length} roles de texto por debajo de ${SUELO} px al 75 %: ${resumen.join(" | ")}`,
      );
    } finally {
      if (uid) await api(`/items/${uid}?repo=lab`, { method: "DELETE" }).catch(() => {});
      // El runner comparte la pestaña: se devuelve a su tamaño y sin repo.
      await page.evaluate(() => localStorage.removeItem("eui.repo")).catch(() => {});
      await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
      await page.goto("about:blank").catch(() => {});
    }
  },
};

async function abrirLab(pagina, UI) {
  await pagina.setViewportSize({ width: 1366, height: 768 });
  await pagina.goto(UI, { waitUntil: "domcontentloaded" });
  await pagina.evaluate(() => localStorage.removeItem("eui.repo"));
  await pagina.reload({ waitUntil: "domcontentloaded" });
  const lab = pagina.getByRole("button", { name: "lab", exact: true });
  await lab.waitFor({ timeout: 15_000 });
  await lab.click();
  await pagina.locator(".map").waitFor({ timeout: 15_000 });
  await pagina.waitForTimeout(800);
}

/** Escala, translate al píxel, tamaño efectivo del título y animaciones. */
function medir(pagina) {
  return pagina.evaluate(() => {
    const mapa = document.querySelector(".map");
    const nodos = [mapa, ...document.querySelectorAll(".node")];
    const matriz = new DOMMatrix(getComputedStyle(mapa).transform);
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
}

function comprobarNítidez(datos, expect, sufijo = "") {
  const pasos = datos.k * 20;
  expect(
    Math.abs(pasos - Math.round(pasos)) < 1e-6,
    `el zoom ${datos.k} no está en un escalón del 5 %${sufijo}`,
  );
  expect(
    datos.k >= 0.75 - 1e-6,
    `el mapa se encuadró al ${(datos.k * 100).toFixed(1)} % (suelo 75 %)${sufijo}`,
  );
  expect(
    !datos.animaciones.some((a) => a.relleno === "both"),
    `quedan animaciones con fill both${sufijo}: ${JSON.stringify(datos.animaciones)}`,
  );
  const alPixel = (valor) =>
    Math.abs(valor - Math.round(valor * datos.dpr) / datos.dpr) < 1e-6;
  expect(
    alPixel(datos.x) && alPixel(datos.y),
    `translate no está al píxel${sufijo}: ${datos.x}, ${datos.y}`,
  );
  expect(
    datos.efectivo >= SUELO,
    `el título mide ${datos.tamano}px y a ${(datos.k * 100).toFixed(0)} % queda en ${datos.efectivo.toFixed(2)}px${sufijo}`,
  );
}
