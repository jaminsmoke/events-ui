// Guarda de `useProtocolos`: una sola estructura de uniones y una sola consulta.
//
// El hook guardaba cuatro `Set` de claves `origen→destino` (`pares`, `exigen`,
// `exigenListas`, `exigenCompletas`) y cuatro funciones con el mismo cuerpo; al
// añadir una exigencia había que tocar los cuatro sitios. Ahora hay un solo
// `Map` con el `Paso` de cada unión y todo se pregunta a `paso()`. Aquí se
// comprueba que la foto no vuelve atrás.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = path.join(ROOT, "packages/ui/src/core/useProtocolos.ts");
const fuente = readFileSync(HOOK, "utf8");

const errores = [];

const sets = (fuente.match(/new Set\(/g) ?? []).length;
if (sets > 0) {
  errores.push(
    `useProtocolos.ts: ${sets} Set(s) de claves; las uniones viven en un solo Map de \`Paso\``,
  );
}

const mapas = (fuente.match(/new Map</g) ?? []).length;
if (mapas !== 1) {
  errores.push(`useProtocolos.ts: esperaba un único Map de uniones y encontré ${mapas}`);
}

const consultas = (fuente.match(/uniones\.get\(/g) ?? []).length;
if (consultas !== 1) {
  errores.push(
    `useProtocolos.ts: las uniones se consultan ${consultas} veces; solo \`paso()\` debe leerlas`,
  );
}

const busquedas = (fuente.match(/\.has\(/g) ?? []).length;
if (busquedas > 0) {
  errores.push(
    `useProtocolos.ts: ${busquedas} búsqueda(s) suelta(s); el estado de la unión sale de \`paso()\``,
  );
}

if (!/\bpaso,\n/.test(fuente)) {
  errores.push("useProtocolos.ts: el hook ya no expone `paso` como la consulta única");
}

if (errores.length > 0) {
  console.error(`check:protocolos:\n${errores.map((error) => `  ${error}`).join("\n")}`);
  process.exit(1);
}

console.log("check:protocolos: un Map de uniones y una sola consulta.");
