"""Ruta del árbol de archivos: los niveles que el pane tiene desplegados."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Query

from .. import arbol, ideas
from ..contrato import RESPUESTAS_ERROR, NivelArbol, RepoParam

router = APIRouter()


@router.get("/arbol", response_model=list[NivelArbol], tags=["arbol"], responses=RESPUESTAS_ERROR)
def get_arbol(
    repo: RepoParam,
    rutas: Annotated[
        list[str] | None,
        Query(description="Carpetas a listar, relativas a la raíz del repo"),
    ] = None,
) -> list[dict[str, Any]]:
    """Los hijos de cada carpeta pedida; la raíz (`""`) siempre lista.

    Se piden solo los niveles desplegados, así que un repo grande no cuesta más
    que uno pequeño: nunca se recorre el árbol entero. Sin `rutas` se devuelve
    solo la raíz, que es lo que el pane enseña plegado.
    """
    carpeta = ideas.resolve_repo(repo)
    return arbol.niveles(carpeta, list(rutas or []))
