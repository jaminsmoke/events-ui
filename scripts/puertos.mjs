// Quién escucha en un puerto, y cómo dejarlo libre: arrancar en limpio sale
// más barato que reutilizar a ciegas un core/Vite de una sesión anterior —
// sobre todo porque "reutilizar" es justamente como ayer se quedó el código
// viejo atendiendo.
import { execFileSync } from "node:child_process";
import process from "node:process";

/** PIDs que escuchan en `puerto` (Windows con `netstat`, POSIX con `lsof`). */
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
      // TCP 127.0.0.1:8765 0.0.0.0:0 LISTENING 12345
      if (partes[3] === "LISTENING" && partes[1]?.endsWith(`:${puerto}`)) {
        const pid = Number(partes[4]);
        if (pid > 0) pids.add(pid);
      }
    }
    return [...pids];
  }
  try {
    const salida = execFileSync("lsof", [`-tiTCP:${puerto}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
    });
    return salida
      .split("\n")
      .map((l) => Number(l.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

/** Mata (con árbol, como `matar` de dev.mjs) a quien escuche en `puerto`.
 *  Devuelve los PIDs que se han terminado. */
export function matarEnPuerto(puerto) {
  const pids = pidsEnPuerto(puerto);
  for (const pid of pids) {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        /* ya no vivía */
      }
    }
  }
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
