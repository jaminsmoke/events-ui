"""El explorador de carpetas de la web: `GET /fs`.

El navegador no puede dar una ruta absoluta al pulsar «elegir carpeta»: los
diálogos nativos son de Tauri y las APIs del navegador entregan handles, no
rutas. El core lista un directorio y la UI navega hasta el repo.

La raíz la fija el core (`EVENTSUI_FS_ROOT` o el directorio del usuario) y no
se puede salir de ella: `path` se resuelve antes de comprobar que sigue dentro.
Los symlinks se resuelven también; uno que apunte fuera se rechaza.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Query

from ..contrato import RESPUESTAS_ERROR, FsListado
from ..items import InvalidInput

router = APIRouter()

# El mismo tope que el árbol del repo: una carpeta del sistema con miles de
# entradas no debe hinchar la respuesta ni congelar el selector.
LIMITE_POR_NIVEL = 400


def _raiz() -> Path:
    """La raíz del explorador: el override de pruebas o el home del usuario."""
    fijada = os.environ.get("EVENTSUI_FS_ROOT", "").strip()
    raiz = Path(fijada).expanduser() if fijada else Path.home()
    try:
        return raiz.resolve()
    except OSError as exc:
        raise InvalidInput(f"no se pudo resolver la raíz {raiz}: {exc}") from exc


def listar(ruta: str | None) -> dict[str, Any]:
    """Lista una carpeta dentro de la raíz, sin contenido ni metadatos de más.

    `ruta` puede ser absoluta o relativa a la raíz. Se resuelve primero y luego
    se comprueba que sigue dentro: así `..` y un symlink que sale no listan
    media máquina. Un fichero o una ruta que no existe es un 400 con el motivo.
    """
    raiz = _raiz()
    if not raiz.is_dir():
        raise InvalidInput(f"la raíz del explorador no es una carpeta: {raiz}")

    destino = Path(ruta).expanduser() if ruta else raiz
    if not destino.is_absolute():
        destino = raiz / destino
    try:
        destino = destino.resolve()
    except OSError as exc:
        raise InvalidInput(f"no se pudo resolver {ruta!r}: {exc}") from exc

    if not destino.is_relative_to(raiz):
        raise InvalidInput(f"ruta fuera de la raíz: {ruta!r}")
    if not destino.is_dir():
        raise InvalidInput(f"no es una carpeta: {ruta!r}")

    entradas: list[dict[str, Any]] = []
    try:
        with os.scandir(destino) as hijos:
            for entrada in hijos:
                try:
                    # Un enlace a carpeta se trata como archivo: seguirlo podría
                    # salir de la raíz o ciclarse. Para entrar se usa la ruta
                    # real, que sí pasa por la comprobación de arriba.
                    es_carpeta = entrada.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                entradas.append(
                    {
                        "nombre": entrada.name,
                        "tipo": "carpeta" if es_carpeta else "archivo",
                        "es_repo": es_carpeta and (Path(entrada.path) / ".EUI").is_dir(),
                    }
                )
    except OSError as exc:
        raise InvalidInput(f"no se pudo leer {ruta!r}: {exc}") from exc

    entradas.sort(
        key=lambda entrada: (
            entrada["tipo"] != "carpeta",
            str(entrada["nombre"]).casefold(),
        )
    )
    return {
        "ruta": str(destino),
        "padre": str(destino.parent) if destino != raiz else None,
        "entradas": entradas[:LIMITE_POR_NIVEL],
        "recortado": len(entradas) > LIMITE_POR_NIVEL,
    }


@router.get("/fs", response_model=FsListado, tags=["fs"], responses=RESPUESTAS_ERROR)
def get_fs(
    path: Annotated[
        str | None,
        Query(description="Carpeta a listar, absoluta o relativa a la raíz"),
    ] = None,
) -> dict[str, Any]:
    """Las carpetas y archivos de un nivel, ordenados y sin contenido.

    La web pinta solo las carpetas; los archivos viajan con su tipo para que el
    contrato no mienta si algún día el explorador también los muestra.
    """
    return listar(path)
