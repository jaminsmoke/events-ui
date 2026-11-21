import { useEffect, useRef, useState } from "react";

import type { CambioGit, CommitGit, ProyeccionRepo } from "../core/api";
import type { Seleccion } from "../mapa/seleccion";

const FECHA_LARGA = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

function fechaLarga(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : FECHA_LARGA.format(fecha);
}

/** La palabra del código de `git status`: el mapa trae el código crudo (`M`,
 *  `??`, `R`…) y la ficha lo acompaña de su nombre. Un estado desconocido se
 *  queda tal cual, sin inventarle etiqueta. */
function palabraCambio(estado: string): string {
  const codigo = estado.trim();
  if (codigo === "??") return "sin seguimiento";
  if (codigo === "!!") return "ignorado";
  switch (codigo.charAt(0)) {
    case "A":
      return "añadido";
    case "M":
      return "modificado";
    case "D":
      return "borrado";
    case "R":
      return "renombrado";
    case "C":
      return "copiado";
    case "T":
      return "tipo cambiado";
    case "U":
      return "conflicto";
    default:
      return codigo;
  }
}

/** La ficha del commit seleccionado. El contrato solo trae el hash abreviado,
 *  el asunto, el autor y la fecha; lo que no llega, no se inventa. */
export function CuerpoCommit({
  commit,
  indice,
  total,
  rama,
}: {
  commit: CommitGit;
  /** Posición en el historial: 0 es HEAD. */
  indice: number;
  total: number;
  rama?: string | null;
}) {
  const [copiado, setCopiado] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (temporizador.current) clearTimeout(temporizador.current);
    },
    [],
  );

  const copiar = async () => {
    try {
      await navigator.clipboard?.writeText(commit.hash);
      setCopiado(true);
      if (temporizador.current) clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => setCopiado(false), 1500);
    } catch {
      // Sin portapapeles (ventana no segura): el hash se sigue pudiendo leer.
    }
  };

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">{commit.asunto}</p>
      <dl className="inspector-dl">
        <dt>Commit</dt>
        <dd className="inspector-hash">
          <span className="inspector-mono" title="Hash abreviado, como lo da Git">
            {commit.hash}
          </span>
          <button
            type="button"
            className="btn ghost inspector-copiar"
            onClick={() => void copiar()}
          >
            {copiado ? "Copiado" : "Copiar"}
          </button>
        </dd>
        <dt>Autor</dt>
        <dd>{commit.autor}</dd>
        <dt>Fecha</dt>
        <dd title={commit.fecha}>{fechaLarga(commit.fecha)}</dd>
        <dt>Rama</dt>
        <dd className="inspector-mono">{rama ?? "—"}</dd>
        <dt>Posición</dt>
        <dd>
          {indice === 0 ? "HEAD · el más reciente" : `${indice + 1} de ${total} desde HEAD`}
        </dd>
      </dl>
    </div>
  );
}

/** La lista de cambios sin commit, con cada archivo a un clic de su ficha. */
export function CuerpoCambios({
  cambios,
  onSeleccionar,
}: {
  cambios: readonly CambioGit[];
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">Cambios sin commit</p>
      <p className="inspector-meta">
        {cambios.length === 1 ? "1 archivo" : `${cambios.length} archivos`}
      </p>

      {cambios.length === 0 ? (
        <p className="hint">Nada sin commit.</p>
      ) : (
        <ul className="inspector-lista">
          {cambios.map((cambio) => (
            <li key={`${cambio.estado}:${cambio.ruta}`}>
              <button
                type="button"
                className="inspector-idea"
                onClick={() => onSeleccionar({ tipo: "cambio", ruta: cambio.ruta })}
              >
                <span className="inspector-idea-titulo inspector-mono" title={cambio.ruta}>
                  {cambio.ruta}
                </span>
                <span className="cambio-estado" title={palabraCambio(cambio.estado)}>
                  {cambio.estado}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        El mapa solo trae ruta y estado; el contenido se abre desde el
        Explorador.
      </p>
    </div>
  );
}

/** La ficha de un archivo sin commit: su estado, de dónde vino si es un
 *  renombrado y cuántos cambios lo acompañan. Sin parche que enseñar. */
export function CuerpoCambio({
  cambio,
  total,
  onSeleccionar,
}: {
  cambio: CambioGit;
  /** Archivos sin commit en total, para situar el elegido. */
  total: number;
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto inspector-mono">{cambio.ruta}</p>
      <p className="inspector-meta">{palabraCambio(cambio.estado)}</p>

      <dl className="inspector-dl">
        <dt>Estado</dt>
        <dd>
          <span className="cambio-estado">{cambio.estado}</span>{" "}
          {palabraCambio(cambio.estado)}
        </dd>
        {cambio.origen && (
          <>
            <dt>Venía de</dt>
            <dd className="inspector-mono">{cambio.origen}</dd>
          </>
        )}
        <dt>Sin commit</dt>
        <dd>{total === 1 ? "es el único archivo" : `${total} archivos en total`}</dd>
      </dl>

      <button
        type="button"
        className="btn ghost inspector-volver"
        onClick={() => onSeleccionar({ tipo: "cambios" })}
      >
        Ver todos los cambios
      </button>

      <p className="hint">
        El parche no viaja en el mapa: se ve en el Explorador y en las fichas
        de fase.
      </p>
    </div>
  );
}

/** La ficha del puente y del nodo de Git: los dos leen la misma proyección.
 *  Sin work tree lo dicen en vez de pintar una rama inventada. */
export function CuerpoNodoGit({
  tipo,
  proyeccion,
}: {
  tipo: "git" | "puente";
  proyeccion: ProyeccionRepo | null | undefined;
}) {
  const activo = proyeccion?.git === true;
  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">
        {tipo === "puente" ? "Entregar a Git" : "Nodo de Git"}
      </p>
      <p className="inspector-meta">{activo ? "asociado al work tree" : "apagado"}</p>

      <dl className="inspector-dl">
        <dt>Rama</dt>
        <dd className="inspector-mono">{proyeccion?.branch ?? "—"}</dd>
        <dt>Commit</dt>
        <dd className="inspector-mono">{proyeccion?.commit ?? "sin commits"}</dd>
        <dt>Raíz</dt>
        <dd className="inspector-mono">{proyeccion?.git_root ?? "—"}</dd>
      </dl>

      <p className="hint">
        {tipo === "puente"
          ? "El puente cierra la línea de ideas y abre el Mapa de Git cuando hay work tree."
          : "Cierra el flujo y enseña el estado del work tree; no guarda ideas."}
      </p>
      {!activo && (
        <p className="hint">Sin repositorio local: se crea desde el puente.</p>
      )}
    </div>
  );
}

/** La ficha del nodo de historial: todos los commits, con cada uno a un clic
 *  de su propia ficha. */
export function CuerpoCommits({
  commits,
  rama,
  onSeleccionar,
}: {
  commits: readonly CommitGit[];
  rama?: string | null;
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">Commits</p>
      <p className="inspector-meta">
        {commits.length === 1 ? "1 commit" : `${commits.length} commits`}
        {rama ? ` en ${rama}` : ""}
      </p>

      {commits.length === 0 ? (
        <p className="hint">Sin commits todavía.</p>
      ) : (
        <ul className="inspector-lista">
          {commits.map((commit, indice) => (
            <li key={commit.hash}>
              <button
                type="button"
                className="inspector-idea"
                onClick={() => onSeleccionar({ tipo: "commit", hash: commit.hash })}
              >
                <span className="inspector-idea-titulo">{commit.asunto}</span>
                <span className="inspector-mono inspector-idea-estado">
                  {indice === 0 ? "HEAD" : commit.hash}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
