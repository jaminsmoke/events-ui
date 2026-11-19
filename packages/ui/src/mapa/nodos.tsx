import { useLayoutEffect, useState } from "react";
import type { Ref } from "react";
import { createPortal } from "react-dom";

import type { Idea, IdeaUpdate } from "../core/api";
import type { PuedeIr } from "../core/useProtocolos";
import { DescartaIdea } from "../pantalla/DescartaIdea";
import type { TreeNode } from "./arbol";
import type { Status } from "./carriles";
import type { TonoPulso } from "./animaciones";
import type { Vuelo } from "./vuelos";

/** Flecha de plegado. Vacía si el nodo no tiene items. */
function Arrow({ open }: { open: boolean }) {
  return <span className="arrow">{open ? "▾" : "▸"}</span>;
}

/** Palabra del estado para la fila, en español: el contrato habla `draft`/
 *  `proposed` pero la fila se lee en español. Los nombres son los mismos
 *  carriles: `draft` es la entrada (no tiene fila en ninguna ficha),
 *  `proposed` vive en la cola, y los demás, en su detalle del nodo. */
const ETIQUETA_ESTADO: Record<string, string> = {
  draft: "En la entrada",
  proposed: "En cola",
  roadmap: "En roadmap",
  verificacion: "En verificación",
  revision_aprobada: "Revisión aprobada",
  historial: "En historial",
  rejected: "Descartada",
  superseded: "Reemplazada",
};

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

/** Fecha corta del sistema: el ISO crudo (`…T07:15:01+00:00`) no se lee. */
function fechaCorta(iso: string): string {
  const f = new Date(iso);
  return Number.isNaN(f.getTime())
    ? iso
    : f.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Estados de una fase (`idea_fase`, 0021). */
const ESTADOS_FASE = ["pendiente", "completada", "fallida", "rechazada"] as const;
type Fase = NonNullable<Idea["fases"]>[number];

/** Las fases en el formato del PATCH: sin `entered_at` (lo pone el core) ni
 *  `done_at` (lo pone al marcar). Lo comparten la fila y la ficha. */
function comoFases(fases: readonly Fase[]): NonNullable<IdeaUpdate["fases"]> {
  return fases.map(({ orden, titulo, estado, nota, requisitos }) => ({
    orden,
    titulo,
    estado,
    nota,
    requisitos: (requisitos ?? []).map(({ orden: suOrden, titulo: suTitulo, hecho }) => ({
      orden: suOrden,
      titulo: suTitulo,
      hecho,
    })),
  }));
}

/** Las fases de una idea: lista corta con su estado, sin salir de la fila.
 *  Cada cambio reenvía la lista entera: el PATCH la reemplaza en una
 *  transacción, así que marcar una casilla no pisa el carril. */
function FasesIdea({
  fases,
  estado,
  alGuardar,
  soloLectura,
}: {
  fases: readonly Fase[];
  /** El carril de la idea: el estado de una fase solo se toca en roadmap. */
  estado: Status;
  /** La copia optimista vive en la fila: así la ficha y la fila no se pisan. */
  alGuardar: (siguientes: readonly Fase[]) => Promise<void>;
  /** En solo lectura no se pintan campos: los controles llegan con Editar. */
  soloLectura: boolean;
}) {
  const [nuevo, setNuevo] = useState("");
  const [primerRequisito, setPrimerRequisito] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  // Al fallar sin motivo no se guarda: se pide aquí y se manda con el estado.
  const [motivoPendiente, setMotivoPendiente] = useState<number | null>(null);
  const [motivoNuevo, setMotivoNuevo] = useState("");
  // En roadmap y verificación los requisitos se abren solos, que es donde se
  // trabajan; en entrada, cola y descartadas se quedan plegados. El clic deja
  // una excepción por fase (abrir en cola, cerrar en roadmap) que dura hasta
  // que la fila cambie de carril y se vuelva a montar.
  const autoRequisitos = estado === "roadmap" || estado === "verificacion";
  const [excepciones, setExcepciones] = useState<ReadonlyMap<number, boolean>>(
    () => new Map(),
  );
  const [requisitoNuevo, setRequisitoNuevo] = useState("");
  const vista = fases;

  const guardar = (siguientes: readonly Fase[]) => {
    setGuardando(true);
    setFallo(null);
    alGuardar(siguientes)
      .catch((err: unknown) => {
        setFallo(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setGuardando(false));
  };

  const anadir = (e: React.FormEvent) => {
    e.preventDefault();
    const titulo = nuevo.trim();
    const primer = primerRequisito.trim();
    if (!titulo || !primer) return;
    const orden = Math.max(0, ...vista.map((fase) => fase.orden)) + 1;
    guardar([
      ...vista,
      {
        orden,
        titulo,
        estado: "pendiente",
        nota: "",
        entered_at: "",
        requisitos: [{ orden: 1, titulo: primer, hecho: false, done_at: null }],
      },
    ]);
    setNuevo("");
    setPrimerRequisito("");
  };

  return (
    <div className="fases">
      <p className="fases-cabecera">
        Fases {vista.filter((fase) => fase.estado === "completada").length}/{vista.length}
      </p>
      {vista.map((fase) => {
        const requisitos = fase.requisitos ?? [];
        const hechosReq = requisitos.filter((requisito) => requisito.hecho).length;
        const pendientesReq = requisitos.length - hechosReq;
        const abiertos = excepciones.get(fase.orden) ?? autoRequisitos;
        return (
        <div className="fase-grupo" key={fase.orden}>
        <div className="fase">
          <div className="fase-texto">
            <span className="fase-titulo">
              <span className="fase-indice">Fase {fase.orden}</span>
              {" · "}
              {fase.titulo}
            </span>
            <button
              type="button"
              className="fase-check"
              title={`Requisitos: ${hechosReq} de ${requisitos.length}`}
              aria-label={`Requisitos de ${fase.titulo}: ${hechosReq} de ${requisitos.length}`}
              aria-expanded={abiertos}
              onClick={() => {
                const siguiente = new Map(excepciones);
                siguiente.set(fase.orden, !abiertos);
                setExcepciones(siguiente);
                setRequisitoNuevo("");
              }}
            >
              {hechosReq}/{requisitos.length}{" "}
              {requisitos.length === 1 ? "requisito" : "requisitos"}
            </button>
            {!soloLectura && motivoPendiente === fase.orden ? (
              <form
                className="fase-motivo-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const nota = motivoNuevo.trim();
                  if (!nota) return;
                  guardar(
                    vista.map((otra) =>
                      otra.orden === fase.orden
                        ? { ...otra, estado: "fallida", nota }
                        : otra,
                    ),
                  );
                  setMotivoPendiente(null);
                  setMotivoNuevo("");
                }}
              >
                <input
                  autoFocus
                  className="fase-motivo"
                  value={motivoNuevo}
                  onChange={(e) => setMotivoNuevo(e.target.value)}
                  placeholder="Motivo del fallo…"
                  aria-label={`Motivo del fallo de ${fase.titulo}`}
                  disabled={guardando}
                />
                <div className="fase-motivo-acciones">
                  <button
                    className="btn ghost"
                    type="submit"
                    disabled={guardando || !motivoNuevo.trim()}
                  >
                    Fallar
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={guardando}
                    onClick={() => setMotivoPendiente(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : !soloLectura && estado === "roadmap" && (fase.estado === "fallida" || fase.estado === "rechazada") ? (
              <input
                key={fase.nota}
                className="fase-motivo"
                defaultValue={fase.nota}
                placeholder="Motivo…"
                aria-label={`Motivo de ${fase.titulo}`}
                disabled={guardando}
                onBlur={(e) => {
                  const nota = e.target.value.trim();
                  if (nota === fase.nota) return;
                  guardar(
                    vista.map((otra) =>
                      otra.orden === fase.orden ? { ...otra, nota } : otra,
                    ),
                  );
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            ) : (
              fase.nota && <span className="fase-nota">Motivo: {fase.nota}</span>
            )}
          </div>
          {estado === "roadmap" && !soloLectura ? (
            <select
              className="fase-estado"
              value={fase.estado}
              disabled={guardando}
              aria-label={`Estado de ${fase.titulo}`}
              title={
                pendientesReq > 0
                  ? `Cierra ${pendientesReq} requisito(s) para completar`
                  : undefined
              }
              onChange={(e) => {
                const siguiente = e.target.value as Fase["estado"];
                if (siguiente === "fallida" && !fase.nota.trim()) {
                  setMotivoPendiente(fase.orden);
                  setMotivoNuevo("");
                  return;
                }
                guardar(
                  vista.map((otra) =>
                    otra.orden === fase.orden ? { ...otra, estado: siguiente } : otra,
                  ),
                );
              }}
            >
              {ESTADOS_FASE.map((otro) => (
                <option
                  key={otro}
                  value={otro}
                  disabled={otro === "completada" && pendientesReq > 0}
                >
                  {otro}
                </option>
              ))}
            </select>
          ) : (
            <span
              className="fase-estado-texto"
              title={
                soloLectura
                  ? "Pulsa Editar para cambiar el estado"
                  : "El estado de la fase se lleva en roadmap"
              }
            >
              {ETIQUETA_FASE[fase.estado] ?? fase.estado}
            </span>
          )}
          <button
            type="button"
            className="chip-quitar"
            title="Quitar fase"
            hidden={soloLectura}
            disabled={guardando}
            onClick={() => guardar(vista.filter((otra) => otra.orden !== fase.orden))}
          >
            ×
          </button>
        </div>
        {abiertos && (
          <div className="fase-requisitos">
            {requisitos.map((requisito) => (
              <label
                key={requisito.orden}
                className={`requisito${requisito.hecho ? " hecho" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={requisito.hecho}
                  disabled={guardando || estado !== "roadmap" || soloLectura}
                  aria-label={`Requisito ${requisito.titulo}`}
                  onChange={() =>
                    guardar(
                      vista.map((otra) =>
                        otra.orden === fase.orden
                          ? {
                              ...otra,
                              requisitos: (otra.requisitos ?? []).map((cada) =>
                                cada.orden === requisito.orden
                                  ? { ...cada, hecho: !cada.hecho }
                                  : cada,
                              ),
                            }
                          : otra,
                      ),
                    )
                  }
                />
                <span className="requisito-titulo">{requisito.titulo}</span>
                <button
                  type="button"
                  className="chip-quitar"
                  title={
                    requisitos.length === 1
                      ? "Una fase necesita al menos un requisito"
                      : "Quitar requisito"
                  }
                  hidden={soloLectura}
                  disabled={guardando || requisitos.length === 1}
                  onClick={(e) => {
                    e.preventDefault();
                    guardar(
                      vista.map((otra) =>
                        otra.orden === fase.orden
                          ? {
                              ...otra,
                              requisitos: (otra.requisitos ?? []).filter(
                                (cada) => cada.orden !== requisito.orden,
                              ),
                            }
                          : otra,
                      ),
                    );
                  }}
                >
                  ×
                </button>
              </label>
            ))}
            <form
              className="requisito-nuevo"
              hidden={soloLectura}
              onSubmit={(e) => {
                e.preventDefault();
                const titulo = requisitoNuevo.trim();
                if (!titulo) return;
                const orden = Math.max(0, ...requisitos.map((cada) => cada.orden)) + 1;
                guardar(
                  vista.map((otra) =>
                    otra.orden === fase.orden
                      ? {
                          ...otra,
                          requisitos: [
                            ...(otra.requisitos ?? []),
                            { orden, titulo, hecho: false, done_at: null },
                          ],
                        }
                      : otra,
                  ),
                );
                setRequisitoNuevo("");
              }}
            >
              <input
                value={requisitoNuevo}
                onChange={(e) => setRequisitoNuevo(e.target.value)}
                placeholder="Nuevo requisito…"
                aria-label={`Nuevo requisito de ${fase.titulo}`}
                disabled={guardando}
              />
              <button className="btn ghost" type="submit" disabled={guardando}>
                +
              </button>
            </form>
          </div>
        )}
        </div>
        );
      })}
      <form className="fase-nueva" hidden={soloLectura} onSubmit={anadir}>
        <input
          className="fase-nueva-titulo"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Nueva fase…"
          aria-label="Nueva fase"
        />
        <input
          className="fase-nueva-requisito"
          value={primerRequisito}
          onChange={(e) => setPrimerRequisito(e.target.value)}
          placeholder="Primer requisito…"
          aria-label="Primer requisito"
        />
        <button
          className="btn ghost"
          type="submit"
          disabled={guardando || !nuevo.trim() || !primerRequisito.trim()}
        >
          Añadir
        </button>
      </form>
      {fallo && <span className="hint error">{fallo}</span>}
    </div>
  );
}

/** Nombre de cada estado de fase para la ficha, en español. */
const ETIQUETA_FASE: Record<string, string> = {
  pendiente: "Pendiente",
  completada: "Completada",
  fallida: "Fallida",
  rechazada: "Rechazada",
};

/** La ficha de fases: el detalle completo (estado, nota y fecha), que la
 *  fila no enseña para no crecer. Solo lectura: editar es cosa de la fila. */
function FichaFases({
  estado,
  titulo,
  fases,
  alGuardar,
  onCerrar,
}: {
  /** El carril de la idea: el motivo se toca en roadmap, como en la fila. */
  estado: Status;
  titulo: string;
  fases: readonly Fase[];
  /** La copia optimista vive en la fila; sin él, la ficha es de lectura. */
  alGuardar?: (siguientes: readonly Fase[]) => Promise<void>;
  onCerrar: () => void;
}) {
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const vista = fases;
  const hechas = vista.filter((fase) => fase.estado === "completada").length;

  const guardar = (siguientes: readonly Fase[]) => {
    if (!alGuardar) return;
    setGuardando(true);
    setFallo(null);
    alGuardar(siguientes)
      .catch((err: unknown) => {
        setFallo(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setGuardando(false));
  };
  return createPortal(
    <div
      className="modal-fondo"
      role="presentation"
      // El tablero captura el puntero al arrastrar: sin cortarlo aquí, el
      // `mouseup` se va al mapa y el botón Cerrar no recibe el clic.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onCerrar}
    >
      <div
        className="modal"
        role="dialog"
        aria-label="Fases de la idea"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      >
        <h2>Fases de «{titulo}»</h2>
        <p className="hint">
          {hechas} de {vista.length} completadas
        </p>
        <ol className="ficha-fases">
          {vista.map((fase) => {
            const requisitos = fase.requisitos ?? [];
            const hechosReq = requisitos.filter((requisito) => requisito.hecho).length;
            return (
            <li key={fase.orden} className={`ficha-fase estado-${fase.estado}`}>
              <span className="ficha-fase-titulo">
                <span className="fase-indice">Fase {fase.orden}</span>
                {" · "}
                {fase.titulo}
              </span>
              {/* Mismo resumen que la fila; aquí la checklist ya está a la vista. */}
              <span className="fase-check">
                {hechosReq}/{requisitos.length}{" "}
                {requisitos.length === 1 ? "requisito" : "requisitos"}
              </span>
              <span className="fila-estado">{ETIQUETA_FASE[fase.estado] ?? fase.estado}</span>
              {alGuardar &&
              estado === "roadmap" &&
              (fase.estado === "fallida" || fase.estado === "rechazada") ? (
                <input
                  key={fase.nota}
                  className="ficha-fase-motivo"
                  defaultValue={fase.nota}
                  placeholder="Motivo…"
                  aria-label={`Motivo de ${fase.titulo}`}
                  disabled={guardando}
                  onBlur={(e) => {
                    const nota = e.target.value.trim();
                    if (nota === fase.nota) return;
                    guardar(
                      vista.map((otra) =>
                        otra.orden === fase.orden ? { ...otra, nota } : otra,
                      ),
                    );
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                />
              ) : (
                fase.nota && <p className="ficha-fase-nota">Motivo: {fase.nota}</p>
              )}
              {fase.requisitos && fase.requisitos.length > 0 && (
                <ul className="ficha-requisitos">
                  {fase.requisitos.map((requisito) => (
                    <li
                      key={requisito.orden}
                      className={`ficha-requisito${requisito.hecho ? " hecho" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={requisito.hecho}
                        disabled={guardando || estado !== "roadmap" || !alGuardar}
                        aria-label={`Requisito ${requisito.titulo}`}
                        onChange={() =>
                          guardar(
                            vista.map((otra) =>
                              otra.orden === fase.orden
                                ? {
                                    ...otra,
                                    requisitos: (otra.requisitos ?? []).map((cada) =>
                                      cada.orden === requisito.orden
                                        ? { ...cada, hecho: !cada.hecho }
                                        : cada,
                                    ),
                                  }
                                : otra,
                            ),
                          )
                        }
                      />
                      <span className="ficha-requisito-titulo">{requisito.titulo}</span>
                      {requisito.done_at && (
                        <time dateTime={requisito.done_at}>{fechaCorta(requisito.done_at)}</time>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              <time className="ficha-fase-fecha" dateTime={fase.entered_at}>
                {fechaCorta(fase.entered_at)}
              </time>
            </li>
            );
          })}
        </ol>
        {fallo && <p className="hint error">{fallo}</p>}
        <div className="modal-acciones">
          <button className="btn" type="button" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

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
function NodeRow({
  node,
  nodo,
  volando,
  onMover,
  onPideEditar,
  onEditar,
  onBorrar,
  puedeIr,
  exigeFases,
  exigeFasesListas,
  exigeFasesCompletas,
  catalogo = [],
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
      }`}
      data-uid={uid}
      data-nodo={nodo}
    >
      <button
        type="button"
        className="row-head"
        onClick={() => {
          setEditando(false);
          setExpandido((v) => !v);
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
          estado={node.idea.status}
          titulo={node.title}
          fases={vistaFases}
          alGuardar={onEditar && editando && !enHistorial ? guardarFases : undefined}
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
              puedeIr={puedeIr}
              exigeFases={exigeFases}
              exigeFasesListas={exigeFasesListas}
              exigeFasesCompletas={exigeFasesCompletas}
              catalogo={catalogo}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** El primer nodo de la rama inferior: los cambios que aún no tienen commit.
 *  No es un carril de ideas; solo enseña lo que Git ve en el árbol de trabajo. */
export function NodoCambios({
  activo,
  cambios,
}: {
  activo: boolean;
  cambios: readonly { estado: string; ruta: string }[];
}) {
  return (
    <section
      className={`rama-git ${activo ? "activo" : "apagado"}`}
      aria-label="Control de versiones"
    >
      <div className="rama-git-kicker">Control de versiones</div>
      <section className={`node nodo-cambios ${activo ? "activo" : "apagado"}`}>
        <div className="node-head">
          <span className="node-title">Cambios sin commit</span>
          <span className="count">{cambios.length}</span>
        </div>
        <div className="cambios-cuerpo">
          {!activo ? (
            <p className="cambios-vacio">Sin repositorio local</p>
          ) : cambios.length === 0 ? (
            <p className="cambios-vacio">Sin cambios pendientes</p>
          ) : (
            <ul className="cambios-lista">
              {cambios.map((cambio) => (
                <li key={`${cambio.estado}:${cambio.ruta}`} className="fila-cambio">
                  <span className="cambio-estado" title={cambio.estado}>
                    {cambio.estado}
                  </span>
                  <span className="cambio-ruta" title={cambio.ruta}>
                    {cambio.ruta}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </section>
  );
}

/** El nodo terminal de Git: no es un carril ni guarda ideas. Solo enseña si
 *  la carpeta pertenece a un work tree y, cuando lo hace, su rama y commit. */
export function NodoGit({
  activo,
  branch,
  commit,
  gitRoot,
  boxRef,
}: {
  activo: boolean;
  branch?: string | null;
  commit?: string | null;
  /** Raíz del work tree; se enseña en el `title` para no crecer el nodo. */
  gitRoot?: string | null;
  boxRef?: Ref<HTMLElement>;
}) {
  return (
    <section
      ref={boxRef}
      className={`node nodo-git ${activo ? "activo" : "apagado"}`}
      aria-label="Estado de Git"
    >
      <div className="node-head">
        <span className={`git-punto${activo ? " on" : ""}`} aria-hidden="true" />
        <span className="node-title">Git</span>
        <span className={`git-estado${activo ? " on" : ""}`}>
          {activo ? "asociado" : "apagado"}
        </span>
      </div>
      <div className="git-detalle">
        {activo ? (
          <>
            <span className="git-rama" title={gitRoot ?? undefined}>
              {branch ?? "HEAD desprendido"}
            </span>
            <span className="git-commit">{commit ?? "sin commits"}</span>
          </>
        ) : (
          <span className="git-ayuda">Sin repositorio local</span>
        )}
      </div>
    </section>
  );
}

/** Un nodo entero: cabecera plegable y, debajo, su propia lista. */
export function NodeBox({
  node,
  cerrados,
  onToggle,
  boxRef,
  volando,
  pulso,
  destello,
  onMover,
  onPideEditar,
  onEditar,
  onBorrar,
  puedeIr,
  exigeFases,
  exigeFasesListas,
  exigeFasesCompletas,
  catalogo = [],
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  boxRef?: Ref<HTMLElement>;
  volando: (uid: string, nodo: string) => boolean;
  pulso?: TonoPulso;
  /** Fogonazo de llegada: la clave es la chispa que lo provoca, para que dos
   *  llegadas seguidas reinicien la animación en vez de fundirse. */
  destello?: { clave: number };
  onMover?: (uid: string, status: Status) => void;
  onPideEditar?: (uid: string, titulo: string, descripcion: string) => void;
  onEditar?: (uid: string, cambios: IdeaUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  puedeIr?: PuedeIr;
  exigeFases?: PuedeIr;
  exigeFasesListas?: PuedeIr;
  exigeFasesCompletas?: PuedeIr;
  catalogo?: readonly Idea[];
}) {
  const tiene = node.kids.length > 0;
  const abierto = tiene && !cerrados.has(node.key);

  return (
    <section
      ref={boxRef}
      className={`node${node.tone ? ` lane-${node.tone}` : ""}${pulso ? ` pulso-${pulso}` : ""}`}
    >
      {destello && <span key={destello.clave} className="destello" aria-hidden="true" />}
      <button
        type="button"
        className="node-head"
        onClick={() => onToggle(node.key)}
        aria-expanded={tiene ? abierto : undefined}
      >
        <span className="node-title">{node.title}</span>
        <span className={`count${pulso ? " pulso" : ""}`}>{node.total}</span>
        {tiene ? <Arrow open={abierto} /> : <span className="arrow" />}
      </button>

      {abierto && (
        <div className="node-body">
          {node.kids.map((kid) => (
            <NodeRow
              key={kid.key}
              node={kid}
              nodo={node.tone ?? "ideas"}
              volando={volando}
              onMover={onMover}
              onPideEditar={onPideEditar}
              onEditar={onEditar}
              onBorrar={onBorrar}
              puedeIr={puedeIr}
              exigeFases={exigeFases}
              exigeFasesListas={exigeFasesListas}
              exigeFasesCompletas={exigeFasesCompletas}
              catalogo={catalogo}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/** La copia que viaja: sale del rectángulo viejo y aterriza en el nuevo. */
export function VueloFila({ vuelo, onDone }: { vuelo: Vuelo; onDone: (id: number) => void }) {
  const [enVuelo, setEnVuelo] = useState(false);

  useLayoutEffect(() => {
    const raf = requestAnimationFrame(() => setEnVuelo(true));
    // Puede no haber transición si las dos filas coinciden en pantalla.
    const timer = setTimeout(() => onDone(vuelo.id), 1000);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [onDone, vuelo.id]);

  const dx = vuelo.to.x - vuelo.from.x;
  const dy = vuelo.to.y - vuelo.from.y;

  return (
    <div
      aria-hidden="true"
      className={`vuelo ${vuelo.lane}${vuelo.funde ? " funde" : ""}`}
      style={{
        left: vuelo.from.x,
        top: vuelo.from.y,
        width: vuelo.from.w,
        height: vuelo.from.h,
        transform: enVuelo ? `translate(${dx}px, ${dy}px)` : "none",
        opacity: enVuelo && vuelo.funde ? 0 : 1,
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "transform") onDone(vuelo.id);
      }}
    >
      <span className="dot" />
      <span className="vuelo-title">{vuelo.title}</span>
    </div>
  );
}
