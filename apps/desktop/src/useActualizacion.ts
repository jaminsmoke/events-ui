import { useCallback, useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";

import type { Actualizacion } from "@events-ui/ui";

/** Una sola comprobación al arrancar aunque StrictMode monte dos veces. */
let comprobadoAlArrancar = false;

/** Puente entre el plugin de Tauri y la UI compartida.
 *
 *  Antes de instalar se para el sidecar y se quita la bandeja
 *  (`preparar_actualizacion`). En Windows el plugin lanza el NSIS y hace
 *  `exit(0)`; el PREINSTALL espera a que no quede `events-ui`/`events-core`
 *  y el `/R` del modo passive vuelve a abrir la app. `relaunch` queda de
 *  respaldo fuera de Windows. */
export function useActualizacion(): Actualizacion {
  const [version, setVersion] = useState("…");
  const [estado, setEstado] = useState<Actualizacion["estado"]>("inactivo");
  const [nueva, setNueva] = useState<Actualizacion["nueva"]>(null);
  const [progreso, setProgreso] = useState<number | null>(null);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const pendiente = useRef<Update | null>(null);
  const ocupado = useRef(false);
  const descargado = useRef(0);
  const total = useRef(0);

  useEffect(() => {
    void getVersion()
      .then(setVersion)
      .catch(() => setVersion("?"));
  }, []);

  const comprobar = useCallback(() => {
    if (ocupado.current) return;
    ocupado.current = true;
    setEstado("comprobando");
    setMensaje(null);
    void check()
      .then((update) => {
        if (!update) {
          pendiente.current = null;
          setNueva(null);
          setEstado("inactivo");
          setMensaje("Estás al día.");
          return;
        }
        pendiente.current = update;
        setNueva({ version: update.version, notas: update.body ?? "" });
        setEstado("disponible");
      })
      .catch((error: unknown) => {
        setEstado("error");
        setMensaje(
          `No se pudo comprobar: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        ocupado.current = false;
      });
  }, []);

  useEffect(() => {
    if (comprobadoAlArrancar) return;
    comprobadoAlArrancar = true;
    comprobar();
  }, [comprobar]);

  const instalar = useCallback(() => {
    const update = pendiente.current;
    if (!update) return;
    ocupado.current = true;
    descargado.current = 0;
    total.current = 0;
    setEstado("descargando");
    setProgreso(0);
    setMensaje(null);
    void update
      .download((evento) => {
        if (evento.event === "Started") {
          total.current = evento.data.contentLength ?? 0;
          setProgreso(total.current > 0 ? 0 : null);
        } else if (evento.event === "Progress") {
          descargado.current += evento.data.chunkLength;
          if (total.current > 0) {
            setProgreso(Math.min(1, descargado.current / total.current));
          }
        } else {
          setProgreso(1);
        }
      })
      .then(() =>
        // Sidecar, bandeja y flag: justo antes del NSIS, no durante la descarga.
        invoke("preparar_actualizacion").catch(() => {
          // Sin comando (dev/web): el PREINSTALL igual espera/mata procesos.
        }),
      )
      .then(() => update.install())
      .then(() => relaunch())
      .catch((error: unknown) => {
        setEstado("error");
        setProgreso(null);
        setMensaje(
          `No se pudo instalar: ${error instanceof Error ? error.message : String(error)}`,
        );
      })
      .finally(() => {
        ocupado.current = false;
      });
  }, []);

  const descartar = useCallback(() => {
    pendiente.current = null;
    setNueva(null);
    setEstado("inactivo");
    setProgreso(null);
    setMensaje(null);
  }, []);

  return {
    version,
    estado,
    nueva,
    progreso,
    mensaje,
    comprobar,
    instalar,
    descartar,
  };
}
