import { Fragment, useState } from "react";

import type { CommitGit, Idea, ProyeccionRepo } from "../core/api";
import { folderName } from "../core/repo";
import type { Paso } from "../core/useProtocolos";
import type { Cable, Nudo } from "../mapa/cables";
import { ETIQUETA_ESTADO, LANES } from "../mapa/carriles";
import type { LaneId, Status } from "../mapa/carriles";
import { TEXTO_EXIGENCIA } from "../mapa/protocolos";
import { fechaCorta } from "../mapa/formato";
import type { Seleccion } from "../mapa/seleccion";
import type { VistaDerecha } from "./Actividad";
import { CuerpoCable } from "./InspectorCable";
import {
  CuerpoCambio,
  CuerpoCambios,
  CuerpoCommit,
  CuerpoCommits,
  CuerpoNodoGit,
} from "./InspectorGit";
import { CuerpoIdea } from "./InspectorIdea";
import { CuerpoNudo } from "./InspectorNudo";
import type { AccionesIdea } from "./InspectorIdea";
import { VisorArchivo } from "./VisorArchivo";
import { VisorDocumento } from "./VisorDocumento";
/** Panel derecho del marco, con varias vistas que comparten cabecera.
 *
 *  Resumen es el estado del repo de un vistazo: sale por encima del lienzo —no
 *  le roba ancho— y se lee de la misma `ProyeccionRepo` que la statusbar, sin
 *  pedir nada nuevo al core. El Inspector recibe lo que se pulsa en el mapa:
 *  así los detalles caben aquí y las filas del lienzo pueden quedarse en una
 *  sola línea. Archivo reutiliza el mismo panel para el visor: al abrir un
 *  archivo no se monta otro panel, y al cerrarlo vuelve el lienzo entero. */
export function PanelDerecho({
  vista,
  onVista,
  repo,
  archivoAbierto,
  documentoAbierto,
  proyeccion,
  onIgnorarAlmacen,
  commits,
  seleccion,
  ideas,
  cables,
  nudos,
  paso,
  acciones,
  onSeleccionar,
  onAbrirArchivo,
  conectado,
  onClose,
}: {
  vista: VistaDerecha;
  onVista: (vista: VistaDerecha) => void;
  /** Repo del archivo abierto: el visor pide su texto a `/archivo`. */
  repo: string;
  /** Ruta abierta en la vista Archivo; `null` deja el aviso de vacío. */
  archivoAbierto: string | null;
  /** Documento absorbido abierto en su visor; `null` deja el aviso de vacío. */
  documentoAbierto: string | null;
  proyeccion: ProyeccionRepo | null | undefined;
  /** Escribe `.EUI/` en el `.gitignore` de esta raíz; lo ofrece el Resumen. */
  onIgnorarAlmacen: () => Promise<unknown>;
  commits: readonly CommitGit[];
  /** Lo seleccionado en el lienzo; `null`, nada. */
  seleccion: Seleccion | null;
  /** Las ideas del mapa: la ficha de un carril las lista por estado. */
  ideas: readonly Idea[];
  /** Los cables medidos: la ficha de un cable explica su compuerta. */
  cables: readonly Cable[];
  /** Los nudos del mapa: agrupan las compuertas de sus cables. */
  nudos: readonly Nudo[];
  /** El protocolo del repo: qué salidas hay y qué exige cada unión. */
  paso: (origen: Status, destino: Status) => Paso | null;
  /** Lo que la ficha de idea puede hacer con la idea seleccionada. */
  acciones: AccionesIdea;
  /** Pulsar una idea en la ficha la selecciona en el lienzo. */
  onSeleccionar: (seleccion: Seleccion) => void;
  /** Abrir un archivo de una ficha (cambio) en la vista Archivo. */
  onAbrirArchivo: (ruta: string) => void;
  conectado: boolean;
  onClose: () => void;
}) {
  const pestana = (clave: VistaDerecha, etiqueta: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={vista === clave}
      className={`chip${vista === clave ? " activo" : ""}`}
      onClick={() => onVista(clave)}
    >
      {etiqueta}
    </button>
  );

  return (
    <aside
      className={`resumen${vista === "archivo" || vista === "documento" ? " resumen--visor" : ""}`}
      aria-label="Panel derecho"
    >
      <div className="panel-cabecera">
        <div className="panel-pestanas" role="tablist">
          {pestana("resumen", "Resumen")}
          {pestana("inspector", "Inspector")}
          {archivoAbierto && pestana("archivo", "Archivo")}
          {documentoAbierto && pestana("documento", "Documento")}
        </div>
        <button
          type="button"
          className="btn ghost"
          onClick={onClose}
          aria-label="Cerrar panel derecho"
        >
          ✕
        </button>
      </div>

      {vista === "archivo" ? (
        archivoAbierto ? (
          <VisorArchivo key={archivoAbierto} repo={repo} ruta={archivoAbierto} />
        ) : (
          <div className="panel-cuerpo">
            <p className="hint">
              Ningún archivo abierto. Pulsa uno en el Explorador o en la ficha de
              un cambio.
            </p>
          </div>
        )
      ) : vista === "documento" ? (
        documentoAbierto ? (
          <VisorDocumento key={documentoAbierto} repo={repo} ruta={documentoAbierto} />
        ) : (
          <div className="panel-cuerpo">
            <p className="hint">
              Ningún documento abierto. Pulsa uno en el pane Documentos.
            </p>
          </div>
        )
      ) : vista === "resumen" ? (
        <CuerpoResumen
          proyeccion={proyeccion}
          conectado={conectado}
          onIgnorarAlmacen={onIgnorarAlmacen}
        />
      ) : (
        <CuerpoInspector
          proyeccion={proyeccion}
          commits={commits}
          seleccion={seleccion}
          ideas={ideas}
          cables={cables}
          nudos={nudos}
          paso={paso}
          acciones={acciones}
          onSeleccionar={onSeleccionar}
          onAbrirArchivo={onAbrirArchivo}
        />
      )}
    </aside>
  );
}

function CuerpoResumen({
  proyeccion,
  conectado,
  onIgnorarAlmacen,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  conectado: boolean;
  onIgnorarAlmacen: () => Promise<unknown>;
}) {
  // La acción pide confirmación en la propia ficha: escribir en el `.gitignore`
  // del repo es pequeño, pero no silencioso.
  const [confirmando, setConfirmando] = useState(false);
  const [ignorando, setIgnorando] = useState(false);
  const [falloIgnorar, setFalloIgnorar] = useState<string | null>(null);
  const estadoAlmacen =
    proyeccion?.git !== true
      ? "—"
      : proyeccion.eui_ignorado === true
        ? "ignorado por Git"
        : proyeccion.eui_ignorado === false
          ? "se versiona con el repo"
          : "sin comprobar";
  const ignorar = async () => {
    setIgnorando(true);
    setFalloIgnorar(null);
    try {
      await onIgnorarAlmacen();
      setConfirmando(false);
    } catch (err) {
      setFalloIgnorar(err instanceof Error ? err.message : String(err));
    } finally {
      setIgnorando(false);
    }
  };
  // De mayor a menor: el carril que más tiene es el que más interesa.
  const estados = proyeccion
    ? Object.entries(proyeccion.por_estado).sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )
    : [];
  const maximo = Math.max(1, ...estados.map(([, n]) => n));

  return (
    <div className="panel-cuerpo resumen-cuerpo">
      {!proyeccion ? (
        <p className="hint">Cargando…</p>
      ) : (
        <>
          <p className="resumen-repo" title={proyeccion.repo}>
            {folderName(proyeccion.repo)}
          </p>
          <p className="resumen-ruta" title={proyeccion.repo}>
            {proyeccion.repo}
          </p>

          <div className="resumen-cifras">
            <div className="resumen-cifra">
              <strong>{proyeccion.ideas}</strong>
              <span>ideas</span>
            </div>
            <div className="resumen-cifra">
              <strong>{proyeccion.events}</strong>
              <span>eventos</span>
            </div>
            <div className="resumen-cifra">
              <strong>{proyeccion.git_cambios.length}</strong>
              <span>cambios</span>
            </div>
          </div>

          <dl className="resumen-dl">
            <dt>Rama</dt>
            <dd>{proyeccion.branch ?? "—"}</dd>
            <dt>Commit</dt>
            <dd>{proyeccion.commit ?? "—"}</dd>
            <dt>Work tree</dt>
            <dd>{proyeccion.git ? "sí" : "no"}</dd>
            <dt>Almacén</dt>
            <dd>{estadoAlmacen}</dd>
            <dt>Última actividad</dt>
            <dd>
              {proyeccion.ultima_actividad ? fechaCorta(proyeccion.ultima_actividad) : "—"}
            </dd>
            <dt>En vivo</dt>
            <dd>{conectado ? "conectado" : "sin SSE"}</dd>
          </dl>

          {proyeccion.git && proyeccion.eui_ignorado === false && (
            <div className="resumen-almacen">
              {!confirmando ? (
                <>
                  <p className="hint">
                    El almacén entrará en el próximo commit. Si prefieres que las
                    ideas no viajen en Git, ignóralo en esta raíz.
                  </p>
                  <button
                    type="button"
                    className="btn ghost"
                    aria-label="Ignorar .EUI"
                    onClick={() => {
                      setFalloIgnorar(null);
                      setConfirmando(true);
                    }}
                  >
                    Ignorar .EUI
                  </button>
                </>
              ) : (
                <>
                  <p className="hint">
                    Se añadirá <code>.EUI/</code> al <code>.gitignore</code> de
                    esta raíz. Las ideas dejarán de versionarse con el código.
                  </p>
                  <div className="resumen-almacen-acciones">
                    <button
                      type="button"
                      className="btn"
                      onClick={() => void ignorar()}
                      disabled={ignorando}
                    >
                      {ignorando ? "Ignorando…" : "Confirmar"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setConfirmando(false)}
                      disabled={ignorando}
                    >
                      Cancelar
                    </button>
                  </div>
                </>
              )}
              {falloIgnorar && <p className="hint">{falloIgnorar}</p>}
            </div>
          )}

          <p className="pane-rotulo">Por estado</p>
          {estados.length === 0 ? (
            <p className="hint">Sin ideas todavía.</p>
          ) : (
            <div className="resumen-estados">
              {estados.map(([estado, n]) => (
                <div key={estado} className="resumen-estado">
                  <span>{estado}</span>
                  <strong>{n}</strong>
                  <span className="resumen-estado-barra" aria-hidden="true">
                    <span style={{ width: `${Math.round((n / maximo) * 100)}%` }} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {proyeccion.git_cambios.length > 0 && (
            <>
              <p className="pane-rotulo">Cambios sin commit</p>
              <ul className="resumen-cambios">
                {proyeccion.git_cambios.map((cambio) => (
                  <li key={`${cambio.estado}-${cambio.ruta}`}>
                    <span className="cambio-estado">{cambio.estado}</span>
                    <span className="cambio-ruta" title={cambio.ruta}>
                      {cambio.ruta}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

/** Estados que viven en cada carril: los mismos grupos con los que el core
 *  cruza el protocolo. `descartadas` junta rechazadas y reemplazadas, y la
 *  Entrada es el caso particular de `draft`, sin carril propio. */
const ESTADOS_POR_CARRIL: Record<LaneId, readonly Status[]> = {
  cola: ["proposed"],
  roadmap: ["roadmap"],
  verificacion: ["verificacion"],
  revision_aprobada: ["revision_aprobada"],
  historial: ["historial"],
  descartadas: ["rejected", "superseded"],
};
const ESTADOS_ENTRADA: readonly Status[] = ["draft"];

/** Todos los estados en el orden del flujo, para buscar salidas. */
const ESTADOS: readonly Status[] = [
  "draft",
  "proposed",
  "roadmap",
  "verificacion",
  "revision_aprobada",
  "historial",
  "rejected",
  "superseded",
];

/** La ficha de un carril: qué ideas lo pueblan, cómo se reparten y por dónde
 *  puede seguir cada estado según el protocolo del repo. Las salidas no se
 *  inventan: son las uniones que `paso` da por abiertas, con lo que piden. */
function CuerpoCarril({
  titulo,
  estados,
  ideas,
  paso,
  onSeleccionar,
}: {
  titulo: string;
  estados: readonly Status[];
  ideas: readonly Idea[];
  paso: (origen: Status, destino: Status) => Paso | null;
  onSeleccionar: (seleccion: Seleccion) => void;
}) {
  const delCarril = ideas.filter((idea) => estados.includes(idea.status));
  const salidas = estados.flatMap((origen) =>
    ESTADOS.filter((destino) => !estados.includes(destino))
      .map((destino) => ({ origen, destino, paso: paso(origen, destino) }))
      .filter((union) => union.paso?.abierta),
  );

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="inspector-asunto">{titulo}</p>
      <p className="inspector-meta">
        {delCarril.length === 1 ? "1 idea" : `${delCarril.length} ideas`}
      </p>

      {estados.length > 1 && (
        <dl className="inspector-dl">
          {estados.map((estado) => (
            <Fragment key={estado}>
              <dt>{ETIQUETA_ESTADO[estado] ?? estado}</dt>
              <dd>{delCarril.filter((idea) => idea.status === estado).length}</dd>
            </Fragment>
          ))}
        </dl>
      )}

      <p className="pane-rotulo">Ideas</p>
      {delCarril.length === 0 ? (
        <p className="hint">Este carril está vacío.</p>
      ) : (
        <ul className="inspector-lista">
          {delCarril.map((idea) => (
            <li key={idea.uid}>
              <button
                type="button"
                className="inspector-idea"
                onClick={() => onSeleccionar({ tipo: "idea", uid: idea.uid })}
              >
                <span className="inspector-idea-titulo">{idea.title}</span>
                <span className="inspector-idea-estado">
                  {ETIQUETA_ESTADO[idea.status] ?? idea.status}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="pane-rotulo">Salidas del protocolo</p>
      {salidas.length === 0 ? (
        <p className="hint">Ningún protocolo deja salir de este carril.</p>
      ) : (
        <ul className="inspector-uniones">
          {salidas.map(({ origen, destino, paso: union }) => (
            <li key={`${origen}→${destino}`}>
              <span className="inspector-union">
                {estados.length > 1 ? `${ETIQUETA_ESTADO[origen] ?? origen} → ` : "→ "}
                {ETIQUETA_ESTADO[destino] ?? destino}
              </span>
              <span className="inspector-exige">
                {union?.exige.length
                  ? union.exige
                      .map((exigencia) => TEXTO_EXIGENCIA[exigencia])
                      .join("; ")
                  : "paso libre"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {estados.includes("revision_aprobada") && (
        <p className="hint">
          Archivar a Changelog no cruza protocolo: lo habilita tener work tree.
        </p>
      )}
    </div>
  );
}

/** La ficha de lo seleccionado en el lienzo. Todo lo que se puede pulsar en
 *  el mapa tiene su cuerpo aquí: carril, idea, commit, cambio, cable, puente,
 *  nodo de Git, historial y nudo. El contrato del historial solo trae `hash`
 *  abreviado, asunto, autor y fecha; lo que no llega, no se inventa. */
function CuerpoInspector({
  proyeccion,
  commits,
  seleccion,
  ideas,
  cables,
  nudos,
  paso,
  acciones,
  onSeleccionar,
  onAbrirArchivo,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  commits: readonly CommitGit[];
  seleccion: Seleccion | null;
  ideas: readonly Idea[];
  cables: readonly Cable[];
  nudos: readonly Nudo[];
  paso: (origen: Status, destino: Status) => Paso | null;
  acciones: AccionesIdea;
  onSeleccionar: (seleccion: Seleccion) => void;
  onAbrirArchivo: (ruta: string) => void;
}) {
  if (seleccion && (seleccion.tipo === "carril" || seleccion.tipo === "cajon")) {
    const laneId =
      seleccion.tipo === "carril"
        ? (seleccion.clave.replace(/^lane-/, "") as LaneId)
        : null;
    const meta = laneId ? LANES.find((lane) => lane.id === laneId) : undefined;
    return (
      <CuerpoCarril
        titulo={meta?.title ?? "Entrada"}
        estados={meta ? ESTADOS_POR_CARRIL[meta.id] : ESTADOS_ENTRADA}
        ideas={ideas}
        paso={paso}
        onSeleccionar={onSeleccionar}
      />
    );
  }

  if (seleccion && (seleccion.tipo === "git" || seleccion.tipo === "puente")) {
    return <CuerpoNodoGit tipo={seleccion.tipo} proyeccion={proyeccion} />;
  }

  if (seleccion && seleccion.tipo === "puente_documentos") {
    return (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="inspector-asunto">Mapa de Documentos</p>
        <p className="inspector-meta">puente al Changelog</p>
        <p className="hint">
          El cable de archivo llega aquí. Abrir el mapa muestra el Changelog:
          las ideas archivadas con el mismo aspecto de siempre.
        </p>
      </div>
    );
  }

  if (seleccion && seleccion.tipo === "nudo") {
    const nudo = nudos.find((candidato) => candidato.id === seleccion.id);
    return nudo ? (
      <CuerpoNudo nudo={nudo} cables={cables} paso={paso} />
    ) : (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="hint">Ese nudo ya no está en el mapa.</p>
      </div>
    );
  }

  if (seleccion && seleccion.tipo === "commits") {
    return (
      <CuerpoCommits
        commits={commits}
        rama={proyeccion?.branch ?? null}
        onSeleccionar={onSeleccionar}
      />
    );
  }

  if (seleccion && seleccion.tipo === "cable") {
    const cable = cables.find((candidato) => candidato.id === seleccion.id);
    return cable ? (
      <CuerpoCable cable={cable} paso={paso} />
    ) : (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="hint">Ese cable ya no está en el mapa.</p>
      </div>
    );
  }

  if (seleccion && seleccion.tipo === "idea") {
    const idea = ideas.find((candidata) => candidata.uid === seleccion.uid);
    return idea ? (
      <CuerpoIdea
        idea={idea}
        catalogo={ideas}
        acciones={acciones}
        onSeleccionar={onSeleccionar}
      />
    ) : (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="hint">Esa idea ya no está en el mapa.</p>
      </div>
    );
  }

  if (seleccion && seleccion.tipo === "cambio") {
    const cambios = proyeccion?.git_cambios ?? [];
    const cambio = cambios.find((candidato) => candidato.ruta === seleccion.ruta);
    return cambio ? (
      <CuerpoCambio
        cambio={cambio}
        total={cambios.length}
        onSeleccionar={onSeleccionar}
        onAbrirArchivo={onAbrirArchivo}
      />
    ) : (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="hint">Ese archivo ya no tiene cambios sin commit.</p>
      </div>
    );
  }

  if (seleccion && seleccion.tipo === "cambios") {
    return (
      <CuerpoCambios cambios={proyeccion?.git_cambios ?? []} onSeleccionar={onSeleccionar} />
    );
  }

  if (seleccion && seleccion.tipo === "commit") {
    const indice = commits.findIndex((commit) => commit.hash === seleccion.hash);
    const commit = indice === -1 ? null : commits[indice];
    return commit ? (
      <CuerpoCommit
        commit={commit}
        indice={indice}
        total={commits.length}
        rama={proyeccion?.branch ?? null}
      />
    ) : (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="hint">Ese commit ya no está en el historial.</p>
      </div>
    );
  }

  return (
    <div className="panel-cuerpo inspector-cuerpo">
      <p className="hint">
        Nada seleccionado. Pulsa un nodo del mapa y sus detalles aparecerán
        aquí.
      </p>
    </div>
  );
}
