// Guarda del puerto: el número vive en `puerto.json` y en ningún otro sitio.
//
// Lo leen el core (Python), el desktop (`build.rs`), los dos `vite.config` y los
// guiones (`scripts/puerto.mjs`). Si alguien vuelve a escribirlo a mano, este
// check lo dice con fichero y línea en vez de dejar que las copias divergan.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { RUTA_PUERTO } from "./puerto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// La ruta viene del módulo que lee el puerto: si el core se mueve, se mueve una.
const FUENTE = RUTA_PUERTO;

// Código que se ejecuta. Documentación, OpenAPI y esquemas generados no cuentan:
// repiten el número como texto y no lo consumen.
const EXTENSIONES = [".py", ".rs", ".mjs", ".ts", ".tsx"];
const GENERADOS = new Set(["packages/ui/src/core/schema.ts"]);

const { core } = JSON.parse(readFileSync(FUENTE, "utf8"));
if (!Number.isInteger(core) || core < 1 || core > 65535) {
  console.error(`puerto.json: \`core\` tiene que ser un puerto, no ${core}.`);
  process.exit(1);
}

let ficheros;
try {
  ficheros = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
} catch (error) {
  // Sin git (una copia sin repositorio) no se puede recorrer el proyecto: se
  // avisa y se deja pasar, que es una guarda, no una compilación.
  console.warn(`check:puerto: no se pudo listar con git (${error.message}); se omite.`);
  process.exit(0);
}

const patron = new RegExp(`\\b${core}\\b`);
const copias = [];
for (const fichero of ficheros) {
  if (!EXTENSIONES.some((extension) => fichero.endsWith(extension))) continue;
  if (GENERADOS.has(fichero)) continue;
  const lineas = readFileSync(path.join(ROOT, fichero), "utf8").split("\n");
  lineas.forEach((linea, indice) => {
    if (patron.test(linea)) copias.push(`${fichero}:${indice + 1}: ${linea.trim()}`);
  });
}

if (copias.length > 0) {
  console.error(
    `check:puerto: el puerto ${core} está copiado fuera de ${path.relative(ROOT, FUENTE)}:\n` +
      copias.map((copia) => `  ${copia}`).join("\n") +
      "\n  Léelo de `puerto.json` (o de `scripts/puerto.mjs`) en vez de escribirlo.",
  );
  process.exit(1);
}

console.log(`check:puerto: el puerto ${core} solo está en ${path.relative(ROOT, FUENTE)}.`);
