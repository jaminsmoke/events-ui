// Batería de e2e: flujos de verdad (core real + UI real) en escenarios
// sueltos, cada uno en su fichero dentro de `e2e/escenarios/`.
//
//  node e2e/run.mjs             todos los escenarios
//  node e2e/run.mjs prueba-1    solo los que matcheen ese nombre de fichero
//  node e2e/run.mjs --ayuda
//
// El runner levanta su propio core en :8765 (con su temporal propio de repos
// y de registro) y su Vite de desktop en :5175, y mata todo lo que queda en
// esos puertos tanto al arrancar como al terminar: no toca el dev de nadie.
// Si algo falla, los procesos se terminan igual y el resumen sale con el
// nombre del escenario y la causa.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { esperarPuertoLibre, matarEnPuerto } from "../scripts/puertos.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESCENARIOS_DIR = path.join(ROOT, "e2e", "escenarios");
const RESULTADOS_DIR = path.join(ROOT, "e2e", "resultados");

const CORE = "http://127.0.0.1:8765";
const UI = "http://localhost:5175";
const TIMEOUT_MS = 45_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function matar(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

async function esperarUrl(url, timeoutMs = TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return true;
    } catch {
      /* aún no */
    }
    await sleep(300);
  }
  return false;
}

function arrancarCore(tmp) {
  // Uvicorn directo (no events_core.serve): así el runner controla su puerto
  // sin colisionar con la comprobación de puerto del arranque en dev.
  return spawn(
    "uv run --directory services/core python -m uvicorn events_core.main:app --host 127.0.0.1 --port 8765",
    {
      cwd: ROOT,
      shell: true,
      env: {
        ...process.env,
        EVENTSUI_REPOS_ROOT: path.join(tmp, "repos"),
        EVENTSUI_REGISTRO_DB: path.join(tmp, "registro.sqlite"),
      },
    },
  );
}

function arrancarVite() {
  return spawn("corepack pnpm --filter desktop dev", {
    cwd: ROOT,
    shell: true,
  });
}

/** Descubre los escenarios y filtra por el nombre dado (si lo hay). */
async function escenarios(filtro) {
  const nombres = (await readdir(ESCENARIOS_DIR)).filter((n) => n.endsWith(".mjs"));
  const elegidos = filtro
    ? nombres.filter((n) => n.replace(/\.mjs$/, "").includes(filtro))
    : nombres;
  const lista = [];
  for (const nombre of elegidos.sort()) {
    const modulo = await import(pathToFileURL(path.join(ESCENARIOS_DIR, nombre)));
    const escenario = modulo.default;
    if (!escenario?.run) throw new Error(`${nombre} no exporta run(ctx)`);
    lista.push({ nombre: nombre.replace(/\.mjs$/, ""), ...escenario });
  }
  return lista;
}

async function main() {
  // `pnpm e2e -- prueba-1` deja un `--` propio: se ignora y vale el resto.
  const arg = process.argv.slice(2).find((a) => a !== "--");
  if (arg === "--ayuda" || arg === "-h") {
    const todos = await escenarios();
    console.log("Uso: node e2e/run.mjs [nombre-de-escenario]\n");
    for (const e of todos) console.log(`  ${e.nombre}  — ${e.descripcion ?? ""}`);
    return;
  }

  const lista = await escenarios(arg);
  if (lista.length === 0) {
    console.error(`Ningún escenario matchea${arg ? ` ${arg}` : ""}.`);
    process.exit(1);
  }

  const { chromium } = await import("playwright-core");

  // Entorno propio: repos y registro temporales.
  const tmp = await mkdtemp(path.join(os.tmpdir(), "eui-e2e-"));
  await mkdir(path.join(tmp, "repos", "lab"), { recursive: true });
  await mkdir(RESULTADOS_DIR, { recursive: true });

  // En limpio: nada nuestro escucha en 8765/5175 durante el e2e.
  for (const puerto of [8765, 5175]) {
    const muertos = matarEnPuerto(puerto);
    if (muertos.length > 0) console.log(`Puerto ${puerto}: terminados ${muertos.join(", ")}.`);
    await esperarPuertoLibre(puerto);
  }

  const core = arrancarCore(tmp);
  const vite = arrancarVite();
  let browser = null;
  const resultados = [];
  try {
    core.on("error", (err) => console.error(`core: ${err.message}`));
    vite.on("error", (err) => console.error(`vite: ${err.message}`));
    if (!(await esperarUrl(`${CORE}/health`))) throw new Error("el core no respondió /health");
    // La lista de la UI (`/repos`) solo enseña carpetas ya sembradas: el
    // escenario clásico abre `lab`, así que se siembra aquí mismo para que
    // el botón exista desde el primer fotograma.
    await fetch(`${CORE}/mapa?repo=lab`).catch(() => {});
    if (!(await esperarUrl(`${UI}/`))) throw new Error("Vite no respondió en 5175");

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on("dialog", async (d) => d.accept());

    const api = async (ruta, opciones = {}) => {
      const res = await fetch(`${CORE}${ruta}`, opciones);
      const data = await res.json().catch(() => null);
      return { status: res.status, data };
    };
    const esperar = async (fn, descripcion, timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await fn()) return;
        await sleep(300);
      }
      throw new Error(`timeout esperando: ${descripcion}`);
    };
    const expect = (cond, mensaje) => {
      if (!cond) throw new Error(mensaje);
    };
    const ctx = { CORE, UI, api, esperar, expect, page, tmp, resultado: (n) => path.join(RESULTADOS_DIR, n) };

    for (const escenario of lista) {
      const inicio = Date.now();
      try {
        await escenario.run(ctx);
        resultados.push({ nombre: escenario.nombre, ok: true, ms: Date.now() - inicio });
        console.log(`✓ ${escenario.nombre} (${((Date.now() - inicio) / 1000).toFixed(1)} s)`);
      } catch (err) {
        resultados.push({
          nombre: escenario.nombre,
          ok: false,
          ms: Date.now() - inicio,
          causa: err instanceof Error ? err.message : String(err),
        });
        console.error(`✗ ${escenario.nombre}: ${resultados.at(-1).causa}`);
        await page
          .screenshot({ path: path.join(RESULTADOS_DIR, `${escenario.nombre}-fallo.png`) })
          .catch(() => {});
      }
    }
  } finally {
    await browser?.close().catch(() => {});
    matar(core);
    matar(vite);
  }

  const fallos = resultados.filter((r) => !r.ok);
  console.log(
    `\n${resultados.length - fallos.length}/${resultados.length} escenarios en verde.`,
  );
  process.exit(fallos.length > 0 ? 1 : 0);
}

await main();
