// Comprueba que el tag llegó a publicarse: sigue el workflow `release`.
//
// Uso: `node scripts/release-verificar.mjs 0.5.3` (o `v0.5.3`; sin argumento,
// la versión de la raíz). `pnpm release` termina en «Listo» al crear el tag,
// pero hasta que el job de CI no acaba no hay nada descargable: la release de
// la 0.4.12 se publicó 7 minutos después. Esto busca el run de ese tag y lo
// sigue hasta el final, para no mirarlo a mano con `gh run list`.
//
// Sale 0 si el run acaba en verde; != 0 con la URL si falla o si el run no
// aparece. Sin `gh` o sin sesión avisa y sale 0: el release local ya está
// hecho y esta comprobación es un extra, como la prueba en frío del sidecar.
//
// `--tiempo-max <segundos>` acota la espera a que el run aparezca (180 por
// defecto): el run se crea en segundos, pero el tag puede tardar en verse.

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW = "release.yml";
const ESPERA_MS = 5_000;
const TIEMPO_MAX_POR_DEFECTO_S = 180;
const INTENTOS_ENDPOINT = 3;

function leerArgumentos(argumentos) {
  const valores = { posicional: null, tiempoMax: TIEMPO_MAX_POR_DEFECTO_S };
  for (let i = 0; i < argumentos.length; i += 1) {
    const clave = argumentos[i];
    if (clave === "--tiempo-max") {
      const valor = Number(argumentos[i + 1]);
      if (!Number.isFinite(valor) || valor <= 0) {
        throw new Error("--tiempo-max espera un número de segundos");
      }
      valores.tiempoMax = valor;
      i += 1;
    } else if (clave.startsWith("--")) {
      throw new Error(`argumento inesperado: ${clave}`);
    } else if (valores.posicional === null) {
      valores.posicional = clave;
    } else {
      throw new Error(`argumento inesperado: ${clave}`);
    }
  }
  return valores;
}

/** `gh` con la salida capturada, o heredada cuando el paso la pinta él. */
function gh(argumentos, { heredar = false } = {}) {
  return spawnSync("gh", argumentos, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: heredar ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

function sinGh(motivo) {
  console.warn(`Aviso: ${motivo}; no se comprueba la publicación.`);
  console.warn("El release local ya está hecho: esto solo mira que el CI lo publique.");
  process.exit(0);
}

/** El run del tag: un push de tag llega con `headBranch` igual al tag. */
async function esperarRun(tag, esperaMaximaMs, acciones) {
  const limite = Date.now() + esperaMaximaMs;
  for (;;) {
    const salida = gh([
      "run",
      "list",
      "--workflow",
      WORKFLOW,
      "--limit",
      "50",
      "--json",
      "databaseId,headBranch,event,status,conclusion,url",
    ]);
    if (salida.status === 0) {
      const runs = JSON.parse(salida.stdout || "[]");
      const delTag = runs.find((run) => run.headBranch === tag && run.event === "push");
      if (delTag) return delTag;
    } else {
      console.warn(`Aviso: \`gh run list\` falló: ${salida.stderr.trim()}`);
    }
    if (Date.now() >= limite) {
      console.error(`No apareció el run de ${tag} en ${Math.round(esperaMaximaMs / 1000)} s.`);
      console.error(`Runs del workflow: ${acciones}`);
      process.exit(1);
    }
    await new Promise((listo) => setTimeout(listo, ESPERA_MS));
  }
}

/** Los cuatro adjuntos sin los que la release no sirve para nada. */
function adjuntosQueFaltan(nombres) {
  const faltan = [];
  if (!nombres.some((nombre) => nombre.endsWith("-setup.exe"))) {
    faltan.push("el instalador NSIS (-setup.exe)");
  }
  if (!nombres.some((nombre) => nombre.endsWith("-setup.exe.sig"))) {
    faltan.push("la firma del instalador (-setup.exe.sig)");
  }
  if (!nombres.some((nombre) => nombre.endsWith(".msi"))) faltan.push("el MSI (.msi)");
  if (!nombres.includes("latest.json")) faltan.push("latest.json");
  return faltan;
}

/**
 * La release del tag, sus adjuntos y el manifiesto del updater.
 *
 * El workflow sube el `latest.json` al final, después de los instaladores, así
 * que un run en verde ya lo tiene. El manifiesto se comprueba dos veces: el
 * que está adjunto a la release y el que sirve el endpoint del updater, que es
 * el que consulta la app (`/releases/latest/download/latest.json`).
 */
async function comprobarRelease({ repo, tag, version }) {
  const release = gh(["release", "view", tag, "--json", "assets"]);
  if (release.status !== 0) {
    console.error(`No hay GitHub Release para ${tag}: ${release.stderr.trim()}`);
    console.error(`Release: https://github.com/${repo}/releases/tag/${tag}`);
    process.exit(1);
  }

  const nombres = JSON.parse(release.stdout || "{}").assets.map((adjunto) => adjunto.name);
  const faltan = adjuntosQueFaltan(nombres);
  if (faltan.length > 0) {
    console.error(`La release ${tag} está incompleta: falta ${faltan.join(", ")}.`);
    console.error(`Release: https://github.com/${repo}/releases/tag/${tag}`);
    process.exit(1);
  }
  console.log(`Release ${tag}: ${nombres.length} adjuntos, están los cuatro que hacen falta.`);

  const carpeta = mkdtempSync(path.join(tmpdir(), "eui-release-"));
  const ruta = path.join(carpeta, "latest.json");
  try {
    const descarga = gh([
      "release",
      "download",
      tag,
      "--pattern",
      "latest.json",
      "--output",
      ruta,
      "--clobber",
    ]);
    if (descarga.status !== 0) {
      console.error(`No se pudo descargar el latest.json de ${tag}: ${descarga.stderr.trim()}`);
      process.exit(1);
    }

    const manifiesto = JSON.parse(readFileSync(ruta, "utf8"));
    if (manifiesto.version !== version) {
      console.error(`El latest.json de ${tag} dice «${manifiesto.version}», no «${version}».`);
      process.exit(1);
    }

    // La URL del manifiesto tiene que apuntar al nombre que GitHub publicó:
    // cambia los espacios del activo por puntos y un nombre local da 404.
    const url = manifiesto.platforms?.["windows-x86_64"]?.url;
    if (!url) {
      console.error(`El latest.json de ${tag} no trae la plataforma windows-x86_64.`);
      process.exit(1);
    }
    const artefacto = decodeURIComponent(url.split("/").pop());
    if (!nombres.includes(artefacto)) {
      console.error(`El latest.json apunta a «${artefacto}», que no está entre los adjuntos.`);
      process.exit(1);
    }
  } finally {
    rmSync(carpeta, { recursive: true, force: true });
  }

  // El endpoint del updater es lo que consulta la app: tiene que responder y
  // decir la versión del tag. `/latest/` es lo último publicado, así que un
  // desfase aquí suele ser una release más nueva, no un fallo de esta.
  //
  // Justo después de publicar, el CDN puede contestar 404 o 5xx unos segundos:
  // eso también se reintenta, no solo el desfase de versión.
  const endpoint = `https://github.com/${repo}/releases/latest/download/latest.json`;
  let motivo = "";
  let desfase = false;
  for (let intento = 1; intento <= INTENTOS_ENDPOINT; intento += 1) {
    desfase = false;
    const respuesta = await fetch(endpoint, { redirect: "follow" });
    if (!respuesta.ok) {
      motivo = `El endpoint ${endpoint} respondió ${respuesta.status}.`;
    } else {
      const publicado = await respuesta.json();
      if (publicado.version === version) {
        console.log(`Updater: ${endpoint} → ${publicado.version}`);
        return;
      }
      motivo = `El endpoint sirve «${publicado.version}» y el tag es «${version}».`;
      desfase = true;
    }
    if (intento === INTENTOS_ENDPOINT) break;
    console.warn(`Intento ${intento}/${INTENTOS_ENDPOINT}: ${motivo} Se reintenta.`);
    await new Promise((listo) => setTimeout(listo, ESPERA_MS));
  }
  console.error(motivo);
  if (desfase) {
    console.error("Si hay una release más nueva publicada, este endpoint ya no es el suyo.");
  }
  process.exit(1);
}

const args = leerArgumentos(process.argv.slice(2));
// Se acepta «0.5.3» o «v0.5.3»; el manifiesto lleva la versión sin la `v`.
const version = (
  args.posicional ?? JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version
).replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Versión no válida: «${version}» (se espera X.Y.Z, p. ej. 0.5.3)`);
  process.exit(1);
}
const tag = `v${version}`;

if (gh(["--version"]).status !== 0) sinGh("no está `gh`");
if (gh(["auth", "status"]).status !== 0) sinGh("`gh` no tiene sesión");

const repo = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
if (repo.status !== 0) sinGh("no se pudo leer el repo con `gh`");
const acciones = `https://github.com/${repo.stdout.trim()}/actions/workflows/${WORKFLOW}`;

console.log(`Release ${tag}: buscando el run del workflow ${WORKFLOW}…`);
const run = await esperarRun(tag, args.tiempoMax * 1000, acciones);
console.log(`Run ${run.databaseId}: ${run.url}`);

if (run.status !== "completed") {
  console.log("Siguiendo el run hasta el final…");
  const seguimiento = gh(["run", "watch", String(run.databaseId), "--exit-status"], {
    heredar: true,
  });
  if (seguimiento.status !== 0) {
    console.error(`\nEl run de ${tag} no terminó bien: ${run.url}`);
    process.exit(seguimiento.status ?? 1);
  }
}

// `gh run watch` sale con el código del run, pero la conclusión se vuelve a
// leer: así el mensaje dice qué pasó y no solo «falló».
const final = gh(["run", "view", String(run.databaseId), "--json", "conclusion,url"]);
let conclusion = run.conclusion;
let url = run.url;
if (final.status === 0) {
  const datos = JSON.parse(final.stdout || "{}");
  conclusion = datos.conclusion ?? conclusion;
  url = datos.url ?? url;
}

if (conclusion !== "success") {
  console.error(`El run de ${tag} terminó en «${conclusion ?? "sin conclusión"}»: ${url}`);
  process.exit(1);
}
console.log(`Run de ${tag} en verde: ${url}`);

await comprobarRelease({ repo: repo.stdout.trim(), tag, version });
console.log(`Release ${tag} publicada y servida por el updater.`);
