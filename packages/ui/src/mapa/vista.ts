/** El contrato de las tres vistas del lienzo: trabajo, Git y Documentos.
 *
 *  Las props son las mismas para las tres porque comparten refs, selección y
 *  acciones del almacén; cada vista decide qué usa. Así una vista nueva no
 *  obliga a inventar otro contrato.
 */
import type { RefObject } from "react";

import type { CommitGit, ProyeccionRepo, WorkItem, WorkItemUpdate } from "../core/api";
import type { PuedeIr, Paso } from "../core/useProtocolos";
import type { MapaLienzo } from "../pantalla/Actividad";
import type { Animacion, Pulso, TonoPulso } from "./animaciones";
import type { Tree } from "./arbol";
import type { Cable, Nudo, RamaRechazo } from "./cables";
import type { LaneId, Status } from "./carriles";
import type { Seleccion } from "./seleccion";
import type { Vuelo } from "./vuelos";
import type { FilaVueloCommit } from "./vuelos-git";

/** Lo que el lienzo pide al almacén: mover, editar, borrar y cargar fichas. */
export type AccionesLienzo = {
  puedeIr: PuedeIr;
  exigeFases: PuedeIr;
  exigeFasesListas: PuedeIr;
  exigeFasesCompletas: PuedeIr;
  onMover: (uid: string, status: Status) => void;
  onEditar: (uid: string, cambios: WorkItemUpdate) => Promise<void>;
  onBorrar: (uid: string) => Promise<void>;
  onCargar: (uid: string) => Promise<WorkItem | null>;
  onPideEditar: (uid: string, titulo: string, descripcion: string) => void;
};

export type PropsVista = {
  mapa: MapaLienzo;
  tree: Tree;
  ideas: readonly WorkItem[];
  commits: readonly CommitGit[];
  cerrados: ReadonlySet<string>;
  onToggle: (key: string) => void;
  refs: {
    cajon: RefObject<HTMLElement | null>;
    carriles: RefObject<Partial<Record<LaneId, HTMLElement | null>>>;
    git: RefObject<HTMLElement | null>;
    cambios: RefObject<HTMLElement | null>;
    commits: RefObject<HTMLElement | null>;
  };
  cables: readonly Cable[];
  nudos: readonly Nudo[];
  rama: RamaRechazo | null;
  chispas: readonly Animacion[];
  cableDeChispa: (chispa: Animacion) => Cable | undefined;
  seleccion: Seleccion | null;
  onSeleccionar: (seleccion: Seleccion) => void;
  paso: (origen: Status, destino: Status) => Paso | null;
  animacion: {
    volando: (uid: string, nodo: string) => boolean;
    pulsos: readonly Pulso[];
    pulsoCajon?: TonoPulso;
    destelloDe: (lane: string | undefined) => { clave: number } | undefined;
  };
  acciones: AccionesLienzo;
  proyeccion?: ProyeccionRepo | null;
  gitActivo: boolean;
  vuelos: readonly Vuelo[];
  onAterrizado: (id: number) => void;
  vuelosGit: readonly FilaVueloCommit[];
  onAterrizadoGit: (id: string) => void;
  onAbrirGit: () => void;
  onAbrirDocumentos: () => void;
  onDialogoGit: (tipo: "crear" | "eliminar") => void;
};
