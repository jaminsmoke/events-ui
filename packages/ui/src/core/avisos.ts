/** Ajustes de avisos del sistema (F3): qué se notifica y cuándo.
 *
 *  La verbosidad es lo que el usuario elige en el diálogo de Ajustes; no hay
 *  razón para avisar de todo siempre. Se guarda en `localStorage`: es
 *  preferencia de esta máquina, no dato del repo. */

export type Verbosidad = "apagado" | "errores" | "eventos" | "todo";

export interface Ajustes {
  /** `todo` = eventos y errores; `errores`/`eventos` solo de cada tipo. */
  verbosidad: Verbosidad;
  /** Si es `true` (defecto) solo se avisa con la ventana oculta o sin foco. */
  soloFondo: boolean;
}

const CLAVE = "eui:avisos";

export const AJUSTES_DEFECTO: Ajustes = { verbosidad: "todo", soloFondo: true };

const VERBOSIDADES: readonly Verbosidad[] = ["apagado", "errores", "eventos", "todo"];

export function cargarAjustes(): Ajustes {
  try {
    const texto = localStorage.getItem(CLAVE);
    if (!texto) return AJUSTES_DEFECTO;
    const datos: unknown = JSON.parse(texto);
    if (typeof datos !== "object" || datos === null) return AJUSTES_DEFECTO;
    const { verbosidad, soloFondo } = datos as Partial<Ajustes>;
    return {
      verbosidad: VERBOSIDADES.includes(verbosidad as Verbosidad)
        ? (verbosidad as Verbosidad)
        : AJUSTES_DEFECTO.verbosidad,
      soloFondo: typeof soloFondo === "boolean" ? soloFondo : AJUSTES_DEFECTO.soloFondo,
    };
  } catch {
    return AJUSTES_DEFECTO;
  }
}

export function guardarAjustes(ajustes: Ajustes): void {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(ajustes));
  } catch {
    // Guardar la preferencia es opcional: sin storage se sigue avisando.
  }
}

export function avisaEventos(ajustes: Ajustes): boolean {
  return ajustes.verbosidad === "eventos" || ajustes.verbosidad === "todo";
}

export function avisaErrores(ajustes: Ajustes): boolean {
  return ajustes.verbosidad === "errores" || ajustes.verbosidad === "todo";
}
