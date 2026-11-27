/** Fila e inspector comparten la lista de traslados y su bloqueo.
 *
 *  Si cada superficie vuelve a leer `ACCIONES_ESTADO` o `motivoBloqueo`, las
 *  dos pueden ofrecer acciones distintas para el mismo ítem. La fuente de
 *  verdad es `BotonesMover`.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const raiz = new URL("..", import.meta.url);
const leer = (ruta) => readFile(new URL(ruta, raiz), "utf8");

test("fila e inspector comparten el borrado confirmado", async () => {
  const fuentes = [
    ["fila", await leer("src/mapa/fila.tsx")],
    ["inspector", await leer("src/pantalla/InspectorItem.tsx")],
  ];
  for (const [nombre, fuente] of fuentes) {
    assert.match(fuente, /BotonEliminar/, `${nombre} no usa el botón de borrar compartido`);
    assert.doesNotMatch(
      fuente,
      /confirmando|¿Eliminar del todo\?/,
      `${nombre} conserva su copia de la confirmación de borrar`,
    );
  }
});

test("fila e inspector comparten los botones de traslado", async () => {
  const fuentes = [
    ["fila", await leer("src/mapa/fila.tsx")],
    ["inspector", await leer("src/pantalla/InspectorItem.tsx")],
  ];
  for (const [nombre, fuente] of fuentes) {
    assert.match(fuente, /BotonesMover/, `${nombre} no usa BotonesMover`);
    assert.doesNotMatch(
      fuente,
      /ACCIONES_ESTADO|motivoBloqueo/,
      `${nombre} duplica la lista de acciones o el bloqueo`,
    );
  }
});
