import { useCallback, useEffect, useRef, useState } from "react";

import { api, unwrap } from "./api";
import type { FsListado } from "./api";

/** El explorador de carpetas del selector: un solo sitio pide `/fs`.
 *
 *  Cada carga aborta la anterior y lleva un número de turno. Con dos clics
 *  seguidos, la respuesta lenta de la primera carpeta ya no pisa la última:
 *  el turno viejo se descarta al volver, aunque el `fetch` no se pueda
 *  cancelar a tiempo. Al desmontar se aborta lo que quede en vuelo. */
export function useCarpetas() {
  const [carpetas, setCarpetas] = useState<FsListado | null>(null);
  const [cargando, setCargando] = useState(true);
  const [fallo, setFallo] = useState<string | null>(null);
  const turno = useRef(0);
  const aborto = useRef<AbortController | null>(null);

  const cargar = useCallback(async (ruta?: string) => {
    const mio = ++turno.current;
    aborto.current?.abort();
    const controller = new AbortController();
    aborto.current = controller;
    // El primer `await` deja que el efecto termine: el estado se toca en la
    // continuación, no en el cuerpo del efecto (regla de React Hooks).
    await Promise.resolve();
    if (mio !== turno.current) return;
    setCargando(true);
    setFallo(null);
    try {
      const datos = await unwrap(
        api.GET("/fs", {
          params: { query: ruta ? { path: ruta } : {} },
          signal: controller.signal,
        }),
      );
      if (mio !== turno.current) return;
      setCarpetas(datos);
    } catch (err) {
      if (mio !== turno.current || controller.signal.aborted) return;
      setFallo(err instanceof Error ? err.message : String(err));
    } finally {
      if (mio === turno.current) setCargando(false);
    }
  }, []);

  useEffect(() => {
    // La primera carga se agenda fuera del cuerpo del efecto: así el montaje
    // no encadena un render más y la regla de Hooks no la cuenta como síncrona.
    const t = setTimeout(() => void cargar(), 0);
    return () => {
      clearTimeout(t);
      aborto.current?.abort();
    };
  }, [cargar]);

  return { carpetas, cargando, fallo, cargar };
}
