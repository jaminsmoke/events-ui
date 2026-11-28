// Matar lo que arrancan los scripts: una sola forma en Windows y en POSIX.
//
// En Windows el shell intermedio del arranque deja al hijo vivo, así que hay
// que matar el árbol con `taskkill /T`. En POSIX no hay árbol: hay grupo de
// proceso, y solo existe si el hijo se arrancó con `detached` —sin eso, el
// hijo está en el grupo de este script y `kill(-pid)` no lo alcanza—. Por eso
// `dev.mjs` arranca core y Vite con `detached` en POSIX: sin grupo propio no
// hay nada que matar y `pnpm`/`node` se quedan escuchando cuando `dev.mjs` sale.
import { spawnSync } from "node:child_process";
import process from "node:process";

/** El árbol por `taskkill`: síncrono a propósito, porque si se lanzara y acto
 *  seguido saliera este proceso, el `taskkill` no llegaría a correr y el hijo
 *  quedaría huérfano escuchando. */
function arbolWindows(pid) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

/** Un PID suelto: árbol en Windows, SIGTERM a ese proceso en POSIX. */
export function matarPid(pid) {
  if (!pid) return;
  if (process.platform === "win32") return arbolWindows(pid);
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* ya no vivía */
  }
}

/** Un hijo de arranque con todo lo que cuelga de él. En POSIX mata el grupo
 *  (`kill(-pid)`): el líder puede haber muerto y el grupo sobrevive, que es
 *  justo el caso de `sh -c` → `pnpm` → `node`. */
export function matarArbol(child) {
  if (!child || child.pid === undefined) return;
  if (process.platform === "win32") return arbolWindows(child.pid);
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // No era líder de grupo (nadie lo arrancó `detached`): al menos el hijo.
    matarPid(child.pid);
  }
}
