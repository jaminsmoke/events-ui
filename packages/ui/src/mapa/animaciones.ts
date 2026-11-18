import { useEffect, useRef, useState } from "react";

import type { Connection, Idea } from "../core/api";
import { laneOf } from "./carriles";
import type { LaneId } from "./carriles";

export type Animacion = { lane: LaneId; id: number };

/** Dónde puede pulsar un nodo: un carril, o el cajón de Ideas (`"cajon"`).
 *  El cajón contiene todas las ideas, así que pulsa cuando entra o sale
 *  alguna, independientemente de qué carril toque. */
export type NodoId = LaneId | "cajon";

/** Código de colores del pulso de borde de cada nodo:
 *  - `azul`: una idea **entra** (se crea o se mueve a En cola);
 *  - `rojo`: una idea **sale** (se borra del repo o se mueve a Descartadas);
 *  - `verde`: una idea se **completa** (`status: "accepted"`).
 *  Verde queda reservado a completado, no a entradas normales. */
export type TonoPulso = "azul" | "rojo" | "verde";
export type Pulso = { lane: NodoId; tono: TonoPulso };

const PRIORIDAD: Record<TonoPulso, number> = { azul: 1, rojo: 2, verde: 3 };

/** Señala entradas y salidas aunque dos ideas se crucen y los totales coincidan.
 *  El pulso va al nodo (borde y contador), la chispa al cable del carril. */
export function useAnimaciones(
  repo: string | null,
  ideas: Idea[] | null,
  links: Connection[] | null = null,
) {
  const [actividad, setActividad] = useState<{
    repo: string;
    chispas: Animacion[];
    pulsos: { lane: LaneId; tono: TonoPulso }[];
    cajon?: TonoPulso;
    /** Enlaces laterales recién creados: pulsan azul en sus dos extremos. */
    enlaces: { parentUid: string; childUid: string }[];
  } | null>(null);
  const anterior = useRef<{
    repo: string;
    estados: Map<string, Idea["status"]>;
    carriles: Map<string, LaneId>;
    enlaces: Map<number, { parentUid: string; childUid: string }>;
  } | null>(null);
  const secuencia = useRef(0);

  useEffect(() => {
    if (!repo || !ideas) return;
    const previo = anterior.current;
    const estados = new Map(ideas.map((idea) => [idea.uid, idea.status]));
    const carriles = new Map(ideas.map((idea) => [idea.uid, laneOf(idea.status)]));
    const enlaces = new Map(
      (links ?? []).map((l) => [l.id, { parentUid: l.parent_uid, childUid: l.child_uid }]),
    );
    anterior.current = { repo, estados, carriles, enlaces };
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
    const cambian = new Set<LaneId>();

    for (const idea of ideas) {
      const lane = laneOf(idea.status);
      const lanePrevio = previo.carriles.get(idea.uid);
      if (idea.status === "accepted" && previo.estados.get(idea.uid) !== "accepted") {
        fijar(lane, "verde");
        cambian.add(lane);
      } else if (lanePrevio === undefined) {
        fijar(lane, "azul");
        fijarCajon("azul");
        cambian.add(lane);
      } else if (lanePrevio !== lane) {
        fijar(lane, lane === "descartadas" ? "rojo" : "azul");
        cambian.add(lane);
        cambian.add(lanePrevio);
      }
    }
    // Borrada del repo: su carril y el cajón pulsan en rojo aunque ya no
    // tengan la fila.
    for (const [uid, lane] of previo.carriles) {
      if (!carriles.has(uid)) {
        fijar(lane, "rojo");
        fijarCajon("rojo");
        cambian.add(lane);
      }
    }
    // Un enlace lateral nuevo (`related`/`supersedes`) pulsa en azul en los
    // dos nodos que une, aunque no cambie ningún carril.
    const enlacesNuevos: { parentUid: string; childUid: string }[] = [];
    for (const [id, extremos] of enlaces) {
      if (!previo.enlaces.has(id)) enlacesNuevos.push(extremos);
    }
    if (cambian.size === 0 && enlacesNuevos.length === 0) return;

    const chispas = Array.from(cambian, (lane) => ({ lane, id: ++secuencia.current }));
    const raf = requestAnimationFrame(() => {
      setActividad({
        repo,
        chispas,
        pulsos: Array.from(pulsos, ([lane, tono]) => ({ lane, tono })),
        cajon,
        enlaces: enlacesNuevos,
      });
    });
    return () => cancelAnimationFrame(raf);
  }, [repo, ideas, links]);

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
    enlacesNuevos: visible?.enlaces ?? [],
  };
}
