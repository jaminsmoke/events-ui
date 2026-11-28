"""Dónde vive cada almacén: el `.gitignore` y la política de puertas.

La resolución de rutas —el laboratorio, un nombre o una ruta absoluta, y la
base dentro de `.EUI`— vive en `events_core.rutas`, porque también la necesita
`config.py`, que no puede depender del dominio. Aquí se reexporta tal cual: es
la API que usan `items`, el CLI y las proyecciones.
"""

from __future__ import annotations

from pathlib import Path

from ...rutas import (
    DB_FILENAME,
    EUI_DIR,
    REPOS_ROOT_ENV_VAR,
    db_file_for,
    repos_root,
    resolve_repo,
)

# La política de puertas del repo. Vive en `.EUI` porque es la única carpeta que
# el producto controla, pero se versiona: `.gitignore` la excluye de la purga y
# la reincorpora al repo.
PROTOCOLOS_FILENAME = "protocolos.json"

LEGACY_DB_FILENAME = "EUI_DATABASE"

EUI_GITIGNORE = f"{DB_FILENAME}-wal\n{DB_FILENAME}-shm\n"
# Lo que el `.gitignore` de un almacén viejo ignora y ya no existe: se retira.

_GITIGNORE_VIEJO = {f"{LEGACY_DB_FILENAME}-wal", f"{LEGACY_DB_FILENAME}-shm"}

# Las rutas siguen saliendo de aquí para no tocar los imports de `items`; la
# verdad es `events_core.rutas`.
__all__ = [
    "DB_FILENAME",
    "EUI_DIR",
    "EUI_GITIGNORE",
    "LEGACY_DB_FILENAME",
    "PROTOCOLOS_FILENAME",
    "REPOS_ROOT_ENV_VAR",
    "db_file_for",
    "repos_root",
    "resolve_repo",
]


def _ignorar_auxiliares(db_file: Path) -> None:
    """Pone al día el `.gitignore` de `.EUI`.

    Escribirlo solo al crear el almacén dejaba a los repos anteriores al cambio
    de nombre con la lista vieja: su WAL —que crece a megas— aparecía como
    fichero nuevo en `git status`. Aquí se añade lo que falte y se retiran las
    líneas del nombre antiguo, sin tocar nada más que haya escrito el repo.
    """
    destino = db_file.parent / ".gitignore"
    try:
        actual = destino.read_text(encoding="utf-8")
    except OSError:
        actual = ""

    lineas = [line for line in actual.splitlines() if line.strip() not in _GITIGNORE_VIEJO]
    for nombre in EUI_GITIGNORE.split():
        if nombre not in lineas:
            lineas.append(nombre)

    nuevo = "\n".join(lineas).strip("\n") + "\n"
    if nuevo != actual:
        destino.write_text(nuevo, encoding="utf-8")
