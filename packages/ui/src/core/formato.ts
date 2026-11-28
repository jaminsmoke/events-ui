/** Las fechas de la UI, con un único locale.
 *
 *  Antes había tres formateadores: `fechaCorta` usaba el locale del sistema
 *  (`toLocaleString(undefined, …)`) y los de Git fijaban `es-ES`, así que la
 *  misma fecha salía en dos idiomas según el navegador. Aquí manda `es-ES` en
 *  las dos formas: la corta (día, mes, año y hora) y la del commit (día y mes).
 *  La «larga» del Inspector era la misma que la corta y por eso no se repite.
 */
const LOCALE = "es-ES";

const CORTA = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });
const COMMIT = new Intl.DateTimeFormat(LOCALE, { day: "2-digit", month: "short" });

function formatear(iso: string, formato: Intl.DateTimeFormat): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : formato.format(fecha);
}

/** Fecha corta del sistema: el ISO crudo (`…T07:15:01+00:00`) no se lee. */
export function fechaCorta(iso: string): string {
  return formatear(iso, CORTA);
}

/** La fecha de un commit en la línea temporal: día y mes, sin año ni hora. */
export function fechaCommit(iso: string): string {
  return formatear(iso, COMMIT);
}
