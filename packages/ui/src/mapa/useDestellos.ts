import { useCallback, useEffect, useRef, useState } from "react";

import type { Animacion } from "./animaciones";
import type { Cable } from "./cables";
import { duracionChispa } from "../modelo/geometria";

/** El fogonazo de llegada de cada chispa y el cable que la recorre.
 *
 *  La chispa tarda lo que mide su cable; al terminar, el nodo da un golpe
 *  breve de luz. Va por su cuenta y no con la actividad, que se apaga en
 *  1,15 s y a veces corta el viaje antes de tiempo. Se anota por `id` para no
 *  repetir el destello de una chispa ya vista.
 */
export function useDestellos({
  chispas,
  cables,
}: {
  chispas: readonly Animacion[];
  cables: readonly Cable[];
}) {
  /* Un carril puede tener cable de ida y de vuelta (verificación↔cola,
   * verificación↔roadmap, verificación↔descartadas). La chispa y el fogonazo
   * se anclan al que sale del carril anterior, no al primero del color. */
  const cableDeChispa = useCallback(
    (chispa: { lane: Animacion["lane"]; desde?: Animacion["desde"] }) => {
      const exacto = cables.find(
        (cable) =>
          cable.lane === chispa.lane && cable.origenLane === (chispa.desde ?? "root"),
      );
      return exacto ?? cables.find((cable) => cable.lane === chispa.lane);
    },
    [cables],
  );

  const [destellos, setDestellos] = useState<{ lane: Animacion["lane"]; id: number }[]>([]);
  const vistos = useRef(new Set<number>());
  const temporizadores = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    for (const chispa of chispas) {
      if (vistos.current.has(chispa.id)) continue;
      vistos.current.add(chispa.id);
      const cable = cableDeChispa(chispa);
      if (!cable) continue;
      temporizadores.current.push(
        setTimeout(() => {
          setDestellos((prev) => [...prev, chispa]);
          temporizadores.current.push(
            setTimeout(
              () => setDestellos((prev) => prev.filter((d) => d.id !== chispa.id)),
              400,
            ),
          );
        }, duracionChispa(cable.longitud) * 1000),
      );
    }
  }, [chispas, cableDeChispa]);

  useEffect(() => () => temporizadores.current.forEach(clearTimeout), []);

  const destelloDe = (lane: string | undefined) => {
    const destello = destellos.find((d) => d.lane === lane);
    return destello ? { clave: destello.id } : undefined;
  };

  return { destelloDe, cableDeChispa };
}
