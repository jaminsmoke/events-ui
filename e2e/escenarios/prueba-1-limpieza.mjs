// Prueba 1 de punta a punta (la del algoritmo de caja): 10 ideas creadas en
// el cajón, 7 a En cola y 3 a Descartadas, y al terminar la limpieza
// automática —el tablero queda a cero y el registro lo cuenta.

export default {
  nombre: "prueba-1-limpieza",
  descripcion: "Prueba 1 completa + limpieza automática, con el registro asumiendo su parte",

  run: async (ctx) => {
    const { page, api, esperar, expect, resultado } = ctx;
    const url = `${ctx.UI}/`;

    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.getByRole("button", { name: "lab" }).click();
    await page.waitForTimeout(2000);

    await page.getByRole("button", { name: "Pruebas" }).click();
    await page.waitForTimeout(600);
    await page.getByRole("button", { name: "Lanzar" }).click();

    await esperar(
      () => page.evaluate(() => document.body.innerText.includes("Completada")),
      "la prueba a completarse",
      60_000,
    );
    await page.screenshot({ path: resultado("prueba-1-terminada.png") });

    // El mapa («10 ideas») se refresca al instante; la tarjeta de proyección
    // que dice cola/descartadas cabecea cada 5 s: se espera también por ella.
    await esperar(
      () => page.evaluate(() => document.body.innerText.includes("descartadas: 3")),
      "la proyección a ponerse al día",
      30_000,
    );
    const tablero = await page.evaluate(() => document.body.innerText);
    await expect(tablero.includes("10 ideas"), "tras lanzar, el tablero dice 10 ideas");
    await expect(tablero.includes("cola: 7"), "tras lanzar, 7 en cola");
    await expect(tablero.includes("descartadas: 3"), "tras lanzar, 3 descartadas");

    // Limpieza automática (el modal de Pruebas reinicia el proyecto).
    await page.getByRole("button", { name: "Limpiar" }).click();
    await esperar(
      () =>
        page.evaluate(() =>
          document.body.innerText.includes("Todavía no hay ideas en este repo."),
        ),
      "el tablero a quedar vacío",
      20_000,
    );

    const mapaR = await api("/mapa?repo=lab");
    await expect(mapaR.data?.ideas?.length === 0, "tras limpiar no quedan ideas");
    await expect(mapaR.data?.connections?.length === 0, "tras limpiar no quedan conexiones");

    const registro = await api("/log?limite=5");
    const ultimo = registro.data?.[0];
    await expect(
      ultimo?.mensaje?.startsWith("Reinicio de laboratorio en lab: 10 ideas"),
      `el registro cuenta el reinicio (vino: ${ultimo?.mensaje ?? "nada"})`,
    );

    await page.screenshot({ path: resultado("prueba-1-limpia.png") });
  },
};
