import type { WorkItem } from "../core/api";
import { LANES, laneOf } from "./carriles";
import type { LaneId } from "./carriles";

/* ---------- el nodo, estilo Unreal ----------
 *
 *  El nodo es compacto: una cabecera con el título, un contador y una flecha.
 *  Cuando tiene items, la flecha los despliega **dentro** del nodo como filas,
 *  igual que un nodo de Unreal enseña sus opciones. Nada de un nodo por item ni
 *  de tarjetas dentro de tarjetas.
 *
 *  La entrada (`draft`) es donde se crean los ítems; en cuanto reciben carril
 *  desaparecen de ahí —no se ven en dos sitios a la vez— y para bajar de
 *  nivel se pasa por la disyuntiva de carriles. Cada carril es un nodo con su
 *  lista plana: la jerarquía que importa son las fases de cada ítem, que viven
 *  fuera del mapa. `eliminadas` sale vacío del árbol: solo la UI le inyecta
 *  filas efímeras mientras se queman.
 *
 *  Plegar y desplegar cambia solo lo que se ve; mover, crear, editar y
 *  borrar items entra por la API, nunca tocando el árbol a mano.
 */
/** Lo que se pinta: la entrada con los ítems sin carril y los carriles. */
export type Tree = { cajon: TreeNode; carriles: TreeNode[] };

export type TreeNode = {
  key: string;
  title: string;
  /** Ítems que hay por debajo: todos los del repo o los del carril. */
  total: number;
  kids: TreeNode[];
  item?: WorkItem;
  tone?: "root" | LaneId;
};

export function buildTree(items: WorkItem[]): Tree {
  const fila = (item: WorkItem): TreeNode => ({
    key: item.uid,
    title: item.title,
    total: 0,
    kids: [],
    item,
  });

  // La entrada: solo los ítems que aún no tienen carril (`draft`). Al recibir
  // uno, dejan de verse aquí y aparecen en su carril: el flujo se ve porque
  // la entrada se va vaciando.
  const sinCarril = items.filter((item) => item.status === "draft");
  const cajon: TreeNode = {
    key: "items",
    title: "Entrada",
    total: sinCarril.length,
    kids: sinCarril.map(fila),
    tone: "root",
  };

  const carriles: TreeNode[] = LANES.map((lane) => {
    const delCarril = items.filter((item) => laneOf(item.status) === lane.id);
    return {
      key: `lane-${lane.id}`,
      title: lane.title,
      total: delCarril.length,
      kids: delCarril.map(fila),
      tone: lane.id,
    };
  });

  return { cajon, carriles };
}
