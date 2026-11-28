/** Reglas del teclado, sin React ni DOM.
 *
 *  La navegación por paradas es lógica pura: se prueba aquí y el hook solo la
 *  conecta a los eventos. Los avisos del sistema se retiraron, así que su
 *  política ya no existe.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import "./entorno-ts.mjs";

const { siguienteIndice } = await import("../src/mapa/paradas.ts");

test("siguienteIndice recorre las paradas en circular", () => {
  assert.equal(siguienteIndice(5, 2, 1), 3);
  assert.equal(siguienteIndice(5, 4, 1), 0);
  assert.equal(siguienteIndice(5, 0, -1), 4);
  assert.equal(siguienteIndice(5, 2, -1), 1);
});

test("siguienteIndice empieza por el principio o por el final si no hay selección", () => {
  assert.equal(siguienteIndice(5, -1, 1), 0);
  assert.equal(siguienteIndice(5, -1, -1), 4);
});

test("sin paradas no hay destino", () => {
  assert.equal(siguienteIndice(0, -1, 1), -1);
  assert.equal(siguienteIndice(0, 3, -1), -1);
});
