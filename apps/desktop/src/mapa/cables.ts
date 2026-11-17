import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

import type { Tree } from "./arbol";
import { LANES } from "./carriles";
import type { LaneId } from "./carriles";
import type { Vista } from "./camara";

/** Un cable del cajón a un carril, ya medido en píxeles del mapa. */
export type Cable = { lane: LaneId; d: string; x1: number; y1: number };

/** Los cables y la respuesta a «¿queda algo fuera del lienzo?».
 *
 *  Los cables se miden del DOM: los nodos crecen al desplegarse y nada es fijo.
 *  La medición se repite sola cuando cambia cualquier nodo, el lienzo o la vista.
 */
export function useCables({
  tree,
  cerrados,
  vista,
  boardRef,
  mapRef,
  cajonRef,
  carrilRefs,
}: {
  tree: Tree | null;
  cerrados: ReadonlySet<string>;
  vista: Vista;
  boardRef: RefObject<HTMLElement | null>;
  mapRef: RefObject<HTMLDivElement | null>;
  cajonRef: RefObject<HTMLElement | null>;
  carrilRefs: RefObject<(HTMLElement | null)[]>;
}) {
  const [cables, setCables] = useState<Cable[]>([]);
  const [recortado, setRecortado] = useState(false);

  useLayoutEffect(() => {
    const map = mapRef.current;
    const cajon = cajonRef.current;
    if (!map || !cajon || !tree) return;

    // Todo se mide en coordenadas locales del mapa: el `scale` del lienzo no
    // puede contarse dos veces al dibujar los cables.
    const k = vista.k;
    const medir = () => {
      const caja = map.getBoundingClientRect();
      const a = cajon.getBoundingClientRect();
      const x1 = (a.right - caja.left) / k;
      const y1 = (a.top - caja.top) / k + a.height / k / 2;

      const trazos: Cable[] = [];
      carrilRefs.current.forEach((el, i) => {
        const lane = LANES[i];
        if (!el || !lane) return;
        const b = el.getBoundingClientRect();
        const x2 = (b.left - caja.left) / k;
        const y2 = (b.top - caja.top) / k + b.height / k / 2;
        const medio = (x1 + x2) / 2;
        trazos.push({
          lane: lane.id,
          x1,
          y1,
          d: `M ${x1} ${y1} C ${medio} ${y1}, ${medio} ${y2}, ${x2} ${y2}`,
        });
      });
      setCables(trazos);

      // ¿Queda algo fuera del lienzo? Entonces se ofrece reencuadrar.
      const vistaMapa = map.getBoundingClientRect();
      const hueco = boardRef.current?.getBoundingClientRect();
      setRecortado(
        hueco
          ? vistaMapa.left < hueco.left - 1 ||
              vistaMapa.right > hueco.right + 1 ||
              vistaMapa.top < hueco.top - 1 ||
              vistaMapa.bottom > hueco.bottom + 1
          : false,
      );
    };

    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(cajon);
    // El lienzo también: al encoger la ventana puede empezar a recortar sin que
    // cambie ni la vista ni el árbol.
    if (boardRef.current) ro.observe(boardRef.current);
    for (const el of carrilRefs.current) if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [tree, cerrados, vista, boardRef, mapRef, cajonRef, carrilRefs]);

  return { cables, recortado };
}
