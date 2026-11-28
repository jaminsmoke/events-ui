import type { Paso } from "../core/useProtocolos";
import type { Cable, Nudo } from "../mapa/cables";
import { ETIQUETA_ESTADO, tituloCarril } from "../modelo/carriles";
import type { Status } from "../modelo/carriles";
import { estadoUnion } from "../modelo/protocolos";

/** La ficha de un nudo del mapa: las compuertas que viven dentro de su rombo,
 *  una por cable que sale de él, con la unión y lo que exige el protocolo. */
export function CuerpoNudo({
  nudo,
  cables,
  paso,
}: {
  nudo: Nudo;
  cables: readonly Cable[];
  paso: (origen: Status, destino: Status) => Paso | null;
}) {
  const suyos = cables.filter((cable) => cable.nudo === nudo.id);
  const filas = suyos.flatMap((cable) =>
    cable.uniones.length === 0
      ? [
          {
            clave: cable.id,
            titulo: tituloCarril(cable.destinoLane),
            estado: cable.abierta ? "abierta: por disponibilidad" : "cerrada: sin work tree",
          },
        ]
      : cable.uniones.map(([origen, destino]) => ({
          clave: `${cable.id}:${origen}→${destino}`,
          titulo: `${ETIQUETA_ESTADO[origen] ?? origen} → ${ETIQUETA_ESTADO[destino] ?? destino}`,
          estado: estadoUnion(paso(origen, destino)),
        })),
  );

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">
        {nudo.rechazo ? "Nudo de la revisión rechazada" : "Nudo del flujo"}
      </p>
      <p className="inspector-meta">
        {filas.length === 1 ? "1 compuerta" : `${filas.length} compuertas`}
      </p>

      {filas.length === 0 ? (
        <p className="hint">Este nudo no lleva ninguna compuerta.</p>
      ) : (
        <ul className="inspector-uniones">
          {filas.map((fila) => (
            <li key={fila.clave}>
              <span className="inspector-union">{fila.titulo}</span>
              <span className="inspector-exige">{fila.estado}</span>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        Las compuertas abiertas dejan pasar; las cerradas dicen qué unión falta
        o qué exige el protocolo.
      </p>
    </div>
  );
}
