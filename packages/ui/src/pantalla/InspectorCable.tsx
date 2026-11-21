import type { Paso } from "../core/useProtocolos";
import type { Cable } from "../mapa/cables";
import { ETIQUETA_ESTADO, tituloCarril } from "../mapa/carriles";
import type { Status } from "../mapa/carriles";
import { estadoUnion } from "../mapa/protocolos";

/** La ficha de un cable y de su compuerta: las uniones que cruza, cómo está
 *  cada una y por qué. Los tramos de archivo no son uniones de protocolo y la
 *  ficha lo dice en vez de inventar una fila que no existe. */
export function CuerpoCable({
  cable,
  paso,
}: {
  cable: Cable;
  paso: (origen: Status, destino: Status) => Paso | null;
}) {
  const origen = tituloCarril(cable.origenLane);
  const destino = tituloCarril(cable.destinoLane);

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">Cable a {destino}</p>
      <p className="inspector-meta">
        {cable.presion === 1 ? "1 idea" : `${cable.presion} ideas`} en {origen}
      </p>

      <p className="pane-rotulo">Compuerta</p>
      {cable.uniones.length === 0 ? (
        <>
          <p className="inspector-union">
            {cable.lane === "git"
              ? cable.abierta
                ? "abierta: el repo tiene work tree"
                : "cerrada: sin work tree"
              : "abierta: archivar no cruza protocolo"}
          </p>
          <p className="hint">
            {cable.lane === "git"
              ? "El tramo a Git no es una unión de protocolo: se abre por la disponibilidad del work tree."
              : "El Historial se alcanza por disponibilidad, no por una fila de protocolo; por eso no exige fases."}
          </p>
        </>
      ) : (
        <ul className="inspector-uniones">
          {cable.uniones.map(([o, d]) => (
            <li key={`${o}→${d}`}>
              <span className="inspector-union">
                {ETIQUETA_ESTADO[o] ?? o} → {ETIQUETA_ESTADO[d] ?? d}
              </span>
              <span className="inspector-exige">{estadoUnion(paso(o, d))}</span>
            </li>
          ))}
        </ul>
      )}

      {cable.rama && (
        <p className="hint">
          Es una vuelta de la revisión rechazada: nace del nudo del rechazo, no
          de la línea principal.
        </p>
      )}
    </div>
  );
}
