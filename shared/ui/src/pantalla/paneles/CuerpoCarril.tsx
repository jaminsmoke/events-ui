import { Fragment } from "react";

import type { WorkItem } from "../../core/api";
import type { Paso } from "../../core/useProtocolos";
import { ESTADOS, ETIQUETA_ESTADO } from "../../modelo/carriles";
import type { Status } from "../../modelo/carriles";
import { TEXTO_EXIGENCIA } from "../../modelo/protocolos";
import type { Seleccion } from "../../modelo/seleccion";

/** La ficha de un carril: qué items lo pueblan, cómo se reparten y por dónde
 *  puede seguir cada estado según el protocolo del repo. Las salidas no se
 *  inventan: son las uniones que `paso` da por abiertas, con lo que piden. */
export function CuerpoCarril({
  titulo,
  estados,
  items,
  paso,
  onSeleccionar,
}: {
  titulo: string;
  estados: readonly Status[];
  items: readonly WorkItem[];
  paso: (origen: Status, destino: Status) => Paso | null;
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  const delCarril = items.filter((item) => estados.includes(item.status));
  const salidas = estados.flatMap((origen) =>
    ESTADOS.filter((destino) => !estados.includes(destino))
      .map((destino) => ({ origen, destino, paso: paso(origen, destino) }))
      .filter((union) => union.paso?.abierta),
  );

  // Eliminadas no guarda items: es el paso visual antes del borrado definitivo.
  if (estados.length === 0) {
    return (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="inspector-asunto">{titulo}</p>
        <p className="inspector-meta">Solo representación</p>
        <p className="hint">
          Los ítems llegan desde Descartadas, se queman y desaparecen. No se
          guardan en el almacén.
        </p>
      </div>
    );
  }

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">{titulo}</p>
      <p className="inspector-meta">
        {delCarril.length === 1 ? "1 ítem" : `${delCarril.length} ítems`}
      </p>

      {estados.length > 1 && (
        <dl className="inspector-dl">
          {estados.map((estado) => (
            <Fragment key={estado}>
              <dt>{ETIQUETA_ESTADO[estado] ?? estado}</dt>
              <dd>{delCarril.filter((item) => item.status === estado).length}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      <p className="pane-rotulo">Ítems</p>
      {delCarril.length === 0 ? (
        <p className="hint">Este carril está vacío.</p>
      ) : (
        <ul className="inspector-lista">
          {delCarril.map((item) => (
            <li key={item.uid}>
              <button
                type="button"
                className="inspector-item"
                onClick={() => onSeleccionar({ tipo: "item", uid: item.uid })}
              >
                <span className="inspector-item-titulo">{item.title}</span>
                <span className="inspector-item-estado">
                  {ETIQUETA_ESTADO[item.status] ?? item.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="pane-rotulo">Salidas del protocolo</p>
      {salidas.length === 0 ? (
        <p className="hint">Ningún protocolo deja salir de este carril.</p>
      ) : (
        <ul className="inspector-uniones">
          {salidas.map(({ origen, destino, paso: union }) => (
            <li key={`${origen}→${destino}`}>
              <span className="inspector-union">
                {estados.length > 1 ? `${ETIQUETA_ESTADO[origen] ?? origen} → ` : "→ "}
                {ETIQUETA_ESTADO[destino] ?? destino}
              </span>
              <span className="inspector-exige">
                {union?.exige.length
                  ? union.exige
                      .map((exigencia) => TEXTO_EXIGENCIA[exigencia])
                      .join("; ")
                  : "paso libre"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {estados.includes("revision_aprobada") && (
        <p className="hint">
          Archivar a Changelog no cruza protocolo: lo habilita tener work tree.
        </p>
      )}
    </div>
  );
}
