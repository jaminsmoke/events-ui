// Release: una versión, dos paquetes, todo verificado.
//
// Uso: `corepack pnpm release 0.2.0` (o sin argumento para empaquetar la
// versión actual). Orden de los pasos y por qué cada uno existe:
//   1. `bump <versión>` — las 7 versiones pasan a ser las mismas.
//   2. `gen:api` — el core ya dice la versión nueva en `/openapi.json`,
//      el cliente generado se regenera (si falla, el contrato cambió).
//   3. `check` completo —contract, versiones, UI, py, rust— en verde.
//   4. Build de ambas apps: la web (estático) y la desktop (bundle Tauri).
//      Antes de la desktop va el sidecar: `tauri build` falla si falta el
//      `externalBin` (scripts/build-sidecar.mjs, F3).
//   5. Commit del bump + contrato y tag `vX.Y.Z`, si no lo hay aún.
//
// Nada se commitea si algo falla antes: el árbol queda como estaba.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ARGUMENTO = process.argv[2];

function paso(nombre, comando, { cwd: directorio = ROOT, opcional = false } = {}) {
  console.log(`\n── ${nombre} ──`);
  console.log(`$ ${comando}`);
  try {
    execSync(comando, { cwd: directorio, stdio: "inherit", shell: true });
  } catch (err) {
    if (opcional) {
      console.warn(`  (opcional, se salta: ${err.message})`);
      return;
    }
    console.error(`\nRelease detenido: falló «${nombre}». Nada commiteado ni etiquetado.`);
    process.exit(err.status ?? 1);
  }
}

// La versión que dice la raíz (fuente de verdad, ver `scripts/bump.mjs`).
const version = ARGUMENTO ?? JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
console.log(`Release v${version}`);

paso(`bump a ${version}`, `node scripts/bump.mjs ${version}`);
paso("regenerar el cliente del contrato", "corepack pnpm gen:api");
paso("check completo", "corepack pnpm check");
paso("build de la web (estático)", "corepack pnpm build:web");
paso("build del sidecar (PyInstaller, externalBin)", "corepack pnpm build:sidecar");
paso("build de la desktop (bundle Tauri)", "corepack pnpm build");

// Se commitea solo lo del bump y el contrato que generó, no lo que haya en el
// árbol por trabajo en curso: eso no es parte de esta versión.
const FICHEROS_RELEASE = [
  "package.json",
  "pnpm-lock.yaml",
  "packages/ui/package.json",
  "apps/desktop/package.json",
  "apps/web/package.json",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.lock",
  "services/core/src/events_core/main.py",
  "services/core/src/events_core/__init__.py",
  "packages/ui/openapi.json",
  "packages/ui/src/core/schema.ts",
];
execSync(`git add ${FICHEROS_RELEASE.join(" ")}`, { cwd: ROOT, stdio: "inherit", shell: true });

const cambios = execSync("git diff --cached --name-only", { cwd: ROOT, encoding: "utf8" }).trim();
if (cambios) {
  paso("commit", `git commit -m "Release v${version}"`);
} else {
  console.log("\n(Sin cambios que commitear en esos ficheros: ya estaba hecho.)");
}

const tag = `v${version}`;
const yaHayTag = execSync(`git tag --list ${tag}`, { cwd: ROOT, encoding: "utf8" }).trim();
if (yaHayTag) {
  console.log(`El tag ${tag} ya existe; no se crea otro.`);
} else {
  paso("tag", `git tag ${tag}`);
}

console.log(`\nListo: v${version} commiteado y etiquetado.`);
console.log("Artefactos: apps/web/dist (estático) y los bundles de apps/desktop/src-tauri/target.");
