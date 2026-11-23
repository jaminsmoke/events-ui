/** Un nodo del mapa y la copia que viaja entre carriles. */

import { useLayoutEffect, useState } from "react";
import type { Ref } from "react";

import type { WorkItem, WorkItemUpdate } from "../core/api";
import type { PuedeIr } from "../core/useProtocolos";
import type { TonoPulso } from "./animaciones";
import type { TreeNode } from "./arbol";
import type { Status } from "./carriles";
import { Arrow, NodeRow } from "./fila";
import { mismoElemento } from "./seleccion";
import type { Seleccion } from "./seleccion";
import type { Vuelo } from "./vuelos";

export {
  NodoCambios,
  NodoCommits,
  NodoGit,
  NodoPuenteDocumentos,
  NodoPuenteGit,
  VueloCambio,
} from "./nodos-git";

/** Fila efímera en Eliminadas: se quema y desaparece; no hay ficha persistida. */
export function FilaQuema({ titulo }: { titulo: string }) {
  return (
    <div className="row fila-quema" aria-hidden="true">
      <div className="row-head">
        <span className="dot" />
        <span className="row-title">{titulo}</span>
        <span className="quema-llamas" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
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
  destello,
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
  onEditar?: (uid: string, cambios: WorkItemUpdate) => Promise<void>;
  onBorrar?: (uid: string) => Promise<void>;
  /** La idea completa (con el parche de sus archivos), vía `useRepo`. */
  onCargarIdea?: (uid: string) => Promise<WorkItem | null>;
  puedeIr?: PuedeIr;
  exigeFases?: PuedeIr;
  exigeFasesListas?: PuedeIr;
  exigeFasesCompletas?: PuedeIr;
  catalogo?: readonly WorkItem[];
  /** Lo seleccionado en el lienzo y cómo cambiarlo: la cabecera marca el
   *  nodo (Entrada o carril) y las filas marcan su idea. */
  seleccion?: Seleccion | null;
  onSeleccionar?: (seleccion: Seleccion) => void;
}) {
  const tiene = node.kids.length > 0;
  // Eliminadas se abre sola mientras hay una quema en curso.
  const forzarAbierto = node.tone === "eliminadas" && tiene;
  const abierto = (tiene && !cerrados.has(node.key)) || forzarAbierto;
  // La entrada y los carriles se seleccionan por su clave de árbol: el cajón
  // es uno solo, así que no necesita identidad propia.
  const yo: Seleccion =
    node.tone === "root" ? { tipo: "cajon" } : { tipo: "carril", clave: node.key };

  return (
    <section
      ref={boxRef}
      className={`node${node.tone ? ` lane-${node.tone}` : ""}${pulso ? ` pulso-${pulso}` : ""}${
        mismoElemento(seleccion, yo) ? " seleccionado" : ""
      }`}
    >
      {destello && <span key={destello.clave} className="destello" aria-hidden="true" />}
      <button
        type="button"
        className="node-head"
        onClick={() => {
          onToggle(node.key);
          onSeleccionar?.(yo);
        }}
        aria-expanded={tiene ? abierto : undefined}
        aria-pressed={mismoElemento(seleccion, yo) || undefined}
      >
        <span className="node-title">{node.title}</span>
        <span className={`count${pulso ? " pulso" : ""}`}>{node.total}</span>
        {tiene ? <Arrow open={abierto} /> : <span className="arrow" />}
      </button>

      {abierto && (
        <div className="node-body">
          {node.kids.map((kid) =>
            node.tone === "eliminadas" && !kid.idea ? (
              <FilaQuema key={kid.key} titulo={kid.title} />
            ) : (
              <NodeRow
                key={kid.key}
                node={kid}
                nodo={node.tone ?? "ideas"}
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
            ),
          )}
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
