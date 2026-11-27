import { open as openFolder } from "@tauri-apps/plugin-dialog";

import App from "@events-ui/ui";

import { Pruebas } from "./Pruebas";
import { useActualizacion } from "./useActualizacion";

/** El lanzador del laboratorio se queda en el envoltorio: la web no lo ve. */
const PANEL_PRUEBAS = { componente: Pruebas };

/** Lo único propio de desktop: el diálogo nativo de carpetas y las
 *  actualizaciones. La web no inyecta nada de esto. */
async function elegirCarpeta(): Promise<string | null> {
  const dir = await openFolder({
    directory: true,
    multiple: false,
    title: "Elige la carpeta del repositorio",
  });
  return typeof dir === "string" ? dir : null;
}

export function Escritorio() {
  const actualizacion = useActualizacion();
  return (
    <App
      elegirCarpeta={elegirCarpeta}
      pruebas={PANEL_PRUEBAS}
      actualizacion={actualizacion}
    />
  );
}
