"""Rutas de la migración de Markdown: aplicar un plan como lote."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import ideas
from .. import migracion as escaneo
from ..contrato import RESPUESTAS_ERROR, MigracionAplicada, PlanMigracion, RepoParam
from ..ideas.base.rutas import resolve_repo

router = APIRouter()


@router.post(
    "/migracion/aplicar",
    response_model=MigracionAplicada,
    tags=["migracion"],
    responses=RESPUESTAS_ERROR,
)
def post_aplicar(body: PlanMigracion, repo: RepoParam) -> dict[str, Any]:
    """Aplica el plan entero o nada.

    El contrato comprueba la forma (todo a `proposed`, fases pendientes, un
    origen con hash por idea); `revisar` vuelve a mirar el disco (origen dentro
    del repo, `sha256` al día, ciclos y duplicados) y el core escribe el lote
    en una transacción. La huella canónica del plan hace idempotente el envío.
    """
    plan = body.model_dump()
    informe = escaneo.revisar(resolve_repo(repo), plan)
    if not informe["ok"]:
        raise ideas.InvalidInput("; ".join(informe["errores"]))
    return ideas.aplicar_migracion(repo, plan, plan_sha256=escaneo.huella_plan(plan))
