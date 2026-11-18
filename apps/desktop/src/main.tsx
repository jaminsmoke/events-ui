import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { open as openFolder } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import App from "@events-ui/ui";
import "@events-ui/ui/styles.css";

/** Lo único propio de desktop: el diálogo nativo de carpetas y los avisos del
 *  sistema, que se inyectan en la UI compartida. La web no tiene ninguno de
 *  los dos y no pasa nada. */
async function elegirCarpeta(): Promise<string | null> {
  const dir = await openFolder({
    directory: true,
    multiple: false,
    title: "Elige la carpeta del repositorio",
  });
  return typeof dir === "string" ? dir : null;
}

/** Notificación del sistema (F3): pide permiso en el primer aviso si hace
 *  falta y, sin permiso, no dice nada (la UI ya muestra el aviso dentro). */
async function avisar(titulo: string, cuerpo: string): Promise<void> {
  let ok = await isPermissionGranted();
  if (!ok) ok = (await requestPermission()) === "granted";
  if (!ok) return;
  sendNotification({ title: titulo, body: cuerpo });
}

const container = document.getElementById("root");
if (!container) throw new Error("#root no existe en index.html");

createRoot(container).render(
  <StrictMode>
    <App elegirCarpeta={elegirCarpeta} avisar={avisar} puedeProbar />
  </StrictMode>,
);
