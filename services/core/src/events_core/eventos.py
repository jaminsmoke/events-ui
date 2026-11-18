"""Eventos: el sobre, la conexión RO y el tail por cursor, por repo.

La app no produce eventos: otro proceso los escribe en la tabla
`event` del `EUI_DATABASE` de cada repo, aquí solo se leen. El sobre (`id`,
`ts`, `type`, `payload`, `dedupe_key`) es la parte estable; `type` y
`payload` son libres. No hay columna `repo`: el fichero ya implica el repo.

Tiempo real sin notificaciones ad-hoc: se sondea
`PRAGMA data_version` —que sube cuando **otra** conexión hace commit— y, si
cambió, se hace tail `WHERE id > :last ORDER BY id`. El mismo mecanismo da
backfill histórico y recuperación tras desconexión.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import sqlite3
from collections.abc import AsyncIterator, Callable
from contextlib import closing
from typing import Any

from .db import barridos_retencion, data_version, open_read_only, vigilante
from .ideas import connect, ensure_repo

# Conteo por página del tail: bastante para el backfill sin traer el log entero.
LIMITE_POR_DEFECTO = 200

# Nivel del evento por tipo, para colorear el log igual que el registro
# (`nivel` ya viene en `EntradaLog`). El `payload` puede imponerlo (nivel
# explícito manda); sin él, todos los tipos son `info` menos este aviso.
NIVELES_POR_TIPO = {
    "idea.deleted": "aviso",
}
NIVELES = ("info", "aviso", "error")

# La retención pactada: como máximo estos
# días de antigüedad y como máximo este número de eventos por repo. Los dos
# topes se aplican a la vez; el más restrictivo manda.
DIAS_RETENCION = 90
MAX_EVENTOS_RETENCION = 5_000
# A partir de cuántas filas borradas vale la pena recompactar el fichero.
FILAS_PARA_VACUUM = 1_000


def _nivel(evento: dict[str, Any]) -> str:
    """El nivel del evento: el que diga el payload o el del tipo."""
    payload = evento.get("payload")
    if isinstance(payload, dict):
        declarado = payload.get("nivel")
        if declarado in NIVELES:
            return str(declarado)
    return NIVELES_POR_TIPO.get(str(evento.get("type", "")), "info")


def _parse(row: sqlite3.Row) -> dict[str, Any]:
    evento = dict(row)
    payload = evento.get("payload") or "{}"
    if isinstance(payload, str):
        try:
            evento["payload"] = json.loads(payload)
        except json.JSONDecodeError:
            # Payload roto en origen: se deja el texto, no se pierde el evento.
            evento["payload"] = payload
    evento["nivel"] = _nivel(evento)
    return evento


def tail(
    repo: str,
    desde: int,
    limite: int = LIMITE_POR_DEFECTO,
    origen: str | None = None,
) -> list[dict[str, Any]]:
    """Eventos del repo con `id > desde`, en orden.

    Sin fichero de eventos no hay eventos —no se crea nada— y se devuelve
    vacío; el llamador lo distingue de «no hay novedades» porque es la
    primera llamada. `origen`, si viene, filtra: `idea`, `externo` o la
    tabla futura que lo sea. `FileNotFoundError` del repo sale tal cual.
    """
    db_file = ensure_repo(repo)
    try:
        with closing(open_read_only(db_file)) as conn:
            rows = conn.execute(
                "SELECT id, ts, type, payload, origen, dedupe_key FROM event"
                " WHERE id > :desde AND (:origen IS NULL OR origen = :origen)"
                " ORDER BY id LIMIT :limite",
                {"desde": desde, "limite": limite, "origen": origen},
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


def compactar(
    repo: str,
    *,
    dias: int = DIAS_RETENCION,
    max_eventos: int = MAX_EVENTOS_RETENCION,
) -> dict[str, Any]:
    """Recorta el log del repo a la política de retención y devuelve qué se fue.

    Dos barridos en el orden que protege la cola (ver
    `db.barridos_retencion`): primero la antigüedad (`ts` anterior a hace
    `dias` días) y luego el conteo (se dejan solo los `max_eventos` más
    nuevos); el segundo nunca resucita lo ya borrado.

    `dias` y `max_eventos` tienen que ser al menos 1: con 0 o negativo, el
    primer barrido se llevaría el log entero. La API ya lo valida; el helper
    lo guarda por si entra por otra vía (CLI, tests) y lanza `ValueError`.

    Después, si el hueco es bastante, se recompacta el fichero con `VACUUM`:
    el `DELETE` solo libera páginas, no devuelve espacio al disco. El `VACUUM`
    es exclusivo y no puede ir en transacción; si otro proceso lo bloquea
    (el productor existe), se salta sin fallar —el recorte ya está hecho—.
    """
    db_file = ensure_repo(repo)
    try:
        with closing(connect(db_file)) as conn:
            por_edad, por_conteo = barridos_retencion(
                conn, tabla="event", dias=dias, maximo=max_eventos
            )
            borrados = por_edad + por_conteo
            conn.commit()
    except (FileNotFoundError, sqlite3.Error):
        return {
            "repo": repo,
            "por_edad": 0,
            "por_conteo": 0,
            "vacuum": False,
        }

    vacuum = False
    if borrados >= FILAS_PARA_VACUUM:
        try:
            with closing(connect(db_file)) as conn:
                conn.isolation_level = None  # VACUUM no admite transacción
                conn.execute("VACUUM")
                vacuum = True
        except sqlite3.Error:
            vacuum = False

    return {
        "repo": repo,
        "por_edad": por_edad,
        "por_conteo": por_conteo,
        "vacuum": vacuum,
    }


async def generar_streamo(
    repo: str,
    desde: int = 0,
    *,
    intervalo: float = 0.5,
    max_esperas: int = 240,
    desconectado: Callable[[], Any] | None = None,
) -> AsyncIterator[str]:
    # `desconectado` vale tanto en sync como en async (la ruta pasa
    # `request.is_disconnected`, async; los tests, un bool a secas).
    """Genera frames SSE del repo: primero el backfill hasta el último, luego en vivo.

    Cada frame es `event: evento\ndata: {...}`. El backfill lleva un `id:`
    para que el cliente reconecte con `Last-Event-ID`; el vivo lleva un
    `ping` cada `intervalo` segundos para que el proxy no cierre la conexión.

    El corte es limpio, no a base de error: `desconectado` (en producción,
    `request.is_disconnected`) se pregunta en cada vuelta y, si el cliente ya
    se fue, se deja de sondear y el stream termina. La parada interna
    (`max_esperas`) es solo para no colgar el generador en tests: en
    producción el cliente cierra y a los 240 pings el EventSource reconecta.
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
        if desconectado is not None:
            salida = desconectado()
            if inspect.isawaitable(salida):
                salida = await salida
            if salida:
                return
        await asyncio.sleep(intervalo)
        esperas += 1
        try:
            firma = data_version(vigilante(db_file))
        except (FileNotFoundError, sqlite3.Error):
            yield ": ping\n\n"
            continue
        if firma == version:
            yield ": ping\n\n"
            continue
        version = firma
        # El tail va por páginas: una ráfaga mayor que `LIMITE_POR_DEFECTO` deja
        # eventos esperando y, sin otra escritura, la firma ya no cambia. Se
        # drena el log entero, no solo la primera página.
        lote = tail(repo, cursor)
        while lote:
            for evento in lote:
                cursor = max(cursor, int(evento["id"]))
                yield f"id: {evento['id']}\nevent: evento\ndata: {json.dumps(evento)}\n\n"
            lote = tail(repo, cursor)
