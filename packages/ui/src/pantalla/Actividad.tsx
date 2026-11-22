import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import type { CommitGit, ProyeccionRepo } from "../core/api";
import { fechaCorta } from "../mapa/formato";
import { ExploradorArbol } from "./ExploradorArbol";

/** Vista del rail izquierdo. `null` es el pane cerrado. */
export type VistaPane = "mapas" | "archivos" | "git";

/** Vista del rail derecho: las estadísticas del repo y el inspector de lo que
 *  se selecciona en el lienzo. `null` es el panel cerrado. */
export type VistaDerecha = "resumen" | "inspector";

/** Barra de actividad izquierda: una tira de iconos, cada uno con su vista.
 *  No navega ella misma: solo decide qué panel se ve. Repetir el icono activo
 *  lo cierra (el pane pasa a `null`), como en un IDE. */
export function BarraActividad({
  vista,
  onVista,
}: {
  vista: VistaPane | null;
  onVista: (vista: VistaPane) => void;
}) {
  const item = (clave: VistaPane, etiqueta: string, icono: ReactNode) => (
    <button
      type="button"
      className={`actividad-item${vista === clave ? " activo" : ""}`}
      aria-pressed={vista === clave}
      aria-label={etiqueta}
      title={vista === clave ? `Ocultar ${etiqueta.toLowerCase()}` : etiqueta}
      onClick={() => onVista(clave)}
    >
      {icono}
    </button>
  );

  return (
    <nav className="actividad" aria-label="Barra de actividad">
      {item(
        "mapas",
        "Mapas",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3.5" width="7" height="4" rx="1" />
          <rect x="14" y="3.5" width="7" height="4" rx="1" />
          <rect x="8.5" y="16.5" width="7" height="4" rx="1" />
          <path d="M6.5 7.5v3h11v-3M12 10.5v6" />
        </svg>,
      )}
      {item(
        "archivos",
        "Archivos",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 6.5h6l2 2.2h9v10.8H3.5z" />
        </svg>,
      )}
      {item(
        "git",
        "Control de código fuente",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="6.5" cy="18" r="2.3" />
          <circle cx="6.5" cy="6" r="2.3" />
          <circle cx="17.5" cy="7.5" r="2.3" />
          <path d="M6.5 8.3v7.4M8.8 6h3.4a5.3 5.3 0 0 1 5.3 5.3" />
        </svg>,
      )}
    </nav>
  );
}

/** Barra de actividad derecha: el Resumen y el Inspector, que se abren sobre
 *  el lienzo. Va a la derecha del viewport, no dentro del panel: el panel se
 *  cierra y la tira se queda. Repetir el icono activo lo cierra. */
export function BarraDerecha({
  vista,
  onVista,
}: {
  vista: VistaDerecha | null;
  onVista: (vista: VistaDerecha) => void;
}) {
  const item = (clave: VistaDerecha, etiqueta: string, icono: ReactNode) => (
    <button
      type="button"
      className={`actividad-item${vista === clave ? " activo" : ""}`}
      aria-pressed={vista === clave}
      aria-label={etiqueta}
      title={vista === clave ? `Ocultar ${etiqueta.toLowerCase()}` : `Mostrar ${etiqueta.toLowerCase()}`}
      onClick={() => onVista(clave)}
    >
      {icono}
    </button>
  );

  return (
    <nav className="actividad actividad-derecha" aria-label="Panel derecho">
      {item(
        "resumen",
        "Resumen",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5 19v-6M12 19V5M19 19v-9" />
        </svg>,
      )}
      {item(
        "inspector",
        "Inspector",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="5.2" />
          <path d="M14.4 14.4 19 19" />
        </svg>,
      )}
    </nav>
  );
}

/** Pane de Mapas: cuál de los dos mapas se está mirando.
 *
 *  Es navegación del lienzo, no del sistema de ficheros: por eso vive en su
 *  propia vista del rail y no dentro del Explorador. Se llama «Mapas» y no
 *  «Flujos y protocolos» porque dentro está el de Git también; los carriles y
 *  las compuertas se ven en el propio lienzo, no en una lista. */
export function PaneMapas({
  mapa,
  gitActivo,
  onMapa,
  onCerrar,
}: {
  mapa: "ideas" | "git";
  gitActivo: boolean;
  onMapa: (mapa: "ideas" | "git") => void;
  onCerrar: () => void;
}) {
  return (
    <aside className="pane" aria-label="Mapas">
      <div className="pane-cabecera">
        <span className="panel-titulo">Mapas</span>
        <button type="button" className="btn ghost" onClick={onCerrar} aria-label="Cerrar mapas">
          ✕
        </button>
      </div>

      <div className="pane-cuerpo">
        <div className="pane-seccion">
          <div className="pane-lista">
            <button
              type="button"
              className={`pane-item${mapa === "ideas" ? " activo" : ""}`}
              aria-pressed={mapa === "ideas"}
              onClick={() => onMapa("ideas")}
            >
              Mapa de ideas
            </button>
            <button
              type="button"
              className={`pane-item${mapa === "git" ? " activo" : ""}`}
              aria-pressed={mapa === "git"}
              onClick={() => onMapa("git")}
              disabled={!gitActivo}
              title={gitActivo ? "Ver cambios sin commit" : "Sin repositorio local"}
            >
              Mapa de Git
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}

/** Pane de archivos: el árbol del repo, y nada más.
 *
 *  La identidad del repo no se repite aquí: está en Resumen y en el pane de
 *  Git. El nombre de la carpeta lo pone el propio árbol como rótulo. */
export function PaneExplorador({
  proyeccion,
  onAbrirArchivo,
  onCerrar,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  onAbrirArchivo: (ruta: string) => void;
  onCerrar: () => void;
}) {
  return (
    <aside className="pane" aria-label="Explorador">
      <div className="pane-cabecera">
        <span className="panel-titulo">Explorador</span>
        <button
          type="button"
          className="btn ghost"
          onClick={onCerrar}
          aria-label="Cerrar explorador"
        >
          ✕
        </button>
      </div>

      <div className="pane-cuerpo">
        {proyeccion ? (
          <div className="pane-seccion">
            <ExploradorArbol
              repo={proyeccion.repo}
              cambios={proyeccion.git_cambios}
              onAbrir={onAbrirArchivo}
            />
          </div>
        ) : (
          <p className="hint">Cargando…</p>
        )}
      </div>
    </aside>
  );
}

/** Pane de Control de código fuente, al estilo de VS Code: la rama y el commit
 *  arriba, los archivos sin commit y una línea de tiempo con el historial.
 *
 *  Solo lectura: `commits` y `git_cambios` salen de la proyección que ya se
 *  refresca sola. Hacer commit o push desde aquí pediría escrituras nuevas en
 *  el core, y eso no está. */
export function PaneGit({
  proyeccion,
  commits,
  onIniciar,
  onCommit,
  onCerrar,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  commits: CommitGit[];
  /** `git init`, con la confirmación del `DialogoGit` de la app. */
  onIniciar: () => void;
  onCommit: (mensaje: string) => Promise<unknown>;
  onCerrar: () => void;
}) {
  const cambios = proyeccion?.git_cambios ?? [];
  const [mensaje, setMensaje] = useState("");
  const [fallo, setFallo] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  /* Commit local: se commitea todo lo que `git status` ve. El error del core
   * se enseña aquí y no se traga: «no hay cambios» o «faltan user.name» son
   * cosas que el usuario tiene que leer para arreglarlas. */
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    const texto = mensaje.trim();
    if (!texto || cambios.length === 0) return;
    setEnviando(true);
    setFallo(null);
    try {
      await onCommit(texto);
      setMensaje("");
    } catch (err: unknown) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <aside className="pane" aria-label="Control de código fuente">
      <div className="pane-cabecera">
        <span className="panel-titulo">Código fuente</span>
        <button
          type="button"
          className="btn ghost"
          onClick={onCerrar}
          aria-label="Cerrar control de código fuente"
        >
          ✕
        </button>
      </div>

      <div className="pane-cuerpo">
        {!proyeccion ? (
          <p className="hint">Cargando…</p>
        ) : !proyeccion.git ? (
          <>
            <p className="hint">
              Sin repositorio Git. El control de versiones se enciende cuando la carpeta tiene un
              work tree.
            </p>
            <button type="button" className="btn" onClick={onIniciar}>
              Inicializar repositorio
            </button>
          </>
        ) : (
          <>
            <div className="git-estado">
              <p className="git-rama" title={proyeccion.branch ?? "sin rama"}>
                {proyeccion.branch ?? "sin rama"}
              </p>
              <p className="git-hash" title={proyeccion.commit ?? "sin commits"}>
                {proyeccion.commit ?? "sin commits"}
              </p>
            </div>

            <form className="git-commit" onSubmit={enviar}>
              <textarea
                className="git-mensaje"
                rows={2}
                maxLength={200}
                placeholder="Mensaje del commit"
                aria-label="Mensaje del commit"
                value={mensaje}
                onChange={(e) => setMensaje(e.target.value)}
              />
              <div className="git-commit-fila">
                <span className="git-commit-n">
                  {cambios.length === 0 ? "Sin cambios" : `${cambios.length} archivo(s)`}
                </span>
                <button
                  type="submit"
                  className="btn"
                  disabled={enviando || cambios.length === 0 || !mensaje.trim()}
                >
                  {enviando ? "Commiteando…" : "Commit"}
                </button>
              </div>
              {fallo && <p className="hint error">{fallo}</p>}
            </form>

            <p className="pane-rotulo">Cambios</p>
            {cambios.length === 0 ? (
              <p className="arbol-vacio">Nada sin commit.</p>
            ) : (
              <ul className="pane-cambios">
                {cambios.map((cambio) => (
                  <li key={`${cambio.estado}-${cambio.ruta}`}>
                    <span className="pane-cambio-estado">{cambio.estado}</span>
                    <span className="pane-cambio-ruta" title={cambio.ruta}>
                      {cambio.ruta}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <p className="pane-rotulo">Historial</p>
            {commits.length === 0 ? (
              <p className="arbol-vacio">Sin commits todavía.</p>
            ) : (
              <ol className="pane-historial">
                {commits.map((commit) => (
                  <li key={commit.hash} className="pane-commit">
                    <span className="pane-commit-asunto" title={commit.asunto}>
                      {commit.asunto}
                    </span>
                    <span className="pane-commit-meta">
                      <span className="pane-commit-hash">{commit.hash}</span>
                      <span title={commit.fecha}>{fechaCorta(commit.fecha)}</span>
                      <span className="pane-commit-autor" title={commit.autor}>
                        {commit.autor}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
