import type { Exigencia, Paso } from "../core/useProtocolos";
import type { LaneId, Status } from "./carriles";
import type { DestinoCable } from "./cables";

/** La unión de protocolo que representa cada cable de etapa. Descartadas no
 *  es una etapa: su rama sirve tanto desde la entrada como desde la cola. */
const UNION: Record<Exclude<LaneId, "descartadas">, [Status, Status]> = {
  cola: ["draft", "proposed"],
  roadmap: ["proposed", "roadmap"],
  verificacion: ["roadmap", "verificacion"],
  revision_aprobada: ["verificacion", "revision_aprobada"],
  // Archivar es el desenlace automático de aprobar: no hay fila de protocolo,
  // así que el cable se dibuja sin compuerta.
  historial: ["revision_aprobada", "historial"],
};

/** El protocolo del cable, ya resuelto para pintar su compuerta. En la rama
 *  de Descartadas se juntan las dos salidas (entrada y cola): la compuerta se
 *  abre si alguna lo está y muestra cualquier exigencia de las dos. */
function pasoDeCable(
  lane: DestinoCable,
  paso: (origen: Status, destino: Status) => Paso | null,
  union: [Status, Status] | null,
): Paso | null {
  // Git no es una unión de protocolo: es un nodo de estado del repo.
  if (lane === "git") return null;
  // Las ramas de revisión rechazada traen su pareja explícita: comparten
  // carril de destino con el flujo normal y no pueden deducirla del color.
  if (union) return paso(...union);
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

function titulo(paso: Paso, lane: DestinoCable, union: [Status, Status] | null): string {
  const prefijo =
    union?.[0] === "verificacion"
      ? `Revisión rechazada → ${union[1] === "proposed" ? "Cola" : union[1] === "roadmap" ? "Roadmap" : "Descartadas"}: `
      : lane === "descartadas"
        ? "Descartar (entrada o cola): "
        : "Protocolo: ";
  if (!paso.abierta) return `${prefijo}esta unión no está permitida`;
  if (paso.exige.length === 0) return `${prefijo}paso libre`;
  return prefijo + paso.exige.map((exigencia) => TEXTO[exigencia]).join("; ");
}

function Icono({ tipo }: { tipo: "libre" | "exige" | "cerrada" }) {
  return (
    <svg
      className={`leyenda-icono${tipo === "cerrada" ? " prohibida" : ""}`}
      viewBox="-6 -10 12 20"
      aria-hidden="true"
    >
      <rect className="compuerta-caja" x={-5} y={-9} width={10} height={18} rx={2.5} />
      {tipo === "exige" && (
        <>
          <path className="compuerta-barra" d="M -1.6 -5 L -1.6 5" />
          <path className="compuerta-barra" d="M 1.6 -5 L 1.6 5" />
        </>
      )}
      {tipo === "cerrada" && (
        <path className="compuerta-barra" d="M -4 -5 L 4 5 M 4 -5 L -4 5" />
      )}
    </svg>
  );
}

/** Leyenda de la gramática de las compuertas, fuera del mapa para no
 *  repetirla en cada cable: caja vacía, barras y aspa. */
export function LeyendaCompuertas() {
  return (
    <aside className="leyenda-compuertas" aria-label="Compuertas de protocolo">
      <span className="leyenda-titulo">Compuertas</span>
      <span>
        <Icono tipo="libre" />
        Paso libre
      </span>
      <span>
        <Icono tipo="exige" />
        Una barra por exigencia
      </span>
      <span>
        <Icono tipo="cerrada" />
        Prohibida
      </span>
    </aside>
  );
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
  union = null,
}: {
  protocolo: (origen: Status, destino: Status) => Paso | null;
  x: number;
  y: number;
  angulo: number;
  lane: DestinoCable;
  union?: [Status, Status] | null;
}) {
  // Archivar no es una unión de protocolo: la hace el core al aprobar, así
  // que el cable del historial no lleva compuerta (ni un aspa de prohibida).
  if (lane === "historial" || lane === "git") return null;
  const paso = pasoDeCable(lane, protocolo, union);
  if (!paso) return null;
  const barras = paso.exige.length;
  return (
    <g
      className={`compuerta ${lane}${paso.abierta ? "" : " cerrada"}`}
      transform={`translate(${x} ${y}) rotate(${angulo})`}
    >
      <title>{titulo(paso, lane, union)}</title>
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
