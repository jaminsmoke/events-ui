import { useEffect, useState } from "react";
import { z } from "zod";

import { api, unwrap } from "./api";
import { suscribirSondeo } from "./sondeo";
import { GRUPOS, grupoDeEstado } from "../mapa/carriles";
import type { Status } from "../mapa/carriles";

/** Los protocolos de flujo (`GET /protocolos`): la allowlist de uniones
 *  permitidas entre carriles. Se valida con Zod porque es configuración del
 *  servidor, no tipos quemados en la UI: lo que llega se comprueba en
 *  ejecución antes de decidir qué botones ofrecer.
 *
 *  La UI solo apaga lo prohibido (el core impone de verdad y responde 400):
 *  sin protocolos cargados aún o si la respuesta no valida, se ofrece todo
 *  y el core decide.
 *
 *  La respuesta se resume una vez en un `Map` de uniones (`origen→destino` →
 *  `Paso`): `puedeIr` y las tres `exige*` se preguntan a `paso()`, así que
 *  añadir una exigencia no obliga a tocar cuatro sitios.
 *
 *  Se refresca con el latido compartido de `sondeo`, uno de cada tres (~6 s):
 *  es configuración y cambia poco.
 */
const SchemaGrupo = z.enum(GRUPOS);
// `exige_fases` (0021): la unión no se cruza sin al menos una fase. Es dato
// del protocolo, así que la fila puede avisar antes de que el core la pare.
const Union = z.object({
  origen: SchemaGrupo,
  destino: SchemaGrupo,
  exige_fases: z.boolean(),
  exige_fases_listas: z.boolean(),
  exige_fases_completas: z.boolean(),
});
const Protocolos = z.array(Union);


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

/** Lo cargado de un repo: sus uniones ya resueltas, por `origen→destino`. */
type Cargado = {
  repo: string | null;
  uniones: ReadonlyMap<string, Paso>;
};

export function useProtocolos(repo: string | null): ProtocolosFlujo {
  // Lo cargado pertenece a *un* repo: al cambiar de carpeta, lo viejo deja de
  // valer al instante en vez de aplicarse un frame (patrón de `useRepo`).
  const [estado, setEstado] = useState<Cargado | null>(null);

  useEffect(() => {
    if (!repo) return;
    let vivo = true;
    let ocupado = false;
    let latido = 0;

    const vigilar = async () => {
      if (latido++ % 3 !== 0 || ocupado) return;
      ocupado = true;
      try {
        const datos = await unwrap(
          api.GET("/protocolos", { params: { query: { repo } } }),
        );
        const filas = Protocolos.parse(datos);
        if (vivo) {
          const uniones = new Map<string, Paso>();
          for (const fila of filas) {
            const exige: Exigencia[] = [];
            if (fila.exige_fases) exige.push("fases");
            if (fila.exige_fases_listas) exige.push("fases-listas");
            if (fila.exige_fases_completas) exige.push("fases-completas");
            // Toda fila de `protocolo_flujo` es una unión abierta: la tabla es
            // la allowlist. Lo que no está, `paso` lo devuelve cerrado.
            uniones.set(`${fila.origen}→${fila.destino}`, { abierta: true, exige });
          }
          setEstado({ repo, uniones });
        }
      } catch {
        // Sin protocolos se deja la puerta como estaba: el core manda.
      } finally {
        ocupado = false;
      }
    };

    const baja = suscribirSondeo(() => void vigilar());
    void vigilar();
    return () => {
      vivo = false;
      baja();
    };
  }, [repo]);

  const cargado = estado?.repo === repo ? estado : null;

  /** La única consulta: qué es esa unión y qué pide. */
  const paso = (origen: Status, destino: Status): Paso | null => {
    if (cargado === null) return null;
    const a = grupoDeEstado(origen);
    const d = grupoDeEstado(destino);
    const union = cargado.uniones.get(`${a}→${d}`);
    // Mismo grupo (p. ej. rechazada → reemplazada) no cruza compuerta.
    return { abierta: a === d || union !== undefined, exige: union?.exige ?? [] };
  };

  /** ¿Pide esa unión este requisito? Sin protocolos cargados, ninguno. */
  const exige = (origen: Status, destino: Status, requisito: Exigencia): boolean =>
    paso(origen, destino)?.exige.includes(requisito) ?? false;

  return {
    puedeIr: (origen, destino) => paso(origen, destino)?.abierta ?? true,
    exigeFases: (origen, destino) => exige(origen, destino, "fases"),
    exigeFasesListas: (origen, destino) => exige(origen, destino, "fases-listas"),
    exigeFasesCompletas: (origen, destino) => exige(origen, destino, "fases-completas"),
    paso,
  };
}
