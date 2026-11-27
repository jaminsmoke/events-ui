/** El mapa se encuadra con una sola regla y «Encuadrar» deja verlo entero.
 *
 *  Normal: nunca por debajo del suelo legible (75 %) y centrado en el alto
 *  libre; a 800×600 antes caía al 29 % y quedaba pegado arriba. Se mide en
 *  desktop y en la web, a 800 y a 1920.
 *
 *  Completo: el encuadre normal deja el mapa recortado a 800, 1366 y 1920, y
 *  el aviso ofrece «Encuadrar». Al pulsarlo, el mapa entero cabe en el lienzo
 *  a cambio de esconder el texto secundario de las filas: el título sigue a la
 *  vista y la descripción y los mandos no.
 */
export default {
  nombre: "encuadrar-completo",
  descripcion:
    "El encuadre no baja del 75 % y centra en las dos apps, y «Encuadrar» deja el mapa entero a 800, 1366 y 1920",
  run: async ({ page, web, UI, WEB, api, expect, resultado }) => {
    const vistas = [
      [800, 600],
      [1366, 768],
      [1920, 1080],
    ];
    const fallos = [];
    const cabeceras = { "content-type": "application/json" };
    let uid = null;

    try {
      // 1) Encuadre normal: suelo del 75 % y centrado, en las dos apps. Se mide
      // con el lab vacío, que es el encuadre de todos los días: una ficha de
      // más cambia el alto del mapa y el centrado deja de ser comparable.
      const medirNormal = async (app) => {
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

        const pequeno = await medirNormal(app);
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
        const grande = await medirNormal(app);
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

      // 2) Vista completa con el aviso, en desktop y a los tres anchos. Aquí
      // sí hace falta una ficha con descripción y fase: es el detalle que se
      // oculta al alejar.
      const crear = await api("/items?repo=lab", {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({
          title: "Encuadrar E2E",
          description: "Detalle que no debe verse por debajo del suelo",
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
          fases: [{ titulo: "Vista", requisitos: [{ titulo: "Ver entero" }] }],
        }),
      });
      expect(plan.status === 200, `roadmap: ${JSON.stringify(plan.data)}`);

      await page.goto(UI, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.removeItem("eui.repo"));
      await page.reload({ waitUntil: "domcontentloaded" });
      const lab = page.getByRole("button", { name: "lab", exact: true });
      await lab.waitFor({ timeout: 15_000 });
      await lab.click();
      await page.locator(".map").waitFor({ timeout: 15_000 });

      const fila = page.locator(`.row[data-uid="${uid}"]`);
      await fila.waitFor({ timeout: 15_000 });

      // Las medidas del propio aviso: el panel derecho tapa el canto sin encoger
      // la caja, así que lo tapado también cuenta como fuera (como `recortadoDe`).
      const medirCompleto = () =>
        page.evaluate(() => {
          const board = document.querySelector(".board");
          const mapa = document.querySelector(".map");
          if (!board || !mapa) return null;
          const hueco = board.getBoundingClientRect();
          const vista = mapa.getBoundingClientRect();
          const resumen = document.querySelector(".resumen");
          const inset = resumen ? resumen.getBoundingClientRect().width : 0;
          return {
            k: new DOMMatrix(getComputedStyle(mapa).transform).a,
            izquierda: vista.left - hueco.left,
            derecha: hueco.right - inset - vista.right,
            arriba: vista.top - hueco.top,
            abajo: hueco.bottom - vista.bottom,
            ancho: vista.width,
            alto: vista.height,
            visible: hueco.width - inset,
            completa: mapa.classList.contains("vista-completa"),
          };
        });

      for (const [ancho, alto] of vistas) {
        await page.setViewportSize({ width: ancho, height: alto });
        // La cámara se reencuadra sola al cambiar el tamaño: se espera a que asiente.
        await page.waitForTimeout(700);

        // El aviso es la acción que el usuario tiene a mano para verlo entero.
        const aviso = page.locator(".aviso-recorte");
        const recortado = await aviso.isVisible().catch(() => false);
        if (recortado) await aviso.click();
        await page.waitForTimeout(400);

        const datos = await medirCompleto();
        if (!datos) {
          fallos.push(`${ancho}: no hay mapa que medir`);
          continue;
        }
        if (
          datos.izquierda < -1 ||
          datos.derecha < -1 ||
          datos.arriba < -1 ||
          datos.abajo < -1
        ) {
          fallos.push(
            `${ancho}: el mapa se sale del lienzo al ${(datos.k * 100).toFixed(0)} % ` +
              `(mide ${datos.ancho.toFixed(0)}×${datos.alto.toFixed(0)} y caben ` +
              `${datos.visible.toFixed(0)} de ancho)`,
          );
        }

        // Si hubo que bajar del suelo, el detalle se esconde y el título no.
        const titulo = await fila.locator(".fila-titulo").isVisible().catch(() => false);
        const descripcion = await fila
          .locator(".fila-descripcion")
          .isVisible()
          .catch(() => false);
        const mandos = await fila.locator(".fila-pie").isVisible().catch(() => false);
        if (recortado && !datos.completa) {
          fallos.push(`${ancho}: se bajó del suelo sin entrar en «ver completo»`);
        }
        if (!titulo) fallos.push(`${ancho}: el título desapareció en «ver completo»`);
        if (recortado && descripcion) {
          fallos.push(`${ancho}: la descripción sigue visible por debajo del suelo`);
        }
        if (recortado && mandos) {
          fallos.push(`${ancho}: los mandos de la fila siguen visibles por debajo del suelo`);
        }
        await page.screenshot({ path: resultado(`encuadrar-${ancho}.png`) });
      }

      expect(fallos.length === 0, fallos.join(" | "));
    } finally {
      if (uid) await api(`/items/${uid}?repo=lab`, { method: "DELETE" }).catch(() => {});
      // El runner comparte estas dos páginas: se devuelven a su tamaño y sin
      // repo recordado, o el siguiente arranca en el mapa (y a 1920).
      for (const app of [page, web]) {
        await app.evaluate(() => localStorage.removeItem("eui.repo")).catch(() => {});
        await app.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
        await app.goto("about:blank").catch(() => {});
      }
    }
  },
};
