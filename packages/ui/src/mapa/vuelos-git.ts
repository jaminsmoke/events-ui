import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { CambioGit, ProyeccionRepo } from "../core/api";
import type { Vista } from "./camara";

/** Una fila del vuelo al commit: dónde nace en el mapa y cuánto tiene que
 *  viajar hasta el nodo de Commits. */
export type FilaVueloCommit = {
  id: string;
  estado: string;
  ruta: string;
  x: number;
  y: number;
  w: number;
  dx: number;
  dy: number;
};

/** El vuelo de los cambios que acaban de entrar en un commit.
 *
 *  Se detecta por el hash de HEAD: cuando cambia y había cambios sin commit,
 *  sus filas salen del nodo de Cambios y aterrizan en el de Commits. No se
 *  mide la fila real —para entonces la lista ya está vacía—: nacen en el
 *  hueco de las filas y mueren en la cabecera del historial, que es lo que
 *  el ojo sigue.
 */
export function useVueloCommit({
  repo,
  proyeccion,
  vista,
  mapRef,
  cambiosRef,
  commitsRef,
}: {
  repo: string | null;
  proyeccion: ProyeccionRepo | null;
  vista: Vista;
  mapRef: RefObject<HTMLDivElement | null>;
  cambiosRef: RefObject<HTMLElement | null>;
  commitsRef: RefObject<HTMLElement | null>;
}): { filas: FilaVueloCommit[]; aterrizado: (id: string) => void } {
  const [filas, setFilas] = useState<FilaVueloCommit[]>([]);
  const ultimo = useRef<{
    repo: string;
    commit: string | null;
    cambios: CambioGit[];
  } | null>(null);
  const k = vista.k;

  useLayoutEffect(() => {
    if (!repo || !proyeccion) {
      ultimo.current = null;
      return;
    }
    const actual = { repo, commit: proyeccion.commit ?? null, cambios: proyeccion.git_cambios };
    const previo = ultimo.current;
    ultimo.current = actual;
    // Solo hay vuelo si había un HEAD anterior y cambios que ahora han
    // entrado en el commit; el primer commit de un repo no mueve filas.
    if (!previo || previo.repo !== repo) return;
    if (!actual.commit || previo.commit === actual.commit) return;
    if (previo.cambios.length === 0) return;
    const map = mapRef.current;
    const desdeEl = cambiosRef.current;
    const hastaEl = commitsRef.current;
    if (!map || !desdeEl || !hastaEl) return;

    // Todo en coordenadas del mapa, como los cables: el zoom se divide, no se
    // multiplica.
    const caja = map.getBoundingClientRect();
    const rect = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      return {
        x: (r.left - caja.left) / k,
        y: (r.top - caja.top) / k,
        w: r.width / k,
        h: r.height / k,
      };
    };
    const desde = rect(desdeEl);
    const hasta = rect(hastaEl);
    const ancho = Math.min(220, Math.max(120, desde.w - 20));
    const destino = { x: hasta.x + 12, y: hasta.y + 15 };
    const nuevas = previo.cambios.slice(0, 8).map((cambio, i) => {
      const x = desde.x + 10;
      const y = Math.min(desde.y + 30 + i * 17, desde.y + desde.h - 16);
      return {
        id: `${actual.commit}-${i}`,
        estado: cambio.estado,
        ruta: cambio.ruta,
        x,
        y,
        w: ancho,
        dx: destino.x - x,
        dy: destino.y - y,
      };
    });
    setFilas(nuevas);
  }, [repo, proyeccion, k, mapRef, cambiosRef, commitsRef]);

  const aterrizado = useCallback((id: string) => {
    setFilas((actuales) => actuales.filter((fila) => fila.id !== id));
  }, []);

  return { filas, aterrizado };
}
