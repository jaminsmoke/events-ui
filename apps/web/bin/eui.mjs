#!/usr/bin/env node
// Envoltorio de `eui`.
//
// El core es de la máquina, no del cliente: vive en `core/vX.Y.Z` dentro del
// directorio de datos del usuario y lo publica el primero que llega (el
// desktop copia el suyo del instalador; este paquete lo descarga del release).
// Así, si el desktop está instalado, la web no baja nada.
//
// Este fichero no sabe servir la web: solo resuelve el `eui` que hay que
// ejecutar y le dice cuál es el core de la máquina (`EUI_CORE_BIN`). El resto
// (arrancar, esperar el health, abrir el navegador) está en `eui web`, en
// Python, en un solo sitio.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { carpetaCompartida, versionesABorrar } from "./compartido.mjs";

const REPO = "jaminsmoke/events-ui";
const PLATAFORMAS = ["win32-x64", "linux-x64", "darwin-arm64", "darwin-x64"];

// `os.platform` es una función (su `toString` devuelve el sistema), así que se
// compara con `process.platform`, que sí es la cadena.
const sistema = process.platform;
const plataforma = `${sistema}-${process.arch}`;
const sufijo = sistema === "win32" ? ".exe" : "";

const aquí = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(aquí, "..", "package.json"), "utf8"));

const CARPETA = carpetaCompartida({ env: process.env, sistema, version });
const CLI = join(CARPETA, `eui${sufijo}`);
const CORE_DEL_DESKTOP = join(CARPETA, `events-core${sufijo}`);

/**
 * Borra las versiones antiguas del core: se queda la que se está usando, la
 * inmediatamente anterior y cualquiera posterior (puede ser la de otro cliente
 * más nuevo). Best-effort: lo que no se pueda borrar —un binario en uso— se
 * queda donde está.
 */
function limpiarVersionesAntiguas() {
  const raiz = dirname(CARPETA);
  let entradas;
  try {
    entradas = readdirSync(raiz, { withFileTypes: true });
  } catch {
    return;
  }
  const nombres = entradas.filter((entrada) => entrada.isDirectory()).map((entrada) => entrada.name);

  for (const nombre of versionesABorrar(nombres, basename(CARPETA))) {
    try {
      rmSync(join(raiz, nombre), { recursive: true, force: true });
    } catch {
      // en uso por otro proceso: se queda
    }
  }
}

function urlDelRelease() {
  const base = (
    process.env.EUI_CORE_URL_BASE ?? `https://github.com/${REPO}/releases/download/v${version}`
  ).replace(/\/$/, "");
  const nombre = `eui-${plataforma}${sufijo}`;
  return { url: `${base}/${nombre}`, sha: `${base}/${nombre}.sha256` };
}

/** El CLI de la máquina: el del desktop si lo publicó, si no se descarga. */
async function asegurarCli() {
  if (existsSync(CLI)) return CLI;
  if (!PLATAFORMAS.includes(plataforma)) {
    console.error(
      `eui: no hay core para ${plataforma}. Plataformas: ${PLATAFORMAS.join(", ")}.`,
    );
    process.exit(1);
  }

  const { url, sha } = urlDelRelease();
  console.error(`eui: bajando el core ${version} para ${plataforma}…`);

  let respuesta;
  let esperado;
  try {
    [respuesta, esperado] = await Promise.all([
      fetch(url, { redirect: "follow" }),
      fetch(sha, { redirect: "follow" }).then((r) => (r.ok ? r.text() : null)),
    ]);
  } catch (error) {
    console.error(`eui: no se pudo descargar el core (${error.message}).\n  ${url}`);
    process.exit(1);
  }
  if (!respuesta.ok) {
    console.error(
      `eui: el release v${version} no trae el core de ${plataforma} (HTTP ${respuesta.status}).\n  ${url}`,
    );
    process.exit(1);
  }

  const crudo = Buffer.from(await respuesta.arrayBuffer());
  const hash = createHash("sha256").update(crudo).digest("hex");
  // El `.sha256` es el que publica `sha256sum`: "<hash>  <fichero>".
  const publicado = esperado?.trim().split(/\s+/)[0];
  if (!publicado || publicado.length !== 64) {
    console.error(`eui: el release no publica un sha256 válido para ${plataforma}; se cancela.`);
    process.exit(1);
  }
  if (publicado !== hash) {
    console.error(`eui: el sha256 del core no coincide (esperado ${publicado}, bajado ${hash}).`);
    process.exit(1);
  }

  mkdirSync(CARPETA, { recursive: true });
  const parcial = `${CLI}.descarga`;
  writeFileSync(parcial, crudo);
  if (sistema !== "win32") chmodSync(parcial, 0o755);
  renameSync(parcial, CLI);
  return CLI;
}

const binario = await asegurarCli();
limpiarVersionesAntiguas();

// `EUI_WEB_DIST` es el build de la web que el core sirve en `/`, y
// `EUI_CORE_BIN` el core de la máquina si ya lo publicó el desktop: `eui web`
// arranca ese en vez de su propia copia.
const entorno = { ...process.env, EUI_WEB_DIST: join(aquí, "..", "dist") };
if (!entorno.EUI_CORE_BIN && existsSync(CORE_DEL_DESKTOP)) {
  entorno.EUI_CORE_BIN = CORE_DEL_DESKTOP;
}

const resultado = spawnSync(binario, process.argv.slice(2), { stdio: "inherit", env: entorno });
if (resultado.error) {
  console.error(`eui: no se pudo ejecutar ${binario}: ${resultado.error.message}`);
  process.exit(1);
}
process.exit(resultado.status ?? 1);
