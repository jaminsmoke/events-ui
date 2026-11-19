"""Rutas de Git y proyecciones: estado del repo, `git init` y eliminación (F2)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import ideas, proyeccion, registro
from ..contrato import RESPUESTAS_ERROR, ProyeccionRepo, RepoParam

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
