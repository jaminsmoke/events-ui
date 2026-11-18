"""Eventos: el sobre, la conexión RO y el tail por cursor, por repo.

La app no produce eventos (ADR 0001): otro proceso los escribe en la tabla
`event` del `EUI_DATABASE` de cada repo, aquí solo se leen. El sobre (`id`,
`ts`, `type`, `payload`, `dedupe_key`) es la parte estable; `type` y
`payload` son libres. No hay columna `repo`: el fichero ya implica el repo
(ADR 0002).

Tiempo real sin notificaciones ad-hoc (decisión 6 del ADR): se sondea
`PRAGMA data_version` —que sube cuando **otra** conexión hace commit— y, si
cambió, se hace tail `WHERE id > :last ORDER BY id`. El mismo mecanismo da
backfill histórico y recuperación tras desconexión.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from collections.abc import Iterator
from contextlib import closing
from pathlib import Path
from typing import Any

from .db import data_version, open_read_only
from .ideas import ensure_repo

# Conteo por página del tail: bastante para el backfill sin traer el log entero.
LIMITE_POR_DEFECTO = 200


def _parse(row: sqlite3.Row) -> dict[str, Any]:
    evento = dict(row)
    payload = evento.get("payload") or "{}"
    if isinstance(payload, str):
        try:
            evento["payload"] = json.loads(payload)
        except json.JSONDecodeError:
            # Payload roto en origen: se deja el texto, no se pierde el evento.
            evento["payload"] = payload
    return evento


def tail(repo: str, desde: int, limite: int = LIMITE_POR_DEFECTO) -> list[dict[str, Any]]:
    """Eventos del repo con `id > desde`, en orden.

    Sin fichero de eventos no hay eventos —no se crea nada— y se devuelve
    vacío; el llamador lo distingue de «no hay novedades» porque es la
    primera llamada. `FileNotFoundError` del repo sale tal cual.
    """
    db_file = ensure_repo(repo)
    try:
        with closing(open_read_only(db_file)) as conn:
            rows = conn.execute(
                "SELECT id, ts, type, payload, dedupe_key FROM event"
                " WHERE id > :desde ORDER BY id LIMIT :limite",
                {"desde": desde, "limite": limite},
            ).fetchall()
    except (FileNotFoundError, sqlite3.Error):
        return []
    return [_parse(row) for row in rows]


def ultimo_id(repo: str) -> int:
    """El `id` más alto del log del repo (0 si no hay): partida del tail vivo."""
    db_file = ensure_repo(repo)
    try:
        with closing(open_read_only(db_file)) as conn:
            fila = conn.execute("SELECT max(id) FROM event").fetchone()
    except (FileNotFoundError, sqlite3.Error):
        return 0
    return int(fila[0] or 0)


# Una conexión vigilante reutilizada, como la de las revisiones de ideas:
# `data_version` solo cambia en una conexión que ya existía cuando otra escribe.
_VIGILANTE: dict[Path, sqlite3.Connection] = {}
_VIGILANTE_LOCK = threading.RLock()


def _vigilante(db_file: Path) -> sqlite3.Connection:
    with _VIGILANTE_LOCK:
        conn = _VIGILANTE.get(db_file)
        if conn is None:
            conn = open_read_only(db_file)
            _VIGILANTE[db_file] = conn
        return conn


def generar_streamo(
    repo: str, desde: int = 0, *, intervalo: float = 0.5, max_esperas: int = 240
) -> Iterator[str]:
    """Genera frames SSE del repo: primero el backfill hasta el último, luego en vivo.

    Cada frame es `event: evento\ndata: {...}`. El backfill lleva un `id:`
    para que el cliente reconecte con `Last-Event-ID`; el vivo lleva un
    `ping` cada `intervalo` segundos para que el proxy no cierre la conexión.
    La parada interna (`max_esperas`) es solo para no colgar el generador en
    tests: en producción el cliente cierra y el generador muere con él.
    """
    db_file = ensure_repo(repo)
    cursor = max(desde, 0)
    # Backfill: todo lo que hay hasta ahora, sin esperar.
    lote = tail(repo, cursor)
    while lote:
        for evento in lote:
            cursor = max(cursor, int(evento["id"]))
            yield f"id: {evento['id']}\nevent: evento\ndata: {json.dumps(evento)}\n\n"
        lote = tail(repo, cursor)

    # Vivo: dormir y sondear la firma; sin novedades, un ping barato.
    version = -1
    esperas = 0
    while esperas < max_esperas:
        time.sleep(intervalo)
        esperas += 1
        try:
            firma = data_version(_vigilante(db_file))
        except (FileNotFoundError, sqlite3.Error):
            yield ": ping\n\n"
            continue
        if firma == version:
            yield ": ping\n\n"
            continue
        version = firma
        for evento in tail(repo, cursor):
            cursor = max(cursor, int(evento["id"]))
            yield f"id: {evento['id']}\nevent: evento\ndata: {json.dumps(evento)}\n\n"
