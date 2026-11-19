// Una sola versión para todo el producto: la raíz manda y el resto copian.
//
// `node scripts/bump.mjs 0.2.0` deja la versión en:
// - los `package.json` (raíz, UI, desktop, web) —la raíz es la fuente—
// - `tauri.conf.json` y `Cargo.toml`
// - el `version=` del core (`main.py`), para Swagger y `/health`.
//
// Sin argumento lee la versión actual de la raíz y sugiere el siguiente
// `patch` (bump sin argumento = mismo número, para revisar). Escribe con el
// formato original del fichero (indentación de 2, salvo `tauri.conf.json`,
// que va con CRLF y 2 espacios como viene del repo).
//
// No commitea ni crea el tag: eso lo hace `pnpm release` (o a mano).

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VERSION_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// `FastAPI(...)` puede llevar argumentos extra o ir en varias líneas: se busca
// su `version=` sin exigir la línea exacta. Con la forma anterior, añadir
// `lifespan=` rompía `check:versions` y el release.
const MAIN_VERSION_RE = /FastAPI\([\s\S]*?version="([^"]+)"/;

function versionDeMain(texto) {
  return texto.match(MAIN_VERSION_RE)?.[1] ?? null;
}

function conVersionDeMain(texto, version) {
  return texto.replace(/(FastAPI\([\s\S]*?version=")[^"]+(")/, `$1${version}$2`);
}

/** Los ficheros que llevan la versión, con el camino hasta el valor. */
const ARCHIVOS = [
  { ruta: "package.json", clave: "version" },
  { ruta: "packages/ui/package.json", clave: "version" },
  { ruta: "apps/desktop/package.json", clave: "version" },
  { ruta: "apps/web/package.json", clave: "version" },
  { ruta: "apps/desktop/src-tauri/tauri.conf.json", clave: "version" },
];

function leerJson(ruta) {
  const texto = readFileSync(ruta, "utf8");
  return { texto, datos: JSON.parse(texto) };
}

function escribirJson(ruta, textoOriginal, datos) {
  const indentacion = textoOriginal.startsWith("{\r\n") ? "\r\n" : "\n";
  writeFileSync(ruta, JSON.stringify(datos, null, 2) + (indentacion === "\r\n" ? "\r\n" : "\n"), "utf8");
}

/** Siguiente `patch` sobre una versión válida, para las sugerencias. */
function siguientePatch(version) {
  const [a, b, c] = version.split(".").map(Number);
  return `${a}.${b}.${c + 1}`;
}

/** La versión actual de cada fichero, sin tocarlos. */
function vigentes() {
  const versiones = new Map();
  for (const { ruta, clave } of ARCHIVOS) {
    const { datos } = leerJson(path.join(ROOT, ruta));
    versiones.set(ruta, datos[clave]);
  }
  const cargo = readFileSync(path.join(ROOT, "apps/desktop/src-tauri/Cargo.toml"), "utf8");
  const m = cargo.match(/^version = "([^"]+)"/m);
  versiones.set("apps/desktop/src-tauri/Cargo.toml", m ? m[1] : "(sin version)");
  const main = readFileSync(path.join(ROOT, "services/core/src/events_core/main.py"), "utf8");
  versiones.set(
    "services/core/src/events_core/main.py",
    versionDeMain(main) ?? "(sin version)",
  );
  return versiones;
}

const [argumento] = process.argv.slice(2);

if (argumento && !VERSION_RE.test(argumento)) {
  console.error(`Versión no válida: «${argumento}» (se espera X.Y.Z, p. ej. 0.2.0)`);
  process.exit(1);
}

const antes = vigentes();
const actual = antes.get("package.json");
const destino = argumento ?? siguientePatch(actual);

if (argumento === undefined) {
  // Sin argumento es el check de «todas las versiones coinciden»: el que
  // entra en `pnpm check`. Si alguna difiere de la raíz, se dice cuál.
  const difieren = [...antes.entries()].filter(([, v]) => v !== actual);
  console.log(`Versión actual de la raíz: ${actual}`);
  if (difieren.length > 0) {
    for (const [ruta, v] of difieren) console.log(`  ${ruta}: ${v} (debería ser ${actual})`);
    process.exit(1);
  }
  console.log("Todas las versiones coinciden.");
  console.log(`Siguiente patch sugerido: ${destino}  (uso: node scripts/bump.mjs ${destino})`);
  process.exit(0);
}

for (const { ruta, clave } of ARCHIVOS) {
  const archivo = path.join(ROOT, ruta);
  const { texto, datos } = leerJson(archivo);
  datos[clave] = destino;
  escribirJson(archivo, texto, datos);
}

// Cargo.toml: solo la línea `version = "..."` de la cabecera del paquete.
const cargoRuta = path.join(ROOT, "apps/desktop/src-tauri/Cargo.toml");
const cargo = readFileSync(cargoRuta, "utf8");
writeFileSync(
  cargoRuta,
  cargo.replace(/^version = "([^"]+)"/m, `version = "${destino}"`),
  "utf8",
);

// Core: la versión que publica Swagger.
const mainRuta = path.join(ROOT, "services/core/src/events_core/main.py");
const main = readFileSync(mainRuta, "utf8");
writeFileSync(mainRuta, conVersionDeMain(main, destino), "utf8");

console.log(`Versiones actualizadas a ${destino}:`);
for (const { ruta } of ARCHIVOS) {
  console.log(`  ${ruta}: ${antes.get(ruta)} → ${destino}`);
}
console.log(`  apps/desktop/src-tauri/Cargo.toml: ${antes.get("apps/desktop/src-tauri/Cargo.toml")} → ${destino}`);
console.log(`  services/core/src/events_core/main.py: ${antes.get("services/core/src/events_core/main.py")} → ${destino}`);

// El lockfile guarda la versión de la raíz: se sincroniza en el propio bump.
const install = spawnSync("corepack pnpm install --lockfile-only", { cwd: ROOT, stdio: "inherit", shell: true });
if (install.status !== 0) console.warn("Aviso: no se pudo sincronizar pnpm-lock.yaml.");
