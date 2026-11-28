// Guarda del árbol: el core vive en `shared/core` y en ningún otro sitio.
//
// El movimiento desde `services/core` tocó rutas en Python, Rust, los guiones y
// los docs. Un `services/` que quede por ahí es un árbol viejo a medio borrar, y
// un `shared/core` sin `pyproject.toml` deja a `uv run` buscando la nada; mejor
// que esto lo diga antes de que falle un comando a medio camino.
//
// Igual con los paquetes: `packages/` es solo lo que se publica fuera (hoy,
// `protocols`), así que un paquete `private` ahí es uno interno que se quedó en
// el sitio viejo. La UI y el config compartidos viven en `shared/`.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEJO = path.join(ROOT, "services");
const CORE = path.join(ROOT, "shared", "core", "pyproject.toml");
const PACKAGES = path.join(ROOT, "packages");

const fallos = [];
if (existsSync(VIEJO)) {
  fallos.push("`services/` sigue existiendo: el core se movió a `shared/core` (borra el resto).");
}
if (!existsSync(CORE)) {
  fallos.push("falta `shared/core/pyproject.toml`: el core no está donde dicen los guiones.");
}

for (const paquete of ["ui", "config"]) {
  if (existsSync(path.join(PACKAGES, paquete))) {
    fallos.push(`\`packages/${paquete}\` sigue existiendo: es interno y vive en \`shared/${paquete}\`.`);
  }
  if (!existsSync(path.join(ROOT, "shared", paquete, "package.json"))) {
    fallos.push(`falta \`shared/${paquete}/package.json\`: el paquete compartido no está donde dicen las apps.`);
  }
}

if (existsSync(PACKAGES)) {
  for (const entrada of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entrada.isDirectory()) continue;
    const json = path.join(PACKAGES, entrada.name, "package.json");
    if (!existsSync(json)) continue;
    const pkg = JSON.parse(readFileSync(json, "utf8"));
    if (pkg.private === true) {
      fallos.push(
        `\`packages/${entrada.name}\` es privado: \`packages/\` es solo lo publicado; lo interno va en \`shared/\`.`,
      );
    }
  }
}

if (fallos.length > 0) {
  console.error(`check:estructura:\n${fallos.map((fallo) => `  ${fallo}`).join("\n")}`);
  process.exit(1);
}

console.log("check:estructura: el core en shared/core, packages/ solo publicado.");
