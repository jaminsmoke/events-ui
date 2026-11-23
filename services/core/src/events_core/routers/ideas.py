"""Rutas de ideas: repos, CRUD, mapa, protocolos y reinicio del laboratorio."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Query

from .. import ideas, registro
from ..contrato import (
    RESPUESTAS_ERROR,
    Idea,
    IdeaCreate,
    IdeaResumen,
    IdeaUpdate,
    Kind,
    MapSnapshot,
    Protocolo,
    Reinicio,
    Repo,
    RepoParam,
    Revision,
    Status,
)

router = APIRouter()


@router.get("/repos", response_model=list[Repo], tags=["ideas"])
def get_repos() -> list[dict[str, Any]]:
    """Repos investigados que ya tienen `.EUI/EUI_DATABASE.sqlite`."""
    return ideas.list_repos()


@router.get(
    "/ideas",
    response_model=list[IdeaResumen] | list[Idea],
    tags=["ideas"],
    responses=RESPUESTAS_ERROR,
)
def get_ideas(
    repo: RepoParam,
    status: Status | None = None,
    kind: Kind | None = None,
    # La fila del listado es un resumen; el cuerpo se pide a propósito.
    incluir: Literal["contenido"] | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    return ideas.list_ideas(
        repo,
        status=status,
        kind=kind,
        limit=limit,
        offset=offset,
        incluir_contenido=incluir == "contenido",
    )


@router.post(
    "/ideas", response_model=Idea, status_code=201, tags=["ideas"], responses=RESPUESTAS_ERROR
)
def post_idea(body: IdeaCreate, repo: RepoParam) -> dict[str, Any]:
    return ideas.create_idea(repo, **body.model_dump())


@router.get("/ideas/{uid}", response_model=Idea, tags=["ideas"], responses=RESPUESTAS_ERROR)
def get_idea(uid: str, repo: RepoParam) -> dict[str, Any]:
    return ideas.get_idea(repo, uid)


@router.patch("/ideas/{uid}", response_model=Idea, tags=["ideas"], responses=RESPUESTAS_ERROR)
def patch_idea(uid: str, body: IdeaUpdate, repo: RepoParam) -> dict[str, Any]:
    return ideas.update_idea(repo, uid, body.model_dump(exclude_unset=True))


@router.delete("/ideas/{uid}", status_code=204, tags=["ideas"], responses=RESPUESTAS_ERROR)
def remove_idea(uid: str, repo: RepoParam) -> None:
    if not ideas.delete_idea(repo, uid):
        raise KeyError(uid)


@router.post("/reiniciar", response_model=Reinicio, tags=["ideas"], responses=RESPUESTAS_ERROR)
def post_reiniciar(repo: RepoParam) -> dict[str, Any]:
    """Reinicio de laboratorio: el almacén queda vacío (ideas, cola, fichas
    y eventos). Solo lo llama el lanzador de pruebas del desktop
    (`puedeProbar`): no es parte del CRUD de producto."""
    resultado = ideas.reiniciar(repo)
    registro.escribir(
        "info",
        f"Reinicio de laboratorio en {repo}: {resultado['ideas_eliminadas']} ideas, "
        f"{resultado['eventos_eliminados']} eventos",
        origen="reiniciar",
    )
    return resultado


@router.get(
    "/protocolos", response_model=list[Protocolo], tags=["ideas"], responses=RESPUESTAS_ERROR
)
def get_protocolos(repo: RepoParam) -> list[dict[str, Any]]:
    """Las uniones permitidas entre carriles (`protocolo_flujo`).

    La UI las lee para no ofrecer flujos prohibidos; la que impone de verdad
    es el PATCH, que responde 400 cuando la unión no está listada. Es
    configuración del almacén: el reinicio de laboratorio no la toca."""
    return ideas.listar_protocolos(repo)


@router.get("/mapa", response_model=MapSnapshot, tags=["ideas"], responses=RESPUESTAS_ERROR)
def get_map(repo: RepoParam) -> dict[str, Any]:
    """Las ideas del mapa tal como estaban en una misma lectura de SQLite."""
    return ideas.map_snapshot(repo)


@router.get("/revision", response_model=Revision, tags=["ideas"], responses=RESPUESTAS_ERROR)
def get_revision(repo: RepoParam) -> dict[str, Any]:
    """Sondeo de cambio: la UI lo pide cada par de segundos, sin traerse el mapa."""
    return ideas.revision(repo)
