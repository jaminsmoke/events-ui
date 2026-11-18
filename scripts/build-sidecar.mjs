// Construye el sidecar empaquetado (PyInstaller, F3) y lo deja donde Tauri lo
// busca: `apps/desktop/src-tauri/binaries/events-core-<triple>[.exe]`.
//
// - `--onefile`: un solo `.exe`, que es lo que `externalBin` de Tauri puede
//   llevar a los instaladores (con `--onedir` los DLLs no viajarían).
// - Se comprueba que arranca y responde a `/health` antes de darlo por bueno:
//   el binario se ejecuta en frío, con el puerto libre, y se mata al final.
//
// Uso: `corepack pnpm build:sidecar` (o solo vía `pnpm release`).

import { execFileSync, execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "services", "core");
const SRC_TAURI = path.join(ROOT, "apps", "desktop", "src-tauri");
const DESTINO = path.join(SRC_TAURI, "binaries");
const ES_WINDOWS = process.platform === "win32";

function puertoLibre(puerto, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sonda = net.createServer();
    sonda.once("error", () => resolve(false));
    sonda.listen(puerto, host, () => sonda.close(() => resolve(true)));
  });
}

function tripleHost() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = out.match(/^host:\s*(.+)$/m);
  if (!match) throw new Error("No se pudo averiguar el target triple de rustc.");
  return match[1].trim();
}

const triple = tripleHost();
const sufijo = ES_WINDOWS ? ".exe" : "";
const nombreBinario = `events-core${sufijo}`;

console.log(`── sidecar (PyInstaller, ${triple}) ──`);
// Ojo: `uv run --directory` cambia el cwd a services/core, así que las rutas
// que lee PyInstaller tienen que ser absolutas (si no, "Script file ...
// does not exist" aunque el fichero esté).
const srcCore = path.join(CORE, "src");
const pyinstaller = execSync(
  `uv run --directory services/core pyinstaller --onefile --noconfirm --name events-core --paths ${srcCore} --collect-all events_core ${path.join(srcCore, "events_core", "sidecar.py")}`,
  { cwd: ROOT, encoding: "utf8", shell: true },
);
console.log(pyinstaller.trim().split("\n").slice(-3).join("\n"));

const congelado = path.join(CORE, "dist", nombreBinario);
if (!existsSync(congelado)) {
  throw new Error(`PyInstaller no dejó el binario en ${congelado}`);
}

mkdirSync(DESTINO, { recursive: true });
const destino = path.join(DESTINO, `events-core-${triple}${sufijo}`);
cpSync(congelado, destino);
console.log(`Copiado a ${destino}`);

// Prueba en frío: arranca en el puerto de verdad (8765) y responde /health.
if (!(await puertoLibre(8765))) {
  throw new Error("El puerto 8765 ya está ocupado: no se puede probar el sidecar.");
}
const proceso = spawn(congelado, [], { stdio: ["ignore", "pipe", "pipe"] });
let salida = "";
proceso.stdout.on("data", (d) => (salida += d.toString()));
proceso.stderr.on("data", (d) => (salida += d.toString()));

async function esperarHealth() {
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    try {
      const res = await fetch("http://127.0.0.1:8765/health", {
        signal: AbortSignal.timeout(1_000),
      });
      if (res.ok) return true;
    } catch {
      // aún no escucha (descomprimiendo el onefile)
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

try {
  if (await esperarHealth()) {
    console.log("Sidecar congelado responde a /health en 127.0.0.1:8765. OK");
  } else {
    throw new Error(`El sidecar no respondió a /health en 30 s. Salida:\n${salida.slice(-2000)}`);
  }
} finally {
  // El proceso puede haber muerto ya (p. ej. porque /health no respondió y
  // salió con error): taskkill sin proceso devuelve 128 y no debe tapar el
  // error original ni impedir la limpieza.
  try {
    if (ES_WINDOWS) {
      execSync(`taskkill /PID ${proceso.pid} /T /F`, { stdio: "ignore", shell: true });
    } else {
      proceso.kill("SIGTERM");
    }
  } catch {
    // ya no vivía
  }
  await new Promise((r) => proceso.on("exit", r));
  rmSync(path.join(CORE, "dist"), { recursive: true, force: true });
  rmSync(path.join(CORE, "build"), { recursive: true, force: true });
  rmSync(path.join(CORE, "events-core.spec"), { force: true });
}
