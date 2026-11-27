import { useEffect, useState } from "react";

import { api, unwrap } from "./api";
import type { Puerta } from "./api";

/** Las puertas activas de un repo, una sola vez para el panel.
 *
 *  Antes las pedía cada montaje del inspector: seleccionar otro ítem volvía a
 *  lanzar la misma lectura. El dato es del repo, no del ítem.
 */
export function usePuertas(repo: string | null) {
  const [estado, setEstado] = useState<{ repo: string; puertas: Puerta[] } | null>(
    null,
  );
  const [fallo, setFallo] = useState<{ repo: string; mensaje: string } | null>(null);

  useEffect(() => {
    // Sin repo no hay nada que pedir: la app arranca antes de elegirlo.
    if (!repo) return;
    const controller = new AbortController();
    let vivo = true;
    void unwrap(
      api.GET("/puertas", {
        params: { query: { repo } },
        signal: controller.signal,
      }),
    )
      .then((puertas) => {
        if (!vivo) return;
        setEstado({ repo, puertas });
        setFallo(null);
      })
      .catch((err: unknown) => {
        if (!vivo) return;
        setFallo({
          repo,
          mensaje: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      vivo = false;
      controller.abort();
    };
  }, [repo]);

  return {
    puertas: estado?.repo === repo ? estado.puertas : null,
    error: fallo?.repo === repo ? fallo.mensaje : null,
  };
}
