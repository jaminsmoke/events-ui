// Guarda de la lista de ficheros versionados: vive en `versiones.mjs` y solo allí.
//
// `bump.mjs` los escribe y `release.mjs` commitea lo que el bump cambió. Tener
// dos listas ya falló una vez: release seguía añadiendo `main.py`, que la
// versión dejó de tocar, y un fichero versionado nuevo podía quedarse sin
// commitear. Aquí se comprueba que el release cubre todo lo versionado, que
// nada de la lista falta en disco y que ningún guion vuelve a escribirla.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ARCHIVOS, CARGO_PATH, CORE_VERSION_PATH, FICHEROS_DEL_RELEASE } from "./versiones.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GUIONES = ["bump.mjs", "release.mjs"];
const VERSIONADOS = [...ARCHIVOS.map(({ ruta }) => ruta), CARGO_PATH, CORE_VERSION_PATH];

const sinCommitear = VERSIONADOS.filter((ruta) => !FICHEROS_DEL_RELEASE.includes(ruta));
if (sinCommitear.length > 0) {
  console.error(
    `check:versiones-ficheros: el release no commitea ${sinCommitear.join(", ")}; ` +
      "la versión se quedaría sin subir entera.",
  );
  process.exit(1);
}

const ausentes = FICHEROS_DEL_RELEASE.filter((ruta) => !existsSync(path.join(ROOT, ruta)));
if (ausentes.length > 0) {
  console.error(`check:versiones-ficheros: la lista nombra ficheros que no existen: ${ausentes.join(", ")}.`);
  process.exit(1);
}

const copias = [];
for (const guion of GUIONES) {
  const lineas = readFileSync(path.join(ROOT, "scripts", guion), "utf8").split("\n");
  lineas.forEach((linea, indice) => {
    for (const ruta of FICHEROS_DEL_RELEASE) {
      if (linea.includes(`"${ruta}"`)) copias.push(`scripts/${guion}:${indice + 1}: ${ruta}`);
    }
  });
}

if (copias.length > 0) {
  console.error(
    "check:versiones-ficheros: la lista se escribe otra vez fuera de scripts/versiones.mjs:\n" +
      copias.map((copia) => `  ${copia}`).join("\n"),
  );
  process.exit(1);
}

console.log(`check:versiones-ficheros: ${FICHEROS_DEL_RELEASE.length} ficheros, una sola lista.`);
