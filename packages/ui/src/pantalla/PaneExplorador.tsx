import type { ProyeccionRepo } from "../core/api";
import { ExploradorArbol } from "./ExploradorArbol";

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
