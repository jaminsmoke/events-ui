"""Registro operativo de la app: qué pasó en las últimas ejecuciones.

No es el log de eventos del repo (`event`, que escribe otro proceso y aquí
solo se lee), ni el historial de ideas: es el registro de la aplicación —
arranques del core, errores no capturados y operaciones de laboratorio— para
verse en la UI y depurar.

Vive en su propio SQLite (`data/registro.sqlite`, `EVENTSUI_REGISTRO_DB` para
cambiarlo): el estado operativo no es estado del repo y no viaja con él. Los
escritores son solo el propio core; la UI lo lee por `/log`.

Purga: automática al escribir, dos barridos como `eventos.compactar` —
antigüedad (90 días) y conteo (las 2000 entradas más recientes)— y, si hace
falta forzarla, por `POST /log/purgar`.
"""

from __future__ import annotations

import os
import sqlite3
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REGISTRO_ENV_VAR = "EVENTSUI_REGISTRO_DB"
DEFAULT_REGISTRO_PATH = "data/registro.sqlite"

BUSY_TIMEOUT_MS = 5_000
# La retención de este registro: tres meses y dos mil entradas. Lo paga cada
# escritura; con este tamaño de tabla los dos barridos son ruido.
DIAS_RETENCION = 90
MAX_ENTRADAS = 2_000


def ruta() -> Path:
    """Ruta del SQLite de registro: `EVENTSUI_REGISTRO_DB` o `data/registro.sqlite`."""
    return Path(os.environ.get(REGISTRO_ENV_VAR, DEFAULT_REGISTRO_PATH)).expanduser().resolve()


def conectar() -> sqlite3.Connection:
    """Abre (creándolo si falta) el SQLite del registro, ya con la tabla."""
    destino = ruta()
    destino.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(destino, timeout=BUSY_TIMEOUT_MS / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    conn.execute(
        "CREATE TABLE IF NOT EXISTS registro ("
        " id INTEGER PRIMARY KEY,"
        " ts TEXT NOT NULL,"
        # ISO-8601 UTC con segundos, como `ideas.now_iso`.
        " nivel TEXT NOT NULL CHECK (nivel IN ('info', 'aviso', 'error')),"
        " origen TEXT NOT NULL DEFAULT 'core',"
        " mensaje TEXT NOT NULL"
        ")"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_registro_id ON registro (id)")
    return conn


def _ahora() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def escribir(nivel: str, mensaje: str, origen: str = "core") -> None:
    """Añade una entrada al registro (y purga lo que sobre).

    Semilla blanda, a propósito: escribir un log no debe tumbar la app. Si el
    disco está lleno o el fichero no se puede abrir, se pierde la línea de
    registro y nada más —como `_emitir` con la tabla `event` ausente.
    """
    try:
        with closing(conectar()) as conn:
            conn.execute(
                "INSERT INTO registro (ts, nivel, origen, mensaje) VALUES (?, ?, ?, ?)",
                (_ahora(), nivel, origen, mensaje),
            )
            _purgar(conn, DIAS_RETENCION, MAX_ENTRADAS)
            conn.commit()
    except sqlite3.Error:
        pass


def _purgar(conn: sqlite3.Connection, dias: int, max_entradas: int) -> tuple[int, int]:
    """Los dos barridos (edad, luego conteo): lo que más protege manda."""
    cursor_edad = conn.execute(
        "DELETE FROM registro WHERE ts < datetime('now', ?)", (f"-{dias} days",)
    )
    cursor_conteo = conn.execute(
        "DELETE FROM registro WHERE id NOT IN (SELECT id FROM registro ORDER BY id DESC LIMIT ?)",
        (max_entradas,),
    )
    return cursor_edad.rowcount, cursor_conteo.rowcount


def purgar(dias: int = DIAS_RETENCION, max_entradas: int = MAX_ENTRADAS) -> dict[str, Any]:
    """Aplica la retención ahora y dice qué se fue.

    `dias` y `max_entradas` tienen que ser al menos 1, igual que en
    `eventos.compactar`: con 0 o negativo el primer barrido se llevaría el
    registro entero.
    """
    if dias < 1 or max_entradas < 1:
        raise ValueError("dias y max_entradas tienen que ser al menos 1")
    try:
        with closing(conectar()) as conn:
            eliminadas_edad, eliminadas_conteo = _purgar(conn, dias, max_entradas)
            conn.commit()
    except sqlite3.Error:
        eliminadas_edad, eliminadas_conteo = 0, 0
    return {
        "eliminadas_por_edad": eliminadas_edad,
        "eliminadas_por_conteo": eliminadas_conteo,
    }


def listar(limite: int = 200, nivel: str | None = None) -> list[dict[str, Any]]:
    """Las últimas entradas (la más nueva primero), opcionalmente por nivel."""
    try:
        with closing(conectar()) as conn:
            filas = conn.execute(
                "SELECT id, ts, nivel, origen, mensaje FROM registro"
                " WHERE (:nivel IS NULL OR nivel = :nivel)"
                " ORDER BY id DESC LIMIT :limite",
                {"nivel": nivel, "limite": limite},
            ).fetchall()
    except sqlite3.Error:
        return []
    return [dict(fila) for fila in filas]
