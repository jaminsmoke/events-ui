/** El Registro late con el sondeo compartido y no encadena peticiones.
 *
 *  Con `/log` tardando 4 s, un sondeo sin guarda lanzaría otra a los 2 s (el
 *  latido es de 2 s) y a los 3 s ya habría dos. El latido único, con guarda
 *  de lectura en vuelo, debe dejar una sola. */
const dormir = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
  nombre: "registro-latido",
  descripcion: "Con /log lento, el Registro mantiene una sola petición en vuelo",

  run: async ({ page, UI, expect }) => {
    let peticiones = 0;
    try {
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.removeItem("eui.repo"));
      await page.reload({ waitUntil: "domcontentloaded" });
      const lab = page.getByRole("button", { name: "lab", exact: true });
      await lab.waitFor({ timeout: 15_000 });
      await lab.click();
      await page.locator(".board").waitFor({ timeout: 15_000 });

      await page.route("**/log*", async (route) => {
        peticiones += 1;
        await dormir(4_000);
        await route.continue().catch(() => {});
      });

      await page.getByRole("button", { name: /^Log/ }).click();
      await page.getByRole("tab", { name: "Registro" }).click();
      await dormir(3_000);

      expect(
        peticiones === 1,
        `el Registro lanzó ${peticiones} peticiones a /log en 3 s (debe ser 1)`,
      );
    } finally {
      await page.unroute("**/log*").catch(() => {});
      await page.evaluate(() => localStorage.removeItem("eui.repo")).catch(() => {});
      await page.goto("about:blank").catch(() => {});
    }
  },
};
