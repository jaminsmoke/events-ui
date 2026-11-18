import { useEffect, useState } from "react";

import { API_BASE } from "./api";
import type { Evento } from "./api";

/** Registro de renderers por `type`: cada tipo de evento puede pintarse de
 *  su manera. Los tipos que no están caen en `resumenGenerico` —un evento
 *  desconocido nunca rompe la vista. */
export type Renderizador = (evento: Evento) => string;

function resumenGenerico(evento: Evento): string {
  const payload =
    typeof evento.payload === "string" ? evento.payload : JSON.stringify(evento.payload);
  return `${evento.type}: ${payload}`;
}

/** Lo ya registrado; se lee en cada render, así añadir un tipo es una línea.
 *
 *  El payload es JSON libre: `payload` puede venir como objeto o como texto
 *  crudo. El renderer accede sin cast y, si no encuentra lo que espera, cae
 *  al fallback genérico en vez de romper. */
function campo(evento: Evento, nombre: string): string | undefined {
  const payload = evento.payload;
  if (typeof payload !== "object" || payload === null) return undefined;
  const valor = (payload as Record<string, unknown>)[nombre];
  return typeof valor === "string" && valor ? valor : undefined;
}

export const RENDERIZADORES: Record<string, Renderizador> = {
  // El ciclo de vida de una idea: el título sale del payload sin tener que
  // abrir el mapa. Sin título no hay resumen: cae al fallback genérico.
  "idea.created": (e) => (campo(e, "title") ? `Nueva idea: ${campo(e, "title")}` : ""),
  "idea.updated": (e) => (campo(e, "title") ? `Idea actualizada: ${campo(e, "title")}` : ""),
  "idea.deleted": (e) => (campo(e, "title") ? `Idea borrada: ${campo(e, "title")}` : ""),
  "idea.status": (e) => {
    const titulo = campo(e, "title");
    const estado = campo(e, "status");
    return titulo && estado ? `${titulo}: ${estado}` : "";
  },
};

export function resumenEvento(evento: Evento): string {
  const renderizador = RENDERIZADORES[evento.type];
  // Un renderer que no tiene qué decir no inventa texto: mejor el volcado.
  const resumen = renderizador?.(evento);
  return resumen ? resumen : resumenGenerico(evento);
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
