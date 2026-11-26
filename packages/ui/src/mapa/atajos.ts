import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";

import type { VistaDerecha, VistaPane } from "../pantalla/Actividad";
import { siguienteIndice } from "./paradas";
import { mismoElemento } from "./seleccion";
import type { Seleccion } from "./seleccion";

/** Índice de la selección dentro de las paradas, o -1 si no está. */
function indiceParada(paradas: readonly Seleccion[], seleccion: Seleccion | null): number {
  if (!seleccion) return -1;
  return paradas.findIndex((parada) => mismoElemento(parada, seleccion));
}

/** Los atajos del lienzo: Escape suelta y cierra, las flechas recorren las
 *  paradas y Enter abre el Inspector (o el mapa del puente).
 *
 *  Vive fuera de `App.tsx` porque son dos efectos independientes del resto:
 *  solo necesitan saber qué hay seleccionado, qué paneles están abiertos y a
 *  dónde llevan los puentes.
 */
export function useAtajosLienzo({
  paradas,
  seleccion,
  setSeleccion,
  panel,
  setPanel,
  vistaDerecha,
  setVistaDerecha,
  archivoAbierto,
  setArchivoAbierto,
  ventanaEstrecha,
  setPane,
  gitActivo,
  irGit,
  irDocumentos,
}: {
  paradas: readonly Seleccion[];
  seleccion: Seleccion | null;
  setSeleccion: Dispatch<SetStateAction<Seleccion | null>>;
  panel: "actividad" | "registro" | null;
  setPanel: Dispatch<SetStateAction<"actividad" | "registro" | null>>;
  vistaDerecha: VistaDerecha | null;
  setVistaDerecha: Dispatch<SetStateAction<VistaDerecha | null>>;
  archivoAbierto: string | null;
  setArchivoAbierto: Dispatch<SetStateAction<string | null>>;
  ventanaEstrecha: boolean;
  setPane: Dispatch<SetStateAction<VistaPane | null>>;
  gitActivo: boolean;
  irGit: () => void;
  irDocumentos: () => void;
}) {
  // Escape suelta lo seleccionado y, si no había nada, cierra el panel (no es
  // modal: no captura ni atrapa el foco). El listener vive mientras haya algo
  // que soltar o cerrar: con el panel derecho abierto, un segundo Escape lo
  // cierra en vez de quedarse sin oyente tras la primera pulsación.
  useEffect(() => {
    if (!panel && !vistaDerecha && !archivoAbierto && seleccion === null) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // El diálogo abierto gestiona su propio Escape; el lienzo no suelta la
      // selección que hay detrás.
      if (document.querySelector('dialog[open], [role="dialog"], .modal-fondo')) return;
      // El visor ocupa el centro: Escape lo cierra antes que nada.
      if (archivoAbierto && vistaDerecha === "archivo") {
        setVistaDerecha(null);
        setArchivoAbierto(null);
        return;
      }
      if (seleccion !== null) {
        setSeleccion(null);
        return;
      }
      setPanel(null);
      setVistaDerecha(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [panel, vistaDerecha, archivoAbierto, seleccion, setArchivoAbierto, setPanel, setSeleccion, setVistaDerecha]);

  // Teclado del lienzo: flechas recorren las paradas (circular) y Enter abre
  // en el Inspector lo marcado. No se mete en campos de formulario ni roba el
  // Enter de un botón o un enlace; Escape sigue soltando lo seleccionado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || paradas.length === 0) return;
      if (document.querySelector('dialog[open], [role="dialog"], .modal-fondo')) return;
      const destino = e.target instanceof HTMLElement ? e.target : null;
      const escribiendo =
        !!destino &&
        (destino.isContentEditable ||
          destino.tagName === "INPUT" ||
          destino.tagName === "TEXTAREA" ||
          destino.tagName === "SELECT");
      if (escribiendo) return;

      const salto =
        e.key === "ArrowRight" || e.key === "ArrowDown"
          ? 1
          : e.key === "ArrowLeft" || e.key === "ArrowUp"
            ? -1
            : 0;
      if (salto !== 0) {
        if (e.shiftKey) return;
        e.preventDefault();
        const siguiente = siguienteIndice(
          paradas.length,
          indiceParada(paradas, seleccion),
          salto,
        );
        const parada = paradas[siguiente];
        if (parada) setSeleccion(parada);
        return;
      }

      if (e.key === "Enter" && seleccion) {
        if (destino?.closest("button, a[href]")) return;
        e.preventDefault();
        // Los puentes abren su mapa, no el inspector.
        if (seleccion.tipo === "puente" && gitActivo) {
          irGit();
          return;
        }
        if (seleccion.tipo === "puente_documentos") {
          irDocumentos();
          return;
        }
        setVistaDerecha("inspector");
        if (ventanaEstrecha) setPane(null);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    paradas,
    seleccion,
    ventanaEstrecha,
    gitActivo,
    irGit,
    irDocumentos,
    setPane,
    setSeleccion,
    setVistaDerecha,
  ]);
}
