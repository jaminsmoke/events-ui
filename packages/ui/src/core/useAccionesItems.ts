import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkItem, WorkItemUpdate } from "./api";
import type { PuedeIr } from "./useProtocolos";
import type { AccionesLienzo } from "../mapa/vista";
import { sePuedeEliminar } from "../modelo/carriles";
import type { Status } from "../modelo/carriles";

/** La ficha que el editor de la fila tiene abierta. */
export type Edicion = { uid: string; titulo: string; descripcion: string };

/** Una fila cruzando Descartadas→Eliminadas: solo UI, se quema y luego se
 *  borra el dato. No hay status `eliminadas` en el almacén. */
export type Quema = { id: number; repo: string; uid: string; title: string };

const mensaje = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Las acciones que el lienzo y el panel piden al almacén, con su aviso.
 *
 *  Vive fuera de `App.tsx` porque todas comparten la misma forma: un `catch`
 *  que deja el mensaje en `falloAccion` en vez de perderse. La edición y la
 *  quema de Descartadas→Eliminadas también son de aquí: son estado de la
 *  acción, no del mapa. */
export function useAccionesItems({
  repo,
  items,
  puedeIr,
  exigeFases,
  exigeFasesListas,
  exigeFasesCompletas,
  mover,
  editar,
  borrar,
  cargarItem,
  expandirEliminadas,
}: {
  repo: string | null;
  items: readonly WorkItem[] | null;
  puedeIr: PuedeIr;
  exigeFases: PuedeIr;
  exigeFasesListas: PuedeIr;
  exigeFasesCompletas: PuedeIr;
  mover: (uid: string, status: Status) => Promise<void>;
  editar: (uid: string, cambios: WorkItemUpdate) => Promise<void>;
  borrar: (uid: string) => Promise<void>;
  cargarItem: (uid: string) => Promise<WorkItem | null>;
  /** Descartadas→Eliminadas despliega el carril para que se vea la quema. */
  expandirEliminadas: () => void;
}) {
  const [falloAccion, setFalloAccion] = useState<string | null>(null);
  const [editando, setEditando] = useState<Edicion | null>(null);
  const [quemas, setQuemas] = useState<Quema[]>([]);
  const quemaSeq = useRef(0);
  const repoRef = useRef(repo);
  useEffect(() => {
    repoRef.current = repo;
  }, [repo]);

  // Mover entre carriles es cambiar el `status` (PATCH tipado). El sondeo de
  // `/revision` relee el mapa y el vuelo existente anima la fila.
  const alMover = useCallback(
    (uid: string, status: Status) => {
      setFalloAccion(null);
      void mover(uid, status).catch((err: unknown) => setFalloAccion(mensaje(err)));
    },
    [mover],
  );

  /** Descartadas → Eliminadas: quema visual y luego borrado real. */
  const alEliminar = useCallback(
    async (uid: string) => {
      const item = items?.find((candidata) => candidata.uid === uid);
      if (!item || !sePuedeEliminar(item.status)) {
        throw new Error("Solo se eliminan ítems que ya están en Descartadas");
      }
      const id = ++quemaSeq.current;
      const repoAlBorrar = repo;
      if (!repoAlBorrar) throw new Error("Sin repo no se puede borrar");
      setQuemas((prev) => [...prev, { id, repo: repoAlBorrar, uid, title: item.title }]);
      expandirEliminadas();
      await new Promise((resolve) => setTimeout(resolve, 1400));
      try {
        // La espera es de la animación: si mientras tanto se cambió de
        // carpeta, el cierre capturado no puede borrar en el repo viejo.
        if (repoRef.current === repoAlBorrar) await borrar(uid);
      } finally {
        setQuemas((prev) => prev.filter((quema) => quema.id !== id));
      }
    },
    [repo, items, borrar, expandirEliminadas],
  );

  const pedirEdicion = useCallback(
    (uid: string, titulo: string, descripcion: string) =>
      setEditando({ uid, titulo, descripcion }),
    [],
  );
  const cerrarEdicion = useCallback(() => setEditando(null), []);

  // El filtro se memoriza: `useArbolMapa` y `useCables` dependen de la
  // identidad de `quemas`; un array nuevo por render rehacía el árbol y
  // volvía a medir los cables en cada fotograma.
  const quemasDelRepo = useMemo(
    () => quemas.filter((quema) => quema.repo === repo),
    [quemas, repo],
  );

  /* Lo que el lienzo y el panel piden al almacén: una sola forma para los
   *  dos, así una acción nueva no se queda en uno de los lados. Memorizado:
   *  es prop de `Lienzo` y no puede cambiar por un movimiento de cámara. */
  const acciones = useMemo<AccionesLienzo>(
    () => ({
      puedeIr,
      exigeFases,
      exigeFasesListas,
      exigeFasesCompletas,
      onMover: alMover,
      onEditar: editar,
      onBorrar: alEliminar,
      onCargar: cargarItem,
      onPideEditar: pedirEdicion,
    }),
    [
      puedeIr,
      exigeFases,
      exigeFasesListas,
      exigeFasesCompletas,
      alMover,
      editar,
      alEliminar,
      cargarItem,
      pedirEdicion,
    ],
  );

  return { acciones, falloAccion, editando, cerrarEdicion, quemasDelRepo };
}
