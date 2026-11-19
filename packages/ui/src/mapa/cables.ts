import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

import type { Tree } from "./arbol";
import { LANES } from "./carriles";
import type { LaneId, Status } from "./carriles";
import type { Vista } from "./camara";

/** Un cable entre etapas de la línea, ya medido en píxeles del mapa.
 *  `lane` es el carril de destino: da el color y por dónde viaja la chispa.
 *  `origenLane` permite distinguir el cable de ida del de vuelta cuando los
 *  dos llegan al mismo carril. `union` es la pareja de protocolo que abre su
 *  compuerta; `null` deja que la compuerta use la unión del carril (la rama
 *  de Descartadas junta entrada y cola). `rama` marca los retornos de la
 *  revisión rechazada, que salen del nudo de abajo y no del flujo principal.
 *  `presion` es lo que espera en el origen: el cable engorda con lo que se
 *  acumula antes de la compuerta, no con lo que ya llegó al destino. */
export type Cable = {
  id: string;
  lane: LaneId;
  origenLane: LaneId | "root";
  destinoLane: LaneId;
  union: [Status, Status] | null;
  rama?: boolean;
  presion: number;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Dónde va la compuerta de protocolo sobre el trazo (en la curva, si la
   *  hay) y su ángulo en grados, listo para `rotate`. */
  compuerta: { x: number; y: number; angulo: number };
  /** Longitud aproximada del trazo en px: la chispa tarda más si es largo. */
  longitud: number;
};

/** El nudo de «Revisión rechazada»: una bifurcación, no un carril. No guarda
 *  ideas; solo dice por dónde puede volver una revisión que no se aprueba. */
export type RamaRechazo = {
  fork: { x: number; y: number; w: number; h: number };
  /** El tramo vertical desde el canto inferior de Verificación. */
  tronco: string;
};

/** Velocidad de la chispa en px/s, con tope para no sobrevivir a la ventana
 *  de actividad (1,15 s), que desmonta las chispas. */
export function duracionChispa(longitud: number): number {
  return Math.min(1.05, Math.max(0.42, longitud / 90));
}

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
  const [rama, setRama] = useState<RamaRechazo | null>(null);
  const [recortado, setRecortado] = useState(false);
  // Punto medio del cable Entrada↔En cola, donde nace la rama de Descartadas.
  const [nudo, setNudo] = useState<{ x: number; y: number } | null>(null);

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
      // Las cabeceras anclan los cables de etapa; las cajas enteras hacen
      // falta para bajar el nudo de rechazo por debajo de la ficha abierta.
      const cajas = new Map<LaneId | "root", ReturnType<typeof rectLocal>>();
      const cajasNodo = new Map<LaneId, ReturnType<typeof rectLocal>>();
      const cabecera = (nodo: HTMLElement) => rectLocal(nodo.querySelector<HTMLElement>(".node-head")!);
      const cajaEntrada = rectLocal(cajon);
      cajas.set("root", cabecera(cajon));
      carrilRefs.current.forEach((el, i) => {
        const lane = LANES[i];
        if (el && lane) {
          cajas.set(lane.id, cabecera(el));
          cajasNodo.set(lane.id, rectLocal(el));
        }
      });

      const total = (lane: LaneId | "root") =>
        lane === "root"
          ? tree.cajon.total
          : (tree.carriles.find((carril) => carril.tone === lane)?.total ?? 0);

      const trazar = ({
        id,
        lane,
        origen,
        union,
        desde,
        hasta,
      }: {
        id: string;
        lane: LaneId;
        origen: LaneId | "root";
        union: [Status, Status] | null;
        desde: ReturnType<typeof rectLocal>;
        hasta: ReturnType<typeof rectLocal>;
      }): Cable => {
        const y1 = desde.y + desde.h / 2;
        const y2 = hasta.y + hasta.h / 2;
        const x1 = desde.x + desde.w;
        const x2 = hasta.x;
        return {
          id,
          lane,
          origenLane: origen,
          destinoLane: lane,
          union,
          presion: total(origen),
          x1,
          y1,
          x2,
          y2,
          d: `M ${x1} ${y1} L ${x2} ${y2}`,
          compuerta: {
            // El nudo de Descartadas ocupa el centro de la entrada: la
            // compuerta se corre al 72 % para no taparlo.
            x: x1 + (x2 - x1) * (lane === "cola" ? 0.72 : 0.5),
            y: y1 + (y2 - y1) * (lane === "cola" ? 0.72 : 0.5),
            angulo: (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI,
          },
          longitud: Math.hypot(x2 - x1, y2 - y1),
        };
      };

      // La línea de producción, etapa a etapa. Descartadas no es una etapa:
      // su rama nace de un nudo en medio del cable Entrada↔En cola.
      const trazos: Cable[] = [];
      const secuencia: {
        id: string;
        origen: LaneId | "root";
        destino: LaneId;
        union: [Status, Status];
      }[] = [
        { id: "etapa-cola", origen: "root", destino: "cola", union: ["draft", "proposed"] },
        { id: "etapa-roadmap", origen: "cola", destino: "roadmap", union: ["proposed", "roadmap"] },
        {
          id: "etapa-verificacion",
          origen: "roadmap",
          destino: "verificacion",
          union: ["roadmap", "verificacion"],
        },
        {
          id: "etapa-revision",
          origen: "verificacion",
          destino: "revision_aprobada",
          union: ["verificacion", "revision_aprobada"],
        },
        {
          id: "etapa-historial",
          origen: "revision_aprobada",
          destino: "historial",
          union: ["revision_aprobada", "historial"],
        },
      ];
      for (const { id, origen, destino, union } of secuencia) {
        const desde = cajas.get(origen);
        const hasta = cajas.get(destino);
        if (desde && hasta) trazos.push(trazar({ id, lane: destino, origen, union, desde, hasta }));
      }
      const cola = cajas.get("cola");
      const descartadas = cajas.get("descartadas");
      /* Una idea se descarta lo mismo desde la entrada que desde la cola: el
       * cable Entrada↔En cola va en los dos sentidos, así que la rama no sale
       * del canto de un nodo sino de un nudo en su punto medio. */
      const entrada = cajas.get("root");
      const medio =
        entrada && cola
          ? {
              x: (entrada.x + entrada.w + cola.x) / 2,
              y: (entrada.y + entrada.h / 2 + cola.y + cola.h / 2) / 2,
            }
          : null;
      if (medio && descartadas) {
        const y2 = descartadas.y + descartadas.h / 2;
        const x2 = descartadas.x - 1;
        // La compuerta va en el tramo vertical, antes del codo: el punto medio
        // de la recta entre extremos caería fuera de la curva.
        const codo = y2 - 8;
        trazos.push({
          id: "descarte-entrada-cola",
          lane: "descartadas",
          origenLane: "root",
          destinoLane: "descartadas",
          union: null,
          presion: total("descartadas"),
          x1: medio.x,
          y1: medio.y,
          x2,
          y2,
          d: `M ${medio.x} ${medio.y} V ${codo} Q ${medio.x} ${y2} ${medio.x + 8} ${y2} H ${x2}`,
          compuerta: {
            x: medio.x,
            y: (medio.y + codo) / 2,
            angulo: 90,
          },
          longitud:
            Math.abs(codo - medio.y) +
            (Math.PI * 8) / 2 +
            Math.abs(x2 - (medio.x + 8)),
        });
      }
      setNudo(medio);

      /* Revisión rechazada: no es un carril, es una bifurcación debajo de
       * Verificación. De ella vuelven tres cables reales, cada uno con su
       * unión de protocolo: a cola, a roadmap y a descartadas. Se mide con las
       * cajas enteras para que el nudo quede por debajo de la ficha más alta. */
      const verificacion = cajasNodo.get("verificacion");
      if (!verificacion) {
        setRama(null);
      } else {
        const fondos = [...cajasNodo.values(), cajaEntrada].map((caja) => caja.y + caja.h);
        const maxBottom = Math.max(...fondos);
        const ancho = 236;
        const alto = 58;
        const fork = {
          x: verificacion.x + verificacion.w / 2 - ancho / 2,
          y: maxBottom + 36,
          w: ancho,
          h: alto,
        };
        const vx = verificacion.x + verificacion.w / 2;
        const vy = verificacion.y + verificacion.h;
        setRama({ fork, tronco: `M ${vx} ${vy} V ${fork.y}` });

        const salidas: { lane: LaneId; status: Status; t: number }[] = [
          { lane: "cola", status: "proposed", t: 0.22 },
          { lane: "roadmap", status: "roadmap", t: 0.5 },
          { lane: "descartadas", status: "rejected", t: 0.78 },
        ];
        for (const salida of salidas) {
          const destino = cajasNodo.get(salida.lane);
          if (!destino) continue;
          const sx = fork.x;
          const sy = fork.y + fork.h * salida.t;
          // Vuelve al canto derecho del carril: deja ver el cable aunque
          // Descartadas quede debajo de Cola, y marca el sentido de vuelta.
          const tx = destino.x + destino.w - 2;
          const ty = destino.y + destino.h / 2;
          // Curva hacia atrás y hacia arriba: sale por debajo de la línea y
          // sube al canto derecho del carril de destino.
          // El control va a la derecha del destino para que la curva llegue
          // por fuera del carril, no atraviese su ficha desde abajo.
          const cx = tx + 60;
          const cy = sy + (ty - sy) * 0.3;
          const qx = 0.25 * sx + 0.5 * cx + 0.25 * tx;
          const qy = 0.25 * sy + 0.5 * cy + 0.25 * ty;
          trazos.push({
            id: `rechazo-${salida.lane}`,
            lane: salida.lane,
            origenLane: "verificacion",
            destinoLane: salida.lane,
            union: ["verificacion", salida.status],
            rama: true,
            presion: total("verificacion"),
            x1: sx,
            y1: sy,
            x2: tx,
            y2: ty,
            d: `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`,
            compuerta: {
              x: qx,
              y: qy,
              angulo: (Math.atan2(ty - sy, tx - sx) * 180) / Math.PI,
            },
            longitud: Math.hypot(tx - sx, ty - sy) * 1.15,
          });
        }
      }
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
    map.addEventListener("scroll", medir, true);
    return () => {
      ro.disconnect();
      map.removeEventListener("scroll", medir, true);
    };
  }, [tree, cerrados, vista, boardRef, mapRef, cajonRef, carrilRefs]);

  return { cables, nudo, rama, recortado };
}
