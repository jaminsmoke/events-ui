/** Ningún texto del mapa puede quedar por debajo del suelo legible al 75 %.
 *
 *  `nitidez-texto` solo miraba `.node-title`: 13 px por 0,75 da 9,75 px. El
 *  meta, las descripciones, los rótulos y los contadores se quedan en 7-8 px y
 *  no se leen. Aquí se mide cada rol de texto visible dentro del mapa a la
 *  escala real del lienzo, no solo el título.
 *
 *  Rojo esperado: varios roles (descripción, rótulos, meta, contadores) por
 *  debajo de 9,5 px efectivos.
 */
const SUELO = 9.5;

export default {
  nombre: "texto-al-75",
  descripcion:
    "Al 75 % todo texto visible del mapa mide al menos 9,5 px efectivos, o no se pinta",
  run: async ({ page, UI, api, expect, resultado }) => {
    const cabeceras = { "content-type": "application/json" };
    let uid = null;

    try {
      // Una ficha con descripción y fase: están todos los roles secundarios.
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

      await page.setViewportSize({ width: 1366, height: 768 });
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.removeItem("eui.repo"));
      await page.reload({ waitUntil: "domcontentloaded" });
      const lab = page.getByRole("button", { name: "lab", exact: true });
      await lab.waitFor({ timeout: 15_000 });
      await lab.click();
      await page.locator(".map").waitFor({ timeout: 15_000 });
      await page.waitForTimeout(800);

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
