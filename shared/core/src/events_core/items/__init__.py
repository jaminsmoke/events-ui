"""Ideas: la primera tabla del sistema, y no la de eventos.

La raíz de cada repo abierto es su propio almacén: en ella vive la carpeta
`.EUI` con un SQLite llamado `EUI_DATABASE`. El fichero viaja con el repo; las
subcarpetas no llevan almacén propio salvo que se abran como raíz.

El esquema no se escribe aquí: vive en `schema/items.sql`, que es el fichero que
se edita a mano. Este paquete solo lo aplica y hace CRUD sobre él.

La implementación va por capas, de abajo arriba, para que cada módulo sepa poco:

- `base/`: lo que no sabe de items — rutas del almacén, esquema y sus
  migraciones numeradas, y utilidades comunes (errores, fechas, eventos y
  lecturas sueltas).
- `modelo/`: las reglas del flujo — estados y fichas, dependencias y compuertas
  de fases y protocolos.
- `trabajo/`: el desglose de el ítem — fases, requisitos y los archivos que anota
  cada evento.
- `consulta.py` y `crud.py`: las dos caras de la API, leer y escribir.

Este `__init__` es la fachada: fuera se sigue importando `items.*`, como antes.
"""

from __future__ import annotations

from .base.comun import AlmacenMasNuevo, InvalidInput, _columna, _existe, now_iso
from .base.esquema import (
    SCHEMA_DIR,
    SCHEMA_VERSION,
    aplicar_esquema,
    connect,
    ensure_repo,
    init_repo,
)
from .base.migraciones import MIGRATIONS_DIR, comprobar_version
from .base.rutas import DB_FILENAME, EUI_DIR, db_file_for, repos_root, resolve_repo
from .consulta import (
    get_item,
    list_items,
    list_repos,
    listar_protocolos,
    listar_puertas,
    map_snapshot,
    revision,
)
from .crud import create_item, delete_item, reiniciar, update_item
from .migracion import MigracionEnConflicto, aplicar_migracion, deshacer_migracion

__all__ = [
    "DB_FILENAME",
    "_columna",
    "_existe",
    "AlmacenMasNuevo",
    "EUI_DIR",
    "InvalidInput",
    "MIGRATIONS_DIR",
    "SCHEMA_DIR",
    "SCHEMA_VERSION",
    "aplicar_esquema",
    "aplicar_migracion",
    "comprobar_version",
    "connect",
    "deshacer_migracion",
    "create_item",
    "db_file_for",
    "delete_item",
    "ensure_repo",
    "get_item",
    "init_repo",
    "list_items",
    "list_repos",
    "listar_protocolos",
    "listar_puertas",
    "map_snapshot",
    "MigracionEnConflicto",
    "now_iso",
    "reiniciar",
    "repos_root",
    "resolve_repo",
    "revision",
    "update_item",
]
