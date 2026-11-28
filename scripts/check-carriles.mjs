// Guarda del mapa estado → carril: una sola tabla, en `packages/ui/src/modelo/carriles.ts`.
//
// El grupo de un estado y el carril donde vive estaban declarados en cinco
// sitios (`_grupo` del core, `laneOf`, los estados por carril del panel,
// `A_GRUPO` y el enum zod de `useProtocolos`). Un cambio de flujo obligaba a
// cinco ediciones y una podía quedarse atrás: la UI ofrecía un traslado que el
// core rechazaba. Aquí se comprueba que la tabla sigue siendo única, que cubre
// todos los estados del contrato y que zod deriva de ella. En el core,
// `_grupo` sigue siendo la verdad que impone el PATCH.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI = path.join(ROOT, "packages/ui/src");
const CARRILES = path.join(UI, "modelo/carriles.ts");
const PROTOCOLOS = path.join(UI, "core/useProtocolos.ts");

/** Nombres que solo pueden declararse en `modelo/carriles.ts`. */
const UNICOS = ["CARRIL_DE_ESTADO", "ESTADOS_POR_CARRIL", "ESTADOS_ENTRADA", "ESTADOS", "A_GRUPO"];

function ficheros(directorio) {
  return readdirSync(directorio, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = path.join(directorio, entrada.name);
    if (entrada.isDirectory()) return ficheros(ruta);
    return /\.(ts|tsx)$/.test(entrada.name) ? [ruta] : [];
  });
}

const relativa = (ruta) => path.relative(ROOT, ruta).split(path.sep).join("/");
const errores = [];

for (const ruta of ficheros(UI)) {
  if (ruta === CARRILES) continue;
  readFileSync(ruta, "utf8")
    .split("\n")
    .forEach((linea, indice) => {
      if (/^\s*import\b/.test(linea)) return;
      for (const nombre of UNICOS) {
        if (new RegExp(`\\b(?:const|let|var|function)\\s+${nombre}\\b`).test(linea)) {
          errores.push(
            `${relativa(ruta)}:${indice + 1}: declara ${nombre}; el mapa vive solo en modelo/carriles.ts`,
          );
        }
      }
    });
}

const protocolos = readFileSync(PROTOCOLOS, "utf8");
if (/z\.enum\(\s*\[/.test(protocolos)) {
  errores.push(
    "core/useProtocolos.ts: el enum de grupos se escribe a mano; derívalo de GRUPOS (modelo/carriles.ts)",
  );
}
if (!/z\.enum\(GRUPOS\)/.test(protocolos)) {
  errores.push("core/useProtocolos.ts: el esquema zod ya no valida con GRUPOS (modelo/carriles.ts)");
}

const fuente = readFileSync(CARRILES, "utf8");
const tabla = fuente.match(/CARRIL_DE_ESTADO[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!tabla) {
  errores.push("modelo/carriles.ts: no encuentro la tabla CARRIL_DE_ESTADO");
} else {
  const claves = [...tabla[1].matchAll(/^\s{2}(\w+):/gm)].map((coincidencia) => coincidencia[1]);
  const repetidas = claves.filter((clave, indice) => claves.indexOf(clave) !== indice);
  if (repetidas.length > 0) {
    errores.push(`modelo/carriles.ts: estados repetidos en CARRIL_DE_ESTADO: ${repetidas.join(", ")}`);
  }

  const esquema = readFileSync(path.join(UI, "core/schema.ts"), "utf8");
  const item = esquema.match(/MapWorkItem: \{[\s\S]*?status:\s*([^;]+);/);
  if (!item) {
    errores.push("core/schema.ts: no encuentro el estado de MapWorkItem para comparar la tabla");
  } else {
    const estados = [...item[1].matchAll(/"([a-z_]+)"/g)].map((coincidencia) => coincidencia[1]);
    const faltan = estados.filter((estado) => !claves.includes(estado));
    const sobran = claves.filter((clave) => !estados.includes(clave));
    if (faltan.length > 0) {
      errores.push(`modelo/carriles.ts: CARRIL_DE_ESTADO no cubre ${faltan.join(", ")}`);
    }
    if (sobran.length > 0) {
      errores.push(`modelo/carriles.ts: CARRIL_DE_ESTADO declara estados que no existen: ${sobran.join(", ")}`);
    }
    if (faltan.length === 0 && sobran.length === 0 && errores.length === 0) {
      console.log(`check:carriles: ${claves.length} estados, una sola tabla.`);
    }
  }
}

if (errores.length > 0) {
  console.error(`check:carriles:\n${errores.map((error) => `  ${error}`).join("\n")}`);
  process.exit(1);
}
