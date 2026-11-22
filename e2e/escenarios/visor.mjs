import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export default {
  nombre: "visor",
  descripcion: "El Explorador abre Markdown renderizado/raw y código resaltado en el visor",
  run: async ({ page, UI, esperar, expect, resultado, tmp }) => {
    const lab = path.join(tmp, "repos", "lab");
    const md = path.join(lab, "visor-prueba.md");
    const ts = path.join(lab, "visor-prueba.ts");
    const json = path.join(lab, "visor-prueba.json");
    const png = path.join(lab, "visor-prueba.png");

    writeFileSync(
      md,
      "# Visor de prueba\n\nTexto **fuerte**.\n\n![punto](visor-prueba.png)\n\n```ts\nconst x: number = 1;\n```\n",
      "utf8",
    );
    writeFileSync(ts, "export const cuadrado = (n: number): number => n * n;\n", "utf8");
    writeFileSync(json, '{"a":1,"b":[2,3]}\n', "utf8");
    // PNG 1×1 válido: basta para comprobar el endpoint y el <img>.
    writeFileSync(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64",
      ),
    );

    try {
      await page.goto(UI, { waitUntil: "domcontentloaded" });
      const selector = page.getByRole("button", { name: "lab", exact: true });
      const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
      await selector.or(pruebas).first().waitFor();
      if (await selector.isVisible()) await selector.click();

      await page.getByRole("button", { name: "Archivos", exact: true }).click();
      await page.locator(".arbol").waitFor();
      const filaMd = page.locator('.arbol-archivo[title="visor-prueba.md"]');
      await filaMd.waitFor();
      expect(
        (await filaMd.innerText()).includes(".md"),
        "el árbol debe enseñar la extensión",
      );
      await filaMd.click();

      const visor = page.locator(".visor");
      await visor.waitFor();
      expect(
        (await page.locator('.resumen[aria-label="Panel derecho"] .visor').count()) === 1,
        "el visor vive en el panel derecho",
      );
      await visor.getByRole("heading", { name: "Visor de prueba" }).waitFor();
      expect(
        (await visor.innerText()).includes("Texto fuerte."),
        "el Markdown debe renderizarse",
      );
      await esperar(
        () =>
          visor
            .locator(".visor-md-imagen")
            .evaluateAll((imgs) => imgs.some((img) => img.naturalWidth > 0)),
        "la imagen relativa del Markdown",
      );
      await page.screenshot({ path: resultado("visor-md.png") });

      // Raw: el fuente completo, con su bloque de código, en vez del render.
      await visor.getByRole("tab", { name: "Raw" }).click();
      await esperar(
        () => visor.innerText().then((t) => t.includes("# Visor de prueba")),
        "el Markdown en raw",
      );
      expect(
        (await visor.locator(".visor-codigo").innerText()).includes("const x"),
        "el raw debe enseñar el bloque de código",
      );

      // Código: números de línea y tokens con color de Shiki. La vista cambia
      // de archivo sin cerrar el panel.
      await page.locator('.arbol-archivo[title="visor-prueba.ts"]').click();
      await esperar(
        () => visor.locator(".visor-linea").count().then((n) => n >= 1),
        "el código con líneas",
      );
      await esperar(
        () => visor.locator(".visor-texto span[style*='color']").count().then((n) => n > 0),
        "el resaltado de Shiki",
        20_000,
      );
      expect((await visor.innerText()).includes("cuadrado"), "el código debe verse");
      await page.screenshot({ path: resultado("visor-codigo.png") });

      // JSON: se abre formateado y el original sigue a un clic.
      await page.locator('.arbol-archivo[title="visor-prueba.json"]').click();
      await esperar(
        () => visor.innerText().then((t) => t.includes('"a": 1')),
        "el JSON formateado",
      );
      await visor.getByRole("tab", { name: "Original" }).click();
      await esperar(
        () =>
          visor.locator(".visor-codigo").innerText().then((t) => t.includes('{"a":1')),
        "el JSON original",
      );

      // Imagen del repo: se pinta como imagen, con sus medidas, no como texto.
      await page.locator('.arbol-archivo[title="visor-prueba.png"]').click();
      const imagen = visor.locator(".visor-imagen-real");
      await imagen.waitFor();
      await esperar(
        () => imagen.evaluate((img) => img.naturalWidth > 0),
        "la imagen del visor",
      );
      expect((await visor.innerText()).includes("1 × 1 px"), "las medidas de la imagen");
      await page.screenshot({ path: resultado("visor-imagen.png") });

      await page.keyboard.press("Escape");
      await esperar(
        () => page.locator(".visor").count().then((n) => n === 0),
        "Escape cierra el visor",
      );
      await esperar(
        () => page.locator(".resumen").count().then((n) => n === 0),
        "Escape cierra el panel del visor",
      );
    } finally {
      rmSync(md, { force: true });
      rmSync(ts, { force: true });
      rmSync(json, { force: true });
      rmSync(png, { force: true });
    }
  },
};
