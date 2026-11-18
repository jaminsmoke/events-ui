import { useEffect, useState } from "react";

import { API_BASE } from "./api";
import type { Evento } from "./api";

/** Registro de renderers por `type`: cada tipo de evento puede pintarse de
 *  su manera. Los tipos que no están caen en `resumenGenerico` —un evento
 *  desconocido nunca rompe la vista (ADR 0001, decisión 7). */
export type Renderizador = (evento: Evento) => string;

function resumenGenerico(evento: Evento): string {
  const payload =
    typeof evento.payload === "string" ? evento.payload : JSON.stringify(evento.payload);
  return `${evento.type}: ${payload}`;
}

/** Lo ya registrado; se lee en cada render, así añadir un tipo es una línea. */
export const RENDERIZADORES: Record<string, Renderizador> = {
  // Ejemplo: aquí iría `commit: (e) => ...` cuando F2 pacte los tipos.
};

export function resumenEvento(evento: Evento): string {
  return (RENDERIZADORES[evento.type] ?? resumenGenerico)(evento);
}

/** El log en vivo por SSE (`GET /eventos/stream?repo=...`), de un repo.
 *
 *  Conecta al abrirse el hook y se despide al desmontarse o al cambiar de repo
 *  (cada repo es su propio log). El core lleva el `id:` de cada frame, así que
 *  el navegador reconecta con `Last-Event-ID` y no se pierde nada entre
 *  medias —ese es el cursor del tail, del lado del servidor. Los `ping`
 *  (`: ping`) son comentarios SSE y llegan sin `data`: el `JSON.parse` no se
 *  toca.
 *
 *  Sin repo no hay stream: con el repo sin elegir no hay log que vigilar.
 */
export function useEventos(repo: string | null): { eventos: Evento[]; conectado: boolean } {
  // El estado se resetea al cambiar de repo (verificado por repo en el render,
  // sin seteo en el efecto).
  const [estado, setEstado] = useState<{ repo: string | null; eventos: Evento[] }>({
    repo,
    eventos: [],
  });
  const [conectado, setConectado] = useState(false);

  useEffect(() => {
    if (!repo) return;
    const url = `${API_BASE.replace(/\/$/, "")}/eventos/stream?repo=${encodeURIComponent(repo)}`;
    const fuente = new EventSource(url);
    fuente.addEventListener("evento", (mensaje) => {
      try {
        const evento = JSON.parse(mensaje.data) as Evento;
        setEstado((previo) => ({
          repo,
          eventos: previo.repo === repo ? [...previo.eventos.slice(-99), evento] : [evento],
        }));
      } catch {
        // Un frame roto no rompe el stream: el siguiente lo sustituye.
      }
    });
    fuente.onopen = () => setConectado(true);
    fuente.onerror = () => setConectado(false);
    return () => fuente.close();
  }, [repo]);

  const eventos = estado.repo === repo ? estado.eventos : [];
  return { eventos, conectado: conectado && repo !== null };
}
