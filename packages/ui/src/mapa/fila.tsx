/** La fila de una idea: cabecera, detalle, traslados y ficha. */

import { useState } from "react";
import { createPortal } from "react-dom";

import type { Idea, IdeaUpdate } from "../core/api";
import type { PuedeIr } from "../core/useProtocolos";
import { DescartaIdea } from "../pantalla/DescartaIdea";
import type { TreeNode } from "./arbol";
import { ETIQUETA_ESTADO } from "./carriles";
import type { Status } from "./carriles";
import { FasesIdea } from "./fases";
import { comoFases, type Fase } from "./fase";
import { FichaFases } from "./ficha-fases";
import { fechaCorta } from "./formato";
import { mismoElemento } from "./seleccion";
import type { Seleccion } from "./seleccion";

/** Flecha de plegado. Vacía si el nodo no tiene items. */
export function Arrow({ open }: { open: boolean }) {
  return <span className="arrow">{open ? "▾" : "▸"}</span>;
}

/** Acciones de traslado que ofrece cada estado. `descartar` abre el diálogo
 *  del motivo en vez de mover directamente. */
const ACCIONES_ESTADO: Record<
  Status,
  { estado: Status; etiqueta: string; descartar?: boolean }[]
> = {
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

/** ¿La ficha se abre sola en este estado? `undefined` deja decidir a la rama:
 *  un nodo con hijos sigue abierto para que se vea el nivel siguiente. */
function seAbreSola(estado: Status | undefined): boolean | undefined {
  if (estado === "roadmap" || estado === "verificacion") return true;
  if (
    estado === "draft" ||
    estado === "proposed" ||
    estado === "historial" ||
    estado === "rejected" ||
    estado === "superseded"
  ) {
    return false;
  }
  return undefined;
}

/** Una fila del nodo: solo título, contador y su botón de expandir.
 *  Al expandirla aparece un panel con los detalles (descripción, estado) y
 *  los botones de la idea —mover, completar, editar, borrar—, más sus hijos,
 *  si los tiene. Las conexiones no se gestionan aquí: son de la arquitectura
 *  (inmutables) y la fila solo las pinta. Los botones nunca se ven
 *  en la fila cerrada. */
export function NodeRow({
  node,
  nodo,
  volando,
  onMover,
  onPideEditar,
  onEditar,
  onBorrar,
  onCargarIdea,
  puedeIr,
  exigeFases,
  exigeFasesListas,
  exigeFasesCompletas,
  catalogo = [],
  seleccion,
  onSeleccionar,
}: {
  node: TreeNode;
  nodo: string;
  volando: (uid: string, nodo: string) => boolean;
  onMover?: (uid: string, status: Status) => void;
  /** Pedir edición: monta el editor en la raíz (App), no aquí —las filas
   *  van portaleadas y los clics del ratón en el portal no llegaban. */
  onPideEditar?: (uid: string, titulo: string, descripcion: string) => void;
  onEditar?: (uid: string, cambios: IdeaUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  /** La idea completa, para el parche de los archivos de cada fase: el mapa
   *  solo trae ruta y estado. */
  onCargarIdea?: (uid: string) => Promise<Idea | null>;
  /** Los protocolos de flujo (`GET /protocolos`): si está, la fila no ofrece
   *  un traslado que el core rechazaría (las descartadas no vuelven a cola,
   *  p. ej.). Sin él se ofrece todo y el core manda. */
  puedeIr?: PuedeIr;
  /** ¿Pide el protocolo fases para esa unión? (0021). Sin él no se apaga
   *  ningún botón: el core manda. */
  exigeFases?: PuedeIr;
  /** ¿Exige el protocolo que no queden fases abiertas al cruzar? (0022). */
  exigeFasesListas?: PuedeIr;
  /** ¿Exige el protocolo que todas estén completadas? (0023). */
  exigeFasesCompletas?: PuedeIr;
  /** Todas las ideas del repo: resuelve títulos de las dependencias y
   *  ofrece las que aún no lo son. */
  catalogo?: readonly Idea[];
  /** Lo seleccionado en el lienzo y cómo cambiarlo: la fila marca su idea. */
  seleccion?: Seleccion | null;
  onSeleccionar?: (seleccion: Seleccion) => void;
}) {
  const tiene = node.kids.length > 0;
  const uid = node.idea?.uid;
  const estado = node.idea?.status;
  // Una sola expansión por fila: detalles, botones e hijos. Al llegar a
  // roadmap o verificación la ficha se abre sola; en entrada, cola y
  // descartadas se queda plegada. Al cambiar de carril la fila se vuelve a
  // montar, así que este estado inicial ya fija lo que toca en el carril
  // nuevo; en el resto de casos manda la rama (con hijos, abierta).
  const [expandido, setExpandido] = useState(() => seAbreSola(estado) ?? tiene);
  const descripcion = node.idea?.description ?? "";
  const deps = node.idea?.depende_de ?? [];
  const fases = node.idea?.fases ?? [];
  // Copia optimista compartida por la fila y la ficha: el mapa tarda en
  // refrescar y dos cambios seguidos no pueden reenviar la lista vieja (el
  // PATCH la reemplaza entera). Vale solo mientras la prop sea la misma;
  // cuando el mapa trae otra lista, manda el mapa.
  const [optimista, setOptimista] = useState<{
    base: readonly Fase[];
    fases: readonly Fase[];
  } | null>(null);
  const vistaFases = optimista?.base === fases ? optimista.fases : fases;
  const guardarFases = (siguientes: readonly Fase[]) => {
    if (!onEditar || !uid) return Promise.resolve();
    setOptimista({ base: fases, fases: siguientes });
    return onEditar(uid, { fases: comoFases(siguientes) }).catch((err: unknown) => {
      setOptimista(null);
      throw err;
    });
  };
  // Candidatas a dependencia: ni ella misma ni las que ya espera.
  const candidatas = catalogo.filter((otra) => otra.uid !== uid && !deps.includes(otra.uid));
  const hechas = fases.filter((fase) => fase.estado === "completada").length;
  const abiertas = fases.filter(
    (fase) => fase.estado === "pendiente" || fase.estado === "fallida",
  ).length;

  // Motivo por el que un traslado no se ofrece, o `null` si se puede probar.
  const motivoBloqueo = (destino: Status): string | null => {
    if (!estado) return null;
    if (fases.length === 0 && exigeFases?.(estado, destino)) {
      return "El protocolo exige al menos una fase";
    }
    if (
      destino === "verificacion" &&
      abiertas > 0 &&
      exigeFasesListas?.(estado, "verificacion")
    ) {
      return `Cierra las fases pendientes o fallidas (${abiertas})`;
    }
    if (
      destino === "revision_aprobada" &&
      !fases.every((fase) => fase.estado === "completada") &&
      exigeFasesCompletas?.(estado, "revision_aprobada")
    ) {
      return "Completa todas las fases para aprobar la revisión";
    }
    return null;
  };
  const [descartando, setDescartando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [fichaFases, setFichaFases] = useState(false);
  // La ficha nace de lectura: Editar enseña los campos y Listo los retira.
  const [editando, setEditando] = useState(false);
  const soloLectura = !editando;
  // El historial es un archivo: ni se edita, ni se mueve, ni se borra.
  const enHistorial = estado === "historial";

  const hacer = (fn: () => Promise<void>, alOk?: () => void) => {
    setTrabajando(true);
    setFallo(null);
    fn()
      .then(() => alOk?.())
      .catch((err: unknown) => setFallo(err instanceof Error ? err.message : String(err)))
      .finally(() => setTrabajando(false));
  };

  return (
    <div
      className={`row${node.tone ? ` lane-${node.tone}` : ""}${
        uid && volando(uid, nodo) ? " volando" : ""
      }${uid && mismoElemento(seleccion, { tipo: "idea", uid }) ? " seleccionada" : ""}`}
      data-uid={uid}
      data-nodo={nodo}
    >
      <button
        type="button"
        className="row-head"
        onClick={() => {
          setEditando(false);
          setExpandido((v) => !v);
          if (uid) onSeleccionar?.({ tipo: "idea", uid });
        }}
        aria-expanded={expandido}
        aria-label={expandido && node.idea ? node.title : undefined}
      >
        {node.idea && <span className="dot" />}
        {/* Abierta, el título encabeza la ficha; la barra solo lleva los
         * contadores y la flecha, con el hueco para alinearlos a la derecha. */}
        <span className="row-title">{expandido ? "" : node.title}</span>
        {node.total > 0 && <span className="count">{node.total}</span>}
        {fases.length > 0 && (
          <span className="count fases-count" title="fases completadas">
            {hechas}/{fases.length}
          </span>
        )}
        <Arrow open={expandido} />
      </button>
      {expandido && node.idea && (
        <div className="fila-detalle">
          <div className="fila-cabecera">
            <div className="fila-texto">
              <p className="fila-titulo">{node.title}</p>
              <p className="fila-descripcion">{node.idea.description || "Sin descripción"}</p>
            </div>
            <div className="fila-meta">
              <span className="fila-estado">
                {ETIQUETA_ESTADO[node.idea.status] ?? node.idea.status}
              </span>
              {node.idea.rejected_at && (
                <span className="fila-rechazo">
                  Rechazada el {fechaCorta(node.idea.rejected_at)}
                  {node.idea.rejected_description ? ` — ${node.idea.rejected_description}` : ""}
                </span>
              )}
            </div>
          </div>
      {(deps.length > 0 ||
        (!enHistorial && !soloLectura && onEditar && candidatas.length > 0)) && (
        <div className="fila-bloque">
          <span className="fila-rotulo">Dependencias</span>
          {deps.length > 0 && (
            <p className="fila-depende">
              Espera a:{" "}
              {deps.map((dep) => {
                const otra = catalogo.find((i) => i.uid === dep);
                // Archivar no rompe la dependencia: historial sigue aprobada.
                const aprobada =
                  otra?.status === "revision_aprobada" || otra?.status === "historial";
                return (
                  <span key={dep} className={`chip-depende${aprobada ? " aprobada" : ""}`}>
                    {otra?.title ?? dep}
                    {onEditar && !soloLectura && !enHistorial && (
                      <button
                        type="button"
                        className="chip-quitar"
                        title="Quitar dependencia"
                        onClick={() =>
                          hacer(() =>
                            onEditar(uid!, {
                              depende_de: deps.filter((otro) => otro !== dep),
                            }),
                          )
                        }
                      >
                        ×
                      </button>
                    )}
                  </span>
                );
              })}
            </p>
          )}
          {onEditar && !soloLectura && !enHistorial && candidatas.length > 0 && (
            <select
              className="select-depende"
              value=""
              disabled={trabajando}
              aria-label="Añadir dependencia"
              onChange={(e) => {
                const dep = e.target.value;
                if (!dep) return;
                hacer(() => onEditar(uid!, { depende_de: [...deps, dep] }));
              }}
            >
              <option value="">Añadir dependencia…</option>
              {candidatas.map((otra) => (
                <option key={otra.uid} value={otra.uid}>
                  {otra.title}
                </option>
              ))}
            </select>
          )}
        </div>
      )}
      {onEditar && estado && estado !== "rejected" && estado !== "superseded" && (
        <div className="fila-bloque">
          <FasesIdea
            fases={vistaFases}
            estado={estado}
            alGuardar={guardarFases}
            soloLectura={soloLectura || enHistorial}
          />
          {estado === "proposed" && fases.length === 0 && exigeFases?.(estado, "roadmap") && (
            <p className="fila-aviso">
              {soloLectura
                ? "Pulsa Editar para añadir una fase."
                : "Añade una fase para pasar a roadmap."}
            </p>
          )}
          {(estado === "draft" || estado === "proposed") && fases.length > 0 && (
            <p className="fila-aviso">Las fases se abren en roadmap.</p>
          )}
          {estado === "roadmap" && abiertas > 0 && exigeFasesListas?.(estado, "verificacion") && (
            <p className="fila-aviso">
              {soloLectura
                ? "Pulsa Editar para cerrar las fases abiertas."
                : "Cierra las fases abiertas."}
            </p>
          )}
          {estado === "verificacion" &&
            fases.length === 0 &&
            exigeFases?.(estado, "revision_aprobada") && (
              <p className="fila-aviso">
                {soloLectura
                  ? "Pulsa Editar para añadir una fase."
                  : "Añade una fase para aprobar."}
              </p>
            )}
          {estado === "verificacion" &&
            !fases.every((fase) => fase.estado === "completada") &&
            exigeFasesCompletas?.(estado, "revision_aprobada") && (
              <p className="fila-aviso">
                {soloLectura
                  ? "Pulsa Editar para completar las fases."
                  : "Completa las fases para aprobar."}
              </p>
            )}
        </div>
      )}
      <div className="fila-pie">
        <div className="fila-mover">
          {estado &&
            onMover &&
            ACCIONES_ESTADO[estado]
              .filter((accion) => !puedeIr || puedeIr(estado, accion.estado))
              .map((accion) => {
                const bloqueo = motivoBloqueo(accion.estado);
                return (
                  <button
                    key={accion.estado}
                    type="button"
                    className="btn ghost mover"
                    title={bloqueo ?? accion.etiqueta}
                    disabled={trabajando || bloqueo !== null}
                    onClick={() => {
                      // Descartar pide el motivo (detalle `rejected_node`); los
                      // demás traslados van directos.
                      if (accion.descartar && onEditar) setDescartando(true);
                      else onMover(uid!, accion.estado);
                    }}
                  >
                    {accion.etiqueta}
                  </button>
                );
              })}
        </div>
        <div className="fila-secundaria">
          {onEditar && !enHistorial && (
            <button
              type="button"
              className="btn ghost mover"
              aria-pressed={editando}
              title={
                editando
                  ? "Volver a la ficha de lectura"
                  : "Editar los datos, las fases y las dependencias"
              }
              onClick={() => setEditando((v) => !v)}
            >
              {editando ? "Listo" : "Editar"}
            </button>
          )}
          {onPideEditar && editando && !enHistorial && (
            <button
              type="button"
              className="btn ghost mover"
              onClick={() => onPideEditar(uid!, node.title, descripcion)}
            >
              Datos…
            </button>
          )}
          {fases.length > 0 && (
            <button type="button" className="btn ghost mover" onClick={() => setFichaFases(true)}>
              Fases · {hechas}/{fases.length}
            </button>
          )}
          {onBorrar && !enHistorial && !confirmando && (
            <button type="button" className="btn ghost mover" onClick={() => setConfirmando(true)}>
              Borrar
            </button>
          )}
          {onBorrar && !enHistorial && confirmando && (
            <span className="fila-acciones">
              ¿Borrar?
              <button
                className="btn ghost mover"
                type="button"
                disabled={trabajando}
                onClick={() => hacer(() => onBorrar(uid!))}
              >
                Sí
              </button>
              <button
                className="btn ghost mover"
                type="button"
                onClick={() => setConfirmando(false)}
              >
                No
              </button>
            </span>
          )}
        </div>
      </div>

      {node.idea && descartando && onEditar &&
        createPortal(
          <DescartaIdea
            titulo={node.title}
            onDescartar={(motivo) =>
              onEditar(uid!, { status: "rejected", rejected_description: motivo })
            }
            onCerrar={() => setDescartando(false)}
          />,
          document.body,
        )}


      {node.idea && fichaFases && (
        <FichaFases
          uid={uid}
          estado={node.idea.status}
          titulo={node.title}
          fases={vistaFases}
          alGuardar={onEditar && editando && !enHistorial ? guardarFases : undefined}
          cargarIdea={onCargarIdea}
          onCerrar={() => setFichaFases(false)}
        />
      )}
      {fallo && <span className="hint error fila-fallo">{fallo}</span>}
        </div>
      )}

      {expandido && tiene && (
        <div className="row-kids">
          {node.kids.map((kid) => (
            <NodeRow
              key={kid.key}
              node={kid}
              nodo={nodo}
              volando={volando}
              onMover={onMover}
              onPideEditar={onPideEditar}
              onEditar={onEditar}
              onBorrar={onBorrar}
              onCargarIdea={onCargarIdea}
              puedeIr={puedeIr}
              exigeFases={exigeFases}
              exigeFasesListas={exigeFasesListas}
              exigeFasesCompletas={exigeFasesCompletas}
              catalogo={catalogo}
              seleccion={seleccion}
              onSeleccionar={onSeleccionar}
            />
          ))}
        </div>
      )}
    </div>
  );
}
