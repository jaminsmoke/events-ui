import { useEffect, useState } from "react";

/** Por debajo de este ancho, el lienzo con los dos paneles abiertos se queda
 *  sin sitio: el mapa cae por debajo del suelo de encuadre y se recorta en
 *  vez de encoger. Ahí los paneles se turnan, y manda el Explorador. */
export const ANCHO_MINIMO_PANELES = 1400;

/** Ancho de la ventana, no del lienzo: el marco que la rodea es fijo (dos
 *  rail de 44, el pane de 232 y el Resumen de 272). */
export function useVentanaEstrecha(): boolean {
  const [estrecha, setEstrecha] = useState(
    () => window.innerWidth < ANCHO_MINIMO_PANELES,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${ANCHO_MINIMO_PANELES - 1}px)`);
    const alCambiar = () => setEstrecha(mq.matches);
    mq.addEventListener("change", alCambiar);
    return () => mq.removeEventListener("change", alCambiar);
  }, []);

  return estrecha;
}
