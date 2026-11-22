"""Lo mínimo que comparten las capas: errores, fechas, eventos y consultas."""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from typing import Any


class InvalidInput(ValueError):
    """Petición inválida: no es un fallo del servidor, es un dato mal puesto."""


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def fecha_iso(valor: str | None, respaldo: str | None = None) -> str:
    """Normaliza una fecha del plan a ISO UTC; sin fecha, usa el respaldo.

    El plan puede traer solo el día (`2025-03-04`) o un instante con zona. Se
    guarda siempre con segundos y zona UTC, que es el formato que ya usan
    `created_at`, `entered_at` y el resto del esquema.
    """
    if not valor:
        return respaldo or now_iso()
    try:
        fecha = datetime.fromisoformat(valor.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidInput(f"fecha inválida: {valor!r}") from exc
    if fecha.tzinfo is None:
        fecha = fecha.replace(tzinfo=UTC)
    return fecha.astimezone(UTC).isoformat(timespec="seconds")


def _tags_json(texto: str | None) -> list[str]:
    """Lee `tags` sin fiarse del fichero: una fila vieja puede no ser una lista.

    El CHECK exige lista desde la 0017, pero un almacén a medio migrar o una
    escritura con los CHECK relajados no puede tumbar el listado: lo que no
    sea una lista de cadenas se lee como lista vacía.
    """
    try:
        valor = json.loads(texto or "[]")
    except (TypeError, ValueError):
        return []
    if not isinstance(valor, list):
        return []
    return [elemento for elemento in valor if isinstance(elemento, str)]


# Columnas con las que se lee una idea: su composición y su nodo. Listar, leer
# una ficha y devolver el resultado de un PATCH usan siempre esta forma.
_COLUMNAS = "idea_data.*, idea_node.estado, idea_node.entered_at"


def _emitir(conn: sqlite3.Connection, tipo: str, payload: dict[str, Any]) -> None:
    """Añade un evento `idea.*` al log del propio almacén, en su transacción.

    El core es quien escribe ideas, así que es también quien emite sus eventos
    de ciclo de vida —esos sí los produce la app; el resto del log viene del
    productor externo. La fila viaja en la misma transacción que la idea: si
    el cambio se deshace, el evento no queda suelto. La `dedupe_key` no aplica.
    """
    # Almacén viejo sin tabla `event`: la idea sí se escribe; el evento no.
    # Solo se traga esa ausencia: otro error (disco lleno, payload roto) debe
    # notarse, no desaparecer en silencio.
    try:
        conn.execute(
            "INSERT INTO event (ts, type, payload, origen) VALUES (?, ?, ?, 'idea')",
            (now_iso(), tipo, json.dumps(payload)),
        )
    except sqlite3.OperationalError as exc:
        if "no such table" not in str(exc):
            raise


def _columna(conn: sqlite3.Connection, tabla: str, columna: str) -> bool:
    """¿Tiene la tabla esa columna? Sirve para reparar un esquema mal firmado."""
    return any(fila[1] == columna for fila in conn.execute(f"PRAGMA table_info({tabla})"))


def _existe(conn: sqlite3.Connection, tabla: str) -> bool:
    return bool(
        conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tabla,)
        ).fetchone()
    )
