export default {
  nombre: "prueba-fases",
  descripcion:
    "Roadmap exige fases, verificación las exige cerradas y la ficha enseña su detalle",
  run: async ({ page, UI, api, esperar, expect }) => {
    const cabeceras = { "content-type": "application/json" };
    const crear = await api("/ideas?repo=lab", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({ title: "Fases E2E", status: "proposed" }),
    });
    expect(crear.status === 201, `no se pudo crear la idea: ${crear.status}`);
    const uid = crear.data.uid;
    const idea = async () => (await api(`/ideas/${uid}?repo=lab`)).data;

    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();
    await page.getByText("Fases E2E", { exact: true }).waitFor();
    await esperar(() => page.locator(".wire").count().then((n) => n === 5), "los cinco cables");

    /** La fila del carril que toque; el mapa la remonta al cambiar de nodo. */
    const filaEn = (carril) =>
      page.locator(`.lane-${carril} .row`, { hasText: "Fases E2E" }).first();
    const fila = () => page.locator(".row", { hasText: "Fases E2E" }).first();
    const abrir = async (carril) => {
      const actual = carril ? filaEn(carril) : fila();
      const cabeza = actual.locator(".row-head");
      await cabeza.waitFor();
      if ((await cabeza.getAttribute("aria-expanded")) !== "true") await cabeza.click();
      await actual.locator(".fases").waitFor();
      return actual;
    };

    let actual = await abrir();

    // Las fases se añaden desde la fila, no por la API.
    const anadir = async (titulo, cuantas) => {
      await actual.getByLabel("Nueva fase").fill(titulo);
      await actual.getByLabel("Primer requisito").fill(`Requisito de ${titulo}`);
      await actual.getByRole("button", { name: "Añadir", exact: true }).click();
      await esperar(
        () => actual.locator(".fase").count().then((n) => n === cuantas),
        `la fase «${titulo}»`,
        15_000,
      );
    };
    await anadir("Diseño", 1);
    await anadir("Prueba", 2);

    // Entrar en roadmap ya no está bloqueado: hay dos fases.
    const aRoadmap = actual.getByRole("button", { name: "A roadmap", exact: true });
    await esperar(async () => !(await aRoadmap.isDisabled()), "A roadmap habilitado");
    await aRoadmap.click();
    await esperar(async () => (await idea()).status === "roadmap", "la idea en roadmap");
    await esperar(
      () => filaEn("roadmap").count().then((n) => n === 1),
      "la fila en el carril de roadmap",
    );
    actual = await abrir("roadmap");

    // Con fases pendientes, verificación está cerrada por protocolo.
    const aVerificacion = actual.getByRole("button", {
      name: "A verificación",
      exact: true,
    });
    expect(
      await aVerificacion.isDisabled(),
      "A verificación debería estar bloqueado con fases pendientes",
    );

    await esperar(
      () => actual.locator(".fase-estado").count().then((n) => n === 2),
      "los dos selectores de fase",
    );
    // Cada fase nace con su requisito y las checklists se abren solas en
    // roadmap: se marcan antes de completar, o «completada» está apagada.
    await esperar(
      () => actual.locator(".requisito input").count().then((n) => n === 2),
      "los dos requisitos",
    );
    await actual.locator(".requisito input").nth(0).check();
    await esperar(async () => (await idea()).fases[0].requisitos[0].hecho === true, "el primero hecho");
    await actual.locator(".requisito input").nth(1).check();
    await esperar(async () => (await idea()).fases[1].requisitos[0].hecho === true, "el segundo hecho");
    await actual.locator(".fase-estado").nth(0).selectOption("completada");
    await esperar(async () => (await idea()).fases[0].estado === "completada", "la primera completada");
    // El selector refleja el estado antes de tocar el segundo: si no, el PATCH
    // siguiente reenviaría la lista vieja y desharía el primero.
    await esperar(
      async () => (await actual.locator(".fase-estado").nth(0).inputValue()) === "completada",
      "el selector de la primera",
    );
    await actual.locator(".fase-estado").nth(1).selectOption("completada");
    await esperar(
      async () => (await idea()).fases.every((f) => f.estado === "completada"),
      "las dos completadas",
    );

    await esperar(async () => !(await aVerificacion.isDisabled()), "A verificación habilitado");
    await aVerificacion.click();
    await esperar(async () => (await idea()).status === "verificacion", "la idea en verificación");
    await esperar(
      () => filaEn("verificacion").count().then((n) => n === 1),
      "la fila en el carril de verificación",
    );
    actual = await abrir("verificacion");

    // La ficha aparte enseña estado, nota y fecha de cada fase.
    await actual.getByRole("button", { name: /Fases · 2\/2/ }).click();
    const ficha = page.getByRole("dialog", { name: "Fases de la idea" });
    await ficha.waitFor();
    const texto = await ficha.innerText();
    expect(texto.includes("Diseño") && texto.includes("Prueba"), "la ficha no lista las fases");
    expect(
      (texto.match(/Completada/g) ?? []).length === 2,
      "la ficha no marca las dos como completadas",
    );
    expect(texto.includes("2 de 2 completadas"), "la ficha no resume el avance");
    await ficha.getByRole("button", { name: "Cerrar", exact: true }).click();
    await ficha.waitFor({ state: "detached" });

    // Sin ninguna fase, «todas completadas» se cumpliría por vacuidad: aprobar
    // exige además al menos una.
    for (const cuantas of [1, 0]) {
      await actual.locator(".fase .chip-quitar").nth(0).click();
      await esperar(async () => (await idea()).fases.length === cuantas, `${cuantas} fases`);
      await esperar(
        () => actual.locator(".fase").count().then((n) => n === cuantas),
        `la fila con ${cuantas} fases`,
      );
    }
    const aprobar = actual.getByRole("button", { name: "Aprobar revisión", exact: true });
    await esperar(() => aprobar.isDisabled(), "Aprobar revisión bloqueado sin fases");
    await actual.getByText("Añade una fase para aprobar.").waitFor();
  },
};
