// La copia optimista de fases no se suelta cuando el mapa relee el mismo
// contenido en un array nuevo.
//
// El PATCH se retiene con `route` para que la relectura del mapa llegue con la
// escritura en vuelo, que es la ventana donde se perdía la casilla marcada.
export default {
  nombre: "copia-optimista-fases",
  descripcion: "Marcar un requisito no parpadea si el mapa relee a mitad de PATCH",
  run: async ({ page, UI, api, esperar, expect }) => {
    const cabeceras = { "content-type": "application/json" };
    const creada = await api("/items?repo=lab", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({
        title: "Copia optimista",
        status: "roadmap",
        fases: [
          {
            orden: 1,
            titulo: "Única",
            estado: "pendiente",
            nota: "",
            requisitos: [{ orden: 1, titulo: "Comprobar", hecho: false }],
          },
        ],
      }),
    });
    expect(creada.status === 201, `no se pudo crear el ítem: ${creada.status}`);
    const uid = creada.data.uid;

    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();

    const fila = page.locator(".row", { hasText: "Copia optimista" }).first();
    await fila.waitFor();
    await fila.getByRole("button", { name: "Editar", exact: true }).click();
    const casilla = fila.getByRole("checkbox", { name: "Requisito Comprobar" });
    await casilla.waitFor();

    let soltar;
    const retenido = new Promise((resolver) => {
      soltar = resolver;
    });
    let atrapado;
    const enVuelo = new Promise((resolver) => {
      atrapado = resolver;
    });
    await page.route("**/items/**", async (route) => {
      if (route.request().method() === "PATCH") {
        atrapado();
        await retenido;
      }
      await route.continue();
    });
    // Se arma antes del clic para no perderse la respuesta del PATCH.
    const respuestaPatch = page.waitForResponse(
      (respuesta) =>
        respuesta.request().method() === "PATCH" && respuesta.url().includes(uid),
      { timeout: 15_000 },
    );

    let suelto = false;
    const liberar = async () => {
      if (suelto) return;
      suelto = true;
      soltar();
      await respuestaPatch.catch(() => {});
      await page.unroute("**/items/**").catch(() => {});
    };

    try {
      await casilla.click();
      expect(await casilla.isChecked(), "la casilla debe marcarse al instante");
      await enVuelo;

      // Cualquier evento hace que el SSE relea el mapa: el mismo contenido en
      // arrays nuevos. Antes, eso soltaba la copia y desmarcaba la casilla.
      const ruido = await api("/items?repo=lab", {
        method: "POST",
        headers: cabeceras,
        body: JSON.stringify({ title: "Ruido SSE", status: "proposed" }),
      });
      expect(ruido.status === 201, `no se pudo crear el ruido: ${ruido.status}`);
      await page.getByText("Ruido SSE", { exact: true }).first().waitFor();
      await page.waitForTimeout(300);
      expect(await casilla.isChecked(), "la relectura del mapa no debe desmarcar la casilla");
    } finally {
      await liberar();
    }

    await esperar(
      () => page.getByRole("checkbox", { name: "Requisito Comprobar" }).first().isChecked(),
      "la casilla marcada al confirmar el PATCH",
      10_000,
    );
    const leida = await api(`/items/${uid}?repo=lab`);
    expect(leida.status === 200, `no se pudo leer el ítem: ${leida.status}`);
    expect(
      leida.data.fases[0].requisitos[0].hecho === true,
      "el core no guardó el requisito marcado",
    );
  },
};
