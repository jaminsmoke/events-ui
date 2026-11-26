/** El lienzo: elige cuál de las tres vistas del mapa se pinta.
 *
 *  Cada vista vive en su módulo y comparte el contrato de `vista.ts`. `App.tsx`
 *  decide qué mapa se ve; aquí solo se elige la vista.
 */
import { memo } from "react";

import type { PropsVista } from "./vista";
import { VistaDocumentos } from "./VistaDocumentos";
import { VistaGit } from "./VistaGit";
import { VistaItems } from "./VistaItems";

// La cámara cambia `vista` en cada `pointermove`; con las props estables,
// memo evita recorrer nodos, filas y cables por un simple arrastre.
export const Lienzo = memo(function Lienzo(props: PropsVista) {
  return (
    <>
      {props.mapa === "items" && <VistaItems {...props} />}
      {props.mapa === "git" && <VistaGit {...props} />}
      {props.mapa === "documentos" && <VistaDocumentos {...props} />}
    </>
  );
});
