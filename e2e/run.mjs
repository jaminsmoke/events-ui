// Batería de e2e: flujos de verdad (core real + UI real) en escenarios
// sueltos, cada uno en su fichero dentro de `e2e/escenarios/`.
//
//  node e2e/run.mjs             todos los escenarios
//  node e2e/run.mjs prueba-1    solo los que matcheen ese nombre de fichero
//  node e2e/run.mjs --ayuda
//
// El runner levanta su propio core (con su temporal propio de repos y de
// registro) y sus dos Vites: el de desktop y el de la web. Por defecto usa el
// puerto de `puerto.json`, :15175 y :15174; si están
// ocupados —la app abierta, por ejemplo— elige otros libres y lo dice, sin
// matar nunca lo ajeno. `--core-port`, `--ui-port` y `--web-port` fijan los
// puertos.
// Al terminar (pase, falle o se interrumpa con Ctrl+C) se cierra lo que el
// runner levantó y se comprueba que los puertos quedan libres: si algo
// nuestro sobrevivió, se remata y se avisa. Si algo falla, el resumen sale
// igual con el nombre del escenario y la causa.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { esperarPuertoLibre, matarEnPuerto, pidsEnPuerto } from "../scripts/puertos.mjs";
import { PUERTO_CORE as PUERTO_CORE_POR_DEFECTO } from "../scripts/puerto.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ESCENARIOS_DIR = path.join(ROOT, "e2e", "escenarios");
const RESULTADOS_DIR = path.join(ROOT, "e2e", "resultados");

const PUERTO_CORE = PUERTO_CORE_POR_DEFECTO;
const PUERTO_UI = 15175;
const PUERTO_WEB = 15174;
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

function arrancarCore(tmp, puerto) {
  // Uvicorn directo (no events_core.serve): así el runner controla su puerto
  // sin colisionar con la comprobación de puerto del arranque en dev.
  return spawn(
    `uv run --directory services/core python -m uvicorn events_core.main:app --host 127.0.0.1 --port ${puerto}`,
    {
      cwd: ROOT,
      shell: true,
      // En POSIX, grupo de proceso propio: así `matar` lleva el árbol entero
      // (uv → Python) y no queda huérfano si se interrumpe el runner.
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        EVENTSUI_REPOS_ROOT: path.join(tmp, "repos"),
        // El explorador de carpetas del selector se ancla al temporal del
        // runner: los escenarios navegan sin salir del árbol de pruebas.
        EVENTSUI_FS_ROOT: tmp,
        EVENTSUI_REGISTRO_DB: path.join(tmp, "registro.sqlite"),
        // La UI escribe la raíz en la configuración compartida al abrir: que
        // caiga en el temporal del runner y no en el perfil del usuario.
        EVENTSUI_CONFIG: path.join(tmp, "config.json"),
        // La UI del runner corre en un Vite propio: el core abre el comodín
        // de orígenes de bucle local (el de producción no lo tiene).
        EVENTSUI_DESARROLLO: "1",
      },
    },
  );
}

function arrancarVite(filtro, puertoUi, puertoCore) {
  // El puerto va por la CLI de Vite (pisa `server.port`) y el destino del
  // proxy por entorno, que `vite.config.ts` lee con `loadEnv`.
  // pnpm reenvía lo que sigue al script tal cual: con `--` Vite lo recibía
  // como argumento propio y arrancaba en su puerto por defecto.
  return spawn(`corepack pnpm --filter ${filtro} dev --port ${puertoUi}`, {
    cwd: ROOT,
    shell: true,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      EVENTSUI_UI_PORT: String(puertoUi),
      EVENTSUI_CORE_URL: `http://127.0.0.1:${puertoCore}`,
    },
  });
}

/** Un puerto que además se puede enlazar: en Windows hay rangos excluidos que
 *  `listen(0)` devuelve igualmente y luego Vite no arranca. Se prueba desde
 *  `desde` hacia arriba, saltando lo que ya escucha alguien. */
async function puertoLibre(desde) {
  for (let puerto = desde; puerto <= desde + 100; puerto++) {
    if (pidsEnPuerto(puerto).length > 0) continue;
    try {
      await new Promise((resolve, reject) => {
        const servidor = net.createServer();
        servidor.once("error", reject);
        servidor.listen(puerto, "127.0.0.1", () => servidor.close(resolve));
      });
      return puerto;
    } catch {
      // Ocupado o excluido por el sistema: se prueba el siguiente.
    }
  }
  throw new Error(`sin puertos libres a partir de ${desde}`);
}

/** El puerto pedido si está libre. Si lo pidió el usuario, se respeta y se
 *  avisa; si era el de por defecto, se busca otro. */
async function elegirPuerto(pedido, explicito, etiqueta) {
  if (pidsEnPuerto(pedido).length === 0) return pedido;
  if (explicito) {
    console.error(
      `El puerto ${etiqueta} ${pedido} ya está ocupado (PID ${pidsEnPuerto(pedido).join(", ")}). ` +
        "Elige otro con --core-port/--ui-port o libéralo.",
    );
    process.exit(1);
  }
  const libre = await puertoLibre(pedido + 1);
  console.log(`Puerto ${etiqueta} ${pedido} ocupado: el runner usa ${libre}.`);
  return libre;
}

/** `--core-port N`, `--ui-port N` y el nombre del escenario, en cualquier orden. */
function leerOpciones(argv) {
  const opciones = { filtro: null, core: null, ui: null, web: null, ayuda: false };
  const args = argv.slice(2).filter((a) => a !== "--");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--ayuda" || arg === "-h") opciones.ayuda = true;
    else if (arg === "--core-port") opciones.core = Number(args[++i]);
    else if (arg === "--ui-port") opciones.ui = Number(args[++i]);
    else if (arg === "--web-port") opciones.web = Number(args[++i]);
    else if (!arg.startsWith("--")) opciones.filtro ??= arg;
    else {
      console.error(`Opción desconocida: ${arg}`);
      process.exit(1);
    }
  }
  for (const [nombre, valor] of [
    ["core", opciones.core],
    ["ui", opciones.ui],
    ["web", opciones.web],
  ]) {
    if (valor !== null && !(Number.isInteger(valor) && valor >= 1 && valor <= 65535)) {
      console.error(`--${nombre}-port espera un puerto entre 1 y 65535.`);
      process.exit(1);
    }
  }
  return opciones;
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
  const opciones = leerOpciones(process.argv);
  if (opciones.ayuda) {
    const todos = await escenarios();
    console.log("Uso: node e2e/run.mjs [escenario] [--core-port N] [--ui-port N]\n");
    for (const e of todos) console.log(`  ${e.nombre}  — ${e.descripcion ?? ""}`);
    console.log(
      `\nLos puertos por defecto (${PUERTO_CORE}, ${PUERTO_UI} y ${PUERTO_WEB}) se cambian solos si están` +
        " ocupados, así que la batería corre con la app abierta.",
    );
    return;
  }

  const lista = await escenarios(opciones.filtro);
  if (lista.length === 0) {
    console.error(`Ningún escenario matchea${opciones.filtro ? ` ${opciones.filtro}` : ""}.`);
    process.exit(1);
  }

  const { chromium } = await import("playwright-core");

  // Entorno propio: repos y registro temporales.
  const tmp = await mkdtemp(path.join(os.tmpdir(), "eui-e2e-"));
  await mkdir(path.join(tmp, "repos", "lab"), { recursive: true });
  await mkdir(RESULTADOS_DIR, { recursive: true });

  // El runner NUNCA mata a quien ocupe un puerto: si los de por defecto están
  // tomados (la app abierta, por ejemplo) usa otros libres. Los explícitos se
  // respetan: si están ocupados, se avisa y se sale.
  const puertoCore = await elegirPuerto(PUERTO_CORE, opciones.core !== null, "del core");
  const puertoUi = await elegirPuerto(PUERTO_UI, opciones.ui !== null, "de la UI");
  const puertoWeb = await elegirPuerto(PUERTO_WEB, opciones.web !== null, "de la web");
  const CORE = `http://127.0.0.1:${puertoCore}`;
  const UI = `http://localhost:${puertoUi}`;
  const WEB = `http://localhost:${puertoWeb}`;
  const puertos = [puertoCore, puertoUi, puertoWeb];
  console.log(`Core en ${CORE}, UI en ${UI} y web en ${WEB}.`);

  let core = arrancarCore(tmp, puertoCore);
  const vite = arrancarVite("desktop", puertoUi, puertoCore);
  const viteWeb = arrancarVite("events-ui-webapp", puertoWeb, puertoCore);
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
    matar(viteWeb);
    for (const puerto of puertos) {
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
    viteWeb.on("error", (err) => console.error(`vite web: ${err.message}`));
    if (!(await esperarUrl(`${CORE}/health`))) throw new Error("el core no respondió /health");
    // La lista de la UI (`/repos`) solo enseña carpetas ya sembradas: el
    // escenario clásico abre `lab`, así que se siembra aquí mismo para que
    // el botón exista desde el primer fotograma. El log lo siembra el core
    // con el almacén: el runner no crea tablas a mano.
    await fetch(`${CORE}/mapa?repo=lab`).catch(() => {});
    if (!(await esperarUrl(`${UI}/`))) throw new Error(`Vite no respondió en ${UI}`);
    if (!(await esperarUrl(`${WEB}/`))) throw new Error(`Vite web no respondió en ${WEB}`);

    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    page.on("dialog", async (d) => d.accept());
    const web = await browser.newPage({ viewport: { width: 1500, height: 950 } });
    web.on("dialog", async (d) => d.accept());

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
    // El escenario de core caído mata el proceso y lo vuelve a levantar en el
    // mismo puerto: los repos son de disco, así que no se pierde nada. `core`
    // es `let` para que el cierre mate el que quede vivo.
    const matarCore = async () => {
      matar(core);
      if (!(await esperarPuertoLibre(puertoCore, 5_000))) {
        throw new Error(`el core no soltó el puerto ${puertoCore}`);
      }
    };
    const levantarCore = async () => {
      core = arrancarCore(tmp, puertoCore);
      core.on("error", (err) => console.error(`core: ${err.message}`));
      if (!(await esperarUrl(`${CORE}/health`))) {
        throw new Error("el core no volvió a responder /health");
      }
    };
    const ctx = {
      CORE,
      UI,
      WEB,
      api,
      esperar,
      expect,
      page,
      web,
      tmp,
      matarCore,
      levantarCore,
      resultado: (n) => path.join(RESULTADOS_DIR, n),
    };

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
