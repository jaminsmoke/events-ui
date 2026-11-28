// Guarda del árbol: el core vive en `shared/core` y en ningún otro sitio.
//
// El movimiento desde `services/core` tocó rutas en Python, Rust, los guiones y
// los docs. Un `services/` que quede por ahí es un árbol viejo a medio borrar, y
// un `shared/core` sin `pyproject.toml` deja a `uv run` buscando la nada; mejor
// que esto lo diga antes de que falle un comando a medio camino.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VIEJO = path.join(ROOT, "services");
const CORE = path.join(ROOT, "shared", "core", "pyproject.toml");

const fallos = [];
if (existsSync(VIEJO)) {
  fallos.push("`services/` sigue existiendo: el core se movió a `shared/core` (borra el resto).");
}
if (!existsSync(CORE)) {
  fallos.push("falta `shared/core/pyproject.toml`: el core no está donde dicen los guiones.");
}

if (fallos.length > 0) {
  console.error(`check:estructura:\n${fallos.map((fallo) => `  ${fallo}`).join("\n")}`);
  process.exit(1);
}

console.log("check:estructura: el core está en shared/core y no hay services/.");
