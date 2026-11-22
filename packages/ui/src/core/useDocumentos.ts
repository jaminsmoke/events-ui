import { useEffect, useState } from "react";

import { api, unwrap } from "./api";
import type { DocumentoAbsorbido } from "./api";

type Estado =
  | { repo: string; documentos: DocumentoAbsorbido[] }
  | { repo: string; error: string };

/** Los documentos absorbidos del repo, pedidos al abrir el pane.
 *
 *  No hay sondeo: la lista cambia cuando se absorbe o se deshace un lote, y
 *  volver a abrir el pane la actualiza. El estado pertenece al repo para no
 *  enseñar documentos de la raíz anterior al cambiar de proyecto.
 */
export function useDocumentos(repo: string) {
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    let vivo = true;
    void unwrap(api.GET("/documentos", { params: { query: { repo } } }))
      .then((documentos) => {
        if (vivo) setEstado({ repo, documentos });
      })
      .catch((err: unknown) => {
        if (vivo) {
          setEstado({ repo, error: err instanceof Error ? err.message : String(err) });
        }
      });
    return () => {
      vivo = false;
    };
  }, [repo]);

  const actual = estado && estado.repo === repo ? estado : null;
  return {
    documentos: actual && "documentos" in actual ? actual.documentos : null,
    error: actual && "error" in actual ? actual.error : null,
    cargando: actual === null,
  };
}
