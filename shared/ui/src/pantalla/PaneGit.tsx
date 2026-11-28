import { useState } from "react";
import type { FormEvent } from "react";

import type { CommitGit, ProyeccionRepo } from "../core/api";
import { fechaCorta } from "../core/formato";

/** Pane de Control de código fuente, al estilo de VS Code: la rama y el commit
 *  arriba, los archivos sin commit y una línea de tiempo con el historial.
 *
 *  Solo lectura salvo el commit: `commits` y `git_cambios` salen de la
 *  proyección que ya se refresca sola. */
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
