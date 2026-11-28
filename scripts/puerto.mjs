// El puerto del core, leído de su única fuente.
//
// `shared/core/src/events_core/puerto.json` es el sitio donde vive el número:
// lo leen el core (Python), el desktop (Rust, en su `build.rs`) y los guiones y
// configs de Vite. Aquí no se escribe el puerto: si hiciera falta, se cambia en
// el JSON y todos lo ven.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** La ruta del JSON, escrita una sola vez. La importan los consumidores
 *  (`check-puerto`, el preset de Vite y su prueba) en vez de componerla cada
 *  uno: mover el core es un cambio aquí y no en cuatro sitios. */
export const RUTA_PUERTO = fileURLToPath(
  new URL("../shared/core/src/events_core/puerto.json", import.meta.url),
);

export const PUERTO_CORE = JSON.parse(readFileSync(RUTA_PUERTO, "utf8")).core;
