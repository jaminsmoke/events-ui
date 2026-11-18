import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { open as openFolder } from "@tauri-apps/plugin-dialog";

import App from "@events-ui/ui";
import "@events-ui/ui/styles.css";

/** Lo único propio de desktop: el diálogo nativo de carpetas, que se inyecta
 *  en la UI compartida. La web no tiene diálogo y no pasa nada. */
async function elegirCarpeta(): Promise<string | null> {
  const dir = await openFolder({
    directory: true,
    multiple: false,
    title: "Elige la carpeta del repositorio",
  });
  return typeof dir === "string" ? dir : null;
}

const container = document.getElementById("root");
if (!container) throw new Error("#root no existe en index.html");

createRoot(container).render(
  <StrictMode>
    <App elegirCarpeta={elegirCarpeta} />
  </StrictMode>,
);
