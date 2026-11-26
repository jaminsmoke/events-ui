/** La fila y la ficha de fases comparten las mismas mutaciones.
 *
 *  El modelo es puro (sin React): recibe la lista y devuelve una nueva. Así
 *  marcar un requisito o cambiar el estado no se escribe dos veces.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  conEstado,
  conNota,
  conRequisito,
  nuevaFase,
  nuevoRequisito,
  progreso,
  requisitosDe,
  sinFase,
  sinRequisito,
} from "../src/mapa/fasesModelo.ts";

const base = () => [
  {
    orden: 1,
    titulo: "Diseño",
    estado: "pendiente",
    nota: "",
    entered_at: "",
    requisitos: [
      { orden: 1, titulo: "Alcance", hecho: false, done_at: null },
      { orden: 2, titulo: "Revisión", hecho: false, done_at: null },
    ],
  },
  {
    orden: 2,
    titulo: "Entrega",
    estado: "completada",
    nota: "",
    entered_at: "",
    requisitos: [{ orden: 1, titulo: "Publicar", hecho: true, done_at: null }],
  },
];

test("cambiar el estado no toca las demás fases ni los requisitos", () => {
  const fases = conEstado(base(), 1, "fallida", "No pasa la carga");
  assert.equal(fases[0].estado, "fallida");
  assert.equal(fases[0].nota, "No pasa la carga");
  assert.equal(fases[0].requisitos[0].hecho, false);
  assert.equal(fases[1].estado, "completada");
});

test("marcar un requisito solo cambia ese requisito", () => {
  const fases = conRequisito(base(), 1, 2);
  assert.equal(fases[0].requisitos[1].hecho, true);
  assert.equal(fases[0].requisitos[0].hecho, false);
  assert.equal(fases[1].requisitos[0].hecho, true);
});

test("la nota se guarda sin cambiar el estado", () => {
  const fases = conNota(base(), 1, "Motivo nuevo");
  assert.equal(fases[0].nota, "Motivo nuevo");
  assert.equal(fases[0].estado, "pendiente");
});

test("añadir una fase toma el orden siguiente y su primer requisito", () => {
  const fases = nuevaFase(base(), "Pruebas", "Pasar el lint");
  assert.equal(fases.length, 3);
  assert.equal(fases[2].orden, 3);
  assert.equal(fases[2].estado, "pendiente");
  assert.deepEqual(fases[2].requisitos.map((r) => r.titulo), ["Pasar el lint"]);
});

test("añadir un requisito numera después del último", () => {
  const fases = nuevoRequisito(base(), 1, "Despliegue");
  assert.equal(fases[0].requisitos.length, 3);
  assert.equal(fases[0].requisitos[2].orden, 3);
  assert.equal(fases[0].requisitos[2].hecho, false);
});

test("quitar fase o requisito no deja huecos de orden", () => {
  assert.deepEqual(sinFase(base(), 1).map((f) => f.orden), [2]);
  assert.deepEqual(sinRequisito(base(), 1, 1)[0].requisitos.map((r) => r.titulo), ["Revisión"]);
});

test("el progreso cuenta fases y requisitos hechos", () => {
  assert.deepEqual(progreso(base()), { hechas: 1, total: 2 });
  assert.deepEqual(requisitosDe(base()[0]), { hechos: 0, total: 2 });
});
