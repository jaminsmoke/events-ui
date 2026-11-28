/** La proyección se compara con una firma barata, no serializando todo.
 *
 *  `useGit` hacía `JSON.stringify` de la proyección entera —incluido
 *  `git_cambios`— en cada latido para no repintar el mapa. La firma tiene que
 *  detectar cualquier cambio real y salir del mismo objeto cuando nada cambia,
 *  sin serializar objetos de muchas claves.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { firmaProyeccion } from "../src/core/firma.ts";

const base = () => ({
  repo: "C:/repo",
  laboratorio: false,
  git: true,
  git_root: "C:/repo",
  branch: "main",
  commit: "abc1234",
  git_cambios: [
    { estado: "M", ruta: "README.md" },
    { estado: "??", ruta: "nota.txt" },
  ],
  eui_ignorado: true,
  items: 7,
  events: 31,
  por_estado: { historial: 4, roadmap: 3 },
  ultima_actividad: "2026-11-27T09:00:00",
});

test("la misma proyección en otro objeto da la misma firma", () => {
  assert.equal(firmaProyeccion(base()), firmaProyeccion(base()));
});

test("un cambio de conteo o de estado cambia la firma", () => {
  const original = firmaProyeccion(base());
  const masItems = { ...base(), items: 8 };
  const otroEstado = { ...base(), por_estado: { historial: 4, roadmap: 2, draft: 1 } };
  assert.notEqual(firmaProyeccion(masItems), original, "no ve cambiar items");
  assert.notEqual(firmaProyeccion(otroEstado), original, "no ve cambiar por_estado");
});

test("un cambio en los archivos sin commit también cambia la firma", () => {
  const original = firmaProyeccion(base());
  const otroEstado = base();
  otroEstado.git_cambios[0].estado = "A";
  const otroArchivo = base();
  otroArchivo.git_cambios.push({ estado: "??", ruta: "otra.txt" });
  assert.notEqual(firmaProyeccion(otroEstado), original, "no ve cambiar un estado de git_cambios");
  assert.notEqual(firmaProyeccion(otroArchivo), original, "no ve un archivo nuevo");
});

test("useGit ya no serializa la proyección entera", async () => {
  const fuente = await readFile(new URL("../src/core/useGit.ts", import.meta.url), "utf8");
  assert.match(fuente, /firmaProyeccion\(/, "useGit no usa la firma");
  assert.doesNotMatch(fuente, /JSON\.stringify/, "useGit sigue serializando la proyección");
});
