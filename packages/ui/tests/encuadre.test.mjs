/** El encuadre del mapa: una sola regla para la cámara.
 *
 *  El mapa nunca se agranda por encima de su tamaño real, nunca baja del
 *  suelo legible y se centra en el área que queda libre (sin contar el
 *  relleno del lienzo ni el panel derecho). */
import assert from "node:assert/strict";
import { test } from "node:test";

import { encuadreDe } from "../src/mapa/camara.ts";

const MAPA = { ancho: 2200, alto: 400 };
const BOARD = { ancho: 712, alto: 506 };
const RELLENO = { arriba: 8, abajo: 64 };

const cerca = (actual, esperado, mensaje) =>
  assert.ok(
    Math.abs(actual - esperado) < 1e-6,
    `${mensaje}: ${actual} no es ${esperado}`,
  );

test("el encuadre no baja del suelo legible aunque el mapa no quepa", () => {
  const vista = encuadreDe({
    mapa: MAPA,
    board: BOARD,
    offset: { x: 0, y: 46 },
    relleno: RELLENO,
  });
  assert.equal(vista.k, 0.5);
  // El mapa se recorta por la derecha, pero empieza en la Entrada: no se
  // centra un mapa que no cabe, o desaparecería la primera columna.
  assert.equal(vista.x, 0);
});

test("el encuadre centra el mapa en el alto visible, sin contar el relleno", () => {
  const vista = encuadreDe({
    mapa: MAPA,
    board: BOARD,
    offset: { x: 0, y: 46 },
    relleno: RELLENO,
  });
  const altoVisible = BOARD.alto - RELLENO.arriba - RELLENO.abajo;
  const centroMapa = vista.y + 46 + (MAPA.alto * vista.k) / 2;
  cerca(centroMapa, RELLENO.arriba + altoVisible / 2, "centro vertical");
});

test("si no cabe, el mapa empieza en el borde izquierdo visible", () => {
  const vista = encuadreDe({
    mapa: MAPA,
    board: BOARD,
    offset: { x: 0, y: 46 },
    relleno: RELLENO,
  });
  assert.equal(vista.x, 0);
});

test("el encuadre cabe entero cuando hay sitio y no agranda por encima de 1", () => {
  const vista = encuadreDe({
    mapa: { ancho: 400, alto: 200 },
    board: { ancho: 1200, alto: 800 },
    offset: { x: 0, y: 0 },
    relleno: { arriba: 0, abajo: 0 },
  });
  assert.equal(vista.k, 1);
  cerca(vista.x, 400, "centro horizontal");
  cerca(vista.y, 300, "centro vertical");
});

test("el panel derecho se descuenta del ancho visible", () => {
  const sinPanel = encuadreDe({
    mapa: MAPA,
    board: { ancho: 1600, alto: 900 },
    offset: { x: 0, y: 0 },
    relleno: { arriba: 0, abajo: 0 },
  });
  const conPanel = encuadreDe({
    mapa: MAPA,
    board: { ancho: 1600, alto: 900 },
    offset: { x: 0, y: 0 },
    relleno: { arriba: 0, abajo: 0 },
    insetDerecha: 272,
  });
  assert.ok(conPanel.k < sinPanel.k, "el panel reduce la escala");
  // Centrado en el hueco visible: el centro se mueve a la izquierda aunque
  // el borde izquierdo quede en el mismo sitio.
  const centroSin = sinPanel.x + (MAPA.ancho * sinPanel.k) / 2;
  const centroCon = conPanel.x + (MAPA.ancho * conPanel.k) / 2;
  assert.ok(centroCon < centroSin, "el centro se mueve a la izquierda");
});
