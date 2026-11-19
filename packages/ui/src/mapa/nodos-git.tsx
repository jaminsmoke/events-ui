/** Los nodos de Git del mapa: estado, cambios y el puente. */

import type { Ref } from "react";

import type { CommitGit } from "../core/api";

/** El primer nodo del Mapa de Git: los cambios que aún no tienen commit.
 *  No es un carril de ideas; solo enseña lo que Git ve en el árbol de trabajo. */
/** «viejo → nuevo» para un renombrado; la ruta sola en el resto. */
function rutaVisible(cambio: { ruta: string; origen?: string | null }): string {
  return cambio.origen ? `${cambio.origen} → ${cambio.ruta}` : cambio.ruta;
}

export function NodoCambios({
  activo,
  cambios,
}: {
  activo: boolean;
  cambios: readonly { estado: string; ruta: string; origen?: string | null }[];
}) {
  return (
    <section
      className={`node nodo-cambios ${activo ? "activo" : "apagado"}`}
      aria-label="Cambios sin commit"
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
              <li key={`${cambio.estado}:${cambio.ruta}`} className="fila-cambio">
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

/** Los últimos commits de la rama: lo que ya entró en Git. Cada fila es un
 *  commit con su hash abreviado y el asunto; el autor y la fecha van en el
 *  `title` porque el asunto es lo que se lee de un vistazo. */
const FECHA_COMMIT = new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short" });

function fechaCommit(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : FECHA_COMMIT.format(fecha);
}

export function NodoCommits({
  activo,
  commits,
}: {
  activo: boolean;
  commits: readonly CommitGit[];
}) {
  return (
    <section
      className={`node nodo-commits ${activo ? "activo" : "apagado"}`}
      aria-label="Últimos commits"
    >
      <div className="node-head">
        <span className="node-title">Commits</span>
        <span className="count">{commits.length}</span>
      </div>
      <div className="commits-cuerpo">
        {!activo ? (
          <p className="cambios-vacio">Sin repositorio local</p>
        ) : commits.length === 0 ? (
          <p className="cambios-vacio">Sin commits todavía</p>
        ) : (
          <ul className="commits-lista">
            {commits.map((commit) => (
              <li
                key={commit.hash}
                className="fila-commit"
                title={`${commit.autor} · ${fechaCommit(commit.fecha)}`}
              >
                <span className="commit-hash">{commit.hash}</span>
                <span className="commit-asunto">{commit.asunto}</span>
                <span className="commit-autor">{commit.autor}</span>
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

/** El puente al Mapa de Git: cierra el flujo de Ideas y solo se activa con
 *  work tree. No guarda ideas; abre la vista de Control de versiones. Sin
 *  repo ofrece crearlo y con repo, eliminarlo (con confirmación). */
export function NodoPuenteGit({
  activo,
  branch,
  commit,
  gitRoot,
  boxRef,
  onAbrir,
  onCrear,
  onEliminar,
}: {
  activo: boolean;
  branch?: string | null;
  commit?: string | null;
  gitRoot?: string | null;
  boxRef?: Ref<HTMLElement>;
  onAbrir: () => void;
  onCrear: () => void;
  onEliminar: () => void;
}) {
  return (
    <section
      ref={boxRef}
      className={`node nodo-git nodo-puente ${activo ? "activo" : "apagado"}`}
      aria-label="Entregar a Git"
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
