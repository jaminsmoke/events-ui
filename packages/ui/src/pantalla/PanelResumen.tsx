import type { ProyeccionRepo } from "../core/api";
import { folderName } from "../core/repo";
import { fechaCorta } from "../mapa/formato";

/** Panel derecho del marco: el estado del repo de un vistazo. Sale por encima
 *  del lienzo —no le roba ancho— y se lee de la misma `ProyeccionRepo` que la
 *  statusbar, sin pedir nada nuevo al core. */
export function PanelResumen({
  proyeccion,
  conectado,
  onClose,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  conectado: boolean;
  onClose: () => void;
}) {
  // De mayor a menor: el carril que más tiene es el que más interesa.
  const estados = proyeccion
    ? Object.entries(proyeccion.por_estado).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )
    : [];
  const maximo = Math.max(1, ...estados.map(([, n]) => n));

  return (
    <aside className="resumen" aria-label="Resumen del repo">
      <div className="panel-cabecera">
        <span className="panel-titulo">Resumen</span>
        <button
          type="button"
          className="btn ghost"
          onClick={onClose}
          aria-label="Cerrar resumen"
        >
          ✕
        </button>
      </div>

      <div className="panel-cuerpo resumen-cuerpo">
        {!proyeccion ? (
          <p className="hint">Cargando…</p>
        ) : (
          <>
            <p className="resumen-repo" title={proyeccion.repo}>
              {folderName(proyeccion.repo)}
            </p>
            <p className="resumen-ruta" title={proyeccion.repo}>
              {proyeccion.repo}
            </p>

            <div className="resumen-cifras">
              <div className="resumen-cifra">
                <strong>{proyeccion.ideas}</strong>
                <span>ideas</span>
              </div>
              <div className="resumen-cifra">
                <strong>{proyeccion.events}</strong>
                <span>eventos</span>
              </div>
              <div className="resumen-cifra">
                <strong>{proyeccion.git_cambios.length}</strong>
                <span>cambios</span>
              </div>
            </div>

            <dl className="resumen-dl">
              <dt>Rama</dt>
              <dd>{proyeccion.branch ?? "—"}</dd>
              <dt>Commit</dt>
              <dd>{proyeccion.commit ?? "—"}</dd>
              <dt>Work tree</dt>
              <dd>{proyeccion.git ? "sí" : "no"}</dd>
              <dt>Última actividad</dt>
              <dd>
                {proyeccion.ultima_actividad ? fechaCorta(proyeccion.ultima_actividad) : "—"}
              </dd>
              <dt>En vivo</dt>
              <dd>{conectado ? "conectado" : "sin SSE"}</dd>
            </dl>

            <p className="pane-rotulo">Por estado</p>
            {estados.length === 0 ? (
              <p className="hint">Sin ideas todavía.</p>
            ) : (
              <div className="resumen-estados">
                {estados.map(([estado, n]) => (
                  <div key={estado} className="resumen-estado">
                    <span>{estado}</span>
                    <strong>{n}</strong>
                    <span className="resumen-estado-barra" aria-hidden="true">
                      <span style={{ width: `${Math.round((n / maximo) * 100)}%` }} />
                    </span>
                  </div>
                ))}
              </div>
            )}

            {proyeccion.git_cambios.length > 0 && (
              <>
                <p className="pane-rotulo">Cambios sin commit</p>
                <ul className="resumen-cambios">
                  {proyeccion.git_cambios.map((cambio) => (
                    <li key={`${cambio.estado}-${cambio.ruta}`}>
                      <span className="cambio-estado">{cambio.estado}</span>
                      <span className="cambio-ruta" title={cambio.ruta}>
                        {cambio.ruta}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
