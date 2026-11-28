/** Las paradas del teclado, mapa a mapa, sin React.
 *
 *  El hook solo conecta los eventos: el orden en que se recorre el lienzo es
 *  `paradasDe`. Aquí se comprueban los tres mapas: Trabajo (sin los
 *  archivados del Changelog), Git (nodo, historial, commits y cambios) y
 *  Documentos (el carril del historial primero).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

// Registra `tsx`: los `.ts` del paquete se importan sin compilar y sus
// imports relativos se resuelven como en el bundler.
import "./entorno-ts.mjs";

const { paradasDe } = await import("../src/mapa/paradas.ts");
import { LANES } from "../src/modelo/carriles.ts";

const items = [
  { uid: "i1", title: "Uno", status: "draft" },
  { uid: "i2", title: "Dos", status: "historial" },
];
const proyeccion = {
  git_cambios: [
    { estado: "M", ruta: "a.ts" },
    { estado: "A", ruta: "b.ts" },
  ],
};
const commits = [{ hash: "abc1234" }];

const tipos = (paradas) => paradas.map((parada) => parada.tipo);

test("Trabajo: entrada, carriles sin Changelog, ítems sin archivados, nudos, cables y puentes", () => {
  const paradas = paradasDe({
    mapa: "items",
    proyeccion,
    commits,
    items,
    nudos: [{ id: "n1" }],
    cables: [{ id: "c1" }],
  });

  assert.deepEqual(paradas[0], { tipo: "cajon" }, "no empieza por la Entrada");
  const carriles = paradas.filter((parada) => parada.tipo === "carril");
  assert.equal(
    carriles.length,
    LANES.filter((lane) => lane.id !== "historial").length,
    "los carriles no son todos menos el Changelog",
  );
  assert.ok(
    !paradas.some((parada) => parada.tipo === "item" && parada.uid === "i2"),
    "un archivado no se recorre en el mapa de trabajo",
  );
  assert.ok(
    paradas.some((parada) => parada.tipo === "item" && parada.uid === "i1"),
    "falta el ítem vivo",
  );
  assert.deepEqual(paradas.slice(-2), [
    { tipo: "puente" },
    { tipo: "puente_documentos" },
  ]);
});

test("Git: nodo, historial, commits y cambios, en ese orden", () => {
  const paradas = paradasDe({
    mapa: "git",
    proyeccion,
    commits,
    items,
    nudos: [],
    cables: [],
  });

  assert.deepEqual(tipos(paradas), [
    "git",
    "commits",
    "commit",
    "cambios",
    "cambio",
    "cambio",
  ]);
  assert.deepEqual(paradas.at(-1), { tipo: "cambio", ruta: "b.ts" });
});

test("Git sin work tree ni cambios: solo el nodo y el historial", () => {
  const paradas = paradasDe({
    mapa: "git",
    proyeccion: { git: false, git_cambios: [] },
    commits: [],
    items,
    nudos: [],
    cables: [],
  });

  assert.deepEqual(tipos(paradas), ["git", "commits"]);
});

test("Documentos: el carril del Changelog y sus archivados", () => {
  const paradas = paradasDe({
    mapa: "documentos",
    proyeccion,
    commits,
    items,
    nudos: [],
    cables: [],
  });

  assert.deepEqual(paradas, [
    { tipo: "carril", clave: "lane-historial" },
    { tipo: "item", uid: "i2" },
  ]);
});

test("sin items todavía no hay paradas de ítem", () => {
  const paradas = paradasDe({
    mapa: "documentos",
    proyeccion: null,
    commits: [],
    items: null,
    nudos: [],
    cables: [],
  });

  assert.deepEqual(paradas, [{ tipo: "carril", clave: "lane-historial" }]);
});
