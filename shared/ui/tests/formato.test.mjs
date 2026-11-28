/** Las fechas de la UI, siempre en el mismo idioma.
 *
 *  `fechaCorta` usaba el locale del navegador y los formateadores de Git
 *  fijaban `es-ES`: la misma fecha salía en dos idiomas. Aquí se fija el
 *  locale en un solo sitio y se prueba que no depende del sistema.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { fechaCommit, fechaCorta } from "../src/core/formato.ts";

// Mediodía UTC: el día no cambia en ninguna zona razonable.
const ISO = "2026-03-05T12:00:00Z";

test("la fecha corta va en es-ES aunque el navegador no lo esté", () => {
  const texto = fechaCorta(ISO);
  assert.match(texto, /mar/, `esperaba el mes en español, salió «${texto}»`);
  assert.doesNotMatch(texto, /AM|PM/, "salió en un locale de 12 horas");
});

test("la fecha del commit usa día de dos cifras y mes corto", () => {
  assert.match(fechaCommit(ISO), /^\d{2} mar$/);
});

test("una fecha ilegible se queda tal como vino", () => {
  assert.equal(fechaCorta("no-es-fecha"), "no-es-fecha");
  assert.equal(fechaCommit(""), "");
});
