import type { Exigencia, Paso } from "../core/useProtocolos";
import type { LaneId, Status } from "./carriles";

/** La unión de protocolo que representa cada cable de etapa. Descartadas no
 *  es una etapa: su rama sirve tanto desde la entrada como desde la cola. */
const UNION: Record<Exclude<LaneId, "descartadas">, [Status, Status]> = {
  cola: ["draft", "proposed"],
  roadmap: ["proposed", "roadmap"],
  verificacion: ["roadmap", "verificacion"],
  revision_aprobada: ["verificacion", "revision_aprobada"],
};

/** El protocolo del cable, ya resuelto para pintar su compuerta. En la rama
 *  de Descartadas se juntan las dos salidas (entrada y cola): la compuerta se
 *  abre si alguna lo está y muestra cualquier exigencia de las dos. */
function pasoDeCable(
  lane: LaneId,
  paso: (origen: Status, destino: Status) => Paso | null,
): Paso | null {
  if (lane !== "descartadas") {
    const [origen, destino] = UNION[lane];
    return paso(origen, destino);
  }
  const desdeEntrada = paso("draft", "rejected");
  const desdeCola = paso("proposed", "rejected");
  if (!desdeEntrada || !desdeCola) return null;
  return {
    abierta: desdeEntrada.abierta || desdeCola.abierta,
    exige: Array.from(new Set([...desdeEntrada.exige, ...desdeCola.exige])),
  };
}

const TEXTO: Record<Exigencia, string> = {
  fases: "pide al menos una fase",
  "fases-listas": "pide cerrar las fases abiertas",
  "fases-completas": "pide todas las fases completadas",
};

function titulo(paso: Paso, lane: LaneId): string {
  const prefijo = lane === "descartadas" ? "Descartar (entrada o cola): " : "Protocolo: ";
  if (!paso.abierta) return `${prefijo}esta unión no está permitida`;
  if (paso.exige.length === 0) return `${prefijo}paso libre`;
  return prefijo + paso.exige.map((exigencia) => TEXTO[exigencia]).join("; ");
}

/** Una compuerta en el punto medio del cable: una caja vacía es paso libre,
 *  cada barra de dentro es una exigencia del protocolo y el aspa cierra una
 *  unión prohibida. El `title` dice qué pide, sin crecer el mapa. */
export function Compuerta({
  protocolo,
  x,
  y,
  angulo,
  lane,
}: {
  protocolo: (origen: Status, destino: Status) => Paso | null;
  x: number;
  y: number;
  angulo: number;
  lane: LaneId;
}) {
  const paso = pasoDeCable(lane, protocolo);
  if (!paso) return null;
  const barras = paso.exige.length;
  return (
    <g
      className={`compuerta ${lane}${paso.abierta ? "" : " cerrada"}`}
      transform={`translate(${x} ${y}) rotate(${angulo})`}
    >
      <title>{titulo(paso, lane)}</title>
      <rect className="compuerta-caja" x={-5} y={-9} width={10} height={18} rx={2.5} />
      {paso.abierta ? (
        Array.from({ length: barras }, (_, i) => (
          <path
            key={i}
            className="compuerta-barra"
            d="M 0 -5 L 0 5"
            transform={`translate(${(i - (barras - 1) / 2) * 3.2} 0)`}
          />
        ))
      ) : (
        <path className="compuerta-barra" d="M -4 -5 L 4 5 M 4 -5 L -4 5" />
      )}
    </g>
  );
}
