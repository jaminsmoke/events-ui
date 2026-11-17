import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Idea } from "../core/api";
import type { LaneId } from "./carriles";
import { laneOf } from "./carriles";
import type { Vista } from "./camara";

/** Rectángulo relativo al mapa: lo que un vuelo necesita para saber de dónde a dónde. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Una fila cruzando de un carril al otro. */
export type Vuelo = {
  id: number;
  uid: string;
  title: string;
  from: Rect;
  to: Rect;
  lane: LaneId;
  /** Sin fila de destino —carril plegado—: la copia se desvanece al llegar. */
  funde: boolean;
};

/** El vuelo: si una idea cambia de carril, su fila no aparece de golpe en el
 *  nodo nuevo — se va volando desde donde estaba, y el destino la espera oculta
 *  hasta que aterriza. El dato llega en un instante; el viaje no. */
export function useVuelos({
  ideas,
  vista,
  mapRef,
}: {
  ideas: Idea[] | null;
  vista: Vista;
  mapRef: RefObject<HTMLDivElement | null>;
}) {
  const [vuelos, setVuelos] = useState<Vuelo[]>([]);
  const carrilesPrevios = useRef(new Map<string, LaneId>());
  const rects = useRef(new Map<string, Rect>());

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map || !ideas) return;

    const k = vista.k;
    const caja = map.getBoundingClientRect();
    const ahora = new Map<string, Rect>();
    for (const fila of map.querySelectorAll<HTMLElement>(".row[data-uid]")) {
      const uid = fila.dataset.uid;
      const nodo = fila.dataset.nodo;
      // El cajón no vuela: sus filas no son origen ni destino de nada.
      if (!uid || !nodo || nodo === "root") continue;
      const r = fila.getBoundingClientRect();
      ahora.set(`${nodo}:${uid}`, {
        x: (r.left - caja.left) / k,
        y: (r.top - caja.top) / k,
        w: r.width / k,
        h: r.height / k,
      });
    }

    /* Con el carril plegado no hay fila que medir: el vuelo arranca o aterriza
     * en la cabecera del nodo, que es lo único que se ve de él. */
    const cabecera = (lane: LaneId): Rect | undefined => {
      const el = map.querySelector<HTMLElement>(`.node.lane-${lane}`);
      if (!el) return undefined;
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - caja.left) / k + 8,
        y: (r.top - caja.top) / k + 6,
        w: Math.max(80, r.width / k - 16),
        h: 20,
      };
    };

    const carriles = new Map(ideas.map((idea) => [idea.uid, laneOf(idea.status)]));
    const nuevos: Vuelo[] = [];
    let n = 0;
    for (const [uid, lane] of carriles) {
      const antes = carrilesPrevios.current.get(uid);
      if (!antes || antes === lane) continue;

      const desde = rects.current.get(`${antes}:${uid}`) ?? cabecera(antes);
      const fila = ahora.get(`${lane}:${uid}`);
      const hasta = fila ?? cabecera(lane);
      if (!desde || !hasta) continue;

      nuevos.push({
        id: Date.now() + n++,
        uid,
        title: ideas.find((idea) => idea.uid === uid)?.title ?? "",
        from: desde,
        to: hasta,
        lane,
        funde: fila === undefined,
      });
    }

    carrilesPrevios.current = carriles;
    rects.current = ahora;
    if (nuevos.length === 0) return;

    // En un frame: este efecto solo mide y compara, y el estado del vuelo no
    // puede entrar en cascada con el render que acaba de pintar las filas.
    const raf = requestAnimationFrame(() => setVuelos((prev) => [...prev, ...nuevos]));
    return () => cancelAnimationFrame(raf);
  }, [ideas, vista, mapRef]);

  // Solo se oculta la fila del carril de destino: la del cajón no se mueve.
  const volando = useCallback(
    (uid: string, nodo: string) => vuelos.some((v) => v.uid === uid && v.lane === nodo),
    [vuelos],
  );

  const aterrizado = useCallback((id: number) => {
    setVuelos((prev) => prev.filter((v) => v.id !== id));
  }, []);

  return { vuelos, volando, aterrizado };
}
