// Genera los tipos TS del cliente desde el OpenAPI del core.
//
// No necesita el core en marcha: se importa la app FastAPI y se vuelca su
// `app.openapi()` con el entorno del propio core (`uv run`), igual que
// `pnpm core:dev` lo arranca. El resultado se guarda en `openapi.json`
// (snapshot versionado: si la API cambia, el diff se ve) y de ahí se
// genera `src/core/schema.ts` con openapi-typescript.
//
// Tras cambiar la API del core: `corepack pnpm gen:api` y commitea los dos
// ficheros generados junto con el cambio del core.
//
// Con `--check` no escribe nada: regenera en memoria y falla (exit 1) si
// `openapi.json`/`schema.ts` difieren de lo que saldría hoy. Es lo que corre
// `pnpm check`, para que un cambio del core sin regenerar no pase en silencio.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const UI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(UI, "..", "..");
const CHECK = process.argv.includes("--check");

// Sin `python -c "...;..."`: el `;` lo parte el shell de Windows. El volcado
// vive en un módulo del propio core (`events_core.dump_openapi`).
const schema = execFileSync(
  "uv",
  ["run", "--directory", "shared/core", "python", "-m", "events_core.dump_openapi"],
  { cwd: ROOT, encoding: "utf8" },
);

// `openapiTS` devuelve nodos del AST de TS; `astToString` los pinta a texto.
const types = astToString(await openapiTS(JSON.parse(schema)));
const header = `// GENERADO desde el OpenAPI del core (openapi.json). No editar a mano:
// tras cambiar la API, regenera con \`corepack pnpm gen:api\`.
// Los tipos que consume la UI se derivan de aquí en \`./api.ts\`.\n`;

const generados = new Map([
  [path.join(UI, "openapi.json"), `${schema.trim()}\n`],
  [path.join(UI, "src/core/schema.ts"), header + types],
]);

if (CHECK) {
  const viejos = [];
  for (const [fichero, contenido] of generados) {
    let actual;
    try {
      actual = readFileSync(fichero, "utf8");
    } catch {
      actual = undefined;
    }
    if (actual !== contenido) viejos.push(path.relative(ROOT, fichero));
  }
  if (viejos.length > 0) {
    console.error(
      `El contrato cambió y no está regenerado: ${viejos.join(", ")}\n` +
        "Ejecuta `corepack pnpm gen:api` y commitea los ficheros generados.",
    );
    process.exit(1);
  }
  console.log("Contrato al día: openapi.json y schema.ts coinciden con el core.");
} else {
  for (const [fichero, contenido] of generados) writeFileSync(fichero, contenido);
  console.log("openapi.json y src/core/schema.ts regenerados.");
}
