"""Rutas de la migración de Markdown: aplicar un plan como lote."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from .. import ideas
from .. import migracion as escaneo
from ..contrato import (
    RESPUESTAS_ERROR,
    MigracionAplicada,
    MigracionDeshecha,
    PlanMigracion,
    RepoParam,
)
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


@router.delete(
    "/migracion/lotes/{lote}",
    response_model=MigracionDeshecha,
    tags=["migracion"],
    responses={
        **RESPUESTAS_ERROR,
        409: {"description": "El lote ya no está como lo dejó el apply"},
    },
)
def delete_lote(lote: str, repo: RepoParam) -> dict[str, Any]:
    """Deshace un lote: borra solo sus ideas si nadie las tocó después.

    Un 409 enumera todos los conflictos (carril distinto de `proposed`,
    `updated_at` posterior a `creada_at`, o una ficha ajena que la usa como
    sustituta) y no borra nada; un 404 es un lote que no existe.
    """
    try:
        return ideas.deshacer_migracion(repo, lote)
    except ideas.MigracionEnConflicto as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
