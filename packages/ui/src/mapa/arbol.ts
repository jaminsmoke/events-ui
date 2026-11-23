import type { Idea } from "../core/api";
import { LANES, laneOf } from "./carriles";
import type { LaneId } from "./carriles";

/* ---------- el nodo, estilo Unreal ----------
 *
 *  El nodo es compacto: una cabecera con el título, un contador y una flecha.
 *  Cuando tiene items, la flecha los despliega **dentro** del nodo como filas,
 *  igual que un nodo de Unreal enseña sus opciones. Nada de un nodo por item ni
 *  de tarjetas dentro de tarjetas.
 *
 *  La entrada (`draft`) es donde se crean las ideas; en cuanto reciben carril
 *  desaparecen de ahí —no se ven en dos sitios a la vez— y para bajar de
 *  nivel se pasa por la disyuntiva de carriles. Cada carril es un nodo con su
 *  lista plana: la jerarquía que importa son las fases de cada ítem, que viven
 *  fuera del mapa. `eliminadas` sale vacío del árbol: solo la UI le inyecta
 *  filas efímeras mientras se queman.
 *
 *  Plegar y desplegar cambia solo lo que se ve; mover, crear, editar y
 *  borrar ideas entra por la API, nunca tocando el árbol a mano.
 */
/** Lo que se pinta: la entrada con las ideas sin carril y los carriles. */
export type Tree = { cajon: TreeNode; carriles: TreeNode[] };

export type TreeNode = {
  key: string;
  title: string;
  /** Ideas que hay por debajo: todas las del repo o las del carril. */
  total: number;
  kids: TreeNode[];
  idea?: Idea;
  tone?: "root" | LaneId;
};

export function buildTree(ideas: Idea[]): Tree {
  const fila = (idea: Idea): TreeNode => ({
    key: idea.uid,
    title: idea.title,
    total: 0,
    kids: [],
    idea,
  });

  // La entrada: solo las ideas que aún no tienen carril (`draft`). Al recibir
  // una, dejan de verse aquí y aparecen en su carril: el flujo se ve porque
  // la entrada se va vaciando.
  const sinCarril = ideas.filter((idea) => idea.status === "draft");
  const cajon: TreeNode = {
    key: "ideas",
    title: "Entrada",
    total: sinCarril.length,
    kids: sinCarril.map(fila),
    tone: "root",
  };

  const carriles: TreeNode[] = LANES.map((lane) => {
    const items = ideas.filter((idea) => laneOf(idea.status) === lane.id);
    return {
      key: `lane-${lane.id}`,
      title: lane.title,
      total: items.length,
      kids: items.map(fila),
      tone: lane.id,
    };
  });

  return { cajon, carriles };
}
