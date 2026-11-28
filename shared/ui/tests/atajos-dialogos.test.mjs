/** Los atajos no pueden dispararse detrás de un diálogo.
 *
 *  `+ − 0 f` y las flechas viven en `window`/`document`; un modal abierto no
 *  debe mover la cámara ni cambiar la selección. Tampoco dentro de un
 *  `contenteditable`, que no es un input.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const raiz = new URL("..", import.meta.url);
const leer = (ruta) => readFile(new URL(ruta, raiz), "utf8");

test("la cámara ignora los atajos con un diálogo abierto", async () => {
  const camara = await leer("src/mapa/camara.ts");
  assert.match(camara, /\[role="dialog"\]/, "la cámara no mira los diálogos");
  assert.match(camara, /isContentEditable/, "la cámara no respeta contenteditable");
});

test("el lienzo no cambia la selección detrás de un diálogo", async () => {
  const atajos = await leer("src/mapa/atajos.ts");
  assert.match(atajos, /\[role="dialog"\]/, "los atajos no miran los diálogos");
});
