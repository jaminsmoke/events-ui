import { mkdir } from "node:fs/promises";
import path from "node:path";

/** El selector de carpeta es uno solo: las dos apps enseñan el explorador,
 *  la lista de repos y la ruta manual. El diálogo nativo de desktop es una
 *  acción extra, no una pantalla distinta.
 *
 *  Además, navegar dos carpetas seguidas no puede dejar abierta la primera:
 *  la respuesta lenta de `uno` no pisa la última pulsación (`dos`). */
export default {
  nombre: "selector-compartido",
  descripcion:
    "Web y desktop con el mismo explorador de carpetas; navegar dos carpetas seguidas abre la última",

  run: async ({ page, web, UI, WEB, tmp, expect }) => {
    const selector = path.join(tmp, "selector");
    await mkdir(path.join(selector, "uno"), { recursive: true });
    await mkdir(path.join(selector, "dos"), { recursive: true });

    await Promise.all([
      page.goto(UI, { waitUntil: "domcontentloaded" }),
      web.goto(WEB, { waitUntil: "domcontentloaded" }),
    ]);

    // 1) Las dos apps pintan las mismas tres vías. Hoy desktop no pinta el
    //    explorador y esta espera se agota. Un escenario anterior puede haber
    //    dejado un repo abierto en la página: se abre el selector con Cambiar.
    for (const [etiqueta, app] of [
      ["desktop", page],
      ["web", web],
    ]) {
      const cambiar = app.getByRole("button", { name: "Cambiar", exact: true });
      if ((await cambiar.count()) > 0 && (await cambiar.isVisible())) {
        await cambiar.click();
      }
      await app.getByText("Explorador de carpetas").waitFor({ timeout: 15_000 });
      await app.getByLabel("Ruta del repositorio").waitFor({ timeout: 15_000 });
      await app
        .getByRole("button", { name: "Abrir esta carpeta", exact: true })
        .waitFor({ timeout: 15_000 });
      expect(
        (await app.locator(".explorador").count()) === 1,
        `${etiqueta} debe tener un solo explorador`,
      );
    }

    // 2) Navegar a `selector` y pulsar `uno` y `dos` en el mismo turno. La
    //    respuesta de `uno` tarda 800 ms a propósito: la última pulsación
    //    manda aunque su respuesta llegue antes.
    await web.getByRole("button", { name: "selector", exact: true }).click();
    await web.getByRole("button", { name: "uno", exact: true }).waitFor({ timeout: 15_000 });

    await web.route(
      (url) => url.pathname.endsWith("/api/fs"),
      async (route) => {
        const ruta = new URL(route.request().url()).searchParams.get("path") ?? "";
        if (ruta.replace(/\\/g, "/").endsWith("/selector/uno")) {
          await new Promise((resolve) => setTimeout(resolve, 800));
        }
        await route.continue();
      },
    );

    await web.evaluate(() => {
      const botones = [...document.querySelectorAll(".explorador-lista button")];
      const porNombre = (nombre) =>
        botones.find((boton) => boton.textContent?.includes(nombre));
      porNombre("uno")?.click();
      porNombre("dos")?.click();
    });

    await web.waitForFunction(
      () =>
        (document.querySelector(".explorador-ruta")?.textContent ?? "")
          .replace(/\\/g, "/")
          .endsWith("/selector/dos"),
      null,
      { timeout: 5_000 },
    );

    // La ruta que se abriría es la que se ve: la última pulsada.
    const visible = await web.locator(".explorador-ruta").textContent();
    expect(
      (visible ?? "").replace(/\\/g, "/").endsWith("/selector/dos"),
      `el explorador se quedó en ${visible}`,
    );
  },
};
