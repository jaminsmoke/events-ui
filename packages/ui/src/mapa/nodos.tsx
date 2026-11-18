import { useLayoutEffect, useState } from "react";
import type { Ref } from "react";
import { createPortal } from "react-dom";

import type { IdeaUpdate } from "../core/api";
import type { PuedeIr } from "../core/useProtocolos";
import { DescartaIdea } from "../pantalla/DescartaIdea";
import type { TreeNode } from "./arbol";
import type { TonoPulso } from "./animaciones";
import type { Vuelo } from "./vuelos";

/** Flecha de plegado. Vacía si el nodo no tiene items. */
function Arrow({ open }: { open: boolean }) {
  return <span className="arrow">{open ? "▾" : "▸"}</span>;
}

/** Palabra del estado para la fila, en español: el contrato habla `draft`/
 *  `rejected` pero la fila se lee en español. Los nombres son los mismos
 *  carriles: `draft` es el cajón (no tiene fila en ninguna ficha),
 *  `proposed` vive en la cola (`idea_cola`), los demás, en sus fichas. */
const ETIQUETA_ESTADO: Record<string, string> = {
  draft: "En el cajón",
  proposed: "En cola",
  accepted: "Completada",
  rejected: "Descartada",
  superseded: "Reemplazada",
};

/** Fecha corta del sistema: el ISO crudo (`…T07:15:01+00:00`) no se lee. */
function fechaCorta(iso: string): string {
  const f = new Date(iso);
  return Number.isNaN(f.getTime())
    ? iso
    : f.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
  onCompletar,
  onPideEditar,
  onEditar,
  onBorrar,
  enlacesNuevos = [],
  puedeIr,
}: {
  node: TreeNode;
  nodo: string;
  volando: (uid: string, nodo: string) => boolean;
  onMover?: (uid: string, lane: "cola" | "descartadas") => void;
  onCompletar?: (uid: string) => void;
  /** Pedir edición: monta el editor en la raíz (App), no aquí —las filas
   *  van portaleadas y los clics del ratón en el portal no llegaban. */
  onPideEditar?: (uid: string, titulo: string, descripcion: string) => void;
  onEditar?: (uid: string, cambios: IdeaUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  enlacesNuevos?: { parentUid: string; childUid: string }[];
  /** Los protocolos de flujo (`GET /protocolos`): si está, la fila no ofrece
   *  un traslado que el core rechazaría (las descartadas no vuelven a cola,
   *  p. ej.). Sin él se ofrece todo y el core manda. */
  puedeIr?: PuedeIr;
}) {
  const tiene = node.kids.length > 0;
  // Una sola expansión por fila: detalles, botones e hijos. Las filas con
  // hijos arrancan abiertas para que se vea la rama; las hoja, cerradas.
  const [expandido, setExpandido] = useState(tiene);
  const uid = node.idea?.uid;
  const descripcion = node.idea?.description ?? "";
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
      }${uid && enlacesNuevos.some((e) => e.parentUid === uid || e.childUid === uid) ? " enlace-nuevo" : ""}`}
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
      {node.idea && onMover && (nodo === "cola" || nodo === "descartadas") &&
        (!puedeIr || puedeIr(node.idea.status, nodo === "cola" ? "rejected" : "proposed")) && (
        <button
          type="button"
          className="btn ghost mover"
          title={nodo === "cola" ? "Descartar esta idea" : "Devolver esta idea a En cola"}
          onClick={() => {
            // Descartar pide el motivo (ficha `idea_rejected`); volver a cola,
            // directo: salir de `descartadas` la retira.
            if (nodo === "cola" && onEditar) setDescartando(true);
            else onMover(uid!, "cola");
          }}
        >
          {nodo === "cola" ? "Descartar" : "A cola"}
        </button>
      )}
      {node.idea && onCompletar && node.idea.status !== "accepted" &&
        (!puedeIr || puedeIr(node.idea.status, "accepted")) && (
        <button
          type="button"
          className="btn ghost mover"
          title="Marcar como completada (accepted)"
          onClick={() => onCompletar(uid!)}
        >
          Completar
        </button>
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
              onCompletar={onCompletar}
              onPideEditar={onPideEditar}
              onEditar={onEditar}
              onBorrar={onBorrar}
              enlacesNuevos={enlacesNuevos}
              puedeIr={puedeIr}
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
  onCompletar,
  onPideEditar,
  onEditar,
  onBorrar,
  enlacesNuevos = [],
  puedeIr,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  boxRef?: Ref<HTMLElement>;
  volando: (uid: string, nodo: string) => boolean;
  pulso?: TonoPulso;
  onMover?: (uid: string, lane: "cola" | "descartadas") => void;
  onCompletar?: (uid: string) => void;
  onPideEditar?: (uid: string, titulo: string, descripcion: string) => void;
  onEditar?: (uid: string, cambios: IdeaUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  enlacesNuevos?: { parentUid: string; childUid: string }[];
  puedeIr?: PuedeIr;
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
              onCompletar={onCompletar}
              onPideEditar={onPideEditar}
              onEditar={onEditar}
              onBorrar={onBorrar}
              enlacesNuevos={enlacesNuevos}
              puedeIr={puedeIr}
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
