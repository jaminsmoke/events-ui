// La raíz compartida se escribe una vez por carpeta, no una vez por evento.
//
// El SSE re-ejecuta el efecto del mapa (y con él `firma` vuelve a null), así
// que la comprobación de «primer contacto» se repetía en cada ítem creado o
// movido: `localStorage` y un `PUT /config` con fsync por evento. El hook
// recuerda el repo una vez y el escenario cuenta los PUT de verdad.
export default {
  nombre: "config-una-vez",
  descripcion: "PUT /config una vez al abrir la carpeta y ninguna en los eventos",
  run: async ({ page, UI, api, esperar, expect }) => {
    let puts = 0;
    page.on("request", (peticion) => {
      if (peticion.method() === "PUT" && peticion.url().endsWith("/config")) puts += 1;
    });

    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await page.locator(".board").waitFor();

    // La carga inicial escribe la raíz una sola vez, aunque StrictMode monte
    // el efecto dos veces en desarrollo.
    await esperar(() => puts >= 1, "el PUT /config de la carga", 15_000);
    await page.waitForTimeout(700);
    expect(puts === 1, `la carga inicial escribió config.json ${puts} veces, no una`);

    // Un evento del SSE relee el mapa; la raíz ya está recordada.
    const creada = await api("/items?repo=lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Evento posterior", status: "proposed" }),
    });
    expect(creada.status === 201, `el ítem de prueba no se creó: ${creada.status}`);
    await page.getByText("Evento posterior", { exact: true }).first().waitFor();
    await page.waitForTimeout(1_500);
    expect(puts === 1, `un evento reescribió config.json (${puts} PUT en total)`);
  },
};
