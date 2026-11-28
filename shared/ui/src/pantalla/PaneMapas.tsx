import type { MapaLienzo } from "./vistas";

/** Pane de Mapas: cuál de los tres mapas se está mirando.
 *
 *  Es navegación del lienzo, no del sistema de ficheros: por eso vive en su
 *  propia vista del rail y no dentro del Explorador. Documentos es un mapa
 *  (Changelog), no un pane del activity. */
export function PaneMapas({
  mapa,
  gitActivo,
  onMapa,
  onCerrar,
}: {
  mapa: MapaLienzo;
  gitActivo: boolean;
  onMapa: (mapa: MapaLienzo) => void;
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
              className={`pane-item${mapa === "items" ? " activo" : ""}`}
              aria-pressed={mapa === "items"}
              onClick={() => onMapa("items")}
            >
              Mapa de Trabajo
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
            <button
              type="button"
              className={`pane-item${mapa === "documentos" ? " activo" : ""}`}
              aria-pressed={mapa === "documentos"}
              onClick={() => onMapa("documentos")}
            >
              Mapa de Documentos
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
