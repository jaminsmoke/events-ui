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
    { estado: "proposed", etiqueta: "A cola" },
    { estado: "revision_aprobada", etiqueta: "Aprobar revisión" },
  ],
  revision_aprobada: [],
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

/** Las fases de una idea: lista corta con su estado, sin salir de la fila.
 *  Cada cambio reenvía la lista entera: el PATCH la reemplaza en una
 *  transacción, así que marcar una casilla no pisa el carril. */
function FasesIdea({
  uid,
  fases,
  onEditar,
}: {
  uid: string;
  fases: readonly Fase[];
  onEditar: (uid: string, cambios: IdeaUpdate) => Promise<void>;
}) {
  const [nuevo, setNuevo] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = (siguientes: readonly Fase[]) => {
    setGuardando(true);
    setFallo(null);
    onEditar(uid, {
      fases: siguientes.map(({ orden, titulo, estado, nota }) => ({
        orden,
        titulo,
        estado,
        nota,
      })),
    })
      .catch((err: unknown) => setFallo(err instanceof Error ? err.message : String(err)))
      .finally(() => setGuardando(false));
  };

  const anadir = (e: React.FormEvent) => {
    e.preventDefault();
    const titulo = nuevo.trim();
    if (!titulo) return;
    const orden = Math.max(0, ...fases.map((fase) => fase.orden)) + 1;
    guardar([...fases, { orden, titulo, estado: "pendiente", nota: "", entered_at: "" }]);
    setNuevo("");
  };

  return (
    <div className="fases">
      <p className="fases-cabecera">
        Fases {fases.filter((fase) => fase.estado === "completada").length}/{fases.length}
      </p>
      {fases.map((fase) => (
        <div className="fase" key={fase.orden}>
          <span className="fase-titulo">{fase.titulo}</span>
          <select
            className="fase-estado"
            value={fase.estado}
            disabled={guardando}
            aria-label={`Estado de ${fase.titulo}`}
            onChange={(e) =>
              guardar(
                fases.map((otra) =>
                  otra.orden === fase.orden
                    ? { ...otra, estado: e.target.value as Fase["estado"] }
                    : otra,
                ),
              )
            }
          >
            {ESTADOS_FASE.map((estado) => (
              <option key={estado} value={estado}>
                {estado}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="chip-quitar"
            title="Quitar fase"
            disabled={guardando}
            onClick={() => guardar(fases.filter((otra) => otra.orden !== fase.orden))}
          >
            ×
          </button>
        </div>
      ))}
      <form className="fase-nueva" onSubmit={anadir}>
        <input
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Nueva fase…"
          aria-label="Nueva fase"
        />
        <button className="btn ghost" type="submit" disabled={guardando}>
          Añadir
        </button>
      </form>
      {fallo && <span className="hint error">{fallo}</span>}
    </div>
  );
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
  /** Todas las ideas del repo: resuelve títulos de las dependencias y
   *  ofrece las que aún no lo son. */
  catalogo?: readonly Idea[];
}) {
  const tiene = node.kids.length > 0;
  // Una sola expansión por fila: detalles, botones e hijos. Las filas con
  // hijos arrancan abiertas para que se vea la rama; las hoja, cerradas.
  const [expandido, setExpandido] = useState(tiene);
  const uid = node.idea?.uid;
  const estado = node.idea?.status;
  const descripcion = node.idea?.description ?? "";
  const deps = node.idea?.depende_de ?? [];
  const fases = node.idea?.fases ?? [];
  const hechas = fases.filter((fase) => fase.estado === "completada").length;
  const abiertas = fases.filter(
    (fase) => fase.estado === "pendiente" || fase.estado === "fallida",
  ).length;

  // Motivo por el que un traslado no se ofrece, o `null` si se puede probar.
  const motivoBloqueo = (destino: Status): string | null => {
    if (!estado) return null;
    if (
      destino === "roadmap" &&
      fases.length === 0 &&
      exigeFases?.(estado, "roadmap")
    ) {
      return "El protocolo exige al menos una fase";
    }
    if (
      destino === "verificacion" &&
      abiertas > 0 &&
      exigeFasesListas?.(estado, "verificacion")
    ) {
      return `Cierra las fases pendientes o fallidas (${abiertas})`;
    }
    return null;
  };
  const [descartando, setDescartando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);

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
        onClick={() => setExpandido((v) => !v)}
        aria-expanded={expandido}
      >
        {node.idea && <span className="dot" />}
        <span className="row-title">{node.title}</span>
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
          <p className="fila-descripcion">{node.idea.description || "Sin descripción"}</p>
          <span className="fila-estado">{ETIQUETA_ESTADO[node.idea.status] ?? node.idea.status}</span>
      {node.idea.rejected_at && <p className="fila-rechazo">
        Rechazada el {fechaCorta(node.idea.rejected_at)}
        {node.idea.rejected_description ? ` — ${node.idea.rejected_description}` : ""}
      </p>}
      {deps.length > 0 && (
        <p className="fila-depende">
          Espera a:{" "}
          {deps.map((dep) => {
            const otra = catalogo.find((i) => i.uid === dep);
            const aprobada = otra?.status === "revision_aprobada";
            return (
              <span key={dep} className={`chip-depende${aprobada ? " aprobada" : ""}`}>
                {otra?.title ?? dep}
                {onEditar && (
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
      {onEditar && (
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
          {catalogo
            .filter((otra) => otra.uid !== uid && !deps.includes(otra.uid))
            .map((otra) => (
              <option key={otra.uid} value={otra.uid}>
                {otra.title}
              </option>
            ))}
        </select>
      )}
      {node.idea && onEditar && estado !== "rejected" && estado !== "superseded" && (
        <FasesIdea uid={uid!} fases={fases} onEditar={onEditar} />
      )}
      {node.idea &&
        estado &&
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
                  // Descartar pide el motivo (detalle `rejected_node`); los demás
                  // traslados van directos.
                  if (accion.descartar && onEditar) setDescartando(true);
                  else onMover(uid!, accion.estado);
                }}
              >
                {accion.etiqueta}
              </button>
            );
          })}
      {estado === "proposed" && fases.length === 0 && exigeFases?.(estado, "roadmap") && (
        <span className="hint">Añade al menos una fase para pasar a roadmap.</span>
      )}
      {estado === "roadmap" &&
        abiertas > 0 &&
        exigeFasesListas?.(estado, "verificacion") && (
          <span className="hint">
            Cierra las fases pendientes o fallidas para pasar a verificación.
          </span>
        )}
      {node.idea && onPideEditar && (
        <button
          type="button"
          className="btn ghost mover"
          onClick={() => onPideEditar(uid!, node.title, descripcion)}
        >
          Editar
        </button>
      )}
      {node.idea && onBorrar && !confirmando && (
        <button type="button" className="btn ghost mover" onClick={() => setConfirmando(true)}>
          Borrar
        </button>
      )}

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


      {node.idea && confirmando && onBorrar && (
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
          <button className="btn ghost mover" type="button" onClick={() => setConfirmando(false)}>
            No
          </button>
        </span>
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
              catalogo={catalogo}
            />
          ))}
        </div>
      )}
    </div>
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
  onMover,
  onPideEditar,
  onEditar,
  onBorrar,
  puedeIr,
  exigeFases,
  exigeFasesListas,
  catalogo = [],
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  boxRef?: Ref<HTMLElement>;
  volando: (uid: string, nodo: string) => boolean;
  pulso?: TonoPulso;
  onMover?: (uid: string, status: Status) => void;
  onPideEditar?: (uid: string, titulo: string, descripcion: string) => void;
  onEditar?: (uid: string, cambios: IdeaUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  puedeIr?: PuedeIr;
  exigeFases?: PuedeIr;
  exigeFasesListas?: PuedeIr;
  catalogo?: readonly Idea[];
}) {
  const tiene = node.kids.length > 0;
  const abierto = tiene && !cerrados.has(node.key);

  return (
    <section
      ref={boxRef}
      className={`node${node.tone ? ` lane-${node.tone}` : ""}${pulso ? ` pulso-${pulso}` : ""}`}
    >
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
