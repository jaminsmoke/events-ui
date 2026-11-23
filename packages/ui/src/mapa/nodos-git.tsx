/** Los nodos de Git del mapa: estado, cambios y el puente. */

import { useEffect, useState } from "react";
import type { Ref } from "react";

import type { CommitGit } from "../core/api";
import { mismoElemento } from "./seleccion";
import type { Seleccion } from "./seleccion";
import type { FilaVueloCommit } from "./vuelos-git";

/** El primer nodo del Mapa de Git: los cambios que aún no tienen commit.
 *  No es un carril de ideas; solo enseña lo que Git ve en el árbol de trabajo. */
/** «viejo → nuevo» para un renombrado; la ruta sola en el resto. */
function rutaVisible(cambio: { ruta: string; origen?: string | null }): string {
  return cambio.origen ? `${cambio.origen} → ${cambio.ruta}` : cambio.ruta;
}

export function NodoCambios({
  activo,
  cambios,
  seleccion,
  onSeleccionar,
  boxRef,
}: {
  activo: boolean;
  cambios: readonly { estado: string; ruta: string; origen?: string | null }[];
  /** Lo seleccionado en el lienzo: el nodo entero o uno de sus archivos. */
  seleccion?: Seleccion | null;
  onSeleccionar?: (seleccion: Seleccion) => void;
  boxRef?: Ref<HTMLElement>;
}) {
  return (
    <section
      ref={boxRef}
      className={`node nodo-cambios ${activo ? "activo" : "apagado"}${
        mismoElemento(seleccion, { tipo: "cambios" }) ? " seleccionado" : ""
      }`}
      aria-label="Cambios sin commit"
      onClick={(e) => {
        // El archivo ya eligió lo suyo al pulsarse; el resto del nodo
        // selecciona la lista de cambios sin commit.
        if (!(e.target as Element).closest("button")) onSeleccionar?.({ tipo: "cambios" });
      }}
    >
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
              <li
                key={`${cambio.estado}:${cambio.ruta}`}
                className={`fila-cambio${
                  mismoElemento(seleccion, { tipo: "cambio", ruta: cambio.ruta })
                    ? " seleccionada"
                    : ""
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeleccionar?.({ tipo: "cambio", ruta: cambio.ruta });
                }}
              >
                <span className="cambio-estado" title={cambio.estado}>
                  {cambio.estado}
                </span>
                <span className="cambio-ruta" title={rutaVisible(cambio)}>
                  {rutaVisible(cambio)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** Los últimos commits de la rama: lo que ya entró en Git, como una línea
 *  temporal al estilo del grafo de VS Code. Un riel a la izquierda une los
 *  puntos de cada commit —el de arriba es HEAD— y a su derecha van el asunto
 *  y, en segundo plano, el hash, el autor y la fecha. */
const FECHA_COMMIT = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" });

function fechaCommit(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : FECHA_COMMIT.format(fecha);
}

export function NodoCommits({
  activo,
  commits,
  branch,
  seleccion,
  onSeleccionar,
  boxRef,
}: {
  activo: boolean;
  commits: readonly CommitGit[];
  /** Rama que sigue la línea temporal; va en la cabecera del nodo. */
  branch?: string | null;
  /** Lo seleccionado en el lienzo: el historial entero o un commit. */
  seleccion?: Seleccion | null;
  /** Pulsar un commit lo selecciona y el Inspector lo abre. */
  onSeleccionar?: (seleccion: Seleccion) => void;
  boxRef?: Ref<HTMLElement>;
}) {
  const esCommit = (hash: string) =>
    mismoElemento(seleccion, { tipo: "commit", hash });
  return (
    <section
      ref={boxRef}
      className={`node nodo-commits ${activo ? "activo" : "apagado"}${
        mismoElemento(seleccion, { tipo: "commits" }) ? " seleccionado" : ""
      }`}
      aria-label="Últimos commits"
      onClick={(e) => {
        // Los botones de la línea temporal ya eligieron un commit; el resto
        // del nodo selecciona el historial entero.
        if (!(e.target as Element).closest("button")) onSeleccionar?.({ tipo: "commits" });
      }}
    >
      <div className="node-head">
        <span className="node-title">Commits</span>
        {activo && branch && (
          <span className="commit-rama" title="Rama actual">
            {branch}
          </span>
        )}
        <span className="count">{commits.length}</span>
      </div>
      <div className="commits-cuerpo">
        {!activo ? (
          <p className="cambios-vacio">Sin repositorio local</p>
        ) : commits.length === 0 ? (
          <p className="cambios-vacio">Sin commits todavía</p>
        ) : (
          <ul className="commits-lista">
            {commits.map((commit, i) => (
              <li
                key={commit.hash}
                className={`fila-commit${i === 0 ? " head" : ""}${
                  esCommit(commit.hash) ? " seleccionado" : ""
                }`}
              >
                {/* Una fila, un renglón: el autor y la fecha completa viven
                 *  en el inspector, así el asunto manda y la lista es densa. */}
                <button
                  type="button"
                  className="commit-fila"
                  aria-pressed={esCommit(commit.hash)}
                  title={`${commit.autor} · ${commit.hash}`}
                  onClick={() => onSeleccionar?.({ tipo: "commit", hash: commit.hash })}
                >
                  {/* El punto es el vértice de la línea temporal: el riel lo
                   *  cruza y el primero —HEAD— va encendido. */}
                  <span className="commit-punto" aria-hidden="true" />
                  <span className="commit-asunto">{commit.asunto}</span>
                  <span className="commit-meta">
                    {i === 0 && <span className="commit-head">HEAD</span>}
                    <span className="commit-hash">{commit.hash}</span>
                    <span className="commit-fecha">{fechaCommit(commit.fecha)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
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
  seleccion,
  onSeleccionar,
  boxRef,
}: {
  activo: boolean;
  branch?: string | null;
  commit?: string | null;
  /** Raíz del work tree; se enseña en el `title` para no crecer el nodo. */
  gitRoot?: string | null;
  seleccion?: Seleccion | null;
  onSeleccionar?: (seleccion: Seleccion) => void;
  boxRef?: Ref<HTMLElement>;
}) {
  return (
    <section
      ref={boxRef}
      className={`node nodo-git ${activo ? "activo" : "apagado"}${
        mismoElemento(seleccion, { tipo: "git" }) ? " seleccionado" : ""
      }`}
      aria-label="Estado de Git"
      onClick={() => onSeleccionar?.({ tipo: "git" })}
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

/** El puente al Mapa de Documentos: cierra el archivo del flujo. El cable de
 *  aprobación sigue midiendo este nodo; al abrirlo se ve el Changelog. */
export function NodoPuenteDocumentos({
  seleccion,
  onSeleccionar,
  boxRef,
  onAbrir,
}: {
  seleccion?: Seleccion | null;
  onSeleccionar?: (seleccion: Seleccion) => void;
  boxRef?: Ref<HTMLElement>;
  onAbrir: () => void;
}) {
  return (
    <section
      ref={boxRef}
      className={`node nodo-git nodo-puente activo${
        mismoElemento(seleccion, { tipo: "puente_documentos" }) ? " seleccionado" : ""
      }`}
      aria-label="Mapa de Documentos"
      onClick={(e) => {
        if ((e.target as Element).closest("button")) return;
        onSeleccionar?.({ tipo: "puente_documentos" });
      }}
      onDoubleClick={(e) => {
        if ((e.target as Element).closest("button")) return;
        e.stopPropagation();
        onAbrir();
      }}
    >
      <div className="node-head">
        <span className="git-punto on" aria-hidden="true" />
        <span className="node-title">Documentos</span>
        <span className="git-estado on">Changelog</span>
      </div>
      <div className="git-detalle">
        <span className="git-ayuda">Ítems archivados</span>
      </div>
      <button type="button" className="btn puente-abrir" onClick={onAbrir}>
        Abrir mapa de Documentos <span aria-hidden="true">→</span>
      </button>
    </section>
  );
}

/** El puente al Mapa de Git: cierra el flujo de Ideas y solo se activa con
 *  work tree. No guarda ideas; abre la vista de Control de versiones. Sin
 *  repo ofrece crearlo y con repo, eliminarlo (con confirmación). */
export function NodoPuenteGit({
  activo,
  branch,
  commit,
  gitRoot,
  seleccion,
  onSeleccionar,
  boxRef,
  onAbrir,
  onCrear,
  onEliminar,
}: {
  activo: boolean;
  branch?: string | null;
  commit?: string | null;
  gitRoot?: string | null;
  seleccion?: Seleccion | null;
  onSeleccionar?: (seleccion: Seleccion) => void;
  boxRef?: Ref<HTMLElement>;
  onAbrir: () => void;
  onCrear: () => void;
  onEliminar: () => void;
}) {
  return (
    <section
      ref={boxRef}
      className={`node nodo-git nodo-puente ${activo ? "activo" : "apagado"}${
        mismoElemento(seleccion, { tipo: "puente" }) ? " seleccionado" : ""
      }`}
      aria-label="Entregar a Git"
      onClick={(e) => {
        // Abrir y Eliminar son botones: pulsarlos no cambia la selección.
        if ((e.target as Element).closest("button")) return;
        onSeleccionar?.({ tipo: "puente" });
      }}
      onDoubleClick={(e) => {
        if ((e.target as Element).closest("button")) return;
        e.stopPropagation();
        if (activo) onAbrir();
      }}
    >
      <div className="node-head">
        <span className={`git-punto${activo ? " on" : ""}`} aria-hidden="true" />
        <span className="node-title">Entregar a Git</span>
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
      {activo ? (
        <>
          <button type="button" className="btn puente-abrir" onClick={onAbrir}>
            Abrir mapa de Git <span aria-hidden="true">→</span>
          </button>
          <button type="button" className="btn ghost puente-borrar" onClick={onEliminar}>
            Eliminar repo…
          </button>
        </>
      ) : (
        <button type="button" className="btn puente-abrir" onClick={onCrear}>
          Crear repo local
        </button>
      )}
    </section>
  );
}

/** Una fila del vuelo al commit. El `setTimeout` es la red por si
 *  `transitionend` no llega (movimiento reducido): la ficha no se queda pegada
 *  al mapa. */
export function VueloCambio({
  fila,
  onDone,
}: {
  fila: FilaVueloCommit;
  onDone: (id: string) => void;
}) {
  const [enVuelo, setEnVuelo] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEnVuelo(true));
    const timer = setTimeout(() => onDone(fila.id), 1100);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [fila.id, onDone]);

  return (
    <div
      className={`vuelo-cambio${enVuelo ? " en-vuelo" : ""}`}
      style={{
        left: fila.x,
        top: fila.y,
        width: fila.w,
        transform: enVuelo ? `translate(${fila.dx}px, ${fila.dy}px)` : "none",
      }}
      onTransitionEnd={(e) => {
        if (e.propertyName === "transform") onDone(fila.id);
      }}
    >
      <span className="vuelo-cambio-estado">{fila.estado}</span>
      <span className="vuelo-cambio-ruta">{fila.ruta}</span>
    </div>
  );
}
