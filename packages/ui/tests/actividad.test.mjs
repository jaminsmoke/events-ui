// La gramática de los cables, sin DOM: al mover un ítem solo se enciende el
// cable de llegada; al borrarlo no hay chispa, solo pulso rojo.
import assert from "node:assert/strict";
import { test } from "node:test";

import { actividadEntre } from "../src/mapa/actividad.ts";

// El carril se resuelve fuera: el módulo puro no importa `laneOf`.
const item = (uid, status, lane) => ({ uid, status, lane });

/** La foto anterior, armada a mano: uid → carril. */
function previo(carriles) {
  return {
    estados: new Map(Object.entries(carriles).map(([uid, lane]) => [uid, lane])),
    carriles: new Map(Object.entries(carriles)),
  };
}

test("mover enciende el cable de llegada y el pulso de los dos carriles", () => {
  const act = actividadEntre(previo({ a: "cola" }), [item("a", "roadmap", "roadmap")]);

  assert.deepEqual(act.llegan, [["roadmap", "cola"]]);
  assert.deepEqual(new Map(act.pulsos.map((p) => [p.lane, p.tono])), new Map([["roadmap", "azul"], ["cola", "rojo"]]));
});

test("borrar no lanza chispa: solo pulso rojo", () => {
  const act = actividadEntre(previo({ a: "cola" }), []);

  assert.deepEqual(act.llegan, []);
  assert.deepEqual(act.pulsos, [{ lane: "cola", tono: "rojo" }]);
  assert.equal(act.cajon, "rojo");
});

test("crear en el cajón solo pulsa el cajón", () => {
  const act = actividadEntre(previo({}), [item("a", "draft", null)]);

  assert.deepEqual(act.llegan, []);
  assert.equal(act.cajon, "azul");
});

test("aprobar enciende verde y no se repite si ya estaba aprobada", () => {
  const act = actividadEntre(previo({ a: "verificacion" }), [
    item("a", "revision_aprobada", "revision_aprobada"),
  ]);
  assert.deepEqual(act.pulsos, [{ lane: "revision_aprobada", tono: "verde" }]);

  const quieta = actividadEntre(previo({ a: "revision_aprobada" }), [
    item("a", "revision_aprobada", "revision_aprobada"),
  ]);
  assert.deepEqual(quieta, { llegan: [], pulsos: [], cajon: undefined });
});

test("borrar no se confunde con mover: mismo pulso, sin chispa", () => {
  const movido = actividadEntre(previo({ a: "cola" }), [item("a", "roadmap", "roadmap")]);
  const borrado = actividadEntre(previo({ a: "roadmap" }), []);

  assert.ok(movido.llegan.length === 1);
  assert.ok(borrado.llegan.length === 0);
});
