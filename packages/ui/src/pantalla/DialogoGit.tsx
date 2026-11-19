import { useState } from "react";

import type { ProyeccionRepo } from "../core/api";

/** Confirmación para crear (`git init`) o eliminar (solo su `.git`) el repo
 *  local del repo abierto. Las dos direcciones piden permiso: eliminar
 *  porque se pierde el historial, crear porque cambia una carpeta `git init`.
 *  El texto es explícito y el error del core se enseña aquí, no se traga. */
export function DialogoGit({
  tipo,
  ruta,
  rama,
  onConfirmar,
  onCerrar,
}: {
  tipo: "crear" | "eliminar";
  /** Carpeta del repo abierto (de la proyección): se nombra para no dudar. */
  ruta: string;
  rama?: string | null;
  onConfirmar: () => Promise<ProyeccionRepo | null>;
  onCerrar: () => void;
}) {
  const [fallo, setFallo] = useState<string | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const crear = tipo === "crear";

  const confirmar = async (e: React.FormEvent) => {
    e.preventDefault();
    setTrabajando(true);
    setFallo(null);
    try {
      await onConfirmar();
      onCerrar();
    } catch (err: unknown) {
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <div className="modal-fondo" role="presentation" onClick={onCerrar}>
      <div
        className="modal"
        role="dialog"
        aria-label={crear ? "Crear repo local" : "Eliminar repo local"}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      >
        <form onSubmit={confirmar}>
          <h2>{crear ? "Crear repo local" : "Eliminar repo local"}</h2>
          {crear ? (
            <p className="hint">
              Se ejecutará <code>git init</code> en <span className="mono">{ruta}</span>. El
              puente y la pestaña de Git se encenderán.
            </p>
          ) : (
            <p className="hint">
              Se eliminará solo la carpeta <code>.git</code> de <span className="mono">{ruta}</span>
              {rama ? ` (rama ${rama})` : ""}. Tus ideas (`.EUI`) no se tocan, pero se pierde el
              historial y los commits locales no subidos.
            </p>
          )}
          {fallo && <p className="hint error">{fallo}</p>}
          <div className="modal-acciones">
            <button className="btn" type="submit" disabled={trabajando}>
              {crear ? "Crear repo" : "Eliminar repo"}
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
