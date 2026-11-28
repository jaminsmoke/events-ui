import { useState } from "react";

import type { ProyeccionRepo } from "../../core/api";
import { fechaCorta } from "../../core/formato";
import { folderName } from "../../core/repo";

/** Resumen del repo de un vistazo: cifras, rama, almacén y cambios.
 *
 *  Se lee de la misma `ProyeccionRepo` que la statusbar, sin pedir nada nuevo
 *  al core. La acción de ignorar `.EUI/` pide confirmación en la propia ficha:
 *  escribir en el `.gitignore` del repo es pequeño, pero no silencioso. */
export function CuerpoResumen({
  proyeccion,
  conectado,
  onIgnorarAlmacen,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  conectado: boolean;
  onIgnorarAlmacen: () => Promise<unknown>;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [ignorando, setIgnorando] = useState(false);
  const [falloIgnorar, setFalloIgnorar] = useState<string | null>(null);
  const estadoAlmacen =
    proyeccion?.git !== true
      ? "—"
      : proyeccion.eui_ignorado === true
        ? "ignorado por Git"
        : proyeccion.eui_ignorado === false
          ? "se versiona con el repo"
          : "sin comprobar";
  const ignorar = async () => {
    setIgnorando(true);
    setFalloIgnorar(null);
    try {
      await onIgnorarAlmacen();
      setConfirmando(false);
    } catch (err) {
      setFalloIgnorar(err instanceof Error ? err.message : String(err));
    } finally {
      setIgnorando(false);
    }
  };
  // De mayor a menor: el carril que más tiene es el que más interesa.
  const estados = proyeccion
    ? Object.entries(proyeccion.por_estado).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )
    : [];
  const maximo = Math.max(1, ...estados.map(([, n]) => n));

  return (
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
              <strong>{proyeccion.items}</strong>
              <span>ítems</span>
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
            <dt>Almacén</dt>
            <dd>{estadoAlmacen}</dd>
            <dt>Última actividad</dt>
            <dd>
              {proyeccion.ultima_actividad ? fechaCorta(proyeccion.ultima_actividad) : "—"}
            </dd>
            <dt>En vivo</dt>
            <dd>{conectado ? "conectado" : "sin SSE"}</dd>
          </dl>

          {proyeccion.git && proyeccion.eui_ignorado === false && (
            <div className="resumen-almacen">
              {!confirmando ? (
                <>
                  <p className="hint">
                    El almacén entrará en el próximo commit. Si prefieres que los
                    ítems no viajen en Git, ignóralo en esta raíz.
                  </p>
                  <button
                    type="button"
                    className="btn ghost"
                    aria-label="Ignorar .EUI"
                    onClick={() => {
                      setFalloIgnorar(null);
                      setConfirmando(true);
                    }}
                  >
                    Ignorar .EUI
                  </button>
                </>
              ) : (
                <>
                  <p className="hint">
                    Se añadirá <code>.EUI/</code> al <code>.gitignore</code> de
                    esta raíz. Los ítems dejarán de versionarse con el código.
                  </p>
                  <div className="resumen-almacen-acciones">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void ignorar()}
                      disabled={ignorando}
                    >
                      {ignorando ? "Ignorando…" : "Confirmar"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setConfirmando(false)}
                      disabled={ignorando}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}
              {falloIgnorar && <p className="hint">{falloIgnorar}</p>}
            </div>
          )}

          <p className="pane-rotulo">Por estado</p>
          {estados.length === 0 ? (
            <p className="hint">Sin ítems todavía.</p>
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
  );
}
