"""Dónde vive un almacén: el laboratorio, su carpeta y su `.EUI`.

`config.py` guarda la raíz como ruta absoluta, y para eso tenía que importar
`items.base.rutas`: una dependencia de la app hacia el dominio que además
arrastraba su `InvalidInput`. Lo que comparten las dos capas vive aquí, sin
depender de `items`; `items` lo reexporta en su API.
"""

from __future__ import annotations

import os
from pathlib import Path

from .errors import InvalidInput

EUI_DIR = ".EUI"
# Con extensión: un SQLite sin extensión no lo reconoce ningún editor ni visor, y
# en un repo commiteado no hay forma de saber qué es. El nombre viejo, sin
# extensión, se migra solo la primera vez que se abre.
DB_FILENAME = "EUI_DATABASE.sqlite"

REPOS_ROOT_ENV_VAR = "EVENTSUI_REPOS_ROOT"


def repos_root() -> Path:
    """Raíz de los repos investigados: `EVENTSUI_REPOS_ROOT` o `repoprobe/repos`."""
    env = os.environ.get(REPOS_ROOT_ENV_VAR)
    if env:
        return Path(env).expanduser().resolve()
    # src/events_core/rutas.py -> raíz del proyecto
    return Path(__file__).resolve().parents[4] / "repoprobe" / "repos"


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
