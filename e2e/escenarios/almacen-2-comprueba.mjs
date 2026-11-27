/** Cada escenario arranca con el almacén vacío.
 *
 *  `almacen-1-escribe` deja `eui.repo` justo antes. Si el runner reutiliza la
 *  pestaña, aquí aparece y el escenario falla: es la fuga que hacía que
 *  `config-una-vez` dependiera del orden. Con un contexto por escenario no hay
 *  nada que ver.
 */
export default {
  nombre: "almacen-2-comprueba",
  descripcion: "El escenario anterior no puede dejar localStorage: cada uno parte limpio",

  run: async ({ page, UI, expect }) => {
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const claves = await page.evaluate(() => Object.keys(localStorage));
    expect(
      claves.length === 0,
      `el escenario anterior dejó localStorage: ${claves.join(", ") || "(ninguna)"}`,
    );
  },
};
