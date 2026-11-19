/** Un solo temporizador para los sondeos del mapa.
 *
 *  Antes cada dato tenía su `setTimeout` —la firma del almacén cada 2 s, los
 *  protocolos y la proyección cada 5 s— y los tres seguían pidiendo con la
 *  ventana oculta. Aquí el temporizador es uno solo: emite cada `TIC_MS`,
 *  calla mientras la pestaña no se ve y, al volver, avisa al instante para no
 *  esperar el intervalo entero.
 *
 *  Los suscriptores no encadenan promesas: cada uno decide si el aviso le
 *  pilla con una lectura en vuelo y se salta el turno, así un core lento no
 *  acumula peticiones.
 */
const TIC_MS = 2_000;

type Aviso = () => void;

const avisos = new Set<Aviso>();
let timer: ReturnType<typeof setTimeout> | undefined;
let escuchando = false;

function programar(): void {
  clearTimeout(timer);
  if (avisos.size === 0 || document.hidden) return;
  timer = setTimeout(() => {
    for (const aviso of avisos) aviso();
    programar();
  }, TIC_MS);
}

function alCambiarVisibilidad(): void {
  if (!document.hidden) for (const aviso of avisos) aviso();
  programar();
}

/** Avisa en cada latido mientras haya suscriptores. Devuelve la baja. */
export function suscribirSondeo(aviso: Aviso): () => void {
  avisos.add(aviso);
  if (!escuchando) {
    document.addEventListener("visibilitychange", alCambiarVisibilidad);
    escuchando = true;
  }
  programar();
  return () => {
    avisos.delete(aviso);
    programar();
  };
}
