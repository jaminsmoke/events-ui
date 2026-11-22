import { useState } from "react";

import type { Actualizacion } from "../core/actualizacion";
import type { Ajustes, Verbosidad } from "../core/avisos";

/** Diálogo de ajustes: avisos del sistema y, en desktop, actualizaciones.
 *
 *  Solo se ofrece donde hay avisos del sistema (desktop): la web no inyecta
 *  `avisar` y el botón de Ajustes no se pinta. `actualizacion` es opcional
 *  por lo mismo: sin plugin updater no hay sección que enseñar. Cerrar es
 *  cancelar. */
export function Ajustes({
  ajustes,
  actualizacion,
  onGuardar,
  onCerrar,
}: {
  ajustes: Ajustes;
  actualizacion?: Actualizacion;
  onGuardar: (ajustes: Ajustes) => void;
  onCerrar: () => void;
}) {
  const [verbosidad, setVerbosidad] = useState<Verbosidad>(ajustes.verbosidad);
  const [soloFondo, setSoloFondo] = useState(ajustes.soloFondo);

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    onGuardar({ verbosidad, soloFondo });
  };

  const comprobando =
    actualizacion?.estado === "comprobando" || actualizacion?.estado === "descargando";

  return (
    <div className="modal-fondo" role="presentation" onClick={onCerrar}>
      <div
        className="modal"
        role="dialog"
        aria-label="Ajustes"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      >
        <form onSubmit={guardar}>
          <h2>Ajustes de avisos</h2>
          <label>
            Qué avisar
            <select
              value={verbosidad}
              onChange={(e) => setVerbosidad(e.target.value as Verbosidad)}
              aria-label="Qué avisar"
            >
              <option value="apagado">Nada (apagado)</option>
              <option value="errores">Solo errores</option>
              <option value="eventos">Solo eventos</option>
              <option value="todo">Eventos y errores</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={soloFondo}
              onChange={(e) => setSoloFondo(e.target.checked)}
              aria-label="Solo cuando no estoy mirando"
            />
            Solo cuando no estoy mirando la ventana
          </label>
          <p className="hint">
            Los avisos llegan como notificaciones del sistema. Cerrar la
            ventana no cierra la app: queda en la bandeja hasta «Salir».
          </p>

          {actualizacion && (
            <section className="ajustes-actualizacion">
              <h3>Actualizaciones</h3>
              <p className="hint">Versión actual: {actualizacion.version}</p>
              <button
                className="btn ghost"
                type="button"
                onClick={actualizacion.comprobar}
                disabled={comprobando}
              >
                {comprobando ? "Buscando…" : "Buscar actualizaciones"}
              </button>
              {actualizacion.nueva && (
                <p className="hint">
                  Hay una versión nueva: {actualizacion.nueva.version}. Cierra
                  este diálogo para instalarla desde el aviso.
                </p>
              )}
              {actualizacion.mensaje && <p className="hint">{actualizacion.mensaje}</p>}
            </section>
          )}

          <div className="modal-acciones">
            <button className="btn" type="submit">
              Guardar
            </button>
            <button className="btn ghost" type="button" onClick={onCerrar}>
              Cancelar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
