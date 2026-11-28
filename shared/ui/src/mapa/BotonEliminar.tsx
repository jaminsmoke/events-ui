/** El borrado de un ítem, compartido por la fila y el inspector.
 *
 *  La confirmación —«Eliminar» y luego «¿Eliminar del todo?»— vive aquí: las
 *  dos superficies ofrecen el mismo texto, el mismo bloqueo mientras el core
 *  trabaja y el mismo aviso si el borrado falla, sin guardar cada una su
 *  `confirmando` ni repetir el markup. La fila y el inspector solo deciden si
 *  el carril permite borrar (`sePuedeEliminar`) y pasan `onBorrar`.
 */
import { useState } from "react";

import { sePuedeEliminar } from "../modelo/carriles";
import type { Status } from "../modelo/carriles";

export function BotonEliminar({
  uid,
  estado,
  onBorrar,
  className = "btn ghost mover",
}: {
  uid: string;
  estado: Status;
  onBorrar?: (uid: string) => Promise<void>;
  className?: string;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  if (!onBorrar || !sePuedeEliminar(estado)) return null;

  if (!confirmando) {
    return (
      <button
        type="button"
        className={className}
        title="Pasa por Eliminadas y se quema; no se guarda"
        onClick={() => setConfirmando(true)}
      >
        Eliminar
      </button>
    );
  }

  return (
    <span className="fila-acciones">
      ¿Eliminar del todo?
      <button
        className={className}
        type="button"
        disabled={trabajando}
        onClick={() => {
          setTrabajando(true);
          setFallo(null);
          onBorrar(uid)
            .catch((err: unknown) => setFallo(err instanceof Error ? err.message : String(err)))
            .finally(() => setTrabajando(false));
        }}
      >
        Sí
      </button>
      <button className={className} type="button" onClick={() => setConfirmando(false)}>
        No
      </button>
      {fallo && <span className="hint error">{fallo}</span>}
    </span>
  );
}
