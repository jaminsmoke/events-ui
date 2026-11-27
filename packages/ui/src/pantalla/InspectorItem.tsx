import { useState } from "react";
import { createPortal } from "react-dom";

import type { Puerta, WorkItem, WorkItemUpdate } from "../core/api";
import type { PuedeIr } from "../core/useProtocolos";
import { BotonEliminar } from "../mapa/BotonEliminar";
import { BotonesMover } from "../mapa/BotonesMover";
import { ETIQUETA_ESTADO, LANES, laneOf } from "../mapa/carriles";
import type { Status } from "../mapa/carriles";
import { ETIQUETA_FASE } from "../mapa/fase";
import { fechaCorta } from "../mapa/formato";
import type { Seleccion } from "../mapa/seleccion";
import { DescartaItem } from "./DescartaItem";

/** Las acciones de el ítem, tal como las ofrece el mapa: la fila y el
 *  inspector usan los mismos callbacks y las mismas reglas de protocolo. */
export type AccionesItem = {
  puedeIr?: PuedeIr;
  exigeFases?: PuedeIr;
  exigeFasesListas?: PuedeIr;
  exigeFasesCompletas?: PuedeIr;
  onMover?: (uid: string, status: Status) => void;
  onEditar?: (uid: string, cambios: WorkItemUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  onPideEditar?: (uid: string, titulo: string, descripcion: string) => void;
};

/** La ficha de un ítem en el Inspector: lo que la fila no enseña para no
 *  crecer —descripción, fases con sus archivos y dependencias— y las mismas
 *  acciones, con el bloqueo del protocolo a la vista. */
export function CuerpoItem({
  item,
  puertas,
  falloPuertas,
  catalogo,
  acciones,
  onSeleccionar,
}: {
  item: WorkItem;
  /** Las puertas del repo: se cargan una vez en el panel, no por ítem. */
  puertas: Puerta[] | null;
  falloPuertas: string | null;
  /** Todas los ítems del repo: resuelve los títulos de las dependencias. */
  catalogo: readonly WorkItem[];
  acciones: AccionesItem;
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  const [descartando, setDescartando] = useState(false);
  const fases = item.fases ?? [];
  const deps = item.depende_de ?? [];
  const hechas = fases.filter((fase) => fase.estado === "completada").length;
  const lane = laneOf(item.status);
  const carril = lane ? LANES.find((l) => l.id === lane)?.title : "Entrada";
  // El historial es un archivo: ni se edita, ni se mueve, ni se borra.
  const enHistorial = item.status === "historial";

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">{item.title}</p>
      <p className="inspector-meta">
        {ETIQUETA_ESTADO[item.status] ?? item.status} · {carril}
      </p>
      <p className="inspector-descripcion">{item.description || "Sin descripción"}</p>

      {item.rejected_at && (
        <p className="fila-rechazo">
          Rechazada el {fechaCorta(item.rejected_at)}
          {item.rejected_description ? ` — ${item.rejected_description}` : ""}
        </p>
      )}

      <p className="pane-rotulo">Fases</p>
      {fases.length === 0 ? (
        <p className="hint">Sin fases.</p>
      ) : (
        <>
          <p className="inspector-meta">
            {hechas} de {fases.length} completadas
          </p>
          <ul className="inspector-lista">
            {fases.map((fase) => (
              <li key={fase.orden} className="inspector-fase">
                <span className="inspector-fase-cabecera">
                  <span className="inspector-fase-titulo">
                    <span className="fase-indice">Fase {fase.orden}</span> · {fase.titulo}
                  </span>
                  <span className={`inspector-fase-estado estado-${fase.estado}`}>
                    {ETIQUETA_FASE[fase.estado] ?? fase.estado}
                  </span>
                </span>
                {fase.archivos && fase.archivos.length > 0 && (
                  <ul className="inspector-archivos">
                    {fase.archivos.map((archivo) => (
                      <li key={archivo.ruta}>
                        <span className={`archivo-estado estado-${archivo.estado}`}>
                          {archivo.estado}
                        </span>
                        <code title={archivo.desde ? `${archivo.desde} → ${archivo.ruta}` : archivo.ruta}>
                          {archivo.desde ? `${archivo.desde} → ${archivo.ruta}` : archivo.ruta}
                        </code>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="pane-rotulo">Dependencias</p>
      {deps.length === 0 ? (
        <p className="hint">No espera a ningún ítem.</p>
      ) : (
        <ul className="inspector-lista">
          {deps.map((dep) => {
            const otra = catalogo.find((candidata) => candidata.uid === dep);
            return (
              <li key={dep}>
                <button
                  type="button"
                  className="inspector-item"
                  disabled={!otra}
                  onClick={() => otra && onSeleccionar({ tipo: "item", uid: otra.uid })}
                >
                  <span className="inspector-item-titulo">{otra?.title ?? dep}</span>
                  <span className="inspector-item-estado">
                    {otra ? ETIQUETA_ESTADO[otra.status] ?? otra.status : "—"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <p className="pane-rotulo">Puertas</p>
      {falloPuertas ? (
        <p className="hint error">No se pudieron leer: {falloPuertas}</p>
      ) : puertas === null ? (
        <p className="hint">Leyendo…</p>
      ) : puertas.length === 0 ? (
        <p className="hint">Ninguna puerta activa.</p>
      ) : (
        <>
          <ul className="inspector-lista">
            {puertas.map((puerta) => (
              <li key={puerta.id} className="inspector-puerta">
                <span className="inspector-puerta-cabecera">
                  <code>{puerta.id}</code>
                  <span className="inspector-puerta-desde">
                    {puerta.desde === "repo" ? "repo" : "preset"}
                  </span>
                </span>
                <span className="inspector-puerta-motivo">{puerta.motivo}</span>
                {puerta.cierra && puerta.cierra.length > 0 && (
                  <span className="inspector-puerta-cierra">
                    cierra: {puerta.cierra.join(", ")}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {puertas.some(
            (puerta) => puerta.id === "item_fases" || puerta.id === "item_requisito",
          ) && (
            <p className="hint">
              Hay fases o requisitos cerrados: completarlos abre esas puertas.
            </p>
          )}
        </>
      )}

      {!enHistorial && (
        <>
          <p className="pane-rotulo">Acciones</p>
          <div className="inspector-acciones">
            <BotonesMover
              uid={item.uid}
              estado={item.status}
              fases={fases}
              puedeIr={acciones.puedeIr}
              exigeFases={acciones.exigeFases}
              exigeFasesListas={acciones.exigeFasesListas}
              exigeFasesCompletas={acciones.exigeFasesCompletas}
              // El traslado no avisa de su progreso aquí; el borrado lleva el
              // suyo dentro de `BotonEliminar`.
              trabajando={false}
              onMover={acciones.onMover}
              onDescartar={acciones.onEditar ? () => setDescartando(true) : undefined}
              className="btn ghost"
            />
            {acciones.onPideEditar && (
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  acciones.onPideEditar?.(item.uid, item.title, item.description)
                }
              >
                Editar datos…
              </button>
            )}
            <BotonEliminar
              uid={item.uid}
              estado={item.status}
              onBorrar={acciones.onBorrar}
              className="btn ghost"
            />
          </div>
        </>
      )}

      {descartando &&
        acciones.onEditar &&
        createPortal(
          <DescartaItem
            titulo={item.title}
            onDescartar={(motivo) =>
              acciones.onEditar?.(item.uid, {
                status: "rejected",
                rejected_description: motivo,
              }) ?? Promise.resolve()
            }
            onCerrar={() => setDescartando(false)}
          />,
          document.body,
        )}
    </div>
  );
}
