import { useState } from "react";

import type { Ajustes, Verbosidad } from "../core/avisos";

/** Diálogo de ajustes de avisos (F3): la verbosidad la elige el usuario.
 *
 *  Solo se ofrece donde hay avisos del sistema (desktop): la web no inyecta
 *  `avisar` y el botón de Ajustes no se pinta. Cerrar es cancelar. */
export function Ajustes({
  ajustes,
  onGuardar,
  onCerrar,
}: {
  ajustes: Ajustes;
  onGuardar: (ajustes: Ajustes) => void;
  onCerrar: () => void;
}) {
  const [verbosidad, setVerbosidad] = useState<Verbosidad>(ajustes.verbosidad);
  const [soloFondo, setSoloFondo] = useState(ajustes.soloFondo);

  const guardar = (e: React.FormEvent) => {
    e.preventDefault();
    onGuardar({ verbosidad, soloFondo });
  };

  return (
    <div className="modal-fondo" role="presentation" onClick={onCerrar}>
      <dialog
        className="modal"
        open
        aria-label="Ajustes de avisos"
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
          <div className="modal-acciones">
            <button className="btn" type="submit">
              Guardar
            </button>
            <button className="btn ghost" type="button" onClick={onCerrar}>
              Cancelar
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
