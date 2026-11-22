import { useEffect, useState } from "react";

import { api, unwrap } from "./api";
import type { Archivo } from "./api";

type Estado =
  | { ruta: string; datos: Archivo }
  | { ruta: string; error: string };

/** El texto de un archivo del repo, pedido al abrirse.
 *
 *  No hay sondeo: el archivo no cambia mientras se lee y el visor se vuelve a
 *  abrir para ver otra versión. El estado pertenece a una ruta, así que cambiar
 *  de archivo no enseña el anterior ni un frame.
 */
export function useArchivo(repo: string, ruta: string) {
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    let vivo = true;
    void unwrap(api.GET("/archivo", { params: { query: { repo, ruta } } }))
      .then((datos) => {
        if (vivo) setEstado({ ruta, datos });
      })
      .catch((err: unknown) => {
        if (vivo) {
          setEstado({ ruta, error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      vivo = false;
    };
  }, [repo, ruta]);

  const actual = estado && estado.ruta === ruta ? estado : null;
  return {
    datos: actual && "datos" in actual ? actual.datos : null,
    error: actual && "error" in actual ? actual.error : null,
    cargando: actual === null,
  };
}
