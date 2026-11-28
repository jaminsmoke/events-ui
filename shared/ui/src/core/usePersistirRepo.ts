import { useEffect, useRef } from "react";

import { persistirRepo } from "./persistir";
import { STORAGE_KEY } from "./repo";

/** La carpeta elegida se recuerda en `localStorage` y se manda al core una vez.
 *
 *  El SSE relee el mapa por cada evento y repinta `App`; si el efecto
 *  dependiera de `put` (una flecha nueva en cada render), cada relectura
 *  volvería a escribir `config.json` con su fsync. Por eso el efecto solo
 *  depende de la carpeta y `put` viaja por una ref. La guarda `persistido`
 *  evita además repetir el PUT del repo que el core ya confirmó, también al
 *  arrancar con una carpeta guardada. `persistirRepo` reintenta si el core no
 *  contesta.
 */
export function usePersistirRepo(
  repo: string | null,
  put: (repo: string) => Promise<unknown>,
) {
  const persistido = useRef<string | null>(null);
  const enviar = useRef(put);
  useEffect(() => {
    enviar.current = put;
  }, [put]);

  useEffect(() => {
    if (!repo) return;
    try {
      localStorage.setItem(STORAGE_KEY, repo);
    } catch {
      // Recordar la carpeta es opcional.
    }
    if (persistido.current === repo) return;
    return persistirRepo(repo, (r) => enviar.current(r), {
      alGuardar: () => {
        persistido.current = repo;
      },
    });
  }, [repo]);
}
