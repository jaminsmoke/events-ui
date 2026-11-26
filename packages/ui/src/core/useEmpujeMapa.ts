import { useEffect, useRef } from "react";

import type { Evento } from "./api";

/** Eventos que cambian la estructura del mapa y merecen una lectura inmediata.
 *  Las ediciones de ficha y de fases (`item.updated`) siguen el sondeo de 2 s:
 *  refrescarlas a media edición remontaba la ficha y podía pisar el borrador. */
const EVENTOS_QUE_EMPUJAN = new Set([
  "item.created",
  "item.deleted",
  "item.status",
  "idea.created",
  "idea.deleted",
  "idea.status",
]);

/** El SSE de un cambio pide releer el mapa al instante: el sondeo de 2 s sigue
 *  de red de seguridad, pero un alta hecha en el otro cliente se ve muy por
 *  debajo del tope. El primer lote es el historial y no empuja. */
export function useEmpujeMapa(eventos: readonly Evento[], refrescar: () => void) {
  const ultimo = useRef<number | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (eventos.length === 0) {
      ultimo.current = null;
      return;
    }
    const evento = eventos[eventos.length - 1];
    if (!evento) return;
    const previo = ultimo.current;
    ultimo.current = evento.id;
    // Un id que no crece es un vaciado del log: no hay nada nuevo que leer.
    if (previo !== null && evento.id <= previo) return;
    if (!EVENTOS_QUE_EMPUJAN.has(evento.type)) return;
    // El backfill de la conexión trae varios seguidos: se agrupan en una sola
    // lectura. El primer evento de un log vacío también es un cambio real.
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => refrescar(), 100);
    return () => clearTimeout(temporizador.current);
  }, [eventos, refrescar]);
}
