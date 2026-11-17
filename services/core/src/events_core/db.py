"""Acceso a la base de datos de eventos.

Regla de la casa: la app **nunca** escribe en el log. El fichero lo crea y lo
mantiene el productor externo; aquí solo se abre en modo lectura (`mode=ro`)
para no competir con él por el bloqueo.
"""

from __future__ import annotations

import os
import sqlite3
from pathlib import Path

DB_ENV_VAR = "EVENTSUI_DB"
DEFAULT_DB_PATH = "data/events.db"
BUSY_TIMEOUT_MS = 5_000


def db_path() -> Path:
    """Ruta de la BD de eventos: `EVENTSUI_DB` o `data/events.db` relativo al core."""
    return Path(os.environ.get(DB_ENV_VAR, DEFAULT_DB_PATH)).expanduser().resolve()


def open_read_only(path: Path) -> sqlite3.Connection:
    """Conexión de solo lectura. Falla si el fichero no existe: no lo creamos."""
    if not path.exists():
        raise FileNotFoundError(f"no existe la BD de eventos: {path}")

    conn = sqlite3.connect(
        f"file:{path.as_posix()}?mode=ro",
        uri=True,
        timeout=BUSY_TIMEOUT_MS / 1000,
    )
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    return conn


def journal_mode(conn: sqlite3.Connection) -> str:
    return str(conn.execute("PRAGMA journal_mode").fetchone()[0])


def data_version(conn: sqlite3.Connection) -> int:
    """`PRAGMA data_version` cambia cuando **otra** conexión hace commit.

    Es la señal barata de "hay eventos nuevos": no ejecuta query sobre el log.
    Base del tail por cursor de F1.
    """
    return int(conn.execute("PRAGMA data_version").fetchone()[0])
