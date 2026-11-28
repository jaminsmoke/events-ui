export const STORAGE_KEY = "eui.repo";

/** Cómo se elige una carpeta puede depender del envoltorio: en desktop es el
 *  diálogo nativo de Tauri y lo inyecta `apps/desktop`; en la web no hay
 *  diálogo y la UI compartida ofrece la lista de `GET /repos` y pegar la ruta.
 *  Por eso aquí no se pregunta si estamos en Tauri: se recibe la capacidad. */
export type ElegirCarpeta = () => Promise<string | null>;

export function folderName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Une una carpeta y un nombre con el separador de la base.
 *
 *  El core acepta `/` en cualquier plataforma, pero mezclar `C:\repo` con
 *  `/sub` deja una ruta que se lee mal y que algún día alguien comparará. La
 *  base manda: si ya usa barras invertidas, se conservan. */
export function unirRuta(base: string, nombre: string): string {
  const limpia = base.replace(/[\\/]+$/, "");
  const separador = limpia.includes("\\") && !limpia.includes("/") ? "\\" : "/";
  return `${limpia}${separador}${nombre}`;
}

/** Última carpeta usada. Es solo comodidad de arranque: la verdad está en el repo. */
export function storedRepo(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // navegador sin storage
  }
}
