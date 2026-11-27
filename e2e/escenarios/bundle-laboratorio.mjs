// El lanzador de pruebas es solo de desktop: la web publicada no debe llevar
// ni su chunk ni los guiones. Esa mitad la vigila apps/web/tests/bundle-web.test.mjs,
// que compila la web y revisa sus assets. Aquí queda el viaje en la UI real: el
// botón sigue abriendo el lanzador con sus nueve guiones.
export default {
  nombre: "bundle-laboratorio",
  descripcion: "El lanzador de desktop sigue abriendo con sus nueve guiones",
  run: async ({ page, UI, esperar }) => {
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await pruebas.click();
    const dialogo = page.getByRole("dialog", { name: "Pruebas del laboratorio" });
    await dialogo.waitFor();
    await esperar(
      () =>
        dialogo
          .getByLabel("Prueba")
          .locator("option")
          .count()
          .then((n) => n === 9),
      "los nueve guiones en el lanzador",
      10_000,
    );
    await dialogo.getByRole("button", { name: "Cerrar", exact: true }).click();
  },
};
