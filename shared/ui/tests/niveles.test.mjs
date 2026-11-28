// El latido del árbol compara nivel a nivel: un nivel que no cambió conserva
// su array y el mapa entero no se serializa. La regresión se medía en e2e
// contando JSON.stringify; aquí se mide donde vive, sin navegador.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { mezclarNiveles } from "../src/core/niveles.ts";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
const hijo = (nombre, tipo = "archivo") => ({ nombre, tipo, ruta: nombre });

test("un nivel que no cambió conserva su array y no marca cambio", () => {
  const antes = { "": [hijo("docs", "carpeta")], docs: [hijo("uno.txt")] };
  const { hijos, cambio } = mezclarNiveles(antes, [
    { ruta: "", hijos: [hijo("docs", "carpeta")] },
    { ruta: "docs", hijos: [hijo("uno.txt")] },
  ]);

  assert.equal(hijos[""], antes[""]);
  assert.equal(hijos.docs, antes.docs);
  assert.equal(cambio, false);
});

test("un nivel reordenado conserva el array anterior", () => {
  const antes = { docs: [hijo("a.txt"), hijo("b.txt")] };
  const { hijos, cambio } = mezclarNiveles(antes, [
    { ruta: "docs", hijos: [hijo("b.txt"), hijo("a.txt")] },
  ]);

  assert.equal(hijos.docs, antes.docs);
  assert.equal(cambio, false);
});

test("un nivel con un hijo nuevo trae su array y marca cambio", () => {
  const antes = { docs: [hijo("a.txt")] };
  const { hijos, cambio } = mezclarNiveles(antes, [
    { ruta: "docs", hijos: [hijo("a.txt"), hijo("b.txt")] },
  ]);

  assert.notEqual(hijos.docs, antes.docs);
  assert.deepEqual(hijos.docs.map((n) => n.nombre), ["a.txt", "b.txt"]);
  assert.equal(cambio, true);
});

test("un nivel que aparece o desaparece marca cambio", () => {
  const antes = { docs: [hijo("a.txt")], viejo: [hijo("x")] };
  const { hijos, cambio } = mezclarNiveles(antes, [{ ruta: "docs", hijos: [hijo("a.txt")] }]);

  assert.equal(cambio, true);
  assert.equal(hijos.viejo, undefined);
});

test("el árbol no serializa el mapa: usa mezclarNiveles", () => {
  const fuente = readFileSync(path.join(SRC, "core", "useArbolArchivos.ts"), "utf8");
  assert.ok(fuente.includes("mezclarNiveles"), "el hook ya no mezcla nivel a nivel");
  assert.ok(
    !fuente.includes("JSON.stringify"),
    "el hook vuelve a serializar el árbol en cada latido",
  );
});
