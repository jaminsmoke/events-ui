// La decisión de la recuperación es pura: compara el latido con un instante y
// no toca el almacén. `pruebaEnCurso.ts` solo usa `localStorage` dentro de sus
// funciones, así que Node lo carga con su type stripping.
import assert from "node:assert/strict";
import { test } from "node:test";

import { estadoDeMarca } from "../src/pruebaEnCurso.ts";

const AHORA = 1_000_000;
const marca = (latido) => ({ ejecucion: "e", prueba: "prueba-1", latido });

test("sin marca no hay nada que recuperar", () => {
  assert.equal(estadoDeMarca(null, AHORA), "ninguna");
});

test("un latido fresco es otra ejecución viva", () => {
  assert.equal(estadoDeMarca(marca(AHORA - 1_000), AHORA), "vigente");
});

test("un latido viejo es una prueba que murió sin limpiar", () => {
  assert.equal(estadoDeMarca(marca(AHORA - 60_000), AHORA), "pendiente");
});

test("el límite exacto ya cuenta como muerta", () => {
  assert.equal(estadoDeMarca(marca(AHORA - 12_000), AHORA), "pendiente");
  assert.equal(estadoDeMarca(marca(AHORA - 11_999), AHORA), "vigente");
});
