"""Rutas del log de eventos del repo: tail, SSE y compactación (F1)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query, Request
from fastapi.responses import StreamingResponse

from .. import eventos, registro
from ..contrato import RESPUESTAS_ERROR, Evento, EventosCompactados, RepoParam

router = APIRouter()

# --- Eventos del log externo (F1) ---
#
# Sobre abierto: `type` libre y `payload` JSON libre. La UI usa renderers por
# tipo con fallback genérico. Sin fichero no hay eventos: no se crea el log.


@router.get("/eventos", response_model=list[Evento], tags=["eventos"], responses=RESPUESTAS_ERROR)
def get_eventos(
    repo: RepoParam,
    desde: Annotated[int, Query(ge=0, description="Cursor: solo eventos con id mayor")] = 0,
    limite: Annotated[int, Query(ge=1, le=1000)] = eventos.LIMITE_POR_DEFECTO,
    origen: str | None = Query(default=None, description="Solo este origen: `idea`, `externo`, …"),
) -> list[dict[str, Any]]:
    """Tail por cursor: backfill histórico con `id > desde`."""
    return eventos.tail(repo, desde, limite, origen)


@router.get("/eventos/stream", tags=["eventos"], responses=RESPUESTAS_ERROR)
def stream_eventos(request: Request, repo: RepoParam) -> StreamingResponse:
    """SSE en vivo: primero el backfill hasta el último y luego lo que llegue.

    Sin `Last-Event-ID` se empieza desde el principio (backfill histórico);
    con él, se reanuda tras ese id —el mismo cursor del tail, sin huecos.
    """
    ultimo = request.headers.get("last-event-id")
    desde = int(ultimo) if ultimo and ultimo.isdigit() else 0
    return StreamingResponse(
        eventos.generar_streamo(repo, desde, desconectado=request.is_disconnected),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post(
    "/eventos/compactar",
    response_model=EventosCompactados,
    tags=["eventos"],
    responses=RESPUESTAS_ERROR,
)
def post_compactar(
    repo: RepoParam,
    dias: Annotated[int, Query(ge=1, description="Edad máxima en días")] = eventos.DIAS_RETENCION,
    max_eventos: Annotated[
        int, Query(ge=1, description="Máximo de eventos a conservar")
    ] = eventos.MAX_EVENTOS_RETENCION,
) -> dict[str, Any]:
    """Recorta el log a la política de retención; el resto se conserva."""
    resultado = eventos.compactar(repo, dias=dias, max_eventos=max_eventos)
    registro.escribir(
        "info",
        f"Compactación del log de {repo}: {resultado['por_edad']} por edad, "
        f"{resultado['por_conteo']} por conteo",
        origen="compactar",
    )
    return resultado
