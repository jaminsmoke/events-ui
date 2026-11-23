"""Rutas de ítems: repos, CRUD, mapa, protocolos y reinicio del laboratorio."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query

from .. import items, registro
from ..contrato import (
    RESPUESTAS_ERROR,
    KindLeido,
    MapSnapshot,
    Protocolo,
    Reinicio,
    Repo,
    RepoParam,
    Revision,
    Status,
    WorkItem,
    WorkItemCreate,
    WorkItemResumen,
    WorkItemUpdate,
)

router = APIRouter()


@router.get("/repos", response_model=list[Repo], tags=["items"])
def get_repos() -> list[dict[str, Any]]:
    """Repos investigados que ya tienen `.EUI/EUI_DATABASE.sqlite`."""
    return items.list_repos()


@router.get(
    "/items",
    response_model=list[WorkItemResumen] | list[WorkItem],
    tags=["items"],
    responses=RESPUESTAS_ERROR,
)
def get_items(
    repo: RepoParam,
    status: Status | None = None,
    kind: KindLeido | None = None,
    # La fila del listado es un resumen; el cuerpo se pide a propósito.
    incluir: Literal["contenido"] | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    return items.list_items(
        repo,
        status=status,
        kind=kind,
        limit=limit,
        offset=offset,
        incluir_contenido=incluir == "contenido",
    )


@router.post(
    "/items",
    response_model=WorkItem,
    status_code=201,
    tags=["items"],
    responses=RESPUESTAS_ERROR,
)
def post_item(body: WorkItemCreate, repo: RepoParam) -> dict[str, Any]:
    return items.create_item(repo, **body.model_dump())


@router.get("/items/{uid}", response_model=WorkItem, tags=["items"], responses=RESPUESTAS_ERROR)
def get_item(uid: str, repo: RepoParam) -> dict[str, Any]:
    return items.get_item(repo, uid)


@router.patch("/items/{uid}", response_model=WorkItem, tags=["items"], responses=RESPUESTAS_ERROR)
def patch_item(uid: str, body: WorkItemUpdate, repo: RepoParam) -> dict[str, Any]:
    return items.update_item(repo, uid, body.model_dump(exclude_unset=True))


@router.delete("/items/{uid}", status_code=204, tags=["items"], responses=RESPUESTAS_ERROR)
def remove_item(uid: str, repo: RepoParam) -> None:
    if not items.delete_item(repo, uid):
        raise KeyError(uid)


@router.post("/reiniciar", response_model=Reinicio, tags=["items"], responses=RESPUESTAS_ERROR)
def post_reiniciar(repo: RepoParam) -> dict[str, Any]:
    """Reinicio de laboratorio: el almacén queda vacío (ítems, cola, fichas
    y eventos). Solo lo llama el lanzador de pruebas del desktop
    (`puedeProbar`): no es parte del CRUD de producto."""
    resultado = items.reiniciar(repo)
    registro.escribir(
        "info",
        f"Reinicio de laboratorio en {repo}: {resultado['ideas_eliminadas']} ítems, "
        f"{resultado['eventos_eliminados']} eventos",
        origen="reiniciar",
    )
    return resultado


@router.get(
    "/protocolos", response_model=list[Protocolo], tags=["items"], responses=RESPUESTAS_ERROR
)
def get_protocolos(repo: RepoParam) -> list[dict[str, Any]]:
    """Las uniones permitidas entre carriles (`protocolo_flujo`).

    La UI las lee para no ofrecer flujos prohibidos; la que impone de verdad
    es el PATCH, que responde 400 cuando la unión no está listada. Es
    configuración del almacén: el reinicio de laboratorio no la toca."""
    return items.listar_protocolos(repo)


@router.get("/mapa", response_model=MapSnapshot, tags=["items"], responses=RESPUESTAS_ERROR)
def get_map(repo: RepoParam) -> dict[str, Any]:
    """Los ítems del mapa tal como estaban en una misma lectura de SQLite."""
    return items.map_snapshot(repo)


@router.get("/revision", response_model=Revision, tags=["items"], responses=RESPUESTAS_ERROR)
def get_revision(repo: RepoParam) -> dict[str, Any]:
    """Sondeo de cambio: la UI lo pide cada par de segundos, sin traerse el mapa."""
    return items.revision(repo)
