import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

import type { Tree } from "./arbol";
import { LANES } from "./carriles";
import type { LaneId, Status } from "./carriles";
import type { Vista } from "./camara";

/** Un punto del trazado, en píxeles locales del mapa. */
type Punto = { x: number; y: number };

/** Un cable entre etapas de la línea, ya medido en píxeles del mapa.
 *  `lane` es el carril de destino: da el color y por dónde viaja la chispa.
 *  `origenLane` permite distinguir el cable de ida del de vuelta cuando los
 *  dos llegan al mismo carril. `union` es la pareja de protocolo que abre su
 *  compuerta; `null` deja que la compuerta use la unión del carril (la rama
 *  de Descartadas junta entrada y cola). `rama` marca los retornos de la
 *  revisión rechazada, que salen del nudo de abajo y no del flujo principal.
 *  `puntos` es la ruta ortogonal —solo tramos horizontales y verticales— y
 *  `chevron` guarda dónde cae la flecha de dirección dentro de esa ruta.
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
  puntos: Punto[];
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Dónde va la compuerta de protocolo sobre un tramo recto y su ángulo en
   *  grados, listo para `rotate`. */
  compuerta: { x: number; y: number; angulo: number };
  /** Dónde va el chevrón de dirección y su ángulo, sin depender del movimiento. */
  chevron: { x: number; y: number; angulo: number };
  /** Longitud del trazado en px: la chispa tarda más si es largo. */
  longitud: number;
};

/** El nodo de «Revisión rechazada»: una bifurcación, no un carril. No guarda
 *  ideas; solo dice por dónde puede volver una revisión que no se aprueba.
 *  `nudo` es el punto del cable Verificación→Revisión aprobada del que cuelga. */
export type RamaRechazo = {
  caja: { x: number; y: number; w: number; h: number };
  /** El tramo vertical desde el nudo del cable hasta el canto superior. */
  tronco: string;
  nudo: { x: number; y: number };
};

/** Velocidad de la chispa en px/s, con tope para no sobrevivir a la ventana
 *  de actividad (1,15 s), que desmonta las chispas. */
export function duracionChispa(longitud: number): number {
  return Math.min(1.05, Math.max(0.42, longitud / 90));
}

/** Longitud de una ruta de puntos. */
function largo(puntos: readonly Punto[]): number {
  let total = 0;
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1]!;
    const b = puntos[i]!;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/** Pinta una ruta ortogonal. Solo hay `M` y `L`: cada tramo es horizontal o
 *  vertical, sin curvas libres, como una pista de circuito impreso. */
function trazoDe(puntos: readonly Punto[]): string {
  return puntos.map((punto, i) => `${i === 0 ? "M" : "L"} ${punto.x} ${punto.y}`).join(" ");
}

/** Punto y ángulo a una fracción de la longitud total. Sirve para colocar la
 *  compuerta y el chevrón sobre un tramo recto de la ruta. */
function puntoEnTrazo(
  puntos: readonly Punto[],
  fraccion: number,
): { x: number; y: number; angulo: number } {
  if (puntos.length === 0) return { x: 0, y: 0, angulo: 0 };
  const primero = puntos[0]!;
  if (puntos.length === 1) return { ...primero, angulo: 0 };

  let restante = Math.max(0, Math.min(1, fraccion)) * largo(puntos);
  let ultimoAngulo = 0;
  for (let i = 1; i < puntos.length; i++) {
    const a = puntos[i - 1]!;
    const b = puntos[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const tramo = Math.hypot(dx, dy);
    if (tramo === 0) continue;
    const angulo = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (restante <= tramo) {
      const t = restante / tramo;
      return { x: a.x + dx * t, y: a.y + dy * t, angulo };
    }
    restante -= tramo;
    ultimoAngulo = angulo;
  }
  const ultimo = puntos[puntos.length - 1]!;
  return { x: ultimo.x, y: ultimo.y, angulo: ultimoAngulo };
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
      // falta para bajar el nodo de rechazo por debajo de la ficha abierta.
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
        compuertaT = 0.5,
      }: {
        id: string;
        lane: LaneId;
        origen: LaneId | "root";
        union: [Status, Status] | null;
        desde: ReturnType<typeof rectLocal>;
        hasta: ReturnType<typeof rectLocal>;
        compuertaT?: number;
      }): Cable => {
        const y1 = desde.y + desde.h / 2;
        const y2 = hasta.y + hasta.h / 2;
        const x1 = desde.x + desde.w;
        const x2 = hasta.x;
        const inicio = { x: x1, y: y1 };
        const fin = { x: x2, y: y2 };
        // Si las cabeceras no están a la misma altura, el cable baja en el
        // hueco entre las dos columnas: un codo recto, nunca una diagonal.
        const puntos =
          Math.abs(y2 - y1) < 0.5
            ? [inicio, fin]
            : [
                inicio,
                { x: (x1 + x2) / 2, y: y1 },
                { x: (x1 + x2) / 2, y: y2 },
                fin,
              ];
        return {
          id,
          lane,
          origenLane: origen,
          destinoLane: lane,
          union,
          presion: total(origen),
          puntos,
          x1,
          y1,
          x2,
          y2,
          d: trazoDe(puntos),
          compuerta: puntoEnTrazo(puntos, compuertaT),
          chevron: puntoEnTrazo(puntos, 0.3),
          longitud: largo(puntos),
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
        compuertaT?: number;
      }[] = [
        {
          id: "etapa-cola",
          origen: "root",
          destino: "cola",
          union: ["draft", "proposed"],
          // El nudo de Descartadas ocupa el centro del cable: la compuerta se
          // corre al 72 % para no taparlo.
          compuertaT: 0.72,
        },
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
      for (const { id, origen, destino, union, compuertaT } of secuencia) {
        const desde = cajas.get(origen);
        const hasta = cajas.get(destino);
        if (desde && hasta) {
          trazos.push(trazar({ id, lane: destino, origen, union, desde, hasta, compuertaT }));
        }
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
        const puntos = [
          { x: medio.x, y: medio.y },
          { x: medio.x, y: y2 },
          { x: x2, y: y2 },
        ];
        trazos.push({
          id: "descarte-entrada-cola",
          lane: "descartadas",
          origenLane: "root",
          destinoLane: "descartadas",
          union: null,
          presion: total("descartadas"),
          puntos,
          x1: medio.x,
          y1: medio.y,
          x2,
          y2,
          d: trazoDe(puntos),
          // La compuerta va en el tramo vertical, antes del codo.
          compuerta: { x: medio.x, y: (medio.y + y2) / 2, angulo: 90 },
          chevron: puntoEnTrazo(puntos, 0.3),
          longitud: largo(puntos),
        });
      }
      setNudo(medio);

      /* Revisión rechazada: no es un carril, es una bifurcación que cuelga
       * del nudo del protocolo en mitad del cable Verificación→Revisión
       * aprobada. De ella vuelven tres cables reales, cada uno con su unión:
       * a cola, a roadmap y a descartadas. Se mide con las cajas enteras para
       * que el nodo quede por debajo de la ficha más alta. */
      const revision = trazos.find((cable) => cable.id === "etapa-revision");
      if (!revision) {
        setRama(null);
      } else {
        const fondos = [...cajasNodo.values(), cajaEntrada].map((caja) => caja.y + caja.h);
        const maxBottom = Math.max(...fondos);
        const ancho = 236;
        const alto = 44;
        const nudoRevision = puntoEnTrazo(revision.puntos, 0.5);
        const caja = {
          x: nudoRevision.x - ancho / 2,
          y: maxBottom + 36,
          w: ancho,
          h: alto,
        };
        setRama({
          caja,
          tronco: `M ${nudoRevision.x} ${nudoRevision.y} L ${nudoRevision.x} ${caja.y}`,
          // Un poco por debajo de la compuerta, para que el nudo se vea.
          nudo: { x: nudoRevision.x, y: nudoRevision.y + 17 },
        });

        /* Los puertos salen del canto izquierdo del nodo y bajan en paralelo
         * hasta el hueco derecho de su carril. El de roadmap va arriba, el de
         * cola en medio y el de descartadas abajo: así los tramos horizontales
         * no se pisan y cada cable sube por su propia calle. */
        const salidas: { lane: LaneId; status: Status; t: number; bus: number }[] = [
          { lane: "roadmap", status: "roadmap", t: 0.22, bus: 14 },
          { lane: "cola", status: "proposed", t: 0.5, bus: 14 },
          { lane: "descartadas", status: "rejected", t: 0.78, bus: 34 },
        ];
        for (const salida of salidas) {
          const destino = cajas.get(salida.lane);
          if (!destino) continue;
          const sx = caja.x;
          const sy = caja.y + caja.h * salida.t;
          // Entra por el canto derecho de la cabecera, un poco por debajo del
          // cable de ida, para no montarse encima de él.
          const tx = destino.x + destino.w - 2;
          const ty = destino.y + destino.h / 2 + 9;
          const busX = destino.x + destino.w + salida.bus;
          const puntos = [
            { x: sx, y: sy },
            { x: busX, y: sy },
            { x: busX, y: ty },
            { x: tx, y: ty },
          ];
          trazos.push({
            id: `rechazo-${salida.lane}`,
            lane: salida.lane,
            origenLane: "verificacion",
            destinoLane: salida.lane,
            union: ["verificacion", salida.status],
            rama: true,
            presion: total("verificacion"),
            puntos,
            x1: sx,
            y1: sy,
            x2: tx,
            y2: ty,
            d: trazoDe(puntos),
            compuerta: { x: busX, y: (sy + ty) / 2, angulo: 90 },
            chevron: puntoEnTrazo(puntos, 0.3),
            longitud: largo(puntos),
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
