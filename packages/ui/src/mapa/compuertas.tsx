import type { Paso } from "../core/useProtocolos";
import { CELDA } from "./cables";
import type { DestinoCable } from "./cables";
import { TEXTO_EXIGENCIA } from "./protocolos";
import type { Union } from "./protocolos";

/** El protocolo de un cable, ya resuelto para pintar su compuerta. Si cruza
 *  varias uniones (el descarte sale de la entrada y de la cola), la compuerta
 *  se abre cuando alguna lo está y reúne las exigencias de todas. */
function pasoDeCable(
  uniones: readonly Union[],
  paso: (origen: Union[0], destino: Union[1]) => Paso | null,
): Paso | null {
  const pasos: Paso[] = [];
  for (const [origen, destino] of uniones) {
    const suyo = paso(origen, destino);
    // Sin protocolos cargados no hay compuerta: mejor no inventarla.
    if (!suyo) return null;
    pasos.push(suyo);
  }
  if (pasos.length === 0) return null;
  return {
    abierta: pasos.some((p) => p.abierta),
    exige: Array.from(new Set(pasos.flatMap((p) => [...p.exige]))),
  };
}

function titulo(paso: Paso, lane: DestinoCable, uniones: readonly Union[]): string {
  // La vuelta de una revisión rechazada sale de `verificacion` hacia cola,
  // roadmap o descartadas. La etapa normal verificacion→revision_aprobada
  // también sale de `verificacion`, pero no es un rechazo: no se etiqueta
  // como tal (antes decía «Revisión rechazada → Descartadas»).
  const vuelta = uniones.find(([origen, destino]) => origen === "verificacion" && destino !== "revision_aprobada");
  const destinoRechazo =
    vuelta?.[1] === "proposed" ? "Cola" : vuelta?.[1] === "roadmap" ? "Roadmap" : "Descartadas";
  const prefijo = vuelta
    ? `Revisión rechazada → ${destinoRechazo}: `
    : lane === "descartadas"
      ? "Descartar (entrada o cola): "
      : "Protocolo: ";
  if (!paso.abierta) return `${prefijo}esta unión no está permitida`;
  if (paso.exige.length === 0) return `${prefijo}paso libre`;
  return prefijo + paso.exige.map((exigencia) => TEXTO_EXIGENCIA[exigencia]).join("; ");
}

/** La caja de la compuerta, con las medidas del nudo que la contiene. */
function Caja() {
  return (
    <rect
      className="compuerta-caja"
      x={-CELDA.ancho / 2}
      y={-CELDA.alto / 2}
      width={CELDA.ancho}
      height={CELDA.alto}
      rx={2.5}
    />
  );
}

function Icono({ tipo }: { tipo: "libre" | "exige" | "cerrada" }) {
  return (
    <svg
      className={`leyenda-icono${tipo === "cerrada" ? " prohibida" : ""}`}
      viewBox="-6 -10 12 20"
      aria-hidden="true"
    >
      <Caja />
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

/** Una compuerta sobre su cable: una caja vacía es paso libre, cada barra de
 *  dentro es una exigencia del protocolo y el aspa cierra una unión prohibida.
 *  El `title` dice qué pide, sin crecer el mapa.
 *
 *  Su sitio también lo decide una regla (ver `cables.ts`): dentro del rombo del
 *  nudo del que sale el cable o, sin nudo, en el punto medio del trazado. */
export function Compuerta({
  protocolo,
  x,
  y,
  angulo,
  lane,
  uniones,
  abierta = false,
  onSeleccionar,
}: {
  protocolo: (origen: Union[0], destino: Union[1]) => Paso | null;
  x: number;
  y: number;
  angulo: number;
  lane: DestinoCable;
  /** Las uniones de protocolo del cable (`protocolos.ts`). */
  uniones: readonly Union[];
  /** Archivar: la compuerta se abre por disponibilidad del destino y no por
   *  una fila del protocolo. */
  abierta?: boolean;
  /** Pulsar la celda lleva a su nudo (o a su cable si no vive en uno). */
  onSeleccionar?: () => void;
}) {
  /* Archivar no es una unión de protocolo: la hace el core al aprobar. La caja
   * se abre si el destino está disponible (la rama a Git solo con work tree) y
   * sin él no se dibuja: queda únicamente la del Historial. */
  if (lane === "historial" || lane === "git") {
    if (!abierta) return null;
    const destino = lane === "git" ? "Git" : "Documentos";
    return (
      <g
        className={`compuerta ${lane}`}
        transform={`translate(${x} ${y}) rotate(${angulo})`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onSeleccionar}
      >
        <title>{`Aprobar → ${destino}: paso libre`}</title>
        <Caja />
      </g>
    );
  }
  const paso = pasoDeCable(uniones, protocolo);
  if (!paso) return null;
  const barras = paso.exige.length;
  return (
    <g
      className={`compuerta ${lane}${paso.abierta ? "" : " cerrada"}`}
      transform={`translate(${x} ${y}) rotate(${angulo})`}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onSeleccionar}
    >
      <title>{titulo(paso, lane, uniones)}</title>
      <Caja />
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
