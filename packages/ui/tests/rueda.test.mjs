/** La rueda ancla el zoom en el cursor aunque lleguen varios eventos por frame.
 *
 *  Antes el manejador leía el `getBoundingClientRect` del mapa (con su
 *  transform) antes de `setVista`: con dos eventos en el mismo frame, el
 *  segundo anclaba con el rect viejo y el punto bajo el cursor se escapaba.
 *  La cuenta vive en `vistaDeRueda`, que recibe la esquina del mapa sin
 *  transform (`offsetLeft`/`offsetTop`), así que no envejece.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { vistaDeRueda } from "../src/mapa/camara.ts";

const cerca = (a, b, margen = 1e-6) => Math.abs(a - b) <= margen;

test("dos pasos de rueda en el mismo frame dejan el cursor sobre el mismo punto", () => {
  const base = { x: 0, y: 0 };
  const cursor = { x: 400, y: 300 };
  const v0 = { x: 0, y: 0, k: 1 };
  const local = (v) => ({
    x: (cursor.x - base.x - v.x) / v.k,
    y: (cursor.y - base.y - v.y) / v.k,
  });

  const v1 = vistaDeRueda(v0, base, cursor, -100);
  const v2 = vistaDeRueda(v1, base, cursor, -100);

  assert.ok(v1.k > v0.k && v2.k > v1.k, "la rueda no acercó");
  assert.ok(cerca(local(v1).x, local(v0).x), "el primer paso movió el ancla");
  assert.ok(cerca(local(v1).y, local(v0).y), "el primer paso movió el ancla");
  assert.ok(cerca(local(v2).x, local(v1).x), "el segundo paso movió el ancla");
  assert.ok(cerca(local(v2).y, local(v1).y), "el segundo paso movió el ancla");
});

test("alejar desde «ver completo» no mueve la cámara", () => {
  const v = { x: 12, y: 8, k: 0.4 };
  assert.equal(vistaDeRueda(v, { x: 0, y: 0 }, { x: 100, y: 100 }, 100), v);
});

test("el manejador no ancla con el rect pintado", async () => {
  const fuente = await readFile(new URL("../src/mapa/camara.ts", import.meta.url), "utf8");
  assert.match(fuente, /vistaDeRueda\(/, "la rueda no usa la cuenta compartida");
  assert.match(fuente, /offsetLeft/, "la rueda no mide la esquina sin transform");
  assert.doesNotMatch(
    fuente,
    /e\.clientX - caja\.left/,
    "la rueda sigue anclando con el rect viejo",
  );
});
