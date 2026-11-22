import { useMemo, useState } from "react";

import type { CambioGit, NodoArbol } from "../core/api";
import { folderName } from "../core/repo";
import { useArbol } from "../core/useArbol";

/** Árbol de archivos del repo, plegable y vivo.
 *
 *  Solo pide los niveles desplegados: el resto del repo no se recorre. Un
 *  archivo con cambios sin commit lleva su marca de Git, la misma que cuenta
 *  el mapa. */
export function ExploradorArbol({
  repo,
  cambios,
  onAbrir,
}: {
  repo: string;
  cambios: CambioGit[];
  /** Pulsar un archivo lo abre en el visor del marco. */
  onAbrir: (ruta: string) => void;
}) {
  const [abiertas, setAbiertas] = useState<string[]>([]);
  // La raíz (`""`) va siempre; lo demás es lo que el usuario desplegó.
  const rutas = useMemo(() => ["", ...abiertas], [abiertas]);
  const { hijos, error } = useArbol(repo, rutas);

  const estado = useMemo(() => {
    const porRuta = new Map<string, string>();
    for (const cambio of cambios) porRuta.set(cambio.ruta, cambio.estado);
    return porRuta;
  }, [cambios]);

  const alternar = (ruta: string) =>
    setAbiertas((previas) =>
      previas.includes(ruta) ? previas.filter((previa) => previa !== ruta) : [...previas, ruta],
    );

  if (error) return <p className="hint">{error}</p>;

  return (
    <div className="arbol">
      {/* El nombre de la carpeta es el rótulo del árbol: es lo que estás
          mirando. La ruta completa queda en el `title`, que no come ancho. */}
      <p className="arbol-raiz" title={repo}>
        {folderName(repo)}
      </p>
      <Nivel
        ruta=""
        mapa={hijos}
        abiertas={abiertas}
        estado={estado}
        profundidad={0}
        onAlternar={alternar}
        onAbrir={onAbrir}
      />
    </div>
  );
}

/** El nombre de un archivo con la extensión fija al final.
 *
 *  El ancho del pane recorta la base con puntos suspensivos, pero `.md`, `.ts`
 *  o `.py` se quedan: sin ellos un archivo no dice qué es. */
function NombreArchivo({ nombre }: { nombre: string }) {
  const punto = nombre.lastIndexOf(".");
  const hayExtension = punto > 0 && punto < nombre.length - 1;
  return (
    <span className="arbol-nombre arbol-nombre-archivo" title={nombre}>
      <span className="arbol-nombre-base">
        {hayExtension ? nombre.slice(0, punto) : nombre}
      </span>
      {hayExtension && <span className="arbol-nombre-ext">{nombre.slice(punto)}</span>}
    </span>
  );
}

/** Un nivel y, debajo, los que estén desplegados: el árbol se pinta solo con
 *  lo pedido, así que una carpeta cerrada no cuesta nada. */
function Nivel({
  ruta,
  mapa,
  abiertas,
  estado,
  profundidad,
  onAlternar,
  onAbrir,
}: {
  ruta: string;
  mapa: Record<string, NodoArbol[]>;
  abiertas: string[];
  estado: Map<string, string>;
  profundidad: number;
  onAlternar: (ruta: string) => void;
  onAbrir: (ruta: string) => void;
}) {
  // Todavía sin respuesta: ni "vacía" ni filas, para no parpadear al abrir.
  const hijos = mapa[ruta];
  if (!hijos) return null;

  if (hijos.length === 0) {
    return (
      <p className="arbol-vacio" style={{ paddingLeft: 8 + profundidad * 12 }}>
        vacía
      </p>
    );
  }

  return (
    <ul className="arbol-lista">
      {hijos.map((hijo) =>
        hijo.tipo === "carpeta" ? (
          <li key={hijo.ruta}>
            <button
              type="button"
              className="arbol-fila"
              aria-expanded={abiertas.includes(hijo.ruta)}
              style={{ paddingLeft: 4 + profundidad * 12 }}
              onClick={() => onAlternar(hijo.ruta)}
            >
              <span className="arbol-flecha" aria-hidden="true">
                {abiertas.includes(hijo.ruta) ? "▾" : "▸"}
              </span>
              <span className="arbol-nombre">{hijo.nombre}</span>
            </button>
            {abiertas.includes(hijo.ruta) && (
              <Nivel
                ruta={hijo.ruta}
                mapa={mapa}
                abiertas={abiertas}
                estado={estado}
                profundidad={profundidad + 1}
                onAlternar={onAlternar}
                onAbrir={onAbrir}
              />
            )}
          </li>
        ) : (
          <li key={hijo.ruta}>
            <button
              type="button"
              className="arbol-fila arbol-archivo"
              style={{ paddingLeft: 4 + profundidad * 12 }}
              title={hijo.ruta}
              onClick={() => onAbrir(hijo.ruta)}
            >
              <span className="arbol-flecha" aria-hidden="true" />
              <NombreArchivo nombre={hijo.nombre} />
              {estado.has(hijo.ruta) && (
                <span className="arbol-cambio">{estado.get(hijo.ruta)}</span>
              )}
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
