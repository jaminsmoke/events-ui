import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api, unwrap } from "../core/api";
import type { Puerta, WorkItem, WorkItemUpdate } from "../core/api";
import type { PuedeIr } from "../core/useProtocolos";
import { ACCIONES_ESTADO, motivoBloqueo } from "../mapa/acciones";
import { ETIQUETA_ESTADO, LANES, laneOf, sePuedeEliminar } from "../mapa/carriles";
import type { Status } from "../mapa/carriles";
import { ETIQUETA_FASE } from "../mapa/fase";
import { fechaCorta } from "../mapa/formato";
import type { Seleccion } from "../mapa/seleccion";
import { DescartaIdea } from "./DescartaIdea";

/** Las acciones de la idea, tal como las ofrece el mapa: la fila y el
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

/** La ficha de una idea en el Inspector: lo que la fila no enseña para no
 *  crecer —descripción, fases con sus archivos y dependencias— y las mismas
 *  acciones, con el bloqueo del protocolo a la vista. */
export function CuerpoItem({
  idea,
  repo,
  catalogo,
  acciones,
  onSeleccionar,
}: {
  idea: WorkItem;
  /** La raíz del repo: las puertas se evalúan contra su estado. */
  repo: string;
  /** Todas las ideas del repo: resuelve los títulos de las dependencias. */
  catalogo: readonly WorkItem[];
  acciones: AccionesItem;
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [puertas, setPuertas] = useState<Puerta[] | null>(null);
  const [falloPuertas, setFalloPuertas] = useState<string | null>(null);
  const fases = idea.fases ?? [];
  const deps = idea.depende_de ?? [];
  const hechas = fases.filter((fase) => fase.estado === "completada").length;
  const lane = laneOf(idea.status);
  const carril = lane ? LANES.find((l) => l.id === lane)?.title : "Entrada";
  // El historial es un archivo: ni se edita, ni se mueve, ni se borra.
  const enHistorial = idea.status === "historial";

  useEffect(() => {
    const controller = new AbortController();
    unwrap(api.GET("/puertas", { params: { query: { repo } }, signal: controller.signal }))
      .then((lista) => {
        if (!controller.signal.aborted) setPuertas(lista);
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setFalloPuertas(err instanceof Error ? err.message : String(err));
        }
      });
    return () => controller.abort();
  }, [repo]);

  const hacer = (fn: () => Promise<void>, alOk?: () => void) => {
    setTrabajando(true);
    setFallo(null);
    fn()
      .then(() => alOk?.())
      .catch((err: unknown) => setFallo(err instanceof Error ? err.message : String(err)))
      .finally(() => setTrabajando(false));
  };

  const movimientos = (ACCIONES_ESTADO[idea.status] ?? []).filter(
    (accion) => !acciones.puedeIr || acciones.puedeIr(idea.status, accion.estado),
  );

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">{idea.title}</p>
      <p className="inspector-meta">
        {ETIQUETA_ESTADO[idea.status] ?? idea.status} · {carril}
      </p>
      <p className="inspector-descripcion">{idea.description || "Sin descripción"}</p>

      {idea.rejected_at && (
        <p className="fila-rechazo">
          Rechazada el {fechaCorta(idea.rejected_at)}
          {idea.rejected_description ? ` — ${idea.rejected_description}` : ""}
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
            {movimientos.map((accion) => {
              const bloqueo = motivoBloqueo(idea.status, fases, accion.estado, {
                exigeFases: acciones.exigeFases,
                exigeFasesListas: acciones.exigeFasesListas,
                exigeFasesCompletas: acciones.exigeFasesCompletas,
              });
              return (
                <button
                  key={accion.estado}
                  type="button"
                  className="btn ghost"
                  title={bloqueo ?? accion.etiqueta}
                  disabled={trabajando || bloqueo !== null}
                  onClick={() => {
                    // Descartar pide el motivo, como en la fila.
                    if (accion.descartar && acciones.onEditar) setDescartando(true);
                    else acciones.onMover?.(idea.uid, accion.estado);
                  }}
                >
                  {accion.etiqueta}
                </button>
              );
            })}
            {acciones.onPideEditar && (
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  acciones.onPideEditar?.(idea.uid, idea.title, idea.description)
                }
              >
                Editar datos…
              </button>
            )}
            {acciones.onBorrar && sePuedeEliminar(idea.status) && !confirmando && (
              <button
                type="button"
                className="btn ghost"
                title="Pasa por Eliminadas y se quema; no se guarda"
                onClick={() => setConfirmando(true)}
              >
                Eliminar
              </button>
            )}
            {acciones.onBorrar && sePuedeEliminar(idea.status) && confirmando && (
              <span className="fila-acciones">
                ¿Eliminar del todo?
                <button
                  className="btn ghost"
                  type="button"
                  disabled={trabajando}
                  onClick={() => hacer(() => acciones.onBorrar?.(idea.uid) ?? Promise.resolve())}
                >
                  Sí
                </button>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setConfirmando(false)}
                >
                  No
                </button>
              </span>
            )}
          </div>
        </>
      )}

      {fallo && <p className="hint error">{fallo}</p>}

      {descartando &&
        acciones.onEditar &&
        createPortal(
          <DescartaIdea
            titulo={idea.title}
            onDescartar={(motivo) =>
              acciones.onEditar?.(idea.uid, {
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
