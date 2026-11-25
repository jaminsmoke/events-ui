// El puerto del core, leído de su única fuente.
//
// `services/core/src/events_core/puerto.json` es el sitio donde vive el número:
// lo leen el core (Python), el desktop (Rust, en su `build.rs`) y los guiones y
// configs de Vite. Aquí no se escribe el puerto: si hiciera falta, se cambia en
// el JSON y todos lo ven.
import { readFileSync } from "node:fs";

export const PUERTO_CORE = JSON.parse(
  readFileSync(new URL("../services/core/src/events_core/puerto.json", import.meta.url), "utf8"),
).core;
