/** Deja `eui.repo` en el almacén del origen de la UI.
 *
 *  Va con `almacen-2-comprueba`: entre los dos demuestran que cada escenario
 *  arranca con el almacén limpio y que ninguno depende de lo que hizo el
 *  anterior. El runner les da un contexto nuevo a cada uno.
 */
export default {
  nombre: "almacen-1-escribe",
  descripcion: "Deja eui.repo en localStorage para que el siguiente compruebe el aislamiento",

  run: async ({ page, UI }) => {
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("eui.repo", "lab"));
  },
};
