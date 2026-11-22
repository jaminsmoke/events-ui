import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import type { ThemedToken } from "shiki/core";
import remarkGfm from "remark-gfm";

import { lenguajeDe, resaltar } from "../core/resaltado";
import { useArchivo } from "../core/useArchivo";

/** Visor de un archivo del repo, como vista Archivo del panel derecho.
 *
 *  Markdown abre en renderizado y ofrece la pestaña Raw; un JSON válido se
 *  enseña formateado y guarda su fuente en Original; el resto se pinta como
 *  código. Es solo lectura: no se edita ni se guarda nada. El HTML crudo del
 *  Markdown se queda como texto (react-markdown no lo interpreta) y las
 *  imágenes se anuncian en vez de cargar rutas relativas que aún no se sirven.
 *  El cierre es el del panel; aquí solo van la ruta y las pestañas de vista.
 */
export function VisorArchivo({ repo, ruta }: { repo: string; ruta: string }) {
  const { datos, error, cargando } = useArchivo(repo, ruta);
  const esMarkdown = /\.(md|markdown)$/i.test(ruta);
  const [modo, setModo] = useState<"render" | "raw">("render");
  // Un minificado se lee mal aunque tenga colores: si parsea, se formatea. Si
  // no —JSONC, un error de sintaxis— se queda el fuente y su resaltado.
  const json = useMemo(() => {
    if (!datos || !/\.json$/i.test(ruta)) return null;
    try {
      return `${JSON.stringify(JSON.parse(datos.texto), null, 2)}\n`;
    } catch {
      return null;
    }
  }, [datos, ruta]);
  const pestanas = esMarkdown
    ? ([
        ["render", "Renderizado"],
        ["raw", "Raw"],
      ] as const)
    : json !== null
      ? ([
          ["render", "Formateado"],
          ["raw", "Original"],
        ] as const)
      : null;

  return (
    <section className="visor" aria-label={`Visor de ${ruta}`}>
      <header className="visor-cabecera">
        <div className="visor-titulo">
          <span className="visor-ruta" title={ruta}>
            {ruta}
          </span>
          <span className="visor-meta">
            {datos
              ? `${datos.bytes.toLocaleString("es-ES")} B${datos.truncado ? " · solo el principio" : ""}`
              : "…"}
          </span>
        </div>

        {pestanas && datos && (
          <div
            className="panel-pestanas"
            role="tablist"
            aria-label={esMarkdown ? "Vista del Markdown" : "Vista del JSON"}
          >
            {pestanas.map(([clave, etiqueta]) => (
              <button
                key={clave}
                type="button"
                role="tab"
                aria-selected={modo === clave}
                className={`chip${modo === clave ? " activo" : ""}`}
                onClick={() => setModo(clave)}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        )}
      </header>

      <div className="visor-cuerpo">
        {cargando && <p className="hint">Cargando…</p>}
        {error && <p className="hint">{error}</p>}
        {datos && (
          <>
            {datos.truncado && (
              <p className="visor-aviso">
                El archivo supera 512 KiB: se muestra solo el principio.
              </p>
            )}
            {esMarkdown && modo === "render" ? (
              <Markdown texto={datos.texto} />
            ) : json !== null && modo === "render" ? (
              <Codigo codigo={json} lenguaje="json" />
            ) : (
              <Codigo codigo={datos.texto} lenguaje={lenguajeDe(datos.ruta)} />
            )}
          </>
        )}
      </div>
    </section>
  );
}

/** Un bloque de código con números de línea. Mientras Shiki carga —o si no hay
 *  gramática— se pinta el texto plano; el `pre` no cambia de tamaño al llegar
 *  los colores porque el número de líneas es el mismo. */
function Codigo({ codigo, lenguaje }: { codigo: string; lenguaje: string | null }) {
  const [lineas, setLineas] = useState<ThemedToken[][] | null>(null);

  useEffect(() => {
    let vivo = true;
    void resaltar(codigo, lenguaje).then((resultado) => {
      if (vivo) setLineas(resultado);
    });
    return () => {
      vivo = false;
    };
  }, [codigo, lenguaje]);

  const filas: readonly { content: string; color?: string }[][] =
    lineas ??
    codigo.split("\n").map((linea) => (linea === "" ? [] : [{ content: linea }]));

  return (
    <pre className={`visor-codigo${lineas ? " resaltado" : ""}`}>
      {filas.map((tokens, i) => (
        <div className="visor-linea" key={i}>
          <span className="visor-numero" aria-hidden="true">
            {i + 1}
          </span>
          <span className="visor-texto">
            {tokens.length === 0
              ? "\u00a0"
              : tokens.map((token, j) => (
                  <span key={j} style={token.color ? { color: token.color } : undefined}>
                    {token.content}
                  </span>
                ))}
          </span>
        </div>
      ))}
    </pre>
  );
}

/** Render de Markdown con el mismo resaltador que el visor de código. Los
 *  enlaces no navegan dentro de la app (abren fuera) y las imágenes quedan
 *  como aviso hasta que exista un endpoint de binarios. */
const COMPONENTES: Components = {
  pre: ({ children }) => <>{children}</>,
  code: ({ className, children }) => {
    const texto = String(children).replace(/\n$/, "");
    const lenguaje = /language-([\w-]+)/.exec(className ?? "")?.[1] ?? null;
    if (lenguaje !== null || texto.includes("\n")) {
      return <Codigo codigo={texto} lenguaje={lenguaje} />;
    }
    return <code className="visor-inline">{children}</code>;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  img: ({ alt, src }) => (
    <span className="visor-imagen" title={src}>
      [imagen: {alt || src}]
    </span>
  ),
};

function Markdown({ texto }: { texto: string }) {
  return (
    <div className="visor-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={COMPONENTES}>
        {texto}
      </ReactMarkdown>
    </div>
  );
}
