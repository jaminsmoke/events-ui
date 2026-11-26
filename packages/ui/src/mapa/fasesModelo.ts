/** Las mutaciones de fases, sin React: la fila y la ficha comparten una sola
 *  definición. Cada función recibe la lista y devuelve una nueva; el PATCH
 *  reemplaza la lista entera, así que no hay parches incrementales. */
import type { Fase } from "./fase";

const conFase = (
  fases: readonly Fase[],
  orden: number,
  cambio: (fase: Fase) => Fase,
): Fase[] => fases.map((fase) => (fase.orden === orden ? cambio(fase) : fase));

const siguienteOrden = (ordenes: readonly number[]) => Math.max(0, ...ordenes) + 1;

export function progreso(fases: readonly Fase[]): { hechas: number; total: number } {
  return {
    hechas: fases.filter((fase) => fase.estado === "completada").length,
    total: fases.length,
  };
}

export function requisitosDe(fase: Fase): { hechos: number; total: number } {
  const requisitos = fase.requisitos ?? [];
  return {
    hechos: requisitos.filter((requisito) => requisito.hecho).length,
    total: requisitos.length,
  };
}

/** Cambia el estado y, si se pasa, la nota en la misma escritura. */
export function conEstado(
  fases: readonly Fase[],
  orden: number,
  estado: Fase["estado"],
  nota?: string,
): Fase[] {
  return conFase(fases, orden, (fase) =>
    nota === undefined ? { ...fase, estado } : { ...fase, estado, nota },
  );
}

export function conNota(fases: readonly Fase[], orden: number, nota: string): Fase[] {
  return conFase(fases, orden, (fase) => ({ ...fase, nota }));
}

export function conRequisito(
  fases: readonly Fase[],
  orden: number,
  ordenRequisito: number,
): Fase[] {
  return conFase(fases, orden, (fase) => ({
    ...fase,
    requisitos: (fase.requisitos ?? []).map((requisito) =>
      requisito.orden === ordenRequisito
        ? { ...requisito, hecho: !requisito.hecho }
        : requisito,
    ),
  }));
}

export function sinFase(fases: readonly Fase[], orden: number): Fase[] {
  return fases.filter((fase) => fase.orden !== orden);
}

export function sinRequisito(
  fases: readonly Fase[],
  orden: number,
  ordenRequisito: number,
): Fase[] {
  return conFase(fases, orden, (fase) => ({
    ...fase,
    requisitos: (fase.requisitos ?? []).filter(
      (requisito) => requisito.orden !== ordenRequisito,
    ),
  }));
}

export function nuevaFase(
  fases: readonly Fase[],
  titulo: string,
  primerRequisito: string,
): Fase[] {
  return [
    ...fases,
    {
      orden: siguienteOrden(fases.map((fase) => fase.orden)),
      titulo,
      estado: "pendiente",
      nota: "",
      entered_at: "",
      requisitos: [{ orden: 1, titulo: primerRequisito, hecho: false, done_at: null }],
    },
  ];
}

export function nuevoRequisito(
  fases: readonly Fase[],
  orden: number,
  titulo: string,
): Fase[] {
  return conFase(fases, orden, (fase) => {
    const requisitos = fase.requisitos ?? [];
    return {
      ...fase,
      requisitos: [
        ...requisitos,
        {
          orden: siguienteOrden(requisitos.map((requisito) => requisito.orden)),
          titulo,
          hecho: false,
          done_at: null,
        },
      ],
    };
  });
}
