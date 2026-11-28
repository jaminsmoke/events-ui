// Puertos y esperas de arranque, en un solo sitio.
//
// Quién escucha en un puerto y cómo dejarlo libre: arrancar en limpio sale más
// barato que reutilizar a ciegas un core/Vite de una sesión anterior — sobre
// todo porque "reutilizar" es justamente como ayer se quedó el código viejo
// atendiendo. Y lo mismo con las esperas: core, sidecar y e2e preguntan a un
// `fetch` hasta que responde, con el mismo bucle y distintos tiempos.
import { execFileSync } from "node:child_process";
import net from "node:net";
import process from "node:process";

import { matarPid } from "./procesos.mjs";

/** Una vez basta: sin `lsof` ni `ss` el aviso saldría en cada consulta. */
let avisadoSinLsof = false;

function pidsConLsof(puerto) {
  // `lsof` sale con 1 cuando no hay nadie: eso es «libre», no un fallo. Un
  // error de verdad (ENOENT u otro) lo decide quien llama.
  const salida = execFileSync("lsof", [`-tiTCP:${puerto}`, "-sTCP:LISTEN"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return salida
    .split("\n")
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** `ss -ltnp` es lo que hay donde no hay `lsof` (iproute2, base de Debian). */
function pidsConSs(puerto) {
  const salida = execFileSync("ss", ["-ltnp"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const pids = new Set();
  for (const linea of salida.split("\n")) {
    const columnas = linea.trim().split(/\s+/);
    // State Recv-Q Send-Q Local:port Peer:port Process
    if (columnas.length < 4 || !columnas[3].endsWith(`:${puerto}`)) continue;
    for (const coincidencia of linea.matchAll(/pid=(\d+)/g)) {
      const pid = Number(coincidencia[1]);
      if (pid > 0) pids.add(pid);
    }
  }
  return [...pids];
}

/** PIDs que escuchan en `puerto` (Windows con `netstat`, POSIX con `lsof` y,
 *  si no está, con `ss`; sin ninguno de los dos, se avisa una vez). */
export function pidsEnPuerto(puerto) {
  if (process.platform === "win32") {
    let salida = "";
    try {
      salida = execFileSync("netstat", ["-ano"], { encoding: "utf8", shell: true });
    } catch {
      return [];
    }
    const pids = new Set();
    for (const linea of salida.split("\n")) {
      const partes = linea.trim().split(/\s+/);
      // TCP 127.0.0.1:65000 0.0.0.0:0 LISTENING 12345
      if (partes[3] === "LISTENING" && partes[1]?.endsWith(`:${puerto}`)) {
        const pid = Number(partes[4]);
        if (pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  }
  try {
    return pidsConLsof(puerto);
  } catch (error) {
    // `lsof` existe pero no encuentra a nadie (sale con 1): el puerto está libre.
    if (error?.code !== "ENOENT") return [];
  }
  try {
    return pidsConSs(puerto);
  } catch (error) {
    if (error?.code !== "ENOENT") return [];
    if (!avisadoSinLsof) {
      avisadoSinLsof = true;
      console.warn(
        "puertos: no hay `lsof` ni `ss` en el PATH; no se puede saber quién escucha en un puerto.",
      );
    }
    return [];
  }
}

/** Mata a quien escuche en `puerto` con el mismo `matarPid` que el resto de
 *  los scripts (árbol en Windows). Devuelve los PIDs que se han terminado. */
export function matarEnPuerto(puerto) {
  const pids = pidsEnPuerto(puerto);
  for (const pid of pids) matarPid(pid);
  return pids;
}

/** Espera (brevemente) a que nadie escuche; los `taskkill` no son instantáneos. */
export async function esperarPuertoLibre(puerto, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (pidsEnPuerto(puerto).length > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  return pidsEnPuerto(puerto).length === 0;
}

/** Si el sistema deja enlazar en `puerto` ahora mismo. */
export function puertoSePuedeEnlazar(puerto, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sonda = net.createServer();
    sonda.once("error", () => resolve(false));
    sonda.listen(puerto, host, () => sonda.close(() => resolve(true)));
  });
}

/** Un puerto que el sistema acaba de dar por libre, o 0 si no hay. */
export function puertoEfimero(host = "127.0.0.1") {
  return new Promise((resolve) => {
    const sonda = net.createServer();
    sonda.once("error", () => resolve(0));
    sonda.listen(0, host, () => {
      const { port } = sonda.address();
      sonda.close(() => resolve(port));
    });
  });
}

/** Un puerto que además se puede enlazar: en Windows hay rangos excluidos que
 *  `listen(0)` devuelve igualmente y luego Vite no arranca. Se prueba desde
 *  `desde` hacia arriba, saltando lo que ya escucha alguien. */
export async function buscarPuertoLibre(desde, { host = "127.0.0.1", saltos = 100 } = {}) {
  for (let puerto = desde; puerto <= desde + saltos; puerto++) {
    if (pidsEnPuerto(puerto).length > 0) continue;
    if (await puertoSePuedeEnlazar(puerto, host)) return puerto;
  }
  throw new Error(`sin puertos libres a partir de ${desde}`);
}

/** Espera a que `url` responda 2xx/3xx. `timeoutMs` manda; el sondeo es corto
 *  para que un arranque lento no se confunda con uno colgado. */
export async function esperarHttp(url, { timeoutMs = 20_000, intervaloMs = 250 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return true;
    } catch {
      // aún no escucha
    }
    await new Promise((r) => setTimeout(r, intervaloMs));
  }
  return false;
}
