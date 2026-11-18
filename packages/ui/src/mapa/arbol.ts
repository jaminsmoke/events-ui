import type { Connection, Idea } from "../core/api";
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
 *  lista.
 *
 *  Plegar y desplegar cambia solo lo que se ve; mover, crear, editar y
 *  borrar ideas entra por la API, nunca tocando el árbol a mano.
 */  /** Lo que se pinta: la entrada con las ideas sin carril y los carriles. */
export type Tree = { cajon: TreeNode; carriles: TreeNode[] };

export type TreeNode = {
  key: string;
  title: string;
  /** Ideas que hay por debajo: todas las del repo, las del carril, o las sub-ideas. */
  total: number;
  kids: TreeNode[];
  idea?: Idea;
  tone?: "root" | LaneId;
};

export function buildTree(ideas: Idea[], links: Connection[]): Tree {
  const byUid = new Map(ideas.map((idea) => [idea.uid, idea]));
  const carrilPorUid = new Map(ideas.map((idea) => [idea.uid, laneOf(idea.status)]));

  const hijos = new Map<string, string[]>();
  const conPadre = new Set<string>();
  for (const link of links) {
    if (link.kind !== "child") continue;
    const carrilPadre = carrilPorUid.get(link.parent_uid);
    // Si cambian de carril por separado, cada idea se ve en el suyo.
    if (!carrilPadre || carrilPadre !== carrilPorUid.get(link.child_uid)) continue;
    const lista = hijos.get(link.parent_uid) ?? [];
    lista.push(link.child_uid);
    hijos.set(link.parent_uid, lista);
    conPadre.add(link.child_uid);
  }

  /* Una idea y lo que cuelga de ella. `camino` corta los ciclos: una
   * importación puede traer dos enlaces `child` recíprocos y el render no
   * puede quedarse dando vueltas. */
  const rama = (uid: string, camino: ReadonlySet<string>): TreeNode | null => {
    const idea = byUid.get(uid);
    if (!idea || camino.has(uid)) return null;

    const siguiente: ReadonlySet<string> = new Set([...camino, uid]);
    const kids = (hijos.get(uid) ?? [])
      .map((kid) => rama(kid, siguiente))
      .filter((nodo): nodo is TreeNode => nodo !== null);

    return {
      key: uid,
      title: idea.title,
      total: kids.length,
      kids,
      idea,
    };
  };

  // La entrada: solo las ideas que aún no tienen carril (`draft`), planas.
  // Al recibir una, dejan de verse aquí y aparecen en su carril: el flujo
  // se ve porque la entrada se va vaciando.
  const sinCarril = ideas.filter((idea) => idea.status === "draft");
  const cajon: TreeNode = {
    key: "ideas",
    title: "Entrada",
    total: sinCarril.length,
    kids: sinCarril.map((idea) => ({
      key: idea.uid,
      title: idea.title,
      total: 0,
      kids: [],
      idea,
    })),
    tone: "root",
  };

  /* Todo lo alcanzable desde una idea, sin repetir. Sirve para saber qué se
   * ve desde las raíces sin reutilizar el `camino` de `rama`: con varios
   * padres, una misma idea se pinta bajo cada uno y no puede marcarse como
   * vista para los demás. */
  const alcanzables = (uid: string): Set<string> => {
    const vistos = new Set<string>();
    const pila = [uid];
    while (pila.length > 0) {
      const actual = pila.pop()!;
      if (vistos.has(actual)) continue;
      vistos.add(actual);
      pila.push(...(hijos.get(actual) ?? []));
    }
    return vistos;
  };

  const carriles: TreeNode[] = LANES.map((lane) => {
    const items = ideas.filter((idea) => carrilPorUid.get(idea.uid) === lane.id);
    // Las raíces no tienen padre. Un ciclo sin raíz (A cuelga de B y B de A)
    // dejaba el carril vacío aunque tuviera ideas, porque nadie lo abría: se
    // promueve la primera idea de cada ciclo que no se vea desde las raíces y
    // `rama` corta la arista que vuelve. Varios padres siguen intactos: la
    // idea se pinta bajo cada uno.
    const mostradas = new Set<string>();
    const raices = items.filter((idea) => !conPadre.has(idea.uid));
    for (const idea of raices) {
      for (const uid of alcanzables(idea.uid)) mostradas.add(uid);
    }
    const promovidas = items.filter((idea) => {
      if (mostradas.has(idea.uid)) return false;
      for (const uid of alcanzables(idea.uid)) mostradas.add(uid);
      return true;
    });
    const kids = [...raices, ...promovidas]
      .map((idea) => rama(idea.uid, new Set()))
      .filter((nodo): nodo is TreeNode => nodo !== null);

    return { key: `lane-${lane.id}`, title: lane.title, total: items.length, kids, tone: lane.id };
  });

  return { cajon, carriles };
}
