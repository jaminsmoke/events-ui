import type { CommitGit, ProyeccionRepo, Puerta, WorkItem } from "../../core/api";
import type { Paso } from "../../core/useProtocolos";
import type { Cable, Nudo } from "../../mapa/cables";
import {
  ESTADOS_ENTRADA,
  ESTADOS_POR_CARRIL,
  LANES,
} from "../../modelo/carriles";
import type { LaneId, Status } from "../../modelo/carriles";
import type { Seleccion } from "../../modelo/seleccion";
import { CuerpoCable } from "../InspectorCable";
import {
  CuerpoCambio,
  CuerpoCambios,
  CuerpoCommit,
  CuerpoCommits,
  CuerpoNodoGit,
} from "../InspectorGit";
import { CuerpoItem } from "../InspectorItem";
import type { AccionesItem } from "../InspectorItem";
import { CuerpoNudo } from "../InspectorNudo";
import { CuerpoCarril } from "./CuerpoCarril";

/** La ficha de lo seleccionado en el lienzo. Todo lo que se puede pulsar en
 *  el mapa tiene su cuerpo aquí: carril, item, commit, cambio, cable, puente,
 *  nodo de Git, historial y nudo. El contrato del historial solo trae `hash`
 *  abreviado, asunto, autor y fecha; lo que no llega, no se inventa. */
export function CuerpoInspector({
  proyeccion,
  commits,
  seleccion,
  items,
  cables,
  nudos,
  paso,
  acciones,
  puertas,
  falloPuertas,
  onSeleccionar,
  onAbrirArchivo,
}: {
  proyeccion: ProyeccionRepo | null | undefined;
  commits: readonly CommitGit[];
  seleccion: Seleccion | null;
  items: readonly WorkItem[];
  cables: readonly Cable[];
  nudos: readonly Nudo[];
  paso: (origen: Status, destino: Status) => Paso | null;
  acciones: AccionesItem;
  puertas: Puerta[] | null;
  falloPuertas: string | null;
  onSeleccionar: (seleccion: Seleccion) => void;
  onAbrirArchivo: (ruta: string) => void;
}) {
  if (!seleccion) {
    return (
      <div className="panel-cuerpo inspector-cuerpo">
        <p className="hint">
          Nada seleccionado. Pulsa un nodo del mapa y sus detalles aparecerán
          aquí.
        </p>
      </div>
    );
  }

  switch (seleccion.tipo) {
    case "carril":
    case "cajon": {
      const laneId =
        seleccion.tipo === "carril"
          ? (seleccion.clave.replace(/^lane-/, "") as LaneId)
          : null;
      const meta = laneId ? LANES.find((lane) => lane.id === laneId) : undefined;
      return (
        <CuerpoCarril
          titulo={meta?.title ?? "Entrada"}
          estados={meta ? ESTADOS_POR_CARRIL[meta.id] : ESTADOS_ENTRADA}
          items={items}
          paso={paso}
          onSeleccionar={onSeleccionar}
        />
      );
    }

    case "git":
    case "puente": {
      return <CuerpoNodoGit tipo={seleccion.tipo} proyeccion={proyeccion} />;
    }

    case "puente_documentos": {
      return (
        <div className="panel-cuerpo inspector-cuerpo">
          <p className="inspector-asunto">Mapa de Documentos</p>
          <p className="inspector-meta">puente al Changelog</p>
          <p className="hint">
            El cable de archivo llega aquí. Abrir el mapa muestra el Changelog:
            los ítems archivados con el mismo aspecto de siempre.
          </p>
        </div>
      );
    }

    case "nudo": {
      const nudo = nudos.find((candidato) => candidato.id === seleccion.id);
      return nudo ? (
        <CuerpoNudo nudo={nudo} cables={cables} paso={paso} />
      ) : (
        <div className="panel-cuerpo inspector-cuerpo">
          <p className="hint">Ese nudo ya no está en el mapa.</p>
        </div>
      );
    }

    case "commits": {
      return (
        <CuerpoCommits
          commits={commits}
          rama={proyeccion?.branch ?? null}
          onSeleccionar={onSeleccionar}
        />
      );
    }

    case "cable": {
      const cable = cables.find((candidato) => candidato.id === seleccion.id);
      return cable ? (
        <CuerpoCable cable={cable} paso={paso} />
      ) : (
        <div className="panel-cuerpo inspector-cuerpo">
          <p className="hint">Ese cable ya no está en el mapa.</p>
        </div>
      );
    }

    case "item": {
      const item = items.find((candidata) => candidata.uid === seleccion.uid);
      return item ? (
        <CuerpoItem
          key={item.uid}
          item={item}
          puertas={puertas}
          falloPuertas={falloPuertas}
          catalogo={items}
          acciones={acciones}
          onSeleccionar={onSeleccionar}
        />
      ) : (
        <div className="panel-cuerpo inspector-cuerpo">
          <p className="hint">Ese ítem ya no está en el mapa.</p>
        </div>
      );
    }

    case "cambio": {
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

    case "cambios": {
      return (
        <CuerpoCambios cambios={proyeccion?.git_cambios ?? []} onSeleccionar={onSeleccionar} />
      );
    }

    case "commit": {
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

    default: {
      const agotado: never = seleccion;
      return agotado;
    }
  }
}
