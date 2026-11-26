/** La pantalla y el contrato hablan de ítems. Este escenario mira el copy del
 *  marco (no los títulos de los datos) y las rutas públicas de la API. */
export default {
  nombre: "vocabulario-item",
  descripcion: "La UI no llama idea a la ficha y la API solo publica /items",

  run: async ({ page, UI, CORE, expect }) => {
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("eui.repo"));
    await page.reload({ waitUntil: "domcontentloaded" });
    const lab = page.getByRole("button", { name: "lab", exact: true });
    await lab.waitFor({ timeout: 15_000 });
    await lab.click();
    await page.locator(".board").waitFor({ timeout: 15_000 });

    await page.getByRole("button", { name: "Mapas", exact: true }).click();
    await page.getByRole("button", { name: "Resumen", exact: true }).click();

    const marco = await page
      .locator(".topbar, .statusbar, .pane-cabecera, .pane-rotulo, .resumen-cabecera")
      .allInnerTexts();
    expect(
      !/\bideas?\b/i.test(marco.join(" ")),
      `el marco sigue diciendo idea: ${marco.join(" | ")}`,
    );

    await page.getByRole("button", { name: "Nuevo ítem", exact: true }).click();
    const formulario = page.locator("form.nueva");
    await formulario.waitFor();
    const copy = await formulario.innerText();
    const titulo = await formulario.getByLabel("Título del ítem").getAttribute("placeholder");
    expect(!/\bideas?\b/i.test(`${copy} ${titulo}`), `el alta sigue diciendo idea: ${copy}`);
    expect(copy.includes("Crear ítem"), "el alta no ofrece «Crear ítem»");
    await formulario.getByRole("button", { name: "Cancelar", exact: true }).click();

    const openapi = await (await fetch(new URL("/openapi.json", CORE))).json();
    const rutas = Object.keys(openapi.paths ?? {});
    expect(rutas.includes("/items"), "la API no publica /items");
    expect(rutas.includes("/items/{uid}"), "la API no publica /items/{uid}");
    expect(!rutas.includes("/ideas"), "la API sigue publicando /ideas");
  },
};
