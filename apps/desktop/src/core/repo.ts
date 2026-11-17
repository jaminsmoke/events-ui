export const STORAGE_KEY = "eui.repo";

/** En `dev:ui` (navegador) no hay Tauri, así que no hay diálogo nativo. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Última carpeta usada. Es solo comodidad de arranque: la verdad está en el repo. */
export function storedRepo(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // navegador sin storage
  }
}
