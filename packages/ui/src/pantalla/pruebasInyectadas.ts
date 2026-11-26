import type { ComponentType } from "react";

import type { WorkItemCreate, WorkItemUpdate } from "../core/api";

/** Lo que la pantalla compartida le pasa al lanzador que inyecta el envoltorio.
 *
 *  El laboratorio (guiones, marca de la prueba y diálogo) vive en
 *  `apps/desktop`: la UI compartida solo conoce esta frontera y no importa
 *  nada suyo, así que la build web no lo publica. */
export type PruebasProps = {
  repo: string;
  crear: (body: WorkItemCreate) => Promise<{ uid: string } | null>;
  mover: (uid: string, status: WorkItemCreate["status"]) => Promise<void>;
  editar: (uid: string, cambios: WorkItemUpdate) => Promise<void>;
  abrirMapa: (mapa: "items" | "git" | "documentos") => void;
  commit: (mensaje: string) => Promise<unknown>;
  cambios: number;
  abierta: boolean;
  onActividad: (enCurso: boolean) => void;
  reiniciar: () => Promise<unknown>;
  /** Aviso al montar si quedó una prueba a medias. */
  onAviso: (mensaje: string) => void;
  onCerrar: () => void;
};

export type PruebasInyectadas = { componente: ComponentType<PruebasProps> };
