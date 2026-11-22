"""Rutas de la migración de Markdown: aplicar un plan como lote."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from .. import ideas
from .. import migracion as escaneo
from ..contrato import (
    RESPUESTAS_ERROR,
    DocumentoAbsorbido,
    DocumentoMarkdown,
    MigracionAplicada,
    MigracionDeshecha,
    PlanMigracion,
    RepoParam,
)
from ..ideas.base.rutas import resolve_repo

router = APIRouter()


@router.get(
    "/documentos",
    response_model=list[DocumentoAbsorbido],
    tags=["documentos"],
    responses=RESPUESTAS_ERROR,
)
def get_documentos(repo: RepoParam) -> list[dict[str, Any]]:
    """Lista los documentos absorbidos que todavía no se han deshecho."""
    return escaneo.listar_documentos_absorbidos(resolve_repo(repo))


@router.get(
    "/documentos/markdown",
    response_model=DocumentoMarkdown,
    tags=["documentos"],
    responses={
        **RESPUESTAS_ERROR,
        404: {"description": "El documento no tiene ítems absorbidos"},
    },
)
def get_documento(ruta: str, repo: RepoParam) -> dict[str, Any]:
    """Genera la vista Markdown actual sin leer el fichero original."""
    try:
        texto = escaneo.exportar_documento(resolve_repo(repo), ruta)
    except KeyError as exc:
        raise HTTPException(
            status_code=404, detail=f"no hay un documento absorbido en {ruta}"
        ) from exc
    return {"ruta": ruta, "texto": texto}


@router.post(
    "/migracion/aplicar",
    response_model=MigracionAplicada,
    tags=["migracion"],
    responses=RESPUESTAS_ERROR,
)
def post_aplicar(body: PlanMigracion, repo: RepoParam) -> dict[str, Any]:
    """Aplica el plan entero o nada.

    El contrato comprueba la forma (destinos de la v2, fases pendientes, un
    origen con hash por idea); `revisar` vuelve a mirar el disco (origen dentro
    del repo, `sha256` al día, ciclos y duplicados) y el core escribe el lote
    en una transacción. La huella canónica del plan hace idempotente el envío.
    """
    # `exclude_none`: el esquema del plan no acepta `null` en fecha/motivo;
    # las claves ausentes son la forma normal de decir «no aplica».
    plan = body.model_dump(exclude_none=True)
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
