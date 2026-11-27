/** La carpeta elegida se guarda en el core, con reintento.
 *
 *  Antes `App` marcaba la carpeta como persistida antes del PUT: si el core
 *  estaba caído, la promesa se rechazaba y nadie volvía a intentarlo, así que
 *  el CLI y el MCP se quedaban con la raíz anterior. Aquí la carpeta solo se
 *  da por guardada cuando el core contesta; si no, se reintenta tras la
 *  espera acordada. Devolver la función de parada cancela el reintento al
 *  cambiar de repo o al desmontar.
 */
export type GuardarRepo = (repo: string) => Promise<unknown>;

export function persistirRepo(
  repo: string,
  put: GuardarRepo,
  {
    espera = 5_000,
    alGuardar,
    programar = (fn: () => void, ms: number) => setTimeout(fn, ms),
    cancelar = (id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>),
  }: {
    espera?: number;
    /** Se llama solo cuando el core confirma el guardado. */
    alGuardar?: () => void;
    /** El reloj, inyectable para medir el reintento sin esperarlo. */
    programar?: (fn: () => void, ms: number) => unknown;
    cancelar?: (id: unknown) => void;
  } = {},
): () => void {
  let vivo = true;
  let pendiente: unknown = null;
  let enVuelo = false;

  const guardar = () => {
    if (!vivo || enVuelo) return;
    enVuelo = true;
    put(repo)
      .then(() => {
        enVuelo = false;
        if (vivo) alGuardar?.();
      })
      .catch(() => {
        enVuelo = false;
        if (vivo) pendiente = programar(guardar, espera);
      });
  };
  guardar();

  return () => {
    vivo = false;
    if (pendiente !== null) cancelar(pendiente);
  };
}
