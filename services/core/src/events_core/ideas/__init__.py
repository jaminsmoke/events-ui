"""Ideas: la primera tabla del sistema, y no la de eventos.

Cada repositorio investigado es su propio almacén: lleva dentro una carpeta
`.EUI` con un SQLite llamado `EUI_DATABASE`. El fichero viaja con el repo.

El esquema no se escribe aquí: vive en `schema/ideas.sql`, que es el fichero que
se edita a mano. Este paquete solo lo aplica y hace CRUD sobre él.

La implementación va por capas, de abajo arriba, para que cada módulo sepa poco:

- `base/`: lo que no sabe de ideas — rutas del almacén, esquema y sus
  migraciones numeradas, y utilidades comunes (errores, fechas, eventos y
  lecturas sueltas).
- `modelo/`: las reglas del flujo — estados y fichas, dependencias y compuertas
  de fases y protocolos.
- `trabajo/`: el desglose de la idea — fases, requisitos y los archivos que anota
  cada evento.
- `consulta.py` y `crud.py`: las dos caras de la API, leer y escribir.

Este `__init__` es la fachada: fuera se sigue importando `ideas.*`, como antes.
"""

from __future__ import annotations

from .base.comun import InvalidInput, _columna, _existe, now_iso
from .base.esquema import (
    SCHEMA_DIR,
    SCHEMA_VERSION,
    aplicar_esquema,
    connect,
    ensure_repo,
    init_repo,
)
from .base.migraciones import MIGRATIONS_DIR
from .base.rutas import DB_FILENAME, EUI_DIR, db_file_for, repos_root, resolve_repo
from .consulta import get_idea, list_ideas, list_repos, listar_protocolos, map_snapshot, revision
from .crud import create_idea, delete_idea, reiniciar, update_idea

__all__ = [
    "DB_FILENAME",
    "_columna",
    "_existe",
    "EUI_DIR",
    "InvalidInput",
    "MIGRATIONS_DIR",
    "SCHEMA_DIR",
    "SCHEMA_VERSION",
    "aplicar_esquema",
    "connect",
    "create_idea",
    "db_file_for",
    "delete_idea",
    "ensure_repo",
    "get_idea",
    "init_repo",
    "list_ideas",
    "list_repos",
    "listar_protocolos",
    "map_snapshot",
    "now_iso",
    "reiniciar",
    "repos_root",
    "resolve_repo",
    "revision",
    "update_idea",
]
