/** Vista del rail izquierdo. `null` es el pane cerrado. */
export type VistaPane = "mapas" | "archivos" | "git";

/** Los tres mapas del lienzo. Documentos ya no vive en el activity. */
export type MapaLienzo = "items" | "git" | "documentos";

/** Vista del rail derecho: las estadísticas del repo, el inspector de lo que
 *  se selecciona en el lienzo y el archivo abierto. */
export type VistaDerecha = "resumen" | "inspector" | "archivo";
