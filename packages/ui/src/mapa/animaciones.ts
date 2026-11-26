import { useEffect, useRef, useState } from "react";

import type { WorkItem } from "../core/api";
import { laneOf } from "./carriles";
import type { LaneId } from "./carriles";

export type Animacion = { lane: LaneId; id: number; desde?: LaneId | null };

/** Dónde puede pulsar un nodo: un carril, o el cajón de Ítems (`"cajon"`).
 *  El cajón contiene los ítems sin carril (recién creadas), así que pulsa
 *  cuando entra alguna y cuando una lo deja hacia un carril. */
export type NodoId = LaneId | "cajon";

/** Código de colores del pulso de borde de cada nodo:
 *  - `azul`: un ítem **entra** (se crea o llega a un carril);
 *  - `rojo`: un ítem **sale** (se borra, se descarta o deja un carril);
 *  - `verde`: un ítem llega a **revisión aprobada** o al **historial**.
 *  Verde queda reservado al estado final, no a entradas normales. */
export type TonoPulso = "azul" | "rojo" | "verde";
export type Pulso = { lane: NodoId; tono: TonoPulso };

const PRIORIDAD: Record<TonoPulso, number> = { azul: 1, rojo: 2, verde: 3 };

/** Señala entradas y salidas aunque dos items se crucen y los totales coincidan.
 *  El pulso va al nodo (borde y contador); la chispa recorre solo el cable de
 *  llegada. Una salida no lanza chispa en el cable de entrada del carril que
 *  deja: eso haría creer que también llega algo. */
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
    const estados = new Map(items.map((item) => [item.uid, item.status]));
    const carriles = new Map(items.map((item) => [item.uid, laneOf(item.status)]));
    anterior.current = { repo, estados, carriles };
    if (previo?.repo !== repo) return;

    const pulsos = new Map<LaneId, TonoPulso>();
    // Un carril puede recibir varios eventos a la vez: manda el más fuerte.
    const fijar = (lane: LaneId, tono: TonoPulso) => {
      const actual = pulsos.get(lane);
      if (!actual || PRIORIDAD[tono] > PRIORIDAD[actual]) pulsos.set(lane, tono);
    };
    // El cajón no tiene cable (no hay chispa): solo pulsa el borde.
    let cajon: TonoPulso | undefined;
    const fijarCajon = (tono: TonoPulso) => {
      if (!cajon || PRIORIDAD[tono] > PRIORIDAD[cajon]) cajon = tono;
    };
    // Solo los carriles que reciben un ítem generan chispa; el resto, pulso.
    // El origen permite elegir, en un carril con ida y vuelta, el cable correcto.
    const llegan = new Map<LaneId, LaneId | null>();

    for (const item of items) {
      const lane = laneOf(item.status);
      const lanePrevio = previo.carriles.get(item.uid);
      if (
        (item.status === "revision_aprobada" || item.status === "historial") &&
        previo.estados.get(item.uid) !== "revision_aprobada" &&
        previo.estados.get(item.uid) !== "historial"
      ) {
        if (lane) {
          fijar(lane, "verde");
          llegan.set(lane, lanePrevio ?? null);
        }
      } else if (lanePrevio === undefined) {
        if (lane) {
          fijar(lane, "azul");
          llegan.set(lane, null);
        }
        fijarCajon("azul");
      } else if (lanePrevio !== lane) {
        if (lane) {
          fijar(lane, lane === "descartadas" ? "rojo" : "azul");
          llegan.set(lane, lanePrevio);
        }
        // El carril que deja el ítem pulsa en rojo, pero su cable de entrada
        // no se enciende: la chispa pertenece al carril de llegada.
        if (lanePrevio) fijar(lanePrevio, "rojo");
        // Salir del cajón a un carril: el cajón pulsa en rojo (sale de aquí).
        if (lanePrevio === null) fijarCajon("rojo");
      }
    }
    // Borrada del repo: su carril y el cajón pulsan en rojo aunque ya no
    // tengan la fila. No hay chispa: no llega nada a ningún sitio.
    for (const [uid, lane] of previo.carriles) {
      if (!carriles.has(uid)) {
        if (lane) fijar(lane, "rojo");
        fijarCajon("rojo");
      }
    }
    // Una salida (o un cajón que solo pulsa) no tiene chispas, pero sí pulso.
    if (llegan.size === 0 && pulsos.size === 0 && !cajon) return;

    const chispas = Array.from(llegan, ([lane, desde]) => ({
      lane,
      desde,
      id: ++secuencia.current,
    }));
    const raf = requestAnimationFrame(() => {
      setActividad({
        repo,
        chispas,
        pulsos: Array.from(pulsos, ([lane, tono]) => ({ lane, tono })),
        cajon,
      });
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
