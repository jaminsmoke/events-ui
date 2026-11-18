/** Entrada de la UI compartida: los envoltorios (Tauri y web) montan esto y
 *  cada uno inyecta lo suyo (el diálogo nativo, solo en desktop). */
export { default } from "./App";
export type { ElegirCarpeta } from "./core/repo";
