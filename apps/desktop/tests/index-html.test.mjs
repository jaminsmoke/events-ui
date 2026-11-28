/** El `index.html` del desktop no puede divergir del de la web.
 *
 *  La ventana de Tauri enseña el HTML antes de que llegue el bundle: sin
 *  `color-scheme`, `theme-color` y el fondo oscuro del `<style>`, la primera
 *  pintura es blanca. El de la web ya lo tenía y el del desktop no.
 *
 *  El favicon no entra en la comparación: la web sirve `/favicon.svg` desde su
 *  `public/` y la ventana del desktop usa el icono de la app.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const DESKTOP = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const WEB = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");

/** Las metas con `name`, ordenadas: el orden en el HTML no importa. */
function metas(html) {
  return [...html.matchAll(/<meta\s+name="([^"]+)"/g)].map((m) => m[1]).sort();
}

test("el desktop declara las mismas metas que la web", () => {
  assert.deepEqual(metas(DESKTOP), metas(WEB));
});

test("el fondo oscuro se pinta antes de que llegue el bundle", () => {
  assert.match(
    DESKTOP,
    /html\s*\{[^}]*background:\s*#0e1116/,
    "falta el <style> con el fondo oscuro: la ventana abriría en blanco",
  );
});
