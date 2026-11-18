"""Acceso a la base de datos de eventos.

Regla de la casa: la app **nunca** escribe en el log. El fichero lo crea y lo
mantiene el productor externo; aquí solo se abre en modo lectura (`mode=ro`)
para no competir con él por el bloqueo.
"""

from __future__ import annotations

import os
import sqlite3
import threading
from pathlib import Path

DB_ENV_VAR = "EVENTSUI_DB"
DEFAULT_DB_PATH = "data/events.db"
BUSY_TIMEOUT_MS = 5_000


def db_path() -> Path:
    """Ruta de la BD de eventos: `EVENTSUI_DB` o `data/events.db` relativo al core."""
    return Path(os.environ.get(DB_ENV_VAR, DEFAULT_DB_PATH)).expanduser().resolve()


def uri_lectura(path: Path) -> str:
    """URI de SQLite en solo lectura, con la ruta ya escapada.

    Una carpeta puede llamarse `carpeta#1`: dentro de una URI, `#` empieza el
    fragmento y `?` la query, así que SQLite abriría otro fichero. `as_uri()`
    codifica esos caracteres.
    """
    return f"{path.resolve().as_uri()}?mode=ro"


def open_read_only(path: Path) -> sqlite3.Connection:
    """Conexión de solo lectura. Falla si el fichero no existe: no lo creamos."""
    if not path.exists():
        raise FileNotFoundError(f"no existe la BD de eventos: {path}")

    conn = sqlite3.connect(
        uri_lectura(path),
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


# Una conexión vigilante reutilizada por almacén: `data_version` solo cambia en
# una conexión que ya existía cuando otra escribe, así que abrirla al vuelo
# devuelve siempre el valor de partida y los cambios no despiertan a la UI.
#
# `compartida` marca si la usa el pool de hilos de uvicorn (`revision()`): sin
# ella, sqlite3 no permite usar la conexión desde otro hilo. Las dos variantes
# tienen su propia conexión por almacén, para no mezclar contextos de uso.
_VIGILANTES: dict[tuple[Path, bool], sqlite3.Connection] = {}
_VIGILANTES_LOCK = threading.RLock()


def vigilante(db_file: Path, *, compartida: bool = False) -> sqlite3.Connection:
    """Conexión de solo lectura reutilizada que solo lee `data_version` y conteos."""
    clave = (db_file, compartida)
    with _VIGILANTES_LOCK:
        conn = _VIGILANTES.get(clave)
        if conn is None:
            if compartida:
                conn = sqlite3.connect(
                    uri_lectura(db_file),
                    uri=True,
                    timeout=BUSY_TIMEOUT_MS / 1000,
                    check_same_thread=False,
                )
            else:
                conn = open_read_only(db_file)
            conn.row_factory = sqlite3.Row
            _VIGILANTES[clave] = conn
        return conn


def barridos_retencion(
    conn: sqlite3.Connection, *, tabla: str, dias: int, maximo: int
) -> tuple[int, int]:
    """Los dos barridos de retención (edad, luego conteo), en ese orden.

    Primero la antigüedad (`ts` anterior a hace `dias` días) y luego el conteo
    (se dejan solo los `maximo` más nuevos); el segundo nunca resucita lo ya
    borrado. `tabla` es un nombre interno constante (`event`, `registro`),
    nunca entrada del usuario.

    `dias` y `maximo` tienen que ser al menos 1: con 0 o negativo, el primer
    barrido se llevaría la tabla entera.
    """
    if dias < 1 or maximo < 1:
        raise ValueError("dias y maximo tienen que ser al menos 1")
    cursor_edad = conn.execute(
        f"DELETE FROM {tabla} WHERE ts < datetime('now', ?)", (f"-{dias} days",)
    )
    cursor_conteo = conn.execute(
        f"DELETE FROM {tabla} WHERE id NOT IN (SELECT id FROM {tabla} ORDER BY id DESC LIMIT ?)",
        (maximo,),
    )
    return cursor_edad.rowcount, cursor_conteo.rowcount
