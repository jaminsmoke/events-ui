// Construye el sidecar empaquetado (PyInstaller, F3) y lo deja donde Tauri lo
// busca: `apps/desktop/src-tauri/binaries/events-core-<triple>[.exe]`.
//
// - `--onefile`: un solo `.exe`, que es lo que `externalBin` de Tauri puede
//   llevar a los instaladores (con `--onedir` los DLLs no viajarían).
// - `--windowed` solo para el core: el bootloader de onefile crea un hijo de
//   consola si es un binario de consola y `CREATE_NO_WINDOW` del lanzador no
//   evita esa ventana. El CLI `eui` sigue siendo consola para imprimir.
//   Con el core GUI, los `git` del sondeo DEBEN ir por `events_core.proceso`
//   (CREATE_NO_WINDOW); si no, cada hijo abre una terminal que parpadea.
// - Se comprueba que arranca y responde a `/health` antes de darlo por bueno:
//   el binario se ejecuta en frío, con el puerto libre, y se mata al final.
//
// Con `--solo-eui` (lo que corre la matriz de CI) se salta el desktop y el
// core: compila únicamente `eui` y lo deja en `services/core/dist/`, que es lo
// que CI adjunta al release como `eui-<os>-<arch>` y de donde el paquete npm
// de la web se lo baja la primera vez. Un solo binario: `eui` también levanta
// el core (`eui serve`).
//
// Uso: `corepack pnpm build:sidecar` (o solo vía `pnpm release`), y
// `node scripts/build-sidecar.mjs --solo-eui` en CI.

import { execFileSync, execSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pidsEnPuerto } from "./puertos.mjs";
import { PUERTO_CORE } from "./puerto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORE = path.join(ROOT, "services", "core");
const SRC_TAURI = path.join(ROOT, "apps", "desktop", "src-tauri");
const DESTINO = path.join(SRC_TAURI, "binaries");
const ES_WINDOWS = process.platform === "win32";
const SOLO_EUI = process.argv.includes("--solo-eui");

function puertoLibre(puerto, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sonda = net.createServer();
    sonda.once("error", () => resolve(false));
    sonda.listen(puerto, host, () => sonda.close(() => resolve(true)));
  });
}

/** Un puerto que el sistema acaba de dar por libre, o 0 si no hay. */
function puertoEfimero(host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sonda = net.createServer();
    sonda.once("error", () => resolve(0));
    sonda.listen(0, host, () => {
      const { port } = sonda.address();
      sonda.close(() => resolve(port));
    });
  });
}

function tripleHost() {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = out.match(/^host:\s*(.+)$/m);
  if (!match) throw new Error("No se pudo averiguar el target triple de rustc.");
  return match[1].trim();
}

const sufijo = ES_WINDOWS ? ".exe" : "";
const nombreBinario = `events-core${sufijo}`;
// Ojo: `uv run --directory` cambia el cwd a services/core, así que las rutas
// que lee PyInstaller tienen que ser absolutas (si no, "Script file ...
// does not exist" aunque el fichero esté).
const srcCore = path.join(CORE, "src");

console.log(`── sidecar (PyInstaller, ${process.platform}-${process.arch}) ──`);

// El core GUI y el `eui` del desktop solo los construye el host que empaqueta
// el instalador (Windows hoy). `--solo-eui` los salta: CI solo necesita el
// binario del paquete npm.
let triple = null;
if (!SOLO_EUI) {
  triple = tripleHost();
  const pyinstaller = execSync(
    `uv run --directory services/core pyinstaller --onefile --windowed --noconfirm --name events-core --paths ${srcCore} --collect-all events_core ${path.join(srcCore, "events_core", "sidecar.py")}`,
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
}

// El CLI `eui` es otro binario, no el servidor: Tauri lo deja junto a la app y
// el instalador puede copiarlo a los datos del usuario si se marca el opt-in.
// En el paquete npm es el único: `eui serve` levanta el core desde él mismo.
const cli = path.join(srcCore, "events_core", "eui.py");
const pyinstallerCli = execSync(
  `uv run --directory services/core pyinstaller --onefile --noconfirm --name eui --paths ${srcCore} --collect-all events_core ${cli}`,
  { cwd: ROOT, encoding: "utf8", shell: true },
);
console.log(pyinstallerCli.trim().split("\n").slice(-3).join("\n"));

const congeladoCli = path.join(CORE, "dist", `eui${sufijo}`);
if (!existsSync(congeladoCli)) {
  throw new Error(`PyInstaller no dejó el binario en ${congeladoCli}`);
}
const destinoCli = triple ? path.join(DESTINO, `eui-${triple}${sufijo}`) : congeladoCli;
if (triple) {
  cpSync(congeladoCli, destinoCli);
}

const versionCli = execFileSync(destinoCli, ["--version"], { encoding: "utf8" }).trim();
if (!versionCli.startsWith("eui ")) {
  throw new Error(`El CLI empaquetado no responde: ${versionCli}`);
}
console.log(`${triple ? `Copiado a ${destinoCli}` : "Compilado"} (${versionCli})`);

// Los binarios no van a npm: npm lleva dos paquetes (protocolos y web) y el
// core se publica como adjunto del release de GitHub. Aquí solo se compila
// `eui` y se deja en `dist/`, que es lo que CI recoge.
if (SOLO_EUI) {
  rmSync(path.join(CORE, "build"), { recursive: true, force: true });
  rmSync(path.join(CORE, "eui.spec"), { force: true });
  console.log(`Binario para el release: ${destinoCli}`);
  process.exit(0);
}

// Prueba en frío: arranca el binario y comprueba que responde a /health.
//
// Se prefiere el puerto de verdad (`puerto.json`), que es el que usa la app. Si lo
// tiene ocupado un core ya vivo (tu app abierta, un `pnpm dev`), la prueba va
// a un puerto libre: el binario es el mismo y lo que se comprueba es que
// arranca y sirve. Antes se abortaba el release entero por eso, después de
// haber compilado todo.
const congelaCore = path.join(CORE, "dist", nombreBinario);
const PUERTO_REAL = PUERTO_CORE;
let puertoPrueba = PUERTO_REAL;
if (!(await puertoLibre(PUERTO_REAL))) {
  puertoPrueba = await puertoEfimero();
  if (!puertoPrueba) {
    const quien = pidsEnPuerto(PUERTO_REAL);
    throw new Error(
      `El puerto ${PUERTO_REAL} está ocupado` +
        (quien.length ? ` (PID ${quien.join(", ")})` : "") +
        " y no se encontró otro libre para la prueba en frío del sidecar." +
        " Para liberarlo: cierra la app o `taskkill /PID <pid> /T /F`.",
    );
  }
  const quien = pidsEnPuerto(PUERTO_REAL);
  console.warn(
    `El puerto ${PUERTO_REAL} está ocupado` +
      (quien.length ? ` (PID ${quien.join(", ")})` : "") +
      `: la prueba en frío del sidecar usa el ${puertoPrueba}.`,
  );
}
const proceso = spawn(congelaCore, [], {
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, EUI_PORT: String(puertoPrueba) },
});
let salida = "";
proceso.stdout.on("data", (d) => (salida += d.toString()));
proceso.stderr.on("data", (d) => (salida += d.toString()));

async function esperarHealth() {
  const limite = Date.now() + 30_000;
  while (Date.now() < limite) {
    try {
      const res = await fetch(`http://127.0.0.1:${puertoPrueba}/health`, {
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
    console.log(`Sidecar congelado responde a /health en 127.0.0.1:${puertoPrueba}. OK`);
  } else {
    throw new Error(
      `El sidecar no respondió a /health en 127.0.0.1:${puertoPrueba} en 30 s.` +
        (puertoPrueba === PUERTO_REAL
          ? " Puede que otro proceso se lo haya llevado mientras arrancaba."
          : "") +
        ` Salida:\n${salida.slice(-2000)}`,
    );
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
  // En Windows el exe puede seguir bloqueado un instante tras el exit:
  // sin reintento, `rmSync(dist)` revienta con EPERM aunque el health OK.
  const borrar = (ruta) => {
    for (let i = 0; i < 8; i++) {
      try {
        rmSync(ruta, { recursive: true, force: true });
        return;
      } catch (err) {
        if (err && (err.code === "EPERM" || err.code === "EBUSY") && i < 7) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
          continue;
        }
        throw err;
      }
    }
  };
  borrar(path.join(CORE, "dist"));
  borrar(path.join(CORE, "build"));
  borrar(path.join(CORE, "events-core.spec"));
  borrar(path.join(CORE, "eui.spec"));
}
