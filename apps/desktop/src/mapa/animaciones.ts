import { useEffect, useRef, useState } from "react";

import type { Tree } from "./arbol";
import type { LaneId } from "./carriles";

export type Animacion = { lane: LaneId; id: number };

/** Chispas y pulsos: el aviso de que un carril ha cambiado de tamaño.
 *
 *  El cambio en el almacén es instantáneo; la animación no. Cuando un carril
 *  cambia de tamaño, una chispa recorre su cable para que se vea llegar, y si
 *  además ha recibido una idea, su contador da un golpe.
 */
export function useAnimaciones(tree: Tree | null) {
  const [chispas, setChispas] = useState<Animacion[]>([]);
  const [pulsos, setPulsos] = useState<Animacion[]>([]);
  const totalesPrevios = useRef(new Map<LaneId, number>());

  useEffect(() => {
    if (!tree) return;
    const nuevas: Animacion[] = [];
    const suben: LaneId[] = [];
    for (const lane of tree.carriles) {
      const id = lane.tone;
      if (id !== "cola" && id !== "descartadas") continue;
      const antes = totalesPrevios.current.get(id);
      if (antes !== undefined && antes !== lane.total) {
        nuevas.push({ lane: id, id: Date.now() + Math.random() });
        if (lane.total > antes) suben.push(id);
      }
      totalesPrevios.current.set(id, lane.total);
    }
    if (nuevas.length === 0) return;

    // En un frame, no en el cuerpo del efecto: las animaciones no pueden entrar
    // en cascada con el render que acaba de pintar las filas.
    const raf = requestAnimationFrame(() => {
      setChispas((prev) => [...prev, ...nuevas]);
      if (suben.length > 0) {
        const sello = Date.now();
        setPulsos((prev) => [...prev, ...suben.map((lane, i) => ({ lane, id: sello + i }))]);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [tree]);

  // Cada chispa vive lo que dura su animación.
  useEffect(() => {
    if (chispas.length === 0) return;
    const timer = setTimeout(() => setChispas([]), 1150);
    return () => clearTimeout(timer);
  }, [chispas]);

  // El pulso del contador también es un golpe breve, no un estado.
  useEffect(() => {
    if (pulsos.length === 0) return;
    const timer = setTimeout(() => setPulsos([]), 1000);
    return () => clearTimeout(timer);
  }, [pulsos]);

  return { chispas, pulsos };
}
