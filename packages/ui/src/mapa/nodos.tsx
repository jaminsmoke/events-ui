import { useLayoutEffect, useState } from "react";
import type { Ref } from "react";

import type { Idea, IdeaUpdate } from "../core/api";
import type { TreeNode } from "./arbol";
import type { TonoPulso } from "./animaciones";
import type { Vuelo } from "./vuelos";

/** Flecha de plegado. Vacía si el nodo no tiene items. */
function Arrow({ open }: { open: boolean }) {
  return <span className="arrow">{open ? "▾" : "▸"}</span>;
}

/** Una fila del nodo: título, contador y, si tiene items, su propia flecha.
 *  Si es una idea, ofrece moverla de carril (`onMover`), editarla y borrarla;
 *  en el cajón (`root`), además, conectarla como padre de otra idea. Todo por
 *  la API tipada y con el formulario en línea, sin salir de la fila. */
function NodeRow({
  node,
  cerrados,
  onToggle,
  nodo,
  volando,
  onMover,
  onEditar,
  onBorrar,
  onConectar,
  ideas,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  nodo: string;
  volando: (uid: string, nodo: string) => boolean;
  onMover?: (uid: string, lane: "cola" | "descartadas") => void;
  onEditar?: (uid: string, cambios: IdeaUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  onConectar?: (parentUid: string, childUid: string) => Promise<void>;
  ideas?: Idea[];
}) {
  const tiene = node.kids.length > 0;
  const abierto = tiene && !cerrados.has(node.key);
  const uid = node.idea?.uid;
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(node.title);
  const [descripcion, setDescripcion] = useState(node.idea?.description ?? "");
  const [confirmando, setConfirmando] = useState(false);
  const [conectando, setConectando] = useState(false);
  const [hijo, setHijo] = useState("");
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
        onClick={() => tiene && onToggle(node.key)}
        aria-expanded={tiene ? abierto : undefined}
        title={node.idea?.description || undefined}
      >
        {node.idea && <span className="dot" />}
        <span className="row-title">{node.title}</span>
        {node.total > 0 && <span className="count">{node.total}</span>}
        {tiene && <Arrow open={abierto} />}
      </button>
      {node.idea && onMover && (nodo === "cola" || nodo === "descartadas") && (
        <button
          type="button"
          className="btn ghost mover"
          title={nodo === "cola" ? "Descartar esta idea" : "Devolver esta idea a En cola"}
          onClick={() => onMover(uid!, nodo === "cola" ? "descartadas" : "cola")}
        >
          {nodo === "cola" ? "Descartar" : "A cola"}
        </button>
      )}
      {node.idea && onEditar && (
        <button type="button" className="btn ghost mover" onClick={() => setEditando((v) => !v)}>
          Editar
        </button>
      )}
      {node.idea && onBorrar && !confirmando && (
        <button type="button" className="btn ghost mover" onClick={() => setConfirmando(true)}>
          Borrar
        </button>
      )}
      {node.idea && onConectar && nodo === "root" && (
        <button type="button" className="btn ghost mover" onClick={() => setConectando((v) => !v)}>
          Conectar
        </button>
      )}

      {node.idea && editando && onEditar && (
        <form
          className="fila-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!titulo.trim()) return;
            hacer(
              () => onEditar(uid!, { title: titulo.trim(), description: descripcion.trim() }),
              () => setEditando(false),
            );
          }}
        >
          <input value={titulo} onChange={(e) => setTitulo(e.target.value)} aria-label="Título" />
          <input
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Descripción"
            aria-label="Descripción"
          />
          <span className="fila-acciones">
            <button className="btn ghost mover" type="submit" disabled={trabajando}>
              Guardar
            </button>
            <button className="btn ghost mover" type="button" onClick={() => setEditando(false)}>
              Cancelar
            </button>
          </span>
        </form>
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

      {node.idea && conectando && onConectar && (
        <form
          className="fila-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!hijo) return;
            hacer(() => onConectar(uid!, hijo), () => setConectando(false));
          }}
        >
          <select value={hijo} onChange={(e) => setHijo(e.target.value)} aria-label="Idea hija">
            <option value="">Elige la idea hija…</option>
            {(ideas ?? [])
              .filter((i) => i.uid !== uid)
              .map((i) => (
                <option key={i.uid} value={i.uid}>
                  {i.title}
                </option>
              ))}
          </select>
          <span className="fila-acciones">
            <button className="btn ghost mover" type="submit" disabled={trabajando || !hijo}>
              Conectar
            </button>
            <button className="btn ghost mover" type="button" onClick={() => setConectando(false)}>
              Cancelar
            </button>
          </span>
        </form>
      )}

      {fallo && <span className="hint error fila-fallo">{fallo}</span>}

      {abierto && (
        <div className="row-kids">
          {node.kids.map((kid) => (
            <NodeRow
              key={kid.key}
              node={kid}
              cerrados={cerrados}
              onToggle={onToggle}
              nodo={nodo}
              volando={volando}
              onMover={onMover}
              onEditar={onEditar}
              onBorrar={onBorrar}
              onConectar={onConectar}
              ideas={ideas}
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
  onEditar,
  onBorrar,
  onConectar,
  ideas,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  boxRef?: Ref<HTMLElement>;
  volando: (uid: string, nodo: string) => boolean;
  pulso?: TonoPulso;
  onMover?: (uid: string, lane: "cola" | "descartadas") => void;
  onEditar?: (uid: string, cambios: IdeaUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  onConectar?: (parentUid: string, childUid: string) => Promise<void>;
  ideas?: Idea[];
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
              cerrados={cerrados}
              onToggle={onToggle}
              nodo={node.tone ?? "ideas"}
              volando={volando}
              onMover={onMover}
              onEditar={onEditar}
              onBorrar={onBorrar}
              onConectar={onConectar}
              ideas={ideas}
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
