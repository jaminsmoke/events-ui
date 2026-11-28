import type { CommitGit, Puerta, WorkItem, ProyeccionRepo } from "../core/api";
import type { Paso } from "../core/useProtocolos";
import type { Cable, Nudo } from "../mapa/cables";
import type { Status } from "../modelo/carriles";
import type { Seleccion } from "../modelo/seleccion";
import type { VistaDerecha } from "./Actividad";
import type { AccionesItem } from "./InspectorItem";
import { CuerpoInspector } from "./paneles/CuerpoInspector";
import { CuerpoResumen } from "./paneles/CuerpoResumen";
import { VisorArchivo } from "./VisorArchivo";

/** Panel derecho del marco, con varias vistas que comparten cabecera.
 *
 *  Resumen es el estado del repo de un vistazo: sale por encima del lienzo —no
 *  le roba ancho— y se lee de la misma `ProyeccionRepo` que la statusbar, sin
 *  pedir nada nuevo al core. El Inspector recibe lo que se pulsa en el mapa:
 *  así los detalles caben aquí y las filas del lienzo pueden quedarse en una
 *  sola línea. Archivo reutiliza el mismo panel para el visor: al abrir un
 *  archivo no se monta otro panel, y al cerrarlo vuelve el lienzo entero.
 *  Los Markdown absorbidos no tienen vista aquí: CLI/API.
 *
 *  Cada vista tiene su cuerpo en `paneles/`; este fichero solo elige cuál. */
export function PanelDerecho({
  vista,
  onVista,
  repo,
  archivoAbierto,
  proyeccion,
  onIgnorarAlmacen,
  commits,
  seleccion,
  items,
  cables,
  nudos,
  paso,
  puertas,
  falloPuertas,
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
  proyeccion: ProyeccionRepo | null | undefined;
  /** Escribe `.EUI/` en el `.gitignore` de esta raíz; lo ofrece el Resumen. */
  onIgnorarAlmacen: () => Promise<unknown>;
  commits: readonly CommitGit[];
  /** Lo seleccionado en el lienzo; `null`, nada. */
  seleccion: Seleccion | null;
  /** Las items del mapa: la ficha de un carril las lista por estado. */
  items: readonly WorkItem[];
  /** Los cables medidos: la ficha de un cable explica su compuerta. */
  cables: readonly Cable[];
  /** Los nudos del mapa: agrupan las compuertas de sus cables. */
  nudos: readonly Nudo[];
  /** El protocolo del repo: qué salidas hay y qué exige cada unión. */
  paso: (origen: Status, destino: Status) => Paso | null;
  /** Las puertas activas del repo, leídas una vez en `App`: reabrir el panel
   *  no vuelve a pedirlas. `null` mientras se leen. */
  puertas: Puerta[] | null;
  /** El fallo de esa lectura, si lo hubo. */
  falloPuertas: string | null;
  /** Lo que la ficha de item puede hacer con el ítem seleccionada. */
  acciones: AccionesItem;
  /** Pulsar un ítem en la ficha la selecciona en el lienzo. */
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
      className={`resumen${vista === "archivo" ? " resumen--visor" : ""}`}
      aria-label="Panel derecho"
    >
      <div className="panel-cabecera">
        <div className="panel-pestanas" role="tablist">
          {pestana("resumen", "Resumen")}
          {pestana("inspector", "Inspector")}
          {archivoAbierto && pestana("archivo", "Archivo")}
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
          items={items}
          cables={cables}
          nudos={nudos}
          paso={paso}
          acciones={acciones}
          puertas={puertas}
          falloPuertas={falloPuertas}
          onSeleccionar={onSeleccionar}
          onAbrirArchivo={onAbrirArchivo}
        />
      )}
    </aside>
  );
}
