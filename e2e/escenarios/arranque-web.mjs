/** La web se sirve sin CSS hasta que carga el bundle: el HTML tiene que
 *  declarar el fondo oscuro para no enseñar un fogonazo blanco. Y el favicon
 *  se pide siempre; sin enlace, el navegador se come un 404. */
export default {
  nombre: "arranque-web",
  descripcion: "index.html declara fondo y color-scheme, y el favicon responde",

  run: async ({ WEB, expect }) => {
    const html = await (await fetch(WEB)).text();
    expect(
      /<meta\s+name="color-scheme"\s+content="dark"/i.test(html),
      "index.html no declara color-scheme",
    );
    expect(
      /html\s*\{\s*background:\s*#0e1116/i.test(html),
      "index.html no pinta el fondo antes del bundle",
    );
    expect(
      /<link\s+rel="icon"[^>]+href="\/favicon\.svg"/i.test(html),
      "index.html no enlaza el favicon",
    );

    const icono = await fetch(new URL("/favicon.svg", WEB));
    expect(icono.ok, `el favicon responde ${icono.status}`);
    const svg = await icono.text();
    expect(svg.includes("<svg"), "el favicon no es un SVG");
    expect(
      (icono.headers.get("content-type") ?? "").includes("image/svg+xml"),
      `el favicon se sirve como ${icono.headers.get("content-type")}`,
    );
  },
};
