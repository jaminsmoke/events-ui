import { useEffect, useRef, useState } from "react";

import type { WorkItem } from "../core/api";
import { actividadEntre } from "./actividad";
import type { Animacion, LaneId, TonoPulso } from "./actividad";
import { laneOf } from "./carriles";

export type { Animacion, NodoId, Pulso, TonoPulso } from "./actividad";

/** Compara la foto anterior con la nueva y deja la actividad visible 1,15 s.
 *  La regla (pulsos, chispa de llegada y salidas sin chispa) vive en
 *  `actividadEntre`, que es puro y tiene su propia unit. */
export function useAnimaciones(repo: string | null, items: WorkItem[] | null) {
  const [actividad, setActividad] = useState<{
    repo: string;
    chispas: Animacion[];
    pulsos: { lane: LaneId; tono: TonoPulso }[];
    cajon?: TonoPulso;
  } | null>(null);
  const anterior = useRef<{
    repo: string;
    estados: Map<string, WorkItem["status"]>;
    carriles: Map<string, LaneId | null>;
  } | null>(null);
  const secuencia = useRef(0);

  useEffect(() => {
    if (!repo || !items) return;
    const previo = anterior.current;
    anterior.current = {
      repo,
      estados: new Map(items.map((item) => [item.uid, item.status])),
      carriles: new Map(items.map((item) => [item.uid, laneOf(item.status)])),
    };
    if (previo?.repo !== repo) return;

    const filas = items.map((item) => ({
      uid: item.uid,
      status: item.status,
      lane: laneOf(item.status),
    }));
    const { llegan, pulsos, cajon } = actividadEntre(previo, filas);
    // Una salida (o un cajón que solo pulsa) no tiene chispas, pero sí pulso.
    if (llegan.length === 0 && pulsos.length === 0 && !cajon) return;
    const chispas = llegan.map(([lane, desde]) => ({ lane, desde, id: ++secuencia.current }));
    const raf = requestAnimationFrame(() => {
      setActividad({ repo, chispas, pulsos, cajon });
    });
    return () => cancelAnimationFrame(raf);
  }, [repo, items]);

  useEffect(() => {
    if (!actividad) return;
    const timer = setTimeout(() => setActividad(null), 1150);
    return () => clearTimeout(timer);
  }, [actividad]);

  const visible = actividad?.repo === repo ? actividad : null;
  return {
    chispas: visible?.chispas ?? [],
    pulsos: visible?.pulsos ?? [],
    pulsoCajon: visible?.cajon,
  };
}
