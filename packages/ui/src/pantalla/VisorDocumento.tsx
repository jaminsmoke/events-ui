import { useEffect, useState } from "react";

import { api, unwrap } from "../core/api";
import type { DocumentoMarkdown } from "../core/api";
import { Markdown } from "./VisorArchivo";

type Estado =
  | { ruta: string; datos: DocumentoMarkdown }
  | { ruta: string; error: string };

/** Visor del Markdown que el core genera desde los ítems de un documento.
 *
 *  No lee el fichero original: el documento puede estar retirado. La vista se
 *  pide cada vez que se abre, así refleja el estado actual de las ideas.
 */
export function VisorDocumento({ repo, ruta }: { repo: string; ruta: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [copiado, setCopiado] = useState<"no" | "si" | "fallo">("no");

  useEffect(() => {
    let vivo = true;
    void unwrap(
      api.GET("/documentos/markdown", { params: { query: { repo, ruta } } }),
    )
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
  const datos = actual && "datos" in actual ? actual.datos : null;
  const error = actual && "error" in actual ? actual.error : null;

  const copiar = async () => {
    if (!datos) return;
    try {
      await navigator.clipboard.writeText(datos.texto);
      setCopiado("si");
    } catch {
      setCopiado("fallo");
    }
  };

  return (
    <section className="visor" aria-label={`Documento ${ruta}`}>
      <header className="visor-cabecera">
        <div className="visor-titulo">
          <span className="visor-ruta" title={ruta}>
            {ruta}
          </span>
          <span className="visor-meta">
            {datos
              ? `Documento absorbido · ${datos.texto.split("\n").length} líneas`
              : "Documento absorbido"}
          </span>
        </div>
        {datos && (
          <button
            type="button"
            className="btn ghost visor-copiar"
            title="Copiar el Markdown"
            onClick={() => void copiar()}
          >
            {copiado === "si" ? "Copiado" : copiado === "fallo" ? "No se pudo" : "Copiar"}
          </button>
        )}
      </header>

      <div className="visor-cuerpo">
        {!datos && !error && <p className="hint">Cargando…</p>}
        {error && <p className="hint">{error}</p>}
        {datos && <Markdown texto={datos.texto} repo={repo} ruta={ruta} />}
      </div>
    </section>
  );
}
