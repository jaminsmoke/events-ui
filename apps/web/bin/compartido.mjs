/** El contrato de `core/vX.Y.Z`, compartido con el desktop.
 *
 *  La regla vive documentada en `docs/core-compartido.md` y el desktop la
 *  aplica en `apps/desktop/src-tauri/src/versiones.rs`. Las dos pruebas usan
 *  la misma tabla: si una implementación se desvía, su prueba falla.
 */
import { join } from "node:path";

/** `vX.Y.Z` → [X, Y, Z]; null si el nombre no es una versión. */
export function versionDe(nombre) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(nombre);
  return m ? m.slice(1).map(Number) : null;
}

function compararVersiones(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/** La carpeta del core de esta versión, la misma que usa el desktop. */
export function carpetaCompartida({ env = process.env, sistema = process.platform, version }) {
  if (env.EUI_CORE_DIR) return env.EUI_CORE_DIR;
  const versionada = (base) => join(base, "core", `v${version}`);
  if (env.LOCALAPPDATA) return versionada(join(env.LOCALAPPDATA, "EventsUI"));
  if (sistema === "darwin") {
    return versionada(join(env.HOME ?? "", "Library", "Application Support", "EventsUI"));
  }
  if (env.XDG_DATA_HOME) return versionada(join(env.XDG_DATA_HOME, "eventsui"));
  return versionada(join(env.HOME ?? ".", ".local", "share", "eventsui"));
}

/**
 * Las carpetas de versión que se borran, en orden ascendente.
 *
 * Se queda la versión en uso, la inmediatamente anterior y cualquiera
 * posterior (puede ser la de otro cliente más nuevo). Lo que no sea `vX.Y.Z`
 * no cuenta.
 */
export function versionesABorrar(nombres, actual) {
  // Las carpetas del core se llaman `vX.Y.Z`; lo demás no se toca (igual que
  // `version_de_carpeta` en el desktop).
  const enUso = actual.startsWith("v") ? versionDe(actual) : null;
  if (!enUso) return [];
  const anteriores = nombres
    .map((nombre) => ({ nombre, numero: versionDe(nombre) }))
    .filter(
      (vieja) =>
        vieja.nombre.startsWith("v") &&
        vieja.numero &&
        compararVersiones(vieja.numero, enUso) < 0,
    )
    .sort((a, b) => compararVersiones(a.numero, b.numero));
  // La última de las anteriores es la que se conserva.
  anteriores.pop();
  return anteriores.map((vieja) => vieja.nombre);
}
