"""Rutas de Git y proyecciones: estado del repo, `git init` y eliminación (F2)."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from .. import ideas, proyeccion, registro
from ..contrato import RESPUESTAS_ERROR, CommitGit, ProyeccionRepo, RepoParam

router = APIRouter()

# --- F2: proyecciones con nombre, sin SQL libre ---


@router.get(
    "/proyecciones/repo", response_model=ProyeccionRepo, tags=["f2"], responses=RESPUESTAS_ERROR
)
def get_proyeccion_repo(repo: RepoParam) -> dict[str, Any]:
    """Primera proyección: estado del repo con su identidad (rama/commit)."""
    return proyeccion.repo_estado_actual(repo)


@router.post(
    "/git/inicializar", response_model=ProyeccionRepo, tags=["git"], responses=RESPUESTAS_ERROR
)
def post_git_inicializar(repo: RepoParam) -> dict[str, Any]:
    """`git init` en la carpeta del repo; devuelve la proyección actualizada."""
    carpeta = ideas.resolve_repo(repo)
    proyeccion.inicializar_repo(carpeta)
    registro.escribir("info", f"Repo Git inicializado en {carpeta}", origen="git")
    return proyeccion.repo_estado_actual(repo)


@router.post(
    "/git/eliminar", response_model=ProyeccionRepo, tags=["git"], responses=RESPUESTAS_ERROR
)
def post_git_eliminar(repo: RepoParam) -> dict[str, Any]:
    """Borra el `.git` propio y nada más; devuelve la proyección actualizada."""
    carpeta = ideas.resolve_repo(repo)
    proyeccion.eliminar_repo(carpeta)
    registro.escribir("info", f"Repo Git eliminado en {carpeta}", origen="git")
    return proyeccion.repo_estado_actual(repo)


@router.get(
    "/git/commits", response_model=list[CommitGit], tags=["git"], responses=RESPUESTAS_ERROR
)
def get_git_commits(
    repo: RepoParam,
    limite: Annotated[int, Query(ge=1, le=100, description="Máximo de commits")] = 20,
) -> list[dict[str, str]]:
    """Los últimos commits de la rama actual, para el nodo Commits del mapa."""
    return proyeccion.historial(ideas.resolve_repo(repo), limite)
