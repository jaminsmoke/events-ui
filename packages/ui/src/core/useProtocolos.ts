import { useEffect, useState } from "react";
import { z } from "zod";

import { api, unwrap } from "./api";
import type { Status } from "../mapa/carriles";

/** Los protocolos de flujo (`GET /protocolos`): la allowlist de uniones
 *  permitidas entre carriles. Se valida con Zod porque es configuración del
 *  servidor, no tipos quemados en la UI: lo que llega se comprueba en
 *  ejecución antes de decidir qué botones ofrecer.
 *
 *  La UI solo apaga lo prohibido (el core impone de verdad y responde 400):
 *  sin protocolos cargados aún o si la respuesta no valida, se ofrece todo
 *  y el core decide.
 */
const Grupo = z.enum([
  "draft",
  "proposed",
  "roadmap",
  "verificacion",
  "revision_aprobada",
  "historial",
  "rejected",
]);
// `exige_fases` (0021): la unión no se cruza sin al menos una fase. Es dato
// del protocolo, así que la fila puede avisar antes de que el core la pare.
const Union = z.object({
  origen: Grupo,
  destino: Grupo,
  exige_fases: z.boolean(),
  exige_fases_listas: z.boolean(),
  exige_fases_completas: z.boolean(),
});
const Protocolos = z.array(Union);

type Grupo = z.infer<typeof Grupo>;

/** El grupo de un estado para mover: `superseded` es el grupo de
 *  descartadas (la ficha lo distingue, el carril no) —igual que en el core. */
const A_GRUPO: Record<Status, Grupo> = {
  draft: "draft",
  proposed: "proposed",
  roadmap: "roadmap",
  verificacion: "verificacion",
  revision_aprobada: "revision_aprobada",
  historial: "historial",
  rejected: "rejected",
  superseded: "rejected",
};

export type PuedeIr = (origen: Status, destino: Status) => boolean;

/** Un requisito del protocolo para cruzar una unión, de menos a más duro. */
export type Exigencia = "fases" | "fases-listas" | "fases-completas";

/** El estado de una unión para pintarla: abierta o prohibida, y qué exige.
 *  `null` = los protocolos aún no han cargado (no se dibuja compuerta). */
export type Paso = { abierta: boolean; exige: readonly Exigencia[] };

export type ProtocolosFlujo = {
  /** ¿Está la unión en la allowlist? */
  puedeIr: PuedeIr;
  /** ¿Exige el protocolo una fase para cruzar esa unión? */
  exigeFases: PuedeIr;
  /** ¿Exige el protocolo que no queden fases abiertas al cruzar? */
  exigeFasesListas: PuedeIr;
  /** ¿Exige el protocolo que todas estén completadas al cruzar? */
  exigeFasesCompletas: PuedeIr;
  /** La unión entera, para la compuerta del cable: `null` sin datos. */
  paso: (origen: Status, destino: Status) => Paso | null;
};

export function useProtocolos(repo: string | null): ProtocolosFlujo {
  // Lo cargado pertenece a *un* repo: al cambiar de carpeta, lo viejo deja de
  // valer al instante en vez de aplicarse un frame (patrón de `useRepo`).
  const [estado, setEstado] = useState<{
    repo: string | null;
    pares: ReadonlySet<string>;
    exigen: ReadonlySet<string>;
    exigenListas: ReadonlySet<string>;
    exigenCompletas: ReadonlySet<string>;
  } | null>(null);

  useEffect(() => {
    if (!repo) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const vigilar = async () => {
      try {
        const datos = await unwrap(
          api.GET("/protocolos", { params: { query: { repo } }, signal: controller.signal }),
        );
        const filas = Protocolos.parse(datos);
        if (!controller.signal.aborted) {
          setEstado({
            repo,
            pares: new Set(filas.map((f) => `${f.origen}→${f.destino}`)),
            exigen: new Set(
              filas.filter((f) => f.exige_fases).map((f) => `${f.origen}→${f.destino}`),
            ),
            exigenListas: new Set(
              filas.filter((f) => f.exige_fases_listas).map((f) => `${f.origen}→${f.destino}`),
            ),
            exigenCompletas: new Set(
              filas
                .filter((f) => f.exige_fases_completas)
                .map((f) => `${f.origen}→${f.destino}`),
            ),
          });
        }
      } catch {
        // Sin protocolos se deja la puerta como estaba: el core manda.
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(vigilar, 5000);
      }
    };
    void vigilar();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [repo]);

  const cargado = estado?.repo === repo ? estado : null;
  return {
    puedeIr: (origen, destino) => {
      if (cargado === null) return true;
      const a = A_GRUPO[origen];
      const d = A_GRUPO[destino];
      return a === d || cargado.pares.has(`${a}→${d}`);
    },
    exigeFases: (origen, destino) => {
      if (cargado === null) return false;
      return cargado.exigen.has(`${A_GRUPO[origen]}→${A_GRUPO[destino]}`);
    },
    exigeFasesListas: (origen, destino) => {
      if (cargado === null) return false;
      return cargado.exigenListas.has(`${A_GRUPO[origen]}→${A_GRUPO[destino]}`);
    },
    exigeFasesCompletas: (origen, destino) => {
      if (cargado === null) return false;
      return cargado.exigenCompletas.has(`${A_GRUPO[origen]}→${A_GRUPO[destino]}`);
    },
    paso: (origen, destino) => {
      if (cargado === null) return null;
      const a = A_GRUPO[origen];
      const d = A_GRUPO[destino];
      const par = `${a}→${d}`;
      const exige: Exigencia[] = [];
      if (cargado.exigen.has(par)) exige.push("fases");
      if (cargado.exigenListas.has(par)) exige.push("fases-listas");
      if (cargado.exigenCompletas.has(par)) exige.push("fases-completas");
      // Mismo grupo (p. ej. rechazada → reemplazada) no cruza compuerta.
      return { abierta: a === d || cargado.pares.has(par), exige };
    },
  };
}
