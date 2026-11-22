import { open as openFolder } from "@tauri-apps/plugin-dialog";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import App from "@events-ui/ui";

import { useActualizacion } from "./useActualizacion";

/** Lo único propio de desktop: el diálogo nativo de carpetas, los avisos del
 *  sistema y las actualizaciones. La web no inyecta nada de esto. */
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

export function Escritorio() {
  const actualizacion = useActualizacion();
  return (
    <App
      elegirCarpeta={elegirCarpeta}
      avisar={avisar}
      puedeProbar
      actualizacion={actualizacion}
    />
  );
}
