/** Lo que la UI compartida necesita saber de las actualizaciones.
 *
 *  Comprobar, descargar e instalar son cosas del envoltorio (solo desktop:
 *  usan el plugin de Tauri). La web no pasa `actualizacion` y la UI no pinta
 *  ni el aviso ni la sección de Ajustes. */
export type EstadoActualizacion =
  | "inactivo"
  | "comprobando"
  | "disponible"
  | "descargando"
  | "error";

export type Actualizacion = {
  /** La versión que se está ejecutando, tal como la reporta la app. */
  version: string;
  estado: EstadoActualizacion;
  /** La versión publicada, si la hay; `notas` es el cuerpo del release. */
  nueva: { version: string; notas: string } | null;
  /** 0..1 durante la descarga; `null` si el servidor no da el tamaño. */
  progreso: number | null;
  /** Resultado de la última comprobación («estás al día», un error…). */
  mensaje: string | null;
  comprobar: () => void;
  instalar: () => void;
  descartar: () => void;
};
