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
  "rejected",
]);
const Union = z.object({ origen: Grupo, destino: Grupo });
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
  rejected: "rejected",
  superseded: "rejected",
};

export type PuedeIr = (origen: Status, destino: Status) => boolean;

export function useProtocolos(repo: string | null): PuedeIr {
  // Lo cargado pertenece a *un* repo: al cambiar de carpeta, lo viejo deja de
  // valer al instante en vez de aplicarse un frame (patrón de `useRepo`).
  const [estado, setEstado] = useState<{
    repo: string | null;
    pares: ReadonlySet<string>;
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
          setEstado({ repo, pares: new Set(filas.map((f) => `${f.origen}→${f.destino}`)) });
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

  const pares = estado?.repo === repo ? estado.pares : null;
  return (origen: Status, destino: Status) => {
    if (pares === null) return true;
    const a = A_GRUPO[origen];
    const d = A_GRUPO[destino];
    return a === d || pares.has(`${a}→${d}`);
  };
}
