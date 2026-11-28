"""Rutas del registro operativo de la app (no de los repos)."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query

from .. import registro
from ..contrato import EntradaLog, RegistroPurgado

router = APIRouter()

# --- Registro operativo de la app (no de los repos) ---


@router.get("/log", response_model=list[EntradaLog], tags=["log"])
def get_log(
    limite: Annotated[int, Query(ge=1, le=1000)] = 200,
    nivel: Literal["info", "aviso", "error"] | None = None,
    origen: str | None = None,
) -> list[dict[str, Any]]:
    """Las últimas entradas del registro de la app (la más nueva primero),
    opcionalmente por nivel y por etiqueta (`origen`: `core`, `seed`, …)."""
    return registro.listar(limite, nivel, origen)


@router.post("/log/purgar", response_model=RegistroPurgado, tags=["log"])
def post_purgar_log() -> dict[str, Any]:
    """Aplica ya la retención del registro (también pasa sola al escribir)."""
    return registro.purgar()
