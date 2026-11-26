import { useLayoutEffect, useState } from "react";
import type { RefObject } from "react";

import type { Tree } from "./arbol";
import { LANES } from "./carriles";
import type { LaneId, Status } from "./carriles";
import type { Vista } from "./camara";
import { largo, puntoEnTrazo, repartirCompuertas, trazoDe } from "./geometria";
import type { Nudo, Punto } from "./geometria";
import { UNIONES } from "./protocolos";
import type { Union } from "./protocolos";

// La geometría vive en `geometria.ts`, sin DOM: aquí solo queda la medición de
// las cajas y el trazado de los cables. Se reexporta porque es parte del
// contrato del mapa: `compuertas.tsx` mide con `CELDA` y `App.tsx` pide aquí la
// duración de la chispa.
export { CELDA, duracionChispa } from "./geometria";
export type { Nudo, Punto } from "./geometria";

/** El nodo Git cierra la línea, pero no es un carril de ideas: solo aporta
 *  su color y su cable. */
export type DestinoCable = LaneId | "git";

/** Un cable entre etapas de la línea, ya medido en píxeles del mapa.
 *  `lane` es el carril de destino: da el color y por dónde viaja la chispa.
 *  `origenLane` permite distinguir el cable de ida del de vuelta cuando los
 *  dos llegan al mismo carril. `uniones` son las uniones de protocolo que
 *  cruza (tabla en `protocolos.ts`); `nudo` es el nudo del que sale, si sale de
 *  alguno, y manda su compuerta dentro del rombo. `rama` marca los retornos de
 *  la revisión rechazada, que salen del nudo de abajo y no del flujo principal.
 *  `puntos` es la ruta ortogonal —solo tramos horizontales y verticales— y
 *  `chevron` guarda dónde cae la flecha de dirección dentro de esa ruta.
 *  `presion` es lo que espera en el origen: el cable engorda con lo que se
 *  acumula antes de la compuerta, no con lo que ya llegó al destino. */
export type Cable = {
  id: string;
  lane: DestinoCable;
  origenLane: LaneId | "root";
  destinoLane: DestinoCable;
  uniones: readonly Union[];
  rama?: boolean;
  /** Archivar no es una unión de protocolo: la compuerta se abre porque el
   *  destino está disponible, no porque una fila la permita. */
  abierta?: boolean;
  /** El nudo del que sale el cable: su compuerta va dentro de su rombo. */
  nudo?: string;
  presion: number;
  puntos: Punto[];
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Dónde va la compuerta de protocolo y su ángulo en grados, listo para
   *  `rotate`. Lo fija `repartirCompuertas`, que es la única regla de sitio. */
  compuerta: { x: number; y: number; angulo: number };
  /** Dónde va el chevrón de dirección y su ángulo, sin depender del movimiento. */
  chevron: { x: number; y: number; angulo: number };
  /** Longitud del trazado en px: la chispa tarda más si es largo. */
  longitud: number;
};

/** El nodo de «Revisión rechazada»: una bifurcación, no un carril. No guarda
 *  ideas; solo dice por dónde puede volver una revisión que no se aprueba.
 *  Sus nudos —el de arriba y los del tronco— viven en la lista de nudos del
 *  mapa, como los demás. */
export type RamaRechazo = {
  caja: { x: number; y: number; w: number; h: number };
  /** El tramo vertical desde el nudo del cable hasta el canto superior. */
  tronco: string;
  /** El tronco único del que se despega cada vuelta, ya horizontal. */
  bus: string | null;
};

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
  conGit,
  insetDerecha = 0,
}: {
  tree: Tree | null;
  cerrados: ReadonlySet<string>;
  vista: Vista;
  mapa: string;
  boardRef: RefObject<HTMLElement | null>;
  mapRef: RefObject<HTMLDivElement | null>;
  cajonRef: RefObject<HTMLElement | null>;
  carrilRefs: RefObject<Partial<Record<LaneId, HTMLElement | null>>>;
  /** Ancho tapado por el panel derecho, en el mismo sentido que en `useCamara`. */
  insetDerecha?: number;
  gitRef: RefObject<HTMLElement | null>;
  /** ¿El repo tiene work tree? Abre la compuerta de la rama a Git. */
  conGit: boolean;
}) {
  const [cables, setCables] = useState<Cable[]>([]);
  const [nudos, setNudos] = useState<Nudo[]>([]);
  const [rama, setRama] = useState<RamaRechazo | null>(null);
  const [recortado, setRecortado] = useState(false);
  // Solo el zoom entra en la medida (`rectLocal` divide por él); `vista.x/y`
  // cambian al arrastrar y no tocan ni un trazado.
  const k = vista.k;

  useLayoutEffect(() => {
    // En el Mapa de Git no hay cables que medir: el cajón no existe.
    if (mapa !== "items") return;
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
      const cabeceraGitEl = nodoGit?.querySelector<HTMLElement>(".node-head");
      const cabeceraGit = cabeceraGitEl ? rectLocal(cabeceraGitEl) : null;
      cajas.set("root", cabecera(cajon));
      // Los carriles se leen por su id, no por su posición: reordenar
      // `LANES` no puede cruzar los cables.
      for (const lane of LANES) {
        const el = carrilRefs.current[lane.id];
        if (!el) continue;
        cajas.set(lane.id, cabecera(el));
        cajasNodo.set(lane.id, rectLocal(el));
      }

      const total = (lane: LaneId | "root") =>
        lane === "root"
          ? tree.cajon.total
          : (tree.carriles.find((carril) => carril.tone === lane)?.total ?? 0);

      /* Los nudos que se van encontrando al trazar: el de Descartadas, los de
       * la revisión rechazada y el del archivo. Se pintan todos igual y sus
       * compuertas se reparten en una pasada final. */
      const nudosTrazados: Nudo[] = [];

      const trazar = ({
        id,
        lane,
        origen,
        desde,
        hasta,
        compuertaT = 0.5,
      }: {
        id: string;
        lane: DestinoCable;
        origen: LaneId | "root";
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
          uniones: UNIONES[id] ?? [],
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
        compuertaT?: number;
      }[] = [
        // La compuerta cae en el nudo de Descartadas, su punto medio: la pasada
        // final la mete en el rombo, junto a la del descarte.
        { id: "etapa-cola", origen: "root", destino: "cola" },
        { id: "etapa-roadmap", origen: "cola", destino: "roadmap" },
        { id: "etapa-verificacion", origen: "roadmap", destino: "verificacion" },
        { id: "etapa-revision", origen: "verificacion", destino: "revision_aprobada" },
      ];
      for (const { id, origen, destino, compuertaT } of secuencia) {
        const desde = cajas.get(origen);
        const hasta = cajas.get(destino);
        if (desde && hasta) {
          trazos.push(trazar({ id, lane: destino, origen, desde, hasta, compuertaT }));
        }
      }

      /* Archivar: la línea de Revisión aprobada sigue recta hasta un nudo en
       * mitad del hueco. De ahí sale una rama recta a Git y otra que baja al
       * Historial, así que nada se tuerce antes del nudo. Cada rama lleva su
       * compuerta abierta; la de Git solo existe cuando el repo tiene work
       * tree, y entonces están abiertas las dos. */
      const revisionFinal = cajas.get("revision_aprobada");
      const cabeceraHistorial = cajas.get("historial");
      if (revisionFinal && cabeceraHistorial) {
        const yRev = revisionFinal.y + revisionFinal.h / 2;
        const inicio = revisionFinal.x + revisionFinal.w;
        const columnaGit = cabeceraGit
          ? cabeceraGit.x
          : cajaGit
            ? cajaGit.x
            : cabeceraHistorial.x;
        const xNudo = (inicio + columnaGit) / 2;
        const yHist = cabeceraHistorial.y + cabeceraHistorial.h / 2;
        const puntos = [
          { x: inicio, y: yRev },
          { x: xNudo, y: yRev },
          { x: xNudo, y: yHist },
          { x: cabeceraHistorial.x - 1, y: yHist },
        ];
        trazos.push({
          id: "etapa-historial",
          lane: "historial",
          origenLane: "revision_aprobada",
          destinoLane: "historial",
          uniones: UNIONES["etapa-historial"] ?? [],
          abierta: true,
          nudo: "archivo",
          presion: total("revision_aprobada"),
          puntos,
          x1: inicio,
          y1: yRev,
          x2: cabeceraHistorial.x - 1,
          y2: yHist,
          d: trazoDe(puntos),
          compuerta: { x: xNudo, y: yRev, angulo: 0 },
          chevron: puntoEnTrazo(puntos, 0.3),
          longitud: largo(puntos),
        });
        if (cabeceraGit) {
          const puntosGit = [
            { x: xNudo, y: yRev },
            { x: cabeceraGit.x, y: yRev },
          ];
          trazos.push({
            id: "etapa-git",
            lane: "git",
            origenLane: "revision_aprobada",
            destinoLane: "git",
            uniones: UNIONES["etapa-git"] ?? [],
            abierta: conGit,
            nudo: "archivo",
            presion: total("revision_aprobada"),
            puntos: puntosGit,
            x1: xNudo,
            y1: yRev,
            x2: cabeceraGit.x,
            y2: yRev,
            d: trazoDe(puntosGit),
            compuerta: { x: xNudo, y: yRev, angulo: 0 },
            chevron: { x: xNudo + (cabeceraGit.x - xNudo) * 0.8, y: yRev, angulo: 0 },
            longitud: largo(puntosGit),
          });
        }
        nudosTrazados.push({ id: "archivo", x: xNudo, y: yRev, lado: 0 });
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
         * superior: sin codo. Su compuerta vive en el nudo, con la de la
         * etapa: las dos salen de ahí. */
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
          uniones: UNIONES["descarte-entrada-cola"] ?? [],
          nudo: "entrada-cola",
          presion: total("descartadas"),
          puntos,
          x1: medio.x,
          y1: medio.y,
          x2,
          y2,
          d: trazoDe(puntos),
          compuerta: { x: medio.x, y: medio.y, angulo: 0 },
          chevron: puntoEnTrazo(puntos, 0.3),
          longitud: largo(puntos),
        });
      }

      /* Eliminadas vive a la izquierda de Descartadas (misma banda). El cable
       * sale del canto izquierdo de Descartadas y entra por el derecho de
       * Eliminadas: la eliminación definitiva no se persiste, solo se
       * representa el paso visual antes del borrado. */
      const eliminadas = cajas.get("eliminadas");
      if (descartadas && eliminadas) {
        const y = descartadas.y + descartadas.h / 2;
        const x1 = descartadas.x + 1;
        const x2 = eliminadas.x + eliminadas.w - 1;
        const puntos = [
          { x: x1, y },
          { x: x2, y },
        ];
        trazos.push({
          id: "etapa-eliminadas",
          lane: "eliminadas",
          origenLane: "descartadas",
          destinoLane: "eliminadas",
          uniones: UNIONES["etapa-eliminadas"] ?? [],
          abierta: true,
          presion: total("descartadas"),
          puntos,
          x1,
          y1: y,
          x2,
          y2: y,
          d: trazoDe(puntos),
          compuerta: { x: (x1 + x2) / 2, y, angulo: 0 },
          chevron: { x: x1 + (x2 - x1) * 0.65, y, angulo: 180 },
          longitud: largo(puntos),
        });
      }
      /* El nudo de Descartadas es un rombo, como el de Revisión rechazada: las
       * compuertas de la entrada —la de la etapa y la del descarte— caen dentro
       * de él. */
      if (medio) {
        nudosTrazados.push({ id: "entrada-cola", x: medio.x, y: medio.y, lado: 0 });
        // La etapa Entrada↔En cola pasa por el nudo: su compuerta es de ahí.
        const cableCola = trazos.find((cable) => cable.id === "etapa-cola");
        if (cableCola) cableCola.nudo = "entrada-cola";
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
        for (const salidaLane of [
          { lane: "roadmap", status: "roadmap", bus: 18 },
          { lane: "cola", status: "proposed", bus: 18 },
          { lane: "descartadas", status: "rejected", bus: 34 },
        ] as const) {
          const destino = cajas.get(salidaLane.lane);
          if (!destino) continue;
          puertos.push({
            lane: salidaLane.lane,
            status: salidaLane.status,
            // Roadmap y cola entran por el canto derecho de su cabecera, un
            // poco por debajo del cable de ida, para no montarse encima de
            // él. A Descartadas no llega nada más por ese canto, así que entra
            // por el centro.
            busX: destino.x + destino.w + salidaLane.bus,
            tx: destino.x + destino.w - 2,
            ty: destino.y + destino.h / 2 + (salidaLane.lane === "descartadas" ? 0 : 9),
          });
        }
        const troncoY = caja.y + caja.h / 2;
        /* En cola y Descartadas caen en la misma calle —sus cantos derechos
         * quedan casi a la misma altura—, así que comparten nudo: dos rombos
         * pegados se leerían como una mancha. */
        const nudoDe = new Map<number, Nudo>();
        for (const puerto of puertos) {
          let nudo = nudosTrazados.find(
            (n) => n.id.startsWith("bus-") && Math.abs(n.x - puerto.busX) < 24 * 1.6,
          );
          if (!nudo) {
            nudo = {
              id: `bus-${nudosTrazados.filter((n) => n.id.startsWith("bus-")).length}`,
              x: puerto.busX,
              y: troncoY,
              lado: 0,
              rechazo: true,
            };
            nudosTrazados.push(nudo);
          }
          nudoDe.set(puerto.busX, nudo);
        }
        const calleDe = (puerto: { busX: number }) => nudoDe.get(puerto.busX)!;
        // El nudo del propio cable de revisión: ahí va su compuerta.
        nudosTrazados.push({ id: "rechazo", x: nudoRevision.x, y: nudoRevision.y, lado: 0, rechazo: true });
        setRama({
          caja,
          tronco: `M ${nudoRevision.x} ${nudoRevision.y} L ${nudoRevision.x} ${caja.y}`,
          bus: puertos.length
            ? `M ${caja.x} ${troncoY} L ${Math.min(...puertos.map((p) => calleDe(p).x))} ${troncoY}`
            : null,
        });
        revision.nudo = "rechazo";
        for (const puerto of puertos) {
          const nudo = calleDe(puerto);
          const puntos = [
            { x: nudo.x, y: troncoY },
            { x: nudo.x, y: puerto.ty },
            { x: puerto.tx, y: puerto.ty },
          ];
          const sube = puerto.lane !== "descartadas" && Math.abs(puerto.ty - troncoY) > 60;
          trazos.push({
            id: `rechazo-${puerto.lane}`,
            lane: puerto.lane,
            origenLane: "verificacion",
            destinoLane: puerto.lane,
            uniones: UNIONES[`rechazo-${puerto.lane}`] ?? [],
            rama: true,
            nudo: nudo.id,
            presion: total("verificacion"),
            puntos,
            x1: nudo.x,
            y1: troncoY,
            x2: puerto.tx,
            y2: puerto.ty,
            d: trazoDe(puntos),
            compuerta: { x: nudo.x, y: troncoY, angulo: 0 },
            chevron: sube
              ? { x: nudo.x, y: puerto.ty + 34, angulo: -90 }
              : { x: puerto.tx + (nudo.x - puerto.tx) * 0.3, y: puerto.ty, angulo: 180 },
            longitud: largo(puntos),
          });
        }
      }

      /* Cada celda de protocolo, en su sitio: dentro del rombo de su nudo o
       * en mitad de su cable. Una sola regla para todo el mapa. */
      repartirCompuertas(trazos, nudosTrazados);

      /* El chevrón de entrada→cola se aparta del rombo: nace en el nudo y
       * tiene que leerse entre su vértice derecho y En cola. */
      const nudoEntrada = nudosTrazados.find((nudo) => nudo.id === "entrada-cola");
      const cableCola = trazos.find((cable) => cable.id === "etapa-cola");
      if (nudoEntrada && cableCola && cola) {
        const borde = cola.x - 6;
        const mediaDiagonal = nudoEntrada.lado / Math.SQRT2;
        const x = Math.min(
          borde,
          nudoEntrada.x + mediaDiagonal + (borde - nudoEntrada.x - mediaDiagonal) / 2,
        );
        cableCola.chevron = { x, y: nudoEntrada.y, angulo: 0 };
      }

      setNudos(nudosTrazados);
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
    for (const lane of LANES) {
      const el = carrilRefs.current[lane.id];
      if (el) ro.observe(el);
    }
    map.addEventListener("scroll", medir, true);
    return () => {
      ro.disconnect();
      map.removeEventListener("scroll", medir, true);
    };
  }, [
    tree,
    cerrados,
    k,
    mapa,
    boardRef,
    mapRef,
    cajonRef,
    carrilRefs,
    gitRef,
    conGit,
    insetDerecha,
  ]);

  /* Arrastrar mueve la cámara pero no la medida: los cables viven en
   *  coordenadas del mapa y solo el zoom entra en la cuenta. Aquí se revisa lo
   *  único que sí cambia al moverse —si el esquema se sale de la ventana—, en
   *  vez de volver a medir los nueve nodos y repintar los cables por píxel. */
  useLayoutEffect(() => {
    if (mapa !== "items") return;
    const map = mapRef.current;
    if (!map) return;
    setRecortado(recortadoDe(map, boardRef.current, insetDerecha));
  }, [vista, mapa, mapRef, boardRef, insetDerecha]);

  const enItems = mapa === "items";
  return {
    cables: enItems ? cables : [],
    nudos: enItems ? nudos : [],
    rama: enItems ? rama : null,
    recortado: enItems ? recortado : false,
  };
}
