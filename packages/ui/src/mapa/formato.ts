/** Formato de fechas para la ficha. */

/** Fecha corta del sistema: el ISO crudo (`…T07:15:01+00:00`) no se lee. */
export function fechaCorta(iso: string): string {
  const f = new Date(iso);
  return Number.isNaN(f.getTime())
    ? iso
    : f.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
