"""Lo mínimo que comparten las capas: errores, fechas, eventos y consultas."""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class InvalidInput(ValueError):
    """Petición inválida: no es un fallo del servidor, es un dato mal puesto."""


class AlmacenMasNuevo(InvalidInput):
    """El almacén lo migró un core posterior: se nombra y no se toca.

    Hereda de `InvalidInput` para que el CLI y el MCP ya lo cuenten con
    `error: …` sin tocar cada comando; la API le da su propio 409 (no es un
    dato mal puesto, es una versión que este core no entiende).
    """


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def escribir_atomico(destino: Path, datos: bytes) -> None:
    """Escribe el fichero entero o deja el anterior intacto.

    Las copias y los manifiestos de absorción no deben quedar a
    medias si el proceso muere o el disco falla: se escribe al lado y se
    sustituye con `os.replace`, que es atómico en el mismo sistema de ficheros.
    Si el destino cae bajo `.EUI`, solo se aceptan rutas del contrato
    (almacén, `.gitignore`, `migracion/<lote>/…`).
    """
    # Import diferido: `rutas` / `eui_fs` importan `InvalidInput` de aquí.
    from .eui_fs import asegurar_destino_eui, asegurar_directorio_eui

    asegurar_destino_eui(destino)
    asegurar_directorio_eui(destino.parent)
    destino.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporal = tempfile.mkstemp(dir=destino.parent, prefix=f".{destino.name}.")
    try:
        with os.fdopen(descriptor, "wb") as fichero:
            fichero.write(datos)
            fichero.flush()
            os.fsync(fichero.fileno())
        os.replace(temporal, destino)
    except Exception:
        Path(temporal).unlink(missing_ok=True)
        raise


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


# Columnas con las que se lee un ítem: su composición y su nodo. Listar, leer
# una ficha y devolver el resultado de un PATCH usan siempre esta forma.
_COLUMNAS = "work_item_data.*, work_item_node.estado, work_item_node.entered_at"

# Lo mismo sin el cuerpo ni la estancia: el listado pinta una fila y el
# Markdown se pide a propósito (`?incluir=contenido` o la ficha).
_COLUMNAS_RESUMEN = (
    "work_item_data.uid, work_item_data.title, work_item_data.description,"
    " work_item_data.kind, work_item_data.tags, work_item_data.depende_de,"
    " work_item_data.created_at, work_item_data.updated_at,"
    " work_item_node.estado"
)


def _emitir(conn: sqlite3.Connection, tipo: str, payload: dict[str, Any]) -> None:
    """Añade un evento `item.*` al log del propio almacén, en su transacción.

    El core es quien escribe items, así que es también quien emite sus eventos
    de ciclo de vida —esos sí los produce la app; el resto del log viene del
    productor externo. La fila viaja en la misma transacción que el ítem: si
    el cambio se deshace, el evento no queda suelto. La `dedupe_key` no aplica.
    """
    # Almacén viejo sin tabla `event`: el ítem sí se escribe; el evento no.
    # Solo se traga esa ausencia: otro error (disco lleno, payload roto) debe
    # notarse, no desaparecer en silencio.
    try:
        conn.execute(
            "INSERT INTO event (ts, type, payload, origen) VALUES (?, ?, ?, 'item')",
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
