/** Qué traslados ofrece cada estado y por qué uno puede estar frenado.
 *
 *  Lo comparten la fila del mapa y el inspector de idea: si cambia una acción
 *  o un requisito del protocolo, cambia en los dos sitios a la vez. */
import type { PuedeIr } from "../core/useProtocolos";
import type { Status } from "./carriles";
import type { Fase } from "./fase";

export type AccionEstado = {
  estado: Status;
  etiqueta: string;
  /** Abre el diálogo del motivo en vez de mover directamente. */
  descartar?: boolean;
};

/** Acciones de traslado que ofrece cada estado. */
export const ACCIONES_ESTADO: Record<Status, readonly AccionEstado[]> = {
  draft: [
    { estado: "proposed", etiqueta: "A cola" },
    { estado: "rejected", etiqueta: "Descartar", descartar: true },
  ],
  proposed: [
    { estado: "roadmap", etiqueta: "A roadmap" },
    { estado: "rejected", etiqueta: "Descartar", descartar: true },
  ],
  roadmap: [{ estado: "verificacion", etiqueta: "A verificación" }],
  verificacion: [
    { estado: "roadmap", etiqueta: "A roadmap" },
    { estado: "proposed", etiqueta: "A cola" },
    { estado: "revision_aprobada", etiqueta: "Aprobar revisión" },
    { estado: "rejected", etiqueta: "Descartar", descartar: true },
  ],
  revision_aprobada: [],
  historial: [],
  rejected: [],
  superseded: [],
};

/** Motivo por el que un traslado no se ofrece, o `null` si se puede probar.
 *  Sale de las fases de la idea y del protocolo del repo, como en la fila. */
export function motivoBloqueo(
  estado: Status | undefined,
  fases: readonly Fase[],
  destino: Status,
  exigencias: {
    exigeFases?: PuedeIr;
    exigeFasesListas?: PuedeIr;
    exigeFasesCompletas?: PuedeIr;
  },
): string | null {
  if (!estado) return null;
  const abiertas = fases.filter(
    (fase) => fase.estado === "pendiente" || fase.estado === "fallida",
  ).length;
  if (fases.length === 0 && exigencias.exigeFases?.(estado, destino)) {
    return "El protocolo exige al menos una fase";
  }
  if (
    destino === "verificacion" &&
    abiertas > 0 &&
    exigencias.exigeFasesListas?.(estado, "verificacion")
  ) {
    return `Cierra las fases pendientes o fallidas (${abiertas})`;
  }
  if (
    destino === "revision_aprobada" &&
    !fases.every((fase) => fase.estado === "completada") &&
    exigencias.exigeFasesCompletas?.(estado, "revision_aprobada")
  ) {
    return "Completa todas las fases para aprobar la revisión";
  }
  return null;
}
