import { mkdir } from "node:fs/promises";
import path from "node:path";

/** Abre un repo en una página: el selector de la bienvenida o, si ya hay uno
 *  abierto, el botón «Cambiar». */
async function abrirRepo(pagina, nombre) {
  const boton = pagina.getByRole("button", { name: nombre, exact: true });
  const nuevo = pagina.getByRole("button", { name: "Nuevo ítem", exact: true });
  const cambiar = pagina.getByRole("button", { name: "Cambiar", exact: true });
  await boton.or(nuevo).first().waitFor({ timeout: 15_000 });
  if (!(await boton.isVisible())) {
    if (await cambiar.isVisible()) await cambiar.click();
    await boton.waitFor({ timeout: 15_000 });
  }
  await boton.click();
  await pagina.locator(".board").waitFor({ timeout: 15_000 });
}

async function crearItem(pagina, titulo) {
  await pagina.getByRole("button", { name: "Nuevo ítem", exact: true }).click();
  const formulario = pagina.locator(".nueva");
  await formulario.getByLabel("Título del ítem").fill(titulo);
  await formulario.getByRole("button", { name: "Crear ítem", exact: true }).click();
  await pagina.getByText(titulo).first().waitFor({ timeout: 15_000 });
}

/** Los títulos que el core tiene en un repo, por API (sin pasar por la UI). */
function titulos(respuesta) {
  const datos = respuesta.data;
  const items = Array.isArray(datos) ? datos : (datos?.items ?? []);
  return items.map((item) => item.title);
}

export default {
  nombre: "sincronia-dos-clientes",
  descripcion:
    "Desktop y web sobre el mismo core: un alta se ve en la otra en ≤2 s, dos repos a la vez sin " +
    "mezclarse y aviso cuando el core cae",
  run: async ({ page, web, UI, WEB, api, esperar, expect, tmp, matarCore, levantarCore }) => {
    // Segundo repo del laboratorio: cada app abrirá el suyo.
    const lab2 = path.join(tmp, "repos", "lab2");
    await mkdir(lab2, { recursive: true });
    const sembrado = await api("/mapa?repo=lab2");
    expect(sembrado.status === 200, `no se pudo sembrar lab2: HTTP ${sembrado.status}`);

    await Promise.all([
      page.goto(UI, { waitUntil: "domcontentloaded" }),
      web.goto(WEB, { waitUntil: "domcontentloaded" }),
    ]);
    await abrirRepo(page, "lab");
    // Las dos empiezan en el mismo repo: es donde se mide la sincronía.
    await abrirRepo(web, "lab");

    // 1) Un alta hecha en desktop se ve en la web en ≤2 s.
    const desdeDesktop = `Sincronía desktop ${Date.now()}`;
    await page.getByRole("button", { name: "Nuevo ítem", exact: true }).click();
    const formulario = page.locator(".nueva");
    await formulario.getByLabel("Título del ítem").fill(desdeDesktop);
    const inicio = Date.now();
    await formulario.getByRole("button", { name: "Crear ítem", exact: true }).click();
    await web.getByText(desdeDesktop).first().waitFor({ timeout: 5_000 });
    const ms = Date.now() - inicio;
    expect(ms <= 2_000, `la web tardó ${ms} ms en ver el alta (tope 2000)`);
    console.log(`  sincronía desktop → web: ${ms} ms`);

    // 2) Cada app en su repo: lo de una no aparece en la otra.
    await abrirRepo(web, "lab2");
    await esperar(
      () => web.getByText(desdeDesktop).count().then((n) => n === 0),
      "la web cambia a lab2",
      15_000,
    );
    const desdeWeb = `Sincronía web ${Date.now()}`;
    await crearItem(web, desdeWeb);
    expect(
      (await page.getByText(desdeWeb).count()) === 0,
      "el ítem del repo de la web no debe aparecer en desktop",
    );
    expect(
      (await web.getByText(desdeDesktop).count()) === 0,
      "el ítem del repo de desktop no debe aparecer en la web",
    );
    const enLab = await api("/items?repo=lab");
    const enLab2 = await api("/items?repo=lab2");
    expect(titulos(enLab).includes(desdeDesktop), "lab debe tener el ítem de desktop");
    expect(!titulos(enLab).includes(desdeWeb), "lab no debe tener el ítem de la web");
    expect(titulos(enLab2).includes(desdeWeb), "lab2 debe tener el ítem de la web");
    expect(!titulos(enLab2).includes(desdeDesktop), "lab2 no debe tener el ítem de desktop");

    // 3) Si cae el core que arrancó el desktop, la web lo dice y se recupera
    //    cuando vuelve (el relevo es volver a lanzar `eui web`).
    await matarCore();
    await web.getByText(/Sin conexión con el core/).waitFor({ timeout: 15_000 });
    await levantarCore();
    await esperar(
      () => web.getByText(/Sin conexión con el core/).count().then((n) => n === 0),
      "el aviso de core caído desaparece",
      20_000,
    );
    await esperar(
      () => web.getByText(desdeWeb).first().isVisible(),
      "la web vuelve a leer su mapa",
      20_000,
    );
  },
};
