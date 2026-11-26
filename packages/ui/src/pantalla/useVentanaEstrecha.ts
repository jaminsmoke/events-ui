import { useEffect, useState } from "react";

import { medidaMarco } from "../core/marco";

/** Por debajo de `--ancho-minimo-paneles` el lienzo con los dos paneles
 *  abiertos se queda sin sitio: el mapa cae por debajo del suelo de encuadre y
 *  se recorta en vez de encoger. Ahí los paneles se turnan y manda el
 *  Explorador. El umbral vive en `marco.css`, no aquí. */
export function useVentanaEstrecha(): boolean {
  const [estrecha, setEstrecha] = useState(() => {
    const minimo = medidaMarco("--ancho-minimo-paneles");
    return minimo > 0 && window.innerWidth < minimo;
  });

  useEffect(() => {
    const minimo = medidaMarco("--ancho-minimo-paneles");
    if (minimo <= 0) return;
    const mq = window.matchMedia(`(max-width: ${minimo - 1}px)`);
    const alCambiar = () => setEstrecha(mq.matches);
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, []);

  return estrecha;
}
