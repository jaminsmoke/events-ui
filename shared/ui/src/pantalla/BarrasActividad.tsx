import type { ReactNode } from "react";

import type { VistaDerecha, VistaPane } from "./vistas";

/** Barra de actividad izquierda: una tira de iconos, cada uno con su vista.
 *  No navega ella misma: solo decide qué panel se ve. Repetir el icono activo
 *  lo cierra (el pane pasa a `null`), como en un IDE. */
export function BarraActividad({
  vista,
  onVista,
}: {
  vista: VistaPane | null;
  onVista: (vista: VistaPane) => void;
}) {
  const item = (clave: VistaPane, etiqueta: string, icono: ReactNode) => (
    <button
      type="button"
      className={`actividad-item${vista === clave ? " activo" : ""}`}
      aria-pressed={vista === clave}
      aria-label={etiqueta}
      title={vista === clave ? `Ocultar ${etiqueta.toLowerCase()}` : etiqueta}
      onClick={() => onVista(clave)}
    >
      {icono}
    </button>
  );

  return (
    <nav className="actividad" aria-label="Barra de actividad">
      {item(
        "mapas",
        "Mapas",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3.5" width="7" height="4" rx="1" />
          <rect x="14" y="3.5" width="7" height="4" rx="1" />
          <rect x="8.5" y="16.5" width="7" height="4" rx="1" />
          <path d="M6.5 7.5v3h11v-3M12 10.5v6" />
        </svg>,
      )}
      {item(
        "archivos",
        "Archivos",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3.5 6.5h6l2 2.2h9v10.8H3.5z" />
        </svg>,
      )}
      {item(
        "git",
        "Control de código fuente",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="6.5" cy="18" r="2.3" />
          <circle cx="6.5" cy="6" r="2.3" />
          <circle cx="17.5" cy="7.5" r="2.3" />
          <path d="M6.5 8.3v7.4M8.8 6h3.4a5.3 5.3 0 0 1 5.3 5.3" />
        </svg>,
      )}
    </nav>
  );
}

/** Barra de actividad derecha: el Resumen y el Inspector, que se abren sobre
 *  el lienzo. Va a la derecha del viewport, no dentro del panel: el panel se
 *  cierra y la tira se queda. Repetir el icono activo lo cierra. */
export function BarraDerecha({
  vista,
  onVista,
}: {
  vista: VistaDerecha | null;
  onVista: (vista: VistaDerecha) => void;
}) {
  const item = (clave: VistaDerecha, etiqueta: string, icono: ReactNode) => (
    <button
      type="button"
      className={`actividad-item${vista === clave ? " activo" : ""}`}
      aria-pressed={vista === clave}
      aria-label={etiqueta}
      title={vista === clave ? `Ocultar ${etiqueta.toLowerCase()}` : `Mostrar ${etiqueta.toLowerCase()}`}
      onClick={() => onVista(clave)}
    >
      {icono}
    </button>
  );

  return (
    <nav className="actividad actividad-derecha" aria-label="Panel derecho">
      {item(
        "resumen",
        "Resumen",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M5 19v-6M12 19V5M19 19v-9" />
        </svg>,
      )}
      {item(
        "inspector",
        "Inspector",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <circle cx="10.5" cy="10.5" r="5.2" />
          <path d="M14.4 14.4 19 19" />
        </svg>,
      )}
      {item(
        "archivo",
        "Archivo",
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 3.5h7.5L18 8v12.5H6z" />
          <path d="M13.5 3.5V8H18M9 12h6M9 15.5h6" />
        </svg>,
      )}
    </nav>
  );
}
