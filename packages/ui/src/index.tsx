/** Entrada de la UI compartida: los envoltorios (Tauri y web) montan esto y
 *  cada uno inyecta lo suyo (el diálogo nativo y las actualizaciones, solo
 *  en desktop). */
export { default } from "./App";
export { montarApp } from "./montar";
export type { Actualizacion, EstadoActualizacion } from "./core/actualizacion";
export type { ElegirCarpeta } from "./core/repo";
export type { WorkItemCreate, WorkItemUpdate } from "./core/api";
