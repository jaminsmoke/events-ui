// Batería de e2e: flujos de verdad (core real + UI real) en escenarios
// sueltos, cada uno en su fichero dentro de `e2e/escenarios/`.
//
//  node e2e/run.mjs             todos los escenarios
//  node e2e/run.mjs prueba-1    solo los que matcheen ese nombre de fichero
//  node e2e/run.mjs --ayuda
//
// El runner levanta su propio core en :18765 (con su temporal propio de repos
// y de registro) y su Vite de desktop en :15175. Los puertos deben estar
// libres: si algo ya escucha (el `pnpm dev` de alguien), el runner se niega
// a arrancar en vez de matar ese proceso —nunca se toca lo ajeno.
// Al terminar (pase, falle o se interrumpa con Ctrl+C) se cierra lo que el
// runner levantó y se comprueba que los puertos quedan libres: si algo
// nuestro sobrevivió, se remata y se avisa. Si algo falla, el resumen sale
// igual con el nombre del escenario y la causa.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { esperarPuertoLibre, matarEnPuerto, pidsEnPuerto } from "../scripts/puertos.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESCENARIOS_DIR = path.join(ROOT, "e2e", "escenarios");
const RESULTADOS_DIR = path.join(ROOT, "e2e", "resultados");

const CORE = "http://127.0.0.1:18765";
const UI = "http://localhost:15175";
const TIMEOUT_MS = 45_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function matar(child) {
  if (!child || child.pid === undefined) return;
  if (process.platform === "win32") {
    // Con árbol: el shell intermedio (`shell: true`) deja al hijo vivo.
    // Síncrono a propósito: si se lanzara y acto seguido saliera el proceso,
    // el `taskkill` no llegaría a correr y el hijo quedaría huérfano.
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    // Grupo de proceso (`detached` al arrancar): matar solo al shell deja a
    // `uv`/Python y a pnpm/node de Vite vivos como huérfanos. El grupo
    // sobrevive al líder, así que vale aunque el hijo ya hubiera salido.
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* el grupo ya no existe */
    }
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
    "uv run --directory services/core python -m uvicorn events_core.main:app --host 127.0.0.1 --port 18765",
    {
      cwd: ROOT,
      shell: true,
      // En POSIX, grupo de proceso propio: así `matar` lleva el árbol entero
      // (uv → Python) y no queda huérfano si se interrumpe el runner.
      detached: process.platform !== "win32",
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
    detached: process.platform !== "win32",
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

  // Los puertos deben estar libres y el runner NUNCA mata a quien los ocupe:
  // si hay un `pnpm dev` en marcha, se avisa y se sale. Matar a ciegas aquí
  // era tirar la sesión de dev de quien estuviera probando.
  for (const puerto of [18765, 15175]) {
    const ocupantes = pidsEnPuerto(puerto);
    if (ocupantes.length > 0) {
      console.error(
        `El puerto ${puerto} ya está ocupado (PID ${ocupantes.join(", ")}). ` +
          "Para el e2e hay que parar antes esa instancia (p. ej. tu `pnpm dev`): " +
          "el runner no mata procesos ajenos.",
      );
      process.exit(1);
    }
  }

  const core = arrancarCore(tmp);
  const vite = arrancarVite();
  let browser = null;
  const resultados = [];

  // Cierre de lo que levantamos, con comprobación de que no queda huérfano:
  // los puertos estaban libres al arrancar y solo nuestros hijos podían
  // escuchar en ellos, así que quien siga ahí es un nieto nuestro que
  // sobrevivió al árbol (se reparentó al morir el líder) y se remata.
  let limpiando = false;
  async function limpiar() {
    if (limpiando) return;
    limpiando = true;
    await browser?.close().catch(() => {});
    matar(core);
    matar(vite);
    for (const puerto of [18765, 15175]) {
      if (await esperarPuertoLibre(puerto, 5_000)) continue;
      const restos = matarEnPuerto(puerto);
      console.warn(
        `Puerto ${puerto}: quedaba escuchando tras cerrar el árbol ` +
          `(PID ${restos.join(", ")}); rematado.`,
      );
      if (!(await esperarPuertoLibre(puerto, 5_000))) {
        console.error(
          `Puerto ${puerto}: SIGUE ocupado (PID ${pidsEnPuerto(puerto).join(", ")}) ` +
            "tras el cierre. Hay un huérfano: míralo a mano.",
        );
      }
    }
  }
  // Sin esto, un Ctrl+C (o morir de SIGTERM) salta el `finally` de abajo y
  // deja core+Vite huérfanos escuchando. El segundo Ctrl+C fuerza la salida.
  const alInterrumpir = (codigo) => async () => {
    if (limpiando) process.exit(codigo);
    await limpiar();
    process.exit(codigo);
  };
  process.on("SIGINT", alInterrumpir(130));
  process.on("SIGTERM", alInterrumpir(143));
  process.on("uncaughtException", (err) => {
    console.error(err);
    void alInterrumpir(1)();
  });
  process.on("unhandledRejection", (err) => {
    console.error(err);
    void alInterrumpir(1)();
  });
  try {
    core.on("error", (err) => console.error(`core: ${err.message}`));
    vite.on("error", (err) => console.error(`vite: ${err.message}`));
    if (!(await esperarUrl(`${CORE}/health`))) throw new Error("el core no respondió /health");
    // La lista de la UI (`/repos`) solo enseña carpetas ya sembradas: el
    // escenario clásico abre `lab`, así que se siembra aquí mismo para que
    // el botón exista desde el primer fotograma. El log lo siembra el core
    // con el almacén: el runner no crea tablas a mano.
    await fetch(`${CORE}/mapa?repo=lab`).catch(() => {});
    if (!(await esperarUrl(`${UI}/`))) throw new Error("Vite no respondió en 15175");

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
      } finally {
        // Escenarios aislados: el lab se limpia tras cada uno, pase o no
        // (es el endpoint LAB/e2e de /reiniciar, no el CRUD de producto).
        await api("/reiniciar?repo=lab", { method: "POST" }).catch(() => {});
      }
    }
  } finally {
    await limpiar();
  }

  const fallos = resultados.filter((r) => !r.ok);
  console.log(
    `\n${resultados.length - fallos.length}/${resultados.length} escenarios en verde.`,
  );
  process.exit(fallos.length > 0 ? 1 : 0);
}

await main();
