/** Los botones de traslado de un ítem, compartidos por la fila y el inspector.
 *
 *  La lista sale de `ACCIONES_ESTADO` y el bloqueo de `motivoBloqueo`: una sola
 *  fuente para las dos superficies. El descarte pide motivo al padre, que es
 *  quien monta el diálogo; sin `onDescartar`, el traslado va directo.
 */
import type { PuedeIr } from "../core/useProtocolos";
import { ACCIONES_ESTADO, motivoBloqueo } from "./acciones";
import type { Status } from "../modelo/carriles";
import type { Fase } from "../modelo/fase";

export function BotonesMover({
  uid,
  estado,
  fases,
  puedeIr,
  exigeFases,
  exigeFasesListas,
  exigeFasesCompletas,
  trabajando,
  onMover,
  onDescartar,
  className = "btn ghost mover",
}: {
  uid: string;
  estado: Status;
  fases: readonly Fase[];
  puedeIr?: PuedeIr;
  exigeFases?: PuedeIr;
  exigeFasesListas?: PuedeIr;
  exigeFasesCompletas?: PuedeIr;
  trabajando: boolean;
  onMover?: (uid: string, status: Status) => void;
  onDescartar?: () => void;
  className?: string;
}) {
  if (!onMover) return null;
  return (
    <>
      {(ACCIONES_ESTADO[estado] ?? [])
        .filter((accion) => !puedeIr || puedeIr(estado, accion.estado))
        .map((accion) => {
          const bloqueo = motivoBloqueo(estado, fases, accion.estado, {
            exigeFases,
            exigeFasesListas,
            exigeFasesCompletas,
          });
          return (
            <button
              key={accion.estado}
              type="button"
              className={className}
              title={bloqueo ?? accion.etiqueta}
              disabled={trabajando || bloqueo !== null}
              onClick={() => {
                // Descartar pide el motivo (detalle `rejected_node`); los
                // demás traslados van directos.
                if (accion.descartar && onDescartar) onDescartar();
                else onMover(uid, accion.estado);
              }}
            >
              {accion.etiqueta}
            </button>
          );
        })}
    </>
  );
}
