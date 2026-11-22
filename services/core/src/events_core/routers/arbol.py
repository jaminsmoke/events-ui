"""Ruta del árbol de archivos: los niveles que el pane tiene desplegados."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, Response

from .. import arbol, ideas
from ..contrato import RESPUESTAS_ERROR, Archivo, ErrorDetail, NivelArbol, RepoParam

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


@router.get(
    "/archivo",
    response_model=Archivo,
    tags=["arbol"],
    responses={
        **RESPUESTAS_ERROR,
        415: {"model": ErrorDetail, "description": "El archivo no es texto legible"},
    },
)
def get_archivo(
    repo: RepoParam,
    ruta: Annotated[
        str,
        Query(min_length=1, description="Ruta del archivo, relativa a la raíz del repo"),
    ],
) -> dict[str, Any]:
    """El texto de un archivo del repo para el visor, acotado a 512 KiB.

    Un binario responde 415 y no se inventa una decodificación: el visor puede
    enseñar el aviso sin intentar pintar bytes. La ruta no sale de la raíz.
    """
    try:
        return arbol.leer_archivo(ideas.resolve_repo(repo), ruta)
    except arbol.ArchivoBinario as exc:
        raise HTTPException(
            status_code=415, detail=f"El archivo no es texto legible: {exc}"
        ) from exc


@router.get(
    "/archivo-bytes",
    tags=["arbol"],
    responses={
        **RESPUESTAS_ERROR,
        413: {"model": ErrorDetail, "description": "La imagen supera el tope"},
        415: {"model": ErrorDetail, "description": "El archivo no es una imagen"},
    },
)
def get_archivo_bytes(
    repo: RepoParam,
    ruta: Annotated[
        str,
        Query(min_length=1, description="Ruta de la imagen, relativa a la raíz del repo"),
    ],
) -> Response:
    """Los bytes de una imagen del repo para pintarla en el visor.

    Solo se sirve `image/*`, hasta 12 MiB, y la ruta no sale de la raíz. El
    tipo viaja en `Content-Type` y `nosniff` evita que el navegador lo adivine.
    """
    try:
        datos, tipo = arbol.leer_imagen(ideas.resolve_repo(repo), ruta)
    except arbol.ArchivoNoImagen as exc:
        raise HTTPException(status_code=415, detail=f"No es una imagen: {exc}") from exc
    except arbol.ArchivoDemasiadoGrande as exc:
        raise HTTPException(status_code=413, detail=f"La imagen supera 12 MiB: {exc}") from exc
    return Response(
        content=datos,
        media_type=tipo,
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"},
    )
