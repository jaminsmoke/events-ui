/** ¿Cuándo hay que ofrecer reencuadrar? Solo cuando el esquema se sale.
 *
 *  La regla está en `mapa/recorte.ts`, sin hook ni jsdom de verdad: solo pide
 *  `getBoundingClientRect`, así que un objeto con esa función basta.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

const { recortadoDe } = await import("../src/mapa/recorte.ts");

const caja = (left, top, right, bottom) => ({
  left,
  top,
  right,
  bottom,
  width: right - left,
  height: bottom - top,
  x: left,
  y: top,
  toJSON() {},
});

const elemento = (rect) => ({ getBoundingClientRect: () => rect });

test("sin tablero no hay nada que recortar", () => {
  assert.equal(recortadoDe(elemento(caja(0, 0, 10, 10)), null), false);
});

test("un esquema dentro del tablero no está recortado", () => {
  const map = elemento(caja(10, 10, 90, 90));
  const board = elemento(caja(0, 0, 100, 100));
  assert.equal(recortadoDe(map, board), false);
});

test("si se sale por abajo, está recortado", () => {
  const map = elemento(caja(10, 10, 90, 120));
  const board = elemento(caja(0, 0, 100, 100));
  assert.equal(recortadoDe(map, board), true);
});

test("el panel derecho tapa el canto y eso también cuenta", () => {
  const map = elemento(caja(10, 10, 90, 90));
  const board = elemento(caja(0, 0, 100, 100));
  assert.equal(recortadoDe(map, board, 0), false);
  assert.equal(recortadoDe(map, board, 20), true);
});
