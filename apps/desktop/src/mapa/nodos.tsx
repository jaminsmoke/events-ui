import { useLayoutEffect, useState } from "react";
import type { Ref } from "react";

import type { TreeNode } from "./arbol";
import type { Vuelo } from "./vuelos";

/** Flecha de plegado. Vacía si el nodo no tiene items. */
function Arrow({ open }: { open: boolean }) {
  return <span className="arrow">{open ? "▾" : "▸"}</span>;
}

/** Una fila del nodo: título, contador y, si tiene items, su propia flecha. */
function NodeRow({
  node,
  cerrados,
  onToggle,
  nodo,
  volando,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  nodo: string;
  volando: (uid: string, nodo: string) => boolean;
}) {
  const tiene = node.kids.length > 0;
  const abierto = tiene && !cerrados.has(node.key);
  const uid = node.idea?.uid;

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
        {node.idea && <span className={`dot status-${node.idea.status}`} />}
        <span className="row-title">{node.title}</span>
        {node.total > 0 && <span className="count">{node.total}</span>}
        {tiene && <Arrow open={abierto} />}
      </button>

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
  pulsa,
}: {
  node: TreeNode;
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  boxRef?: Ref<HTMLElement>;
  volando: (uid: string, nodo: string) => boolean;
  pulsa?: boolean;
}) {
  const tiene = node.kids.length > 0;
  const abierto = tiene && !cerrados.has(node.key);

  return (
    <section ref={boxRef} className={`node${node.tone ? ` lane-${node.tone}` : ""}`}>
      <button
        type="button"
        className="node-head"
        onClick={() => onToggle(node.key)}
        aria-expanded={tiene ? abierto : undefined}
      >
        <span className="node-title">{node.title}</span>
        <span className={`count${pulsa ? " pulso" : ""}`}>{node.total}</span>
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
    return () => cancelAnimationFrame(raf);
  }, []);

  const dx = vuelo.to.x - vuelo.from.x;
  const dy = vuelo.to.y - vuelo.from.y;

  return (
    <div
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
