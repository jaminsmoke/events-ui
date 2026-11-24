"""Dónde vive cada almacén: el laboratorio, la carpeta y su `.EUI`."""

from __future__ import annotations

import os
from pathlib import Path

from .comun import InvalidInput

EUI_DIR = ".EUI"
# Con extensión: un SQLite sin extensión no lo reconoce ningún editor ni visor, y
# en un repo commiteado no hay forma de saber qué es. El nombre viejo, sin
# extensión, se migra solo la primera vez que se abre.

DB_FILENAME = "EUI_DATABASE.sqlite"

# La política de puertas del repo. Vive en `.EUI` porque es la única carpeta que
# el producto controla, pero se versiona: `.gitignore` la excluye de la purga y
# la reincorpora al repo.
PROTOCOLOS_FILENAME = "protocolos.json"

LEGACY_DB_FILENAME = "EUI_DATABASE"

REPOS_ROOT_ENV_VAR = "EVENTSUI_REPOS_ROOT"

EUI_GITIGNORE = f"{DB_FILENAME}-wal\n{DB_FILENAME}-shm\n"
# Lo que el `.gitignore` de un almacén viejo ignora y ya no existe: se retira.

_GITIGNORE_VIEJO = {f"{LEGACY_DB_FILENAME}-wal", f"{LEGACY_DB_FILENAME}-shm"}

# Columnas que la API puede modificar. Lista blanca: los nombres de columna de un
# UPDATE no pueden venir del cliente. `status` no está: un cambio de estado no
# es un UPDATE de el ítem, es mover la fila de `work_item_node` y escribir el detalle
# del nodo (`roadmap_node`, `verificacion_node`, `revision_node` o
# `rejected_node`). Los campos del descarte tampoco: los gestiona la transición
# del propio `status`.


def repos_root() -> Path:
    """Raíz de los repos investigados: `EVENTSUI_REPOS_ROOT` o `repoprobe/repos`."""
    env = os.environ.get(REPOS_ROOT_ENV_VAR)
    if env:
        return Path(env).expanduser().resolve()
    # src/events_core/items/base/rutas.py -> raíz del proyecto
    return Path(__file__).resolve().parents[6] / "repoprobe" / "repos"


def resolve_repo(repo: str) -> Path:
    """Carpeta del repo a partir de lo que manda la UI.

    Dos formas, y solo dos:
    - **ruta absoluta**: la que devuelve el selector de carpetas; se usa tal cual.
    - **nombre**: un solo segmento dentro del laboratorio (`repoprobe/repos`).
      Se rechazan `..` y separadores, para que un nombre no escape de la raíz.
    """
    candidate = Path(repo).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()

    name = repo.strip()
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise InvalidInput(f"nombre de repo inválido: {repo!r}")
    return (repos_root() / name).resolve()


def db_file_for(repo: str) -> Path:
    return resolve_repo(repo) / EUI_DIR / DB_FILENAME


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
