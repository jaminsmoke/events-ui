import type { Actualizacion } from "../core/actualizacion";

/** Aviso de versión nueva, encima del marco.
 *
 *  No es modal: se puede seguir trabajando o posponer. La descarga la dispara
 *  el botón y el reinicio lo hace el envoltorio cuando termina. Solo aparece
 *  donde el envoltorio inyecta la actualización (desktop), así que la web no
 *  pinta nada. */
export function BannerActualizacion({ actualizacion }: { actualizacion: Actualizacion }) {
  const { estado, nueva, progreso, mensaje, instalar, descartar } = actualizacion;
  // Sin versión nueva no hay banda: un fallo del chequeo automático (por
  // ejemplo, una release sin latest.json) se queda en Ajustes, no encima del
  // mapa en cada arranque.
  if (!nueva) return null;

  const porcentaje = progreso === null ? null : Math.round(progreso * 100);

  return (
    <aside className={`actualizacion ${estado}`} role="status" aria-live="polite">
      <div className="actualizacion-texto">
        {estado === "error" && (
          <strong>{mensaje ?? "No se pudo completar la actualización."}</strong>
        )}
        {estado !== "error" && (
          <>
            <strong>Events UI {nueva.version} disponible</strong>
            {nueva.notas && <span className="actualizacion-notas">{nueva.notas}</span>}
          </>
        )}
        {estado === "descargando" && (
          <span className="actualizacion-progreso">
            {porcentaje === null ? "Descargando…" : `${porcentaje}%`}
          </span>
        )}
      </div>
      <div className="actualizacion-acciones">
        {nueva && estado !== "descargando" && (
          <button className="btn" type="button" onClick={instalar}>
            Instalar y reiniciar
          </button>
        )}
        {nueva && estado !== "descargando" && (
          <button className="btn ghost" type="button" onClick={descartar}>
            Más tarde
          </button>
        )}
      </div>
    </aside>
  );
}
