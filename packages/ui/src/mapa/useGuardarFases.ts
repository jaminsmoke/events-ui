import { useState } from "react";

import type { Fase } from "../modelo/fase";

/** Guardar una lista de fases y enseñar el fallo, igual en la fila y en la
 *  ficha. Sin `alGuardar` (ficha de solo lectura), no hace nada. */
export function useGuardarFases(
  alGuardar?: (siguientes: readonly Fase[]) => Promise<void>,
) {
  const [guardando, setGuardando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  const guardar = (siguientes: readonly Fase[]) => {
    if (!alGuardar) return;
    setGuardando(true);
    setFallo(null);
    alGuardar(siguientes)
      .catch((err: unknown) => {
        setFallo(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setGuardando(false));
  };

  return { guardando, fallo, guardar };
}
