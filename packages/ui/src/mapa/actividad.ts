/** Qué se mueve entre dos fotos de ítems: qué nodos pulsan, cuáles son chispa
 *  y de qué carril sale. Es puro: ni React ni DOM, solo las dos listas.
 *
 *  El pulso va al nodo (borde y contador); la chispa recorre solo el cable de
 *  llegada. Una salida no lanza chispa en el cable de entrada del carril que
 *  deja: eso haría creer que también llega algo.
 */
import type { WorkItem } from "../core/api";
import type { LaneId } from "./carriles";

export type { LaneId };

export type Animacion = { lane: LaneId; id: number; desde?: LaneId | null };

/** Dónde puede pulsar un nodo: un carril, o el cajón de Ítems (`"cajon"`).
 *  El cajón contiene los ítems sin carril (recién creadas), así que pulsa
 *  cuando entra alguna y cuando una lo deja hacia un carril. */
export type NodoId = LaneId | "cajon";

/** Código de colores del pulso de borde de cada nodo:
 *  - `azul`: un ítem **entra** (se crea o llega a un carril);
 *  - `rojo`: un ítem **sale** (se borra, se descarta o deja un carril);
 *  - `verde`: un ítem llega a **revisión aprobada** o al **historial**.
 *  Verde queda reservado al estado final, no a entradas normales. */
export type TonoPulso = "azul" | "rojo" | "verde";
export type Pulso = { lane: NodoId; tono: TonoPulso };

const PRIORIDAD: Record<TonoPulso, number> = { azul: 1, rojo: 2, verde: 3 };

export type Foto = {
  estados: Map<string, WorkItem["status"]>;
  carriles: Map<string, LaneId | null>;
};

export type Actividad = {
  /** Los carriles que reciben un ítem, con el carril de donde viene. */
  llegan: [LaneId, LaneId | null][];
  pulsos: { lane: LaneId; tono: TonoPulso }[];
  cajon?: TonoPulso;
};

/** Un ítem con su carril ya resuelto: el módulo no depende de `laneOf`, así
 *  que Node lo carga sin extensiones y la unit no necesita el mapa entero. */
export type Fila = { uid: string; status: WorkItem["status"]; lane: LaneId | null };

/** Señala entradas y salidas aunque dos items se crucen y los totales coincidan. */
export function actividadEntre(previo: Foto, items: Fila[]): Actividad {
  const pulsos = new Map<LaneId, TonoPulso>();
  // Un carril puede recibir varios eventos a la vez: manda el más fuerte.
  const fijar = (lane: LaneId, tono: TonoPulso) => {
    const actual = pulsos.get(lane);
    if (!actual || PRIORIDAD[tono] > PRIORIDAD[actual]) pulsos.set(lane, tono);
  };
  // El cajón no tiene cable (no hay chispa): solo pulsa el borde.
  let cajon: TonoPulso | undefined;
  const fijarCajon = (tono: TonoPulso) => {
    if (!cajon || PRIORIDAD[tono] > PRIORIDAD[cajon]) cajon = tono;
  };
  // Solo los carriles que reciben un ítem generan chispa; el resto, pulso.
  // El origen permite elegir, en un carril con ida y vuelta, el cable correcto.
  const llegan = new Map<LaneId, LaneId | null>();
  const carrilesAhora = new Map(items.map((item) => [item.uid, item.lane]));

  for (const item of items) {
    const lane = item.lane;
    const lanePrevio = previo.carriles.get(item.uid);
    if (
      (item.status === "revision_aprobada" || item.status === "historial") &&
      previo.estados.get(item.uid) !== "revision_aprobada" &&
      previo.estados.get(item.uid) !== "historial"
    ) {
      if (lane) {
        fijar(lane, "verde");
        llegan.set(lane, lanePrevio ?? null);
      }
    } else if (lanePrevio === undefined) {
      if (lane) {
        fijar(lane, "azul");
        llegan.set(lane, null);
      }
      fijarCajon("azul");
    } else if (lanePrevio !== lane) {
      if (lane) {
        fijar(lane, lane === "descartadas" ? "rojo" : "azul");
        llegan.set(lane, lanePrevio);
      }
      // El carril que deja el ítem pulsa en rojo, pero su cable de entrada
      // no se enciende: la chispa pertenece al carril de llegada.
      if (lanePrevio) fijar(lanePrevio, "rojo");
      // Salir del cajón a un carril: el cajón pulsa en rojo (sale de aquí).
      if (lanePrevio === null) fijarCajon("rojo");
    }
  }
  // Borrada del repo: su carril y el cajón pulsan en rojo aunque ya no
  // tengan la fila. No hay chispa: no llega nada a ningún sitio.
  for (const [uid, lane] of previo.carriles) {
    if (!carrilesAhora.has(uid)) {
      if (lane) fijar(lane, "rojo");
      fijarCajon("rojo");
    }
  }

  return { llegan: Array.from(llegan), pulsos: Array.from(pulsos, ([lane, tono]) => ({ lane, tono })), cajon };
}
