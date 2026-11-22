// El editor no pierde las etiquetas al refrescarse el mapa ni cuando la
// lectura de la idea falla: un cambio externo no pisa el borrador, y un
// guardado que solo toca el título no borra las etiquetas guardadas.

export default {
  nombre: "editor-conserva-etiquetas",
  descripcion: "El borrador de tags sobrevive al refresco y un fallo de lectura no los borra al guardar",

  run: async (ctx) => {
    const { page, api, esperar, expect, resultado } = ctx;

    const abrirEditor = async (titulo) => {
      await page.goto(`${ctx.UI}/`, { waitUntil: "networkidle", timeout: 30_000 });
      const selector = page.getByRole("button", { name: "lab" });
      if ((await selector.count()) > 0) await selector.click();
      await esperar(
        () => page.evaluate((t) => document.body.innerText.includes(t), titulo),
        `la idea ${titulo} en el mapa`,
        30_000,
      );
      await page.getByRole("button", { name: new RegExp(titulo) }).click();
      await page.getByRole("button", { name: "Editar", exact: true }).click();
      await page.getByRole("button", { name: "Datos…", exact: true }).click();
      await esperar(
        () => page.getByRole("dialog", { name: "Editar ítem" }).isVisible(),
        "el editor abierto",
        10_000,
      );
    };

    // 1) El refresco periódico (y un cambio externo) no pisan el borrador.
    const creada = await api("/ideas?repo=lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Titulo de etiquetas", tags: ["base", "q3"] }),
    });
    await expect(creada.status === 201, "la creación devuelve 201");
    const uid = creada.data.uid;

    await abrirEditor("Titulo de etiquetas");
    const tags = page.getByLabel("Tags", { exact: true });
    await esperar(async () => (await tags.inputValue()) === "base, q3", "las tags precargadas", 10_000);
    await tags.fill("base, q3, tocado");

    // Un cambio por la API fuerza un refresco del mapa con el editor abierto.
    const externa = await api(`/ideas/${uid}?repo=lab`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "cambio externo" }),
    });
    await expect(externa.status === 200, "el cambio externo devuelve 200");
    await page.waitForTimeout(2_500);
    await expect(
      (await tags.inputValue()) === "base, q3, tocado",
      "el refresco conserva el borrador de tags",
    );

    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await esperar(
      () => page.getByRole("dialog", { name: "Editar ítem" }).count().then((n) => n === 0),
      "el editor se cierra tras guardar",
      10_000,
    );
    const trasGuardar = await api(`/ideas/${uid}?repo=lab`);
    await expect(
      JSON.stringify(trasGuardar.data.tags) === JSON.stringify(["base", "q3", "tocado"]),
      "las tags guardadas son las del borrador",
    );

    // 2) Si la lectura falla, cambiar solo el título conserva las etiquetas.
    const segunda = await api("/ideas?repo=lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Titulo con fallo", tags: ["conservadas"] }),
    });
    await expect(segunda.status === 201, "la segunda creación devuelve 201");
    const uid2 = segunda.data.uid;

    let fallarLectura = true;
    await page.route("**/api/ideas/*", async (route) => {
      if (route.request().method() === "GET" && fallarLectura) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ detail: "fallo de lectura" }),
        });
      } else {
        await route.continue();
      }
    });

    await abrirEditor("Titulo con fallo");
    await esperar(
      () =>
        page.evaluate(() =>
          document.body.innerText.includes("No se pudieron cargar las etiquetas"),
        ),
      "el aviso de lectura fallida",
      10_000,
    );
    fallarLectura = false;
    await page.getByLabel("Título", { exact: true }).fill("Titulo retocado");
    await page.getByRole("button", { name: "Guardar", exact: true }).click();
    await esperar(
      () => page.getByRole("dialog", { name: "Editar ítem" }).count().then((n) => n === 0),
      "el editor se cierra tras el guardado sin tags",
      10_000,
    );

    const conservadas = await api(`/ideas/${uid2}?repo=lab`);
    await expect(conservadas.data.title === "Titulo retocado", "el título sí se guardó");
    await expect(
      JSON.stringify(conservadas.data.tags) === JSON.stringify(["conservadas"]),
      "sin tocar tags, el guardado las conserva",
    );
    await page.screenshot({ path: resultado("editor-conserva-etiquetas.png") });
  },
};
