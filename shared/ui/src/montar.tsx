import { StrictMode } from "react";
import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/index.css";

/** Monta la UI compartida en el `#root` que declaran los dos `index.html`.
 *
 *  El `StrictMode` y la hoja de estilos son iguales en web y desktop; lo único
 *  que cambia es el componente que se pasa (la App o el envoltorio Tauri). */
export function montarApp(contenido: ReactNode, id = "root"): void {
  const container = document.getElementById(id);
  if (!container) throw new Error(`#${id} no existe en index.html`);
  createRoot(container).render(<StrictMode>{contenido}</StrictMode>);
}
