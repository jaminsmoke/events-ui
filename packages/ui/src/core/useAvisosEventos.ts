import { useEffect, useRef } from "react";

import type { Evento, WorkItem } from "./api";
import type { Ajustes } from "./avisos";
import { eventosNuevos, puedeAvisar } from "./avisosReglas";
import { resumenEvento } from "./useEventos";

/** Los avisos del sistema: eventos nuevos y caída del core.
 *
 *  Solo se avisa de lo que llega después del primer lote del SSE (ese lote es
 *  el historial), solo si la verbosidad lo permite y, con `soloFondo`, solo
 *  con la ventana oculta o sin foco.
 */
export function useAvisosEventos({
  eventos,
  ideas,
  error,
  avisar,
  ajustes,
}: {
  eventos: readonly Evento[];
  ideas: WorkItem[] | null;
  error: string | null;
  avisar?: (titulo: string, cuerpo: string) => void;
  ajustes: Ajustes;
}) {
  const ultimoEvento = useRef<number | null>(null);
  useEffect(() => {
    if (eventos.length === 0) {
      ultimoEvento.current = null;
      return;
    }
    if (!avisar) return;
    const ultimo = eventos[eventos.length - 1];
    if (!ultimo) return;
    const previo = ultimoEvento.current;
    ultimoEvento.current = ultimo.id;
    if (!puedeAvisar(ajustes, "evento", !document.hidden)) return;
    for (const evento of eventosNuevos(eventos, previo)) {
      avisar("Events UI", resumenEvento(evento));
    }
  }, [eventos, avisar, ajustes]);

  // Error del core: solo cuando el mapa ni carga (`!ideas`), al pasar a
  // fallar (transición), no en cada reintento —si no, cada 2 s otro aviso.
  const errorPrevio = useRef<string | null>(null);
  useEffect(() => {
    const previo = errorPrevio.current;
    errorPrevio.current = error;
    if (!avisar || !error || previo === error) return;
    if (!puedeAvisar(ajustes, "error", !document.hidden)) return;
    if (!ideas) avisar("Events UI", `Sin conexión con el core: ${error}`);
  }, [error, ideas, avisar, ajustes]);
}
