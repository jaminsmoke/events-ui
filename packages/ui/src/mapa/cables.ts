import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

import type { Tree } from "./arbol";
import { LANES } from "./carriles";
import type { LaneId } from "./carriles";
import type { Vista } from "./camara";

/** Un cable entre etapas de la línea, ya medido en píxeles del mapa.
 *  `lane` es el carril de destino: da el color y por dónde viaja la chispa. */
export type Cable = { lane: LaneId; d: string; x1: number; y1: number };

/** Un enlace lateral entre dos ideas (`related` o `supersedes`), medido en
 *  píxeles del mapa. `kind` da el estilo: punteado el lateral, doble línea
 *  el que reemplaza. No anida: las dos filas siguen donde estaban. */
export type Enlace = { id: number; kind: "related" | "supersedes"; d: string };

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
  enlaces,
}: {
  tree: Tree | null;
  cerrados: ReadonlySet<string>;
  vista: Vista;
  boardRef: RefObject<HTMLElement | null>;
  mapRef: RefObject<HTMLDivElement | null>;
  cajonRef: RefObject<HTMLElement | null>;
  carrilRefs: RefObject<(HTMLElement | null)[]>;
  enlaces?: { id: number; kind: "related" | "supersedes"; parentUid: string; childUid: string }[];
}) {
  const [cables, setCables] = useState<Cable[]>([]);
  const [trazosEnlace, setTrazosEnlace] = useState<Enlace[]>([]);
  const [recortado, setRecortado] = useState(false);

  useLayoutEffect(() => {
    const map = mapRef.current;
    const cajon = cajonRef.current;
    if (!map || !cajon || !tree) return;

    // Todo se mide en coordenadas locales del mapa: el `scale` del lienzo no
    // puede contarse dos veces al dibujar los cables.
    const k = vista.k;
    const rectLocal = (el: HTMLElement) => {
      const caja = map.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - caja.left) / k,
        y: (r.top - caja.top) / k,
        w: r.width / k,
        h: r.height / k,
      };
    };
    const medir = () => {
      const cajas = new Map<LaneId | "root", ReturnType<typeof rectLocal>>();
      cajas.set("root", rectLocal(cajon));
      carrilRefs.current.forEach((el, i) => {
        const lane = LANES[i];
        if (el && lane) cajas.set(lane.id, rectLocal(el));
      });

      const trazar = (
        lane: LaneId,
        desde: ReturnType<typeof rectLocal>,
        hasta: ReturnType<typeof rectLocal>,
        vertical = false,
      ): Cable => {
        if (vertical) {
          const x1 = desde.x + desde.w / 2;
          const y1 = desde.y + desde.h;
          const x2 = hasta.x + hasta.w / 2;
          const y2 = hasta.y;
          const medio = (y1 + y2) / 2;
          return {
            lane,
            x1,
            y1,
            d: `M ${x1} ${y1} C ${x1} ${medio}, ${x2} ${medio}, ${x2} ${y2}`,
          };
        }
        const x1 = desde.x + desde.w;
        const y1 = desde.y + desde.h / 2;
        const x2 = hasta.x;
        const y2 = hasta.y + hasta.h / 2;
        const medio = (x1 + x2) / 2;
        return {
          lane,
          x1,
          y1,
          d: `M ${x1} ${y1} C ${medio} ${y1}, ${medio} ${y2}, ${x2} ${y2}`,
        };
      };

      // La línea de producción, etapa a etapa. Descartadas es la salida
      // lateral desde En cola, no una etapa más de la línea.
      const trazos: Cable[] = [];
      const secuencia: [LaneId | "root", LaneId][] = [
        ["root", "cola"],
        ["cola", "roadmap"],
        ["roadmap", "verificacion"],
        ["verificacion", "revision_aprobada"],
      ];
      for (const [origen, destino] of secuencia) {
        const desde = cajas.get(origen);
        const hasta = cajas.get(destino);
        if (desde && hasta) trazos.push(trazar(destino, desde, hasta));
      }
      const cola = cajas.get("cola");
      const descartadas = cajas.get("descartadas");
      if (cola && descartadas) trazos.push(trazar("descartadas", cola, descartadas, true));
      setCables(trazos);

      // Enlaces laterales: de la fila del padre a la del hijo, donde estén
      // (cajón o carril, plegadas o no). Sin las dos filas a la vista no hay
      // trazo: el enlace existe, solo que no se puede medir.
      const filasRect = new Map<string, ReturnType<typeof rectLocal>>();
      for (const fila of map.querySelectorAll<HTMLElement>(".row[data-uid]")) {
        const uid = fila.dataset.uid;
        const cabecera = fila.firstElementChild as HTMLElement | null;
        if (!uid || !cabecera) continue;
        filasRect.set(uid, rectLocal(cabecera));
      }
      const trazosEnlace: Enlace[] = [];
      for (const enlace of enlaces ?? []) {
        const a = filasRect.get(enlace.parentUid);
        const b = filasRect.get(enlace.childUid);
        if (!a || !b) continue;
        const x1 = a.x + a.w;
        const y1 = a.y + a.h / 2;
        const x2 = b.x;
        const y2 = b.y + b.h / 2;
        const medio = (x1 + x2) / 2;
        trazosEnlace.push({
          id: enlace.id,
          kind: enlace.kind,
          d: `M ${x1} ${y1} C ${medio} ${y1}, ${medio} ${y2}, ${x2} ${y2}`,
        });
      }
      setTrazosEnlace(trazosEnlace);

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
    // Y cada fila, para que los enlaces laterales sigan a su idea.
    for (const fila of map.querySelectorAll<HTMLElement>(".row[data-uid]")) {
      ro.observe(fila);
    }
    return () => ro.disconnect();
  }, [tree, cerrados, vista, boardRef, mapRef, cajonRef, carrilRefs, enlaces]);

  return { cables, recortado, enlaces: trazosEnlace };
}
