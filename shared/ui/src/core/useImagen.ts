import { useEffect, useState } from "react";

import { API_BASE } from "./api";

const EXTENSION_IMAGEN = /\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i;

/** ¿La ruta tiene una extensión que el visor pinta como imagen? */
export function esImagen(ruta: string): boolean {
  return EXTENSION_IMAGEN.test(ruta);
}

/** Resuelve el `src` relativo de una imagen de Markdown contra su archivo.
 *
 *  Devuelve `null` para URLs de red o `data:`: esas las pinta el navegador y
 *  no pasan por el core. Una ruta absoluta (`/img/...`) se interpreta dentro
 *  del repo; los `..` se resuelven sin salir de la raíz.
 */
export function resolverImagen(rutaMd: string, src: string): string | null {
  if (/^(https?:|data:|blob:)/i.test(src)) return null;
  let limpio = src.replace(/[#?].*$/, "");
  try {
    limpio = decodeURI(limpio);
  } catch {
    // Un `%` suelto no invalida la imagen: se intenta con la ruta tal cual.
  }
  if (!limpio) return null;
  const absoluta = limpio.startsWith("/");
  const pila = absoluta ? [] : rutaMd.split("/").slice(0, -1);
  for (const parte of (absoluta ? limpio.slice(1) : limpio).split("/")) {
    if (!parte || parte === ".") continue;
    if (parte === "..") pila.pop();
    else pila.push(parte);
  }
  return pila.join("/");
}

type Estado =
  | { ruta: string; url: string; bytes: number }
  | { ruta: string; error: string };

/** Una imagen del repo como object URL, pedida al abrirse.
 *
 *  La URL se revoca al cambiar de archivo: el blob no se queda colgado en
 *  memoria. El estado pertenece a una ruta, así que no se enseña la imagen
 *  anterior mientras llega la siguiente.
 */
export function useImagen(repo: string, ruta: string | null) {
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    if (!ruta) return;
    let vivo = true;
    let url: string | null = null;
    const controller = new AbortController();

    const pedir = async () => {
      try {
        const consulta = new URLSearchParams({ repo, ruta });
        const res = await fetch(`${API_BASE}/archivo-bytes?${consulta}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          const cuerpo = (await res.json().catch(() => null)) as { detail?: unknown } | null;
          const detalle =
            typeof cuerpo?.detail === "string" ? cuerpo.detail : `HTTP ${res.status}`;
          throw new Error(detalle);
        }
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        if (!vivo) {
          URL.revokeObjectURL(url);
          return;
        }
        setEstado({ ruta, url, bytes: blob.size });
      } catch (err) {
        if (vivo) {
          setEstado({ ruta, error: err instanceof Error ? err.message : String(err) });
        }
      }
    };

    void pedir();
    return () => {
      vivo = false;
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [repo, ruta]);

  const actual = estado && estado.ruta === ruta ? estado : null;
  return {
    url: actual && "url" in actual ? actual.url : null,
    bytes: actual && "bytes" in actual ? actual.bytes : null,
    error: actual && "error" in actual ? actual.error : null,
    cargando: ruta !== null && actual === null,
  };
}
