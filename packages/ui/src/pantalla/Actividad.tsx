/** El marco tipo IDE, partido por pane: barras, Mapas, Explorador y Git.
 *
 *  Este fichero solo reexporta: los consumidores siguen importando de aquí y
 *  cada pane vive en su módulo. */
export type { MapaLienzo, VistaDerecha, VistaPane } from "./vistas";
export { BarraActividad, BarraDerecha } from "./BarrasActividad";
export { PaneExplorador } from "./PaneExplorador";
export { PaneGit } from "./PaneGit";
export { PaneMapas } from "./PaneMapas";
