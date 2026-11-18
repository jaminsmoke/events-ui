import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { Idea } from "../core/api";
import type { LaneId } from "./carriles";
import { LANES, laneOf } from "./carriles";
import type { Vista } from "./camara";

/** Rectángulo relativo al mapa: lo que un vuelo necesita para saber de dónde a dónde. */
export type Rect = { x: number; y: number; w: number; h: number };

/** Una fila cruzando de un carril al otro. */
export type Vuelo = {
  id: number;
  repo: string;
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
  repo,
  ideas,
  cerrados,
  vista,
  mapRef,
}: {
  repo: string | null;
  ideas: Idea[] | null;
  cerrados: ReadonlySet<string>;
  vista: Vista;
  mapRef: RefObject<HTMLDivElement | null>;
}) {
  const [vuelos, setVuelos] = useState<Vuelo[]>([]);
  const anterior = useRef<{
    repo: string;
    carriles: Map<string, LaneId | "root">;
    rects: Map<string, Rect>;
  } | null>(null);
  const secuencia = useRef(0);
  const k = vista.k;

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!repo || !map || !ideas) return;

    const caja = map.getBoundingClientRect();
    const ahora = new Map<string, Rect>();
    for (const fila of map.querySelectorAll<HTMLElement>(".row[data-uid]")) {
      const uid = fila.dataset.uid;
      const nodo = fila.dataset.nodo;
      // Las filas del cajón también se miden: son el origen del vuelo cuando
      // una idea recibe carril (deja Ideas para ir a En cola).
      const cabecera = fila.firstElementChild;
      if (!uid || !nodo || !cabecera) continue;
      const r = cabecera.getBoundingClientRect();
      ahora.set(`${nodo}:${uid}`, {
        x: (r.left - caja.left) / k,
        y: (r.top - caja.top) / k,
        w: r.width / k,
        h: r.height / k,
      });
    }

    /* Con el carril plegado no hay fila que medir: el vuelo arranca o aterriza
     * en la cabecera del nodo, que es lo único que se ve de él. */
    for (const nodo of map.querySelectorAll<HTMLElement>(".linea > .node")) {
      const lane = LANES.find((carril) =>
        nodo.classList.contains(`lane-${carril.id}`),
      )?.id;
      if (!lane) continue;
      const r = nodo.getBoundingClientRect();
      ahora.set(lane, {
        x: (r.left - caja.left) / k + 8,
        y: (r.top - caja.top) / k + 6,
        w: Math.max(80, r.width / k - 16),
        h: 20,
      });
    }

    const carriles = new Map<string, LaneId | "root">(
      ideas.map((idea) => [idea.uid, laneOf(idea.status) ?? ("root" as const)]),
    );
    const previo = anterior.current;
    anterior.current = { repo, carriles, rects: ahora };
    if (previo?.repo !== repo) return;

    const nuevos: Vuelo[] = [];
    for (const { uid, title, status } of ideas) {
      const lane = laneOf(status);
      const antes = previo.carriles.get(uid);
      if (antes === undefined || antes === lane) continue;
      // Volver al cajón (sin carril) no tiene destino: ahí no se vuela.
      if (!lane) continue;

      const desde = previo.rects.get(`${antes}:${uid}`) ?? previo.rects.get(antes);
      const fila = ahora.get(`${lane}:${uid}`);
      const hasta = fila ?? ahora.get(lane);
      if (!desde || !hasta) continue;

      nuevos.push({
        id: ++secuencia.current,
        repo,
        uid,
        title,
        from: desde,
        to: hasta,
        lane,
        funde: fila === undefined,
      });
    }

    if (nuevos.length === 0) return;

    // En un frame: este efecto solo mide y compara, y el estado del vuelo no
    // puede entrar en cascada con el render que acaba de pintar las filas.
    const raf = requestAnimationFrame(() => setVuelos(nuevos));
    return () => cancelAnimationFrame(raf);
  }, [repo, ideas, cerrados, k, mapRef]);

  // Solo se oculta la fila del carril de destino: la del cajón no se mueve.
  const volando = useCallback(
    (uid: string, nodo: string) => vuelos.some((v) => v.repo === repo && v.uid === uid && v.lane === nodo),
    [repo, vuelos],
  );

  const aterrizado = useCallback((id: number) => {
    setVuelos((prev) => prev.filter((v) => v.id !== id));
  }, []);

  return { vuelos: vuelos.filter((vuelo) => vuelo.repo === repo), volando, aterrizado };
}
