import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

import type { Tree } from "./arbol";
import { LANES } from "./carriles";
import type { LaneId, Status } from "./carriles";
import type { Vista } from "./camara";

/** Un punto del trazado, en píxeles locales del mapa. */
type Punto = { x: number; y: number };

/** El nodo Git cierra la línea, pero no es un carril de ideas: solo aporta
 *  su color y su cable. */
export type DestinoCable = LaneId | "git";

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
  lane: DestinoCable;
  origenLane: LaneId | "root";
  destinoLane: DestinoCable;
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
 *  `nudo` es el punto del cable Verificación→Revisión aprobada del que cuelga y
 *  el rombo que lo marca, ancho para que la compuerta del protocolo quede
 *  dentro de él en vez de colgar por fuera. */
export type RamaRechazo = {
  caja: { x: number; y: number; w: number; h: number };
  /** El tramo vertical desde el nudo del cable hasta el canto superior. */
  tronco: string;
  nudo: { x: number; y: number; lado: number };
  /** El tronco único de las vueltas y los nudos de los que se despega cada
   *  una: una sola salida del nodo y tres ramas ya coloreadas. */
  bus: { d: string; nudos: { x: number; y: number; lado: number }[] } | null;
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

/** ¿El esquema se sale de la ventana del tablero?
 *
 *  Es lo único que depende de dónde esté la cámara: arrastrar cambia los
 *  cantos y hay que ofrecer reencuadrar. La medida de los nodos, en cambio, va
 *  en coordenadas del mapa y solo la mueve el zoom (o un cambio de tamaño). */
function recortadoDe(
  map: HTMLElement,
  board: HTMLElement | null,
  insetDerecha = 0,
): boolean {
  if (!board) return false;
  const vista = map.getBoundingClientRect();
  const hueco = board.getBoundingClientRect();
  // El panel derecho tapa el canto sin encoger la caja: lo tapado también
  // cuenta como fuera de la vista, o el aviso mentiría.
  return (
    vista.left < hueco.left - 1 ||
    vista.right > hueco.right - insetDerecha + 1 ||
    vista.top < hueco.top - 1 ||
    vista.bottom > hueco.bottom + 1
  );
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
  mapa,
  boardRef,
  mapRef,
  cajonRef,
  carrilRefs,
  gitRef,
  insetDerecha = 0,
}: {
  tree: Tree | null;
  cerrados: ReadonlySet<string>;
  vista: Vista;
  mapa: string;
  boardRef: RefObject<HTMLElement | null>;
  mapRef: RefObject<HTMLDivElement | null>;
  cajonRef: RefObject<HTMLElement | null>;
  carrilRefs: RefObject<(HTMLElement | null)[]>;
  /** Ancho tapado por el panel derecho, en el mismo sentido que en `useCamara`. */
  insetDerecha?: number;
  gitRef: RefObject<HTMLElement | null>;
}) {
  const [cables, setCables] = useState<Cable[]>([]);
  const [rama, setRama] = useState<RamaRechazo | null>(null);
  const [recortado, setRecortado] = useState(false);
  // Punto medio del cable Entrada↔En cola, donde nace la rama de Descartadas.
  const [nudo, setNudo] = useState<{ x: number; y: number; lado: number } | null>(null);
  // Solo el zoom entra en la medida (`rectLocal` divide por él); `vista.x/y`
  // cambian al arrastrar y no tocan ni un trazado.
  const k = vista.k;

  useLayoutEffect(() => {
    // En el Mapa de Git no hay cables que medir: el cajón no existe.
    if (mapa !== "ideas") return;
    const map = mapRef.current;
    const cajon = cajonRef.current;
    if (!map || !cajon || !tree) return;

    // Todo se mide en coordenadas locales del mapa: el `scale` del lienzo no
    // puede contarse dos veces al dibujar los cables.
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
      const nodoGit = gitRef.current;
      const cajaGit = nodoGit ? rectLocal(nodoGit) : null;
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
        lane: DestinoCable;
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
          // La compuerta cae en el nudo de Descartadas, su punto medio: el
          // rombo del nudo la envuelve en vez de quedarle al lado.
          union: ["draft", "proposed"],
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

      /* El último tramo: el Historial cuelga justo debajo del puente a Git, en
       * la misma columna, así que su cable es una vertical entre las dos cajas
       * y no un tramo horizontal con codo. No lleva compuerta ni chispa; se
       * apaga si el repo no tiene work tree. */
      const cajaHistorial = cajasNodo.get("historial");
      if (cajaHistorial && cajaGit) {
        const x = cajaGit.x + cajaGit.w / 2;
        const y1 = cajaGit.y + cajaGit.h;
        const puntos = [
          { x, y: y1 },
          { x, y: cajaHistorial.y },
        ];
        trazos.push({
          id: "etapa-git",
          lane: "git",
          origenLane: "historial",
          destinoLane: "git",
          union: null,
          presion: total("historial"),
          puntos,
          x1: x,
          y1,
          x2: x,
          y2: cajaHistorial.y,
          d: trazoDe(puntos),
          compuerta: puntoEnTrazo(puntos, 0.5),
          chevron: puntoEnTrazo(puntos, 0.5),
          longitud: largo(puntos),
        });
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
        /* Descartadas se asienta centrada bajo este cable (ver `.linea` en
         * mapa.css), así que baja recto y entra por el centro de su canto
         * superior: sin codo y con la compuerta sobre la vertical. */
        const y2 = descartadas.y - 1;
        const x2 = medio.x;
        const puntos = [
          { x: medio.x, y: medio.y },
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
      /* El nudo de Descartadas es un rombo, como el de Revisión rechazada:
       * la compuerta del protocolo cae dentro de él. El chevrón se aparta
       * del rombo y queda entre su vértice y En cola. */
      setNudo(medio ? { ...medio, lado: 22 } : null);
      if (medio && cola) {
        const cableCola = trazos.find((cable) => cable.id === "etapa-cola");
        const borde = cola.x - 6;
        const mediaDiagonal = 22 / Math.SQRT2;
        if (cableCola) {
          cableCola.chevron = {
            x: Math.min(
              borde,
              medio.x + mediaDiagonal + (borde - medio.x - mediaDiagonal) / 2,
            ),
            y: medio.y,
            angulo: 0,
          };
        }
      }

      /* Revisión rechazada: no es un carril, es una bifurcación que cuelga
       * del nudo del protocolo en mitad del cable Verificación→Revisión
       * aprobada. De ella vuelven tres cables reales, cada uno con su unión:
       * a cola, a roadmap y a descartadas. Se coloca a la altura de Descartadas
       * —las dos salidas laterales del flujo en la misma banda— y baja si una
       * de las fichas que puede tapar por ancho (roadmap, verificación o
       * revisión) se despliega. */
      const revision = trazos.find((cable) => cable.id === "etapa-revision");
      if (!revision) {
        setRama(null);
      } else {
        const ancho = 236;
        const alto = 44;
        const nudoRevision = puntoEnTrazo(revision.puntos, 0.5);
        const suelo =
          Math.max(
            0,
            ...(["roadmap", "verificacion", "revision_aprobada"] as const).map((lane) => {
              const vecina = cajasNodo.get(lane);
              return vecina ? vecina.y + vecina.h : 0;
            }),
          ) + 36;
        const cabeceraDescartadas = cajas.get("descartadas");
        const caja = {
          x: nudoRevision.x - ancho / 2,
          /* Centrada con la cabecera de Descartadas, no con su canto: así el
           * tronco y su vuelta salen a la misma altura y el cable entra en el
           * rombo por el vértice, no por el filo. Nunca encima de una ficha
           * abierta. */
          y: Math.max(
            cabeceraDescartadas
              ? cabeceraDescartadas.y + cabeceraDescartadas.h / 2 - alto / 2
              : suelo,
            suelo,
          ),
          w: ancho,
          h: alto,
        };
        /* Las tres vueltas salen de un mismo tronco: el nodo tiene una sola
         * salida y no tres cables paralelos por debajo de las fichas. De cada
         * nudo del tronco se despega su rama, ya con el color de su carril. */
        const puertos: {
          lane: LaneId;
          status: Status;
          busX: number;
          tx: number;
          ty: number;
        }[] = [];
        for (const salida of [
          { lane: "roadmap", status: "roadmap", bus: 18 },
          { lane: "cola", status: "proposed", bus: 18 },
          { lane: "descartadas", status: "rejected", bus: 34 },
        ] as const) {
          const destino = cajas.get(salida.lane);
          if (!destino) continue;
          puertos.push({
            lane: salida.lane,
            status: salida.status,
            // Roadmap y cola entran por el canto derecho de su cabecera, un
            // poco por debajo del cable de ida, para no montarse encima de
            // él. A Descartadas no llega nada más por ese canto, así que entra
            // por el centro.
            busX: destino.x + destino.w + salida.bus,
            tx: destino.x + destino.w - 2,
            ty: destino.y + destino.h / 2 + (salida.lane === "descartadas" ? 0 : 9),
          });
        }
        const troncoY = caja.y + caja.h / 2;
        const ladoNudo = 24;
        /* En cola y Descartadas caen en la misma calle —sus cantos derechos
         * quedan casi a la misma altura—, así que comparten nudo: dos rombos
         * pegados se leerían como una mancha. Cada rama sale igual, ya con el
         * color de su carril. */
        const nudoDe = new Map<number, number>();
        for (const puerto of puertos) {
          let x = puerto.busX;
          for (const [calle, nudo] of nudoDe) {
            if (Math.abs(calle - puerto.busX) < ladoNudo * 1.6) x = nudo;
          }
          nudoDe.set(puerto.busX, x);
        }
        const calleDe = (puerto: { busX: number }) => nudoDe.get(puerto.busX) ?? puerto.busX;
        setRama({
          caja,
          tronco: `M ${nudoRevision.x} ${nudoRevision.y} L ${nudoRevision.x} ${caja.y}`,
          /* El rombo se centra en el punto de la compuerta: su diagonal (lado
           * × √2) deja sitio a la caja del protocolo dentro, y el tronco sale
           * ya fuera del rombo porque este se pinta encima. */
          nudo: { x: nudoRevision.x, y: nudoRevision.y, lado: 26 },
          bus: puertos.length
            ? {
                d: `M ${caja.x} ${troncoY} L ${Math.min(
                  ...puertos.map(calleDe),
                )} ${troncoY}`,
                nudos: Array.from(new Set(puertos.map(calleDe))).map((x) => ({
                  x,
                  y: troncoY,
                  lado: ladoNudo,
                })),
              }
            : null,
        });
        for (const puerto of puertos) {
          const nudoX = calleDe(puerto);
          const puntos = [
            { x: nudoX, y: troncoY },
            { x: nudoX, y: puerto.ty },
            { x: puerto.tx, y: puerto.ty },
          ];
          // La vuelta a Descartadas va por el tramo horizontal (con la ficha
          // abierta comparte calle con En cola, y dos compuertas en la misma
          // vertical se leerían como una sola). Las otras dos, en su vertical,
          // lejos del nudo.
          const sube = puerto.lane !== "descartadas" && Math.abs(puerto.ty - troncoY) > 60;
          trazos.push({
            id: `rechazo-${puerto.lane}`,
            lane: puerto.lane,
            origenLane: "verificacion",
            destinoLane: puerto.lane,
            union: ["verificacion", puerto.status],
            rama: true,
            presion: total("verificacion"),
            puntos,
            x1: nudoX,
            y1: troncoY,
            x2: puerto.tx,
            y2: puerto.ty,
            d: trazoDe(puntos),
            /* La vuelta a Descartadas es corta: su nudo y su compuerta
             * conviven, así que la celda va dentro del rombo. Las otras dos no
             * tienen nudo cerca y la llevan en mitad de su vertical. */
            compuerta: sube
              ? { x: nudoX, y: (troncoY + puerto.ty) / 2, angulo: 90 }
              : { x: nudoX, y: troncoY, angulo: 0 },
            chevron: sube
              ? { x: nudoX, y: puerto.ty + 34, angulo: -90 }
              : { x: puerto.tx + (nudoX - puerto.tx) * 0.3, y: puerto.ty, angulo: 180 },
            longitud: largo(puntos),
          });
        }
      }
      setCables(trazos);

      // Medir también refresca el recorte: un nodo que crece puede sacar el
      // esquema de la ventana sin que se mueva la cámara.
      setRecortado(recortadoDe(map, boardRef.current, insetDerecha));
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
  }, [tree, cerrados, k, mapa, boardRef, mapRef, cajonRef, carrilRefs, gitRef, insetDerecha]);

  /* Arrastrar mueve la cámara pero no la medida: los cables viven en
   *  coordenadas del mapa y solo el zoom entra en la cuenta. Aquí se revisa lo
   *  único que sí cambia al moverse —si el esquema se sale de la ventana—, en
   *  vez de volver a medir los nueve nodos y repintar los cables por píxel. */
  useLayoutEffect(() => {
    if (mapa !== "ideas") return;
    const map = mapRef.current;
    if (!map) return;
    setRecortado(recortadoDe(map, boardRef.current, insetDerecha));
  }, [vista, mapa, mapRef, boardRef, insetDerecha]);

  const enIdeas = mapa === "ideas";
  return {
    cables: enIdeas ? cables : [],
    nudo: enIdeas ? nudo : null,
    rama: enIdeas ? rama : null,
    recortado: enIdeas ? recortado : false,
  };
}
