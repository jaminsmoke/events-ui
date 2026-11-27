// El foco, Tab y Escape viven en el componente de diálogo compartido: probarlo
// en Ajustes y en EditorItem cubre lo mismo que en los cinco. EditorItem se
// queda porque además vigila que su `autoFocus` no pise el título con el
// primer enfocable del diálogo.
export default {
  nombre: "modales-teclado",
  descripcion:
    "Ajustes y EditorItem reciben el foco, atrapan Tab, cierran con Escape y lo devuelven; EditorItem conserva el título",
  run: async ({ page, UI, api, expect, resultado }) => {
    const cabeceras = { "content-type": "application/json" };
    const fallos = [];
    let uid = null;

    const focoDentro = () =>
      page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')));

    const cerrarSiSigue = async (dialogo) => {
      if (!(await dialogo.isVisible().catch(() => false))) return;
      const cerrar = dialogo.getByRole("button", { name: /^(Cancelar|Cerrar)$/ });
      if (await cerrar.count()) await cerrar.first().click();
      await dialogo.waitFor({ state: "hidden" }).catch(() => {});
    };

    const comprobar = async (nombre, origen, abrir, dialogo, botonCerrar, campo) => {
      // 1. El foco entra al abrir (y al campo pedido) y Escape funciona aunque
      //    se vaya fuera.
      await abrir();
      await dialogo.waitFor({ timeout: 15_000 });
      if (!(await focoDentro())) {
        fallos.push(`${nombre}: el foco inicial se queda fuera del diálogo`);
      } else if (campo) {
        const enCampo = await page.evaluate(
          (etiqueta) => document.activeElement?.getAttribute("aria-label") === etiqueta,
          campo,
        );
        if (!enCampo) fallos.push(`${nombre}: el foco inicial no está en «${campo}»`);
      }
      await origen.evaluate((el) => el.focus());
      await page.keyboard.press("Escape");
      await page.waitForTimeout(300);
      if (await dialogo.isVisible().catch(() => false)) {
        fallos.push(`${nombre}: Escape no cierra el diálogo con el foco fuera`);
      } else {
        const devuelto = await origen.evaluate((el) => el === document.activeElement);
        if (!devuelto) fallos.push(`${nombre}: Escape no devuelve el foco al origen`);
      }
      await cerrarSiSigue(dialogo);

      // 2. Tab no sale del diálogo y cerrar con el botón devuelve el foco.
      await abrir();
      await dialogo.waitFor({ timeout: 15_000 });
      await page.keyboard.press("Shift+Tab");
      if (!(await focoDentro())) fallos.push(`${nombre}: Tab se escapa del diálogo`);
      await dialogo.getByRole("button", { name: botonCerrar, exact: true }).click();
      await dialogo.waitFor({ state: "hidden" });
      const devuelto = await origen.evaluate((el) => el === document.activeElement);
      if (!devuelto) fallos.push(`${nombre}: cerrar no devuelve el foco al origen`);
    };

    try {
      const crear = await api("/items?repo=lab", {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({ title: "Modales E2E", status: "proposed" }),
      });
      expect(crear.status === 201, `no se pudo crear el ítem: ${crear.status}`);
      uid = crear.data.uid;
      const plan = await api(`/items/${uid}?repo=lab`, {
        method: "PATCH",
        headers: cabeceras,
        body: JSON.stringify({
          status: "roadmap",
          fases: [{ titulo: "Diálogo", requisitos: [{ titulo: "Cerrar con Escape" }] }],
        }),
      });
      expect(plan.status === 200, `roadmap: ${JSON.stringify(plan.data)}`);

      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();
      await page.locator(".board").waitFor();

      // Ajustes: el botón de la barra superior deja el foco fuera del modal.
      const abrirAjustes = page.getByRole("button", { name: "Ajustes", exact: true });
      await comprobar(
        "Ajustes",
        abrirAjustes,
        async () => {
          await abrirAjustes.click();
        },
        page.getByRole("dialog", { name: "Ajustes" }),
        "Cancelar",
      );

      // EditorItem: React enfoca el título con `autoFocus` (sin atributo en el
      // DOM); el modal debe respetarlo en vez de elegir su propio enfocable.
      const fila = page.locator(`.row[data-uid="${uid}"]`);
      await fila.waitFor({ timeout: 15_000 });
      const cabeza = fila.locator(".row-head");
      if ((await cabeza.getAttribute("aria-expanded")) !== "true") await cabeza.click();
      const editar = fila.getByRole("button", { name: "Editar", exact: true });
      await editar.click();
      const abrirDatos = fila.getByRole("button", { name: "Datos…", exact: true });
      await abrirDatos.waitFor();
      await comprobar(
        "EditorItem",
        abrirDatos,
        async () => {
          await abrirDatos.click();
        },
        page.getByRole("dialog", { name: "Editar ítem" }),
        "Cancelar",
        "Título",
      );

      await page.screenshot({ path: resultado("modales-teclado.png") });
      expect(fallos.length === 0, fallos.join(" | "));
    } finally {
      if (uid) await api(`/items/${uid}?repo=lab`, { method: "DELETE" }).catch(() => {});
    }
  },
};
