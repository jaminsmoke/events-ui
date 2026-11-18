// Arranque en desarrollo: core + UI en un solo comando.
//
// La UI no habla con el core directamente: Vite le pasa `/api` por proxy a
// 127.0.0.1:8765. Si el core no está, Vite escupe
// `http proxy error: connect ECONNREFUSED 127.0.0.1:8765` cada dos segundos
// (lo que pide `useRepo`) y la ventana se queda en "Cargando…".
// Por eso este script se asegura de que el core esté antes de lanzar la UI:
// si ya responde en /health se reutiliza (p. ej. porque se arrancó aparte con
// `pnpm core:dev`); si no, se levanta aquí y se apaga al salir la UI.
//
// Uso: `node scripts/dev.mjs` (Tauri) o `node scripts/dev.mjs web` (solo web,
// en 5174; `ui` es un alias histórico). Ambas montan la UI de `@events-ui/ui`.

import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = "http://127.0.0.1:8765";
const TIMEOUT_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function coreVivo() {
  try {
    const res = await fetch(`${CORE}/health`, { signal: AbortSignal.timeout(1_000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function esperarCore() {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await coreVivo()) return true;
    await sleep(250);
  }
  return false;
}

// Mismo comando que `pnpm core:dev` en la raíz.
function arrancarCore() {
  return spawn(
    "uv run --directory services/core python -m events_core.serve",
    { cwd: ROOT, shell: true, stdio: "inherit" },
  );
}

function matar(child) {
  if (!child || child.exitCode !== null) return;
  // En Windows hay que matar el árbol: el shell intermedio deja al hijo vivo.
  // Síncrono a propósito: si se lanza y acto seguido sale el proceso, el
  // `taskkill` no llega a correr y el core queda huérfano escuchando.
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function main() {
  const modo = process.argv[2] === "web" || process.argv[2] === "ui" ? "web" : "tauri";

  let core = null;
  if (await coreVivo()) {
    console.log("Core ya en marcha en 127.0.0.1:8765, se reutiliza.");
  } else {
    console.log("Core no responde: levantándolo en 127.0.0.1:8765…");
    core = arrancarCore();
    core.on("error", (err) => {
      console.error(`No se pudo arrancar el core: ${err.message}`);
      console.error("¿Está `uv` en el PATH? Prueba aparte: corepack pnpm core:dev");
      process.exit(1);
    });
    if (!(await esperarCore())) {
      console.error(
        `El core no respondió en ${CORE}/health en ${TIMEOUT_MS / 1000} s. ` +
          "Mira el mensaje de arriba o prueba aparte: corepack pnpm core:dev",
      );
      matar(core);
      process.exit(1);
    }
    console.log("Core listo.");
  }

  const comando =
    modo === "web"
      ? "corepack pnpm --filter web dev"
      : "corepack pnpm --filter desktop tauri dev";
  const ui = spawn(comando, { cwd: ROOT, shell: true, stdio: "inherit" });

  const apagar = () => {
    matar(ui);
    matar(core);
  };
  process.on("SIGINT", apagar);
  process.on("SIGTERM", apagar);

  ui.on("exit", (code) => {
    matar(core);
    process.exit(code ?? 0);
  });
}

await main();
