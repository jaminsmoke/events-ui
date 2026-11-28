// Arranque en desarrollo: core + UI en un solo comando.
//
// La UI no habla con el core directamente: Vite le pasa `/api` por proxy al
// puerto de `puerto.json` (la única copia del número). Si el core no está,
// Vite escupe `http proxy error: connect ECONNREFUSED` cada dos segundos (lo
// que pide `useRepo`) y la ventana se queda en "Cargando…".
//
// Siempre en limpio: antes de arrancar, quien escuchaba en ese puerto y en el
// puerto de la UI es un resto de una sesión anterior (core o Vite, incluso un
// zombie) y muere; el core se levanta siempre de nuevo con el código de hoy.
// Reutilizarlo a ciegas ya costó una mañana: ayer atendía el código de
// antes de ayer sin que nada lo notara. Al salir la UI, el core también cae.
//
// Uso: `node scripts/dev.mjs` (Tauri) o `node scripts/dev.mjs web` (solo web,
// en 15174; `ui` es un alias histórico). Ambas montan la UI de `@events-ui/ui`.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import { matarArbol } from "./procesos.mjs";
import { PUERTO_CORE } from "./puerto.mjs";
import { esperarHttp, esperarPuertoLibre, matarEnPuerto } from "./puertos.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = `http://127.0.0.1:${PUERTO_CORE}`;
const TIMEOUT_MS = 20_000;

// Mismo comando que `pnpm core:dev` en la raíz. `uv` es un ejecutable real en
// Windows y Unix; sin `shell` no hay que concatenar argumentos ni avisar por
// DEP0190.
function arrancarCore() {
  return spawn(
    "uv",
    ["run", "--directory", "shared/core", "python", "-m", "events_core.serve"],
    {
      cwd: ROOT,
      stdio: "inherit",
      // Grupo propio en POSIX: `matarArbol` mata el grupo (`kill(-pid)`) y sin
      // `detached` el hijo vive en el grupo de este script, donde no se le
      // alcanza. Con él, el `uv` de este core se lleva a Python por delante.
      detached: process.platform !== "win32",
      // El core de dev abre el comodín de orígenes de bucle local: Vite sirve
      // la UI en un puerto que puede no ser el de siempre.
      env: { ...process.env, EVENTSUI_DESARROLLO: "1" },
    },
  );
}

/** `corepack` es un shim `.cmd` en Windows y no se puede lanzar sin shell;
 *  se usa `cmd /c`/`sh -c` con argumentos fijos, sin `shell:true` (DEP0190). */
function arrancarComando(comando) {
  // `detached` por lo mismo que en el core: sin grupo propio, matar el `sh`
  // deja vivos a `pnpm` y a `node` de Vite.
  const opciones = { cwd: ROOT, stdio: "inherit", detached: process.platform !== "win32" };
  if (process.platform === "win32") {
    return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", comando], opciones);
  }
  return spawn("sh", ["-c", comando], opciones);
}

/** Tauri exige que existan los `externalBin` para compilar, aunque en dev el
 *  sidecar no se arranque (lo levanta este script). Se crean vacíos si faltan;
 *  `binaries/` está ignorado y el build de release los sustituye de verdad. */
function asegurarBinariosTauri() {
  const host = execFileSync("rustc", ["-vV"], { encoding: "utf8" }).match(/^host:\s*(.+)$/m);
  if (!host) throw new Error("No se pudo averiguar el target triple de rustc.");
  const triple = host[1].trim();
  const sufijo = process.platform === "win32" ? ".exe" : "";
  const directorio = path.join(ROOT, "apps", "desktop", "src-tauri", "binaries");
  mkdirSync(directorio, { recursive: true });
  for (const nombre of ["events-core", "eui"]) {
    const archivo = path.join(directorio, `${nombre}-${triple}${sufijo}`);
    if (!existsSync(archivo)) {
      writeFileSync(archivo, "");
      console.log(`Placeholder de ${nombre} para tauri dev: ${archivo}`);
    }
  }
}

async function main() {
  const modo = process.argv[2] === "web" || process.argv[2] === "ui" ? "web" : "tauri";

  // En limpio: los restos de sesiones anteriores no estorban ni reutilizan.
  const puertoUi = modo === "web" ? 15174 : 15175;
  for (const puerto of [PUERTO_CORE, puertoUi]) {
    const muertos = matarEnPuerto(puerto);
    if (muertos.length > 0) {
      console.log(
        `Puerto ${puerto}: terminados ${muertos.join(", ")} (restos de sesiones anteriores).`,
      );
    }
    await esperarPuertoLibre(puerto);
  }

  console.log(`Levantando el core en 127.0.0.1:${PUERTO_CORE}…`);
  const core = arrancarCore();
  core.on("error", (err) => {
    console.error(`No se pudo arrancar el core: ${err.message}`);
    console.error("¿Está `uv` en el PATH? Prueba aparte: corepack pnpm core:dev");
    process.exit(1);
  });
  if (!(await esperarHttp(`${CORE}/health`, { timeoutMs: TIMEOUT_MS }))) {
    console.error(
      `El core no respondió en ${CORE}/health en ${TIMEOUT_MS / 1000} s. ` +
        "Mira el mensaje de arriba o prueba aparte: corepack pnpm core:dev",
    );
    matarArbol(core);
    process.exit(1);
  }
  console.log("Core listo.");

  const comando =
    modo === "web"
      ? "corepack pnpm --filter events-ui-webapp dev"
      : "corepack pnpm --filter desktop tauri dev";
  if (modo === "tauri") asegurarBinariosTauri();
  const ui = arrancarComando(comando);

  const apagar = () => {
    matarArbol(ui);
    matarArbol(core);
  };
  process.on("SIGINT", apagar);
  process.on("SIGTERM", apagar);

  ui.on("exit", (code) => {
    matarArbol(core);
    process.exit(code ?? 0);
  });
}

await main();
