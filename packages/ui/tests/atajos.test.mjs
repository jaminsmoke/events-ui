/** Reglas del teclado y de los avisos, sin React ni DOM.
 *
 *  La navegación por paradas y la decisión de avisar son lógica pura: se
 *  prueban aquí y los hooks solo las conectan a los efectos.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { eventosNuevos, puedeAvisar } from "../src/core/avisosReglas.ts";
import { siguienteIndice } from "../src/mapa/paradas.ts";

const ajustes = (verbosidad, soloFondo = true) => ({ verbosidad, soloFondo });

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

test("sin verbosidad no se avisa de nada", () => {
  assert.equal(puedeAvisar(ajustes("apagado"), "evento", true), false);
  assert.equal(puedeAvisar(ajustes("apagado"), "error", true), false);
});

test("la verbosidad elige la clase de aviso", () => {
  assert.equal(puedeAvisar(ajustes("errores", false), "error", false), true);
  assert.equal(puedeAvisar(ajustes("errores", false), "evento", false), false);
  assert.equal(puedeAvisar(ajustes("eventos", false), "evento", false), true);
  assert.equal(puedeAvisar(ajustes("eventos", false), "error", false), false);
  assert.equal(puedeAvisar(ajustes("todo", false), "evento", false), true);
  assert.equal(puedeAvisar(ajustes("todo", false), "error", false), true);
});

test("soloFondo silencia lo que pasa con la ventana delante", () => {
  assert.equal(puedeAvisar(ajustes("todo", true), "evento", false), false);
  assert.equal(puedeAvisar(ajustes("todo", true), "evento", true), true);
  assert.equal(puedeAvisar(ajustes("todo", false), "evento", false), true);
});

test("eventosNuevos ignora el primer lote y filtra por id", () => {
  assert.deepEqual(eventosNuevos([{ id: 1 }, { id: 2 }], null), []);
  assert.deepEqual(eventosNuevos([{ id: 1 }, { id: 2 }, { id: 3 }], 1), [
    { id: 2 },
    { id: 3 },
  ]);
  assert.deepEqual(eventosNuevos([], 3), []);
});
