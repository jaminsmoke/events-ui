/** Lo que no puede volver al Mapa de Documentos: capas y nodos sin tope.
 *
 *  Con 200 documentos el nodo del Changelog medía 5.332 px (el mapa, 5.376) y
 *  cada fila retenía su animación (`fill: both`), así que el compositor
 *  rasterizaba cientos de bordes de 1 px dentro de una capa gigante: al
 *  desplazar y hacer zoom quedaban las «líneas fantasma». La guarda lee las
 *  hojas, que es donde viven las reglas.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const NODO = readFileSync(new URL("../src/styles/nodo.css", import.meta.url), "utf8");
const MAPA = readFileSync(new URL("../src/styles/mapa.css", import.meta.url), "utf8");

function bloque(css, selector) {
  const inicio = css.indexOf(`\n${selector} {`);
  assert.ok(inicio >= 0, `no está el bloque ${selector}`);
  return css.slice(inicio, css.indexOf("}", inicio));
}

test("el archivo no estira el mapa: el nodo se acota y su cuerpo rueda", () => {
  assert.match(
    bloque(MAPA, ".linea-documentos"),
    /--altura-documentos:/,
    "el alto del archivo debe salir de una variable",
  );
  assert.match(
    bloque(MAPA, ".linea.linea-documentos > .node"),
    /max-height: var\(--altura-documentos\)/,
    "sin tope, el Changelog largo vuelve a medir miles de píxeles",
  );
  assert.match(
    bloque(MAPA, ".linea-documentos > .node > .node-body"),
    /overflow-y: auto/,
    "la lista tiene que rodar dentro del nodo, no estirarlo",
  );
});

test("la fila suelta su capa al terminar: `llegar` no retiene el estado", () => {
  const fila = bloque(NODO, ".row");
  assert.match(fila, /animation: llegar 420ms[^;]*backwards;/, "llegar debe quedarse en `backwards`");
  assert.doesNotMatch(fila, /\bboth;/, "con `both` la fila queda aplicada y el compositor la mantiene como capa");
});

test("el mapa no se promociona: el texto se rasteriza a la escala real", () => {
  assert.doesNotMatch(
    bloque(MAPA, ".map"),
    /will-change/,
    "`will-change: transform` deja el texto estirado desde la textura y borroso con zoom",
  );
});
