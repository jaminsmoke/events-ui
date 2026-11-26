import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { VistaDerecha, VistaPane } from "../pantalla/Actividad";
import type { Seleccion } from "./seleccion";

/** Lo seleccionado en el lienzo y cómo se abre desde ahí el panel derecho.
 *
 *  Seleccionar no despliega nada dentro del nodo: los detalles viven en el
 *  Inspector. Un commit trae el panel al frente; el resto se marca y espera su
 *  ficha. En ventana estrecha, el panel le deja el turno al pane.
 */
export function useSeleccion({
  ventanaEstrecha,
  setPane,
  setVistaDerecha,
  setArchivoAbierto,
}: {
  ventanaEstrecha: boolean;
  setPane: Dispatch<SetStateAction<VistaPane | null>>;
  setVistaDerecha: Dispatch<SetStateAction<VistaDerecha | null>>;
  setArchivoAbierto: Dispatch<SetStateAction<string | null>>;
}) {
  const [seleccion, setSeleccion] = useState<Seleccion | null>(null);

  const seleccionar = useCallback(
    (s: Seleccion) => {
      setSeleccion(s);
      if (s.tipo !== "commit") return;
      setVistaDerecha("inspector");
      if (ventanaEstrecha) setPane(null);
    },
    [ventanaEstrecha, setPane, setVistaDerecha],
  );

  /* Abrir un archivo estrena la vista Archivo del panel derecho: el visor
   * sustituye a Resumen/Inspector en vez de montar otro panel. En ventana
   * estrecha, le deja el turno al pane. */
  const abrirArchivo = useCallback(
    (ruta: string) => {
      setArchivoAbierto(ruta);
      setVistaDerecha("archivo");
      if (ventanaEstrecha) setPane(null);
    },
    [ventanaEstrecha, setPane, setArchivoAbierto, setVistaDerecha],
  );

  return { seleccion, setSeleccion, seleccionar, abrirArchivo };
}
