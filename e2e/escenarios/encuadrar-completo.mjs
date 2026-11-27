/** Encuadrar tiene que dejar el esquema entero a la vista.
 *
 *  El encuadre normal se queda en el suelo legible (75 %) y el mapa sigue
 *  recortado a 800, 1366 y 1920: el aviso ofrece «Encuadrar» y pulsarlo no
 *  cambiaba nada. Ahora ese aviso baja del suelo lo justo para que el mapa
 *  entero quepa, a cambio de esconder el texto secundario de las filas.
 *
 *  Se comprueba a los tres anchos: el mapa cabe dentro del lienzo, el título
 *  sigue a la vista y la descripción y los mandos de la fila no.
 */
export default {
  nombre: "encuadrar-completo",
  descripcion:
    "Encuadrar deja el mapa entero dentro del lienzo a 800, 1366 y 1920, con el detalle oculto",

  run: async ({ page, UI, api, expect, resultado }) => {
    const vistas = [
      [800, 600],
      [1366, 768],
      [1920, 1080],
    ];
    const fallos = [];
    const cabeceras = { "content-type": "application/json" };
    let uid = null;

    // Las medidas del propio aviso: el panel derecho tapa el canto sin encoger
    // la caja, así que lo tapado también cuenta como fuera (como `recortadoDe`).
    const medir = () =>
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

    try {
      // Una ficha con descripción y fase: el detalle que se oculta al alejar.
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

      for (const [ancho, alto] of vistas) {
        await page.setViewportSize({ width: ancho, height: alto });
        // La cámara se reencuadra sola al cambiar el tamaño: se espera a que asiente.
        await page.waitForTimeout(700);

        // El aviso es la acción que el usuario tiene a mano para verlo entero.
        const aviso = page.locator(".aviso-recorte");
        const recortado = await aviso.isVisible().catch(() => false);
        if (recortado) await aviso.click();
        await page.waitForTimeout(400);

        const datos = await medir();
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
      // El runner comparte la pestaña: se devuelve a su tamaño y sin repo.
      await page.evaluate(() => localStorage.removeItem("eui.repo")).catch(() => {});
      await page.setViewportSize({ width: 1500, height: 950 }).catch(() => {});
      await page.goto("about:blank").catch(() => {});
    }
  },
};
