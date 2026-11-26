/** La web no publica el laboratorio de desktop.
 *
 *  Compila la web en un directorio temporal (sin tocar `dist`) y busca el
 *  chunk `Pruebas-*` y la marca de los guiones. Antes viajaban en un chunk
 *  perezoso de 19 KB; ahora el panel lo inyecta desktop y la web no lo conoce.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MARCA = "Marcha · cable";

test("la build de la web no lleva el lanzador de pruebas", () => {
  const salida = mkdtempSync(path.join(os.tmpdir(), "eui-web-"));
  try {
    // Node directo al binario de Vite: sin `pnpm` ni shell, que en Windows
    // añaden una capa que aquí no hace falta y ensucia el error.
    const vite = path.join(raiz, "apps/web/node_modules/vite/bin/vite.js");
    const build = spawnSync(
      process.execPath,
      [vite, "build", "--outDir", salida, "--emptyOutDir"],
      { cwd: path.join(raiz, "apps/web"), encoding: "utf8", timeout: 180_000 },
    );
    assert.equal(
      build.status,
      0,
      `el build de la web falló: ${(build.stderr || build.stdout || "").trim()}`,
    );

    const assets = path.join(salida, "assets");
    const js = readdirSync(assets).filter((nombre) => nombre.endsWith(".js"));
    const conMarca = js.filter((nombre) =>
      readFileSync(path.join(assets, nombre), "utf8").includes(MARCA),
    );
    const chunksPruebas = js.filter((nombre) => /^Pruebas[-.]/.test(nombre));
    const bytes = js.reduce((total, nombre) => total + statSync(path.join(assets, nombre)).size, 0);

    console.log(
      `web: ${js.length} JS, ${(bytes / 1024).toFixed(0)} KB; ` +
        `chunks Pruebas: ${chunksPruebas.length}; chunks con guiones: ${conMarca.length}`,
    );

    assert.deepEqual(chunksPruebas, [], `la web publica ${chunksPruebas.join(", ")}`);
    assert.deepEqual(conMarca, [], `los guiones viajan en ${conMarca.join(", ")}`);
  } finally {
    rmSync(salida, { recursive: true, force: true });
  }
});
