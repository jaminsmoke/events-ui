"""Leer ideas: ficha, listado, mapa, protocolos, repos y revisiones."""

from __future__ import annotations

import sqlite3
import threading
import uuid
from contextlib import closing
from typing import Any

from ..db import data_version, open_read_only, vigilante
from .base.comun import _COLUMNAS, _COLUMNAS_RESUMEN, _existe, _tags_json
from .base.esquema import connect, ensure_repo
from .base.rutas import DB_FILENAME, EUI_DIR, repos_root
from .modelo.estados import _grupo, _rechazo, _revision, _roadmap, _verificacion
from .trabajo.fases import _fases, _fases_en_lote


def list_repos() -> list[dict[str, Any]]:
    """Repos investigados que ya tienen un `EUI_DATABASE`."""
    root = repos_root()
    if not root.is_dir():
        return []

    found = []
    for entry in sorted(root.iterdir()):
        db_file = entry / EUI_DIR / DB_FILENAME
        if db_file.is_file():
            found.append({"repo": entry.name, "db_path": str(db_file)})
    return found


def _fila(
    row: sqlite3.Row,
    roadmap: sqlite3.Row | None,
    verificacion: sqlite3.Row | None,
    revision: sqlite3.Row | None,
    rechazo: sqlite3.Row | None,
    fases: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Arma el dict de una idea con su nodo y el detalle ya resueltos.

    `row` trae la idea y su nodo (`idea_data.*` + `estado`, `entered_at`).
    Quien lista muchas ideas no lee cada detalle por fila (eso era un N+1),
    sino que los trae en lote con `_en_lote` y ensambla aquí.
    """
    idea = dict(row)
    estado = str(idea.pop("estado"))
    entrada = idea.pop("entered_at")
    idea.pop("posicion", None)
    idea["status"] = estado
    idea["tags"] = _tags_json(idea["tags"])
    idea["depende_de"] = _tags_json(idea["depende_de"])
    # `entered_at` es la fecha de la estancia actual, con el nombre que el
    # contrato le daba a cada carril: roadmap, verificación, aprobación o descarte.
    idea["roadmap_started_at"] = entrada if estado == "roadmap" else None
    idea["roadmap_completed_at"] = verificacion["roadmap_completed_at"] if verificacion else None
    idea["roadmap_resultado"] = roadmap["resultado"] if roadmap else ""
    idea["roadmap_referencia"] = roadmap["referencia"] if roadmap else ""
    idea["verificacion_started_at"] = entrada if estado == "verificacion" else None
    # Los intentos acumulados viven en la idea (0014): el detalle solo existe
    # mientras dura la estancia.
    idea["verificacion_intentos"] = int(row["verificacion_intentos"]) if verificacion else 0
    idea["verificacion_ultimo_resultado"] = verificacion["ultimo_resultado"] if verificacion else ""
    idea["verificacion_comentario"] = verificacion["comentario"] if verificacion else ""
    # La firma vive en `revision_node`; el historial la conserva al archivar.
    idea["revision_approved_at"] = entrada if estado in ("revision_aprobada", "historial") else None
    idea["revision_approved_by"] = revision["approved_by"] if revision else "usuario"
    idea["revision_nota"] = revision["nota"] if revision else ""
    idea["rejected_at"] = entrada if estado == "rejected" else None
    idea["rejected_description"] = rechazo["rejected_description"] if rechazo else ""
    idea["rejected_by"] = rechazo["rejected_by"] if rechazo else "usuario"
    idea["superseded_by_uid"] = rechazo["superseded_by_uid"] if rechazo else None
    idea["fases"] = list(fases or [])
    return idea


def _row(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    """Una idea suelta (get/update): lecturas por idea, no merece lote completo."""
    uid = str(row["uid"])
    return _fila(
        row,
        _roadmap(conn, uid),
        _verificacion(conn, uid),
        _revision(conn, uid),
        _rechazo(conn, uid),
        _fases(conn, uid),
    )


def _en_lote(
    conn: sqlite3.Connection, uids: list[str]
) -> tuple[
    dict[str, sqlite3.Row],
    dict[str, sqlite3.Row],
    dict[str, sqlite3.Row],
    dict[str, sqlite3.Row],
    dict[str, list[dict[str, Any]]],
]:
    """Detalle de roadmap, verificación, revisión y descarte, en lote."""
    if not uids:
        return {}, {}, {}, {}, {}
    marcas = ",".join("?" for _ in uids)
    roadmaps = {
        str(row["uid"]): row
        for row in conn.execute(
            f"SELECT uid, resultado, referencia FROM roadmap_node WHERE uid IN ({marcas})",
            uids,
        )
    }
    verificaciones = {
        str(row["uid"]): row
        for row in conn.execute(
            "SELECT uid, intentos, ultimo_resultado, comentario,"
            f" roadmap_completed_at FROM verificacion_node WHERE uid IN ({marcas})",
            uids,
        )
    }
    revisiones = {
        str(row["uid"]): row
        for row in conn.execute(
            f"SELECT uid, approved_by, nota FROM revision_node WHERE uid IN ({marcas})",
            uids,
        )
    }
    rechazos = {
        str(row["uid"]): row
        for row in conn.execute(
            "SELECT uid, rejected_description, rejected_by, superseded_by_uid"
            f" FROM rejected_node WHERE uid IN ({marcas})",
            uids,
        )
    }
    return roadmaps, verificaciones, revisiones, rechazos, _fases_en_lote(conn, uids)


def _resumen(row: sqlite3.Row, fases: list[dict[str, Any]]) -> dict[str, Any]:
    """Una fila del listado: lo que pinta la lista, sin cuerpo ni fichas.

    Las fases ya vienen en lote para el contador; ni sus requisitos ni sus
    archivos viajan a la fila.
    """
    requisitos = [requisito for fase in fases for requisito in fase.get("requisitos") or []]
    return {
        "uid": str(row["uid"]),
        "title": row["title"],
        "description": row["description"],
        "kind": row["kind"],
        "status": str(row["estado"]),
        "tags": _tags_json(row["tags"]),
        "depende_de": _tags_json(row["depende_de"]),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "fases_hechas": sum(1 for fase in fases if fase.get("estado") == "completada"),
        "fases_total": len(fases),
        "requisitos_hechos": sum(1 for requisito in requisitos if requisito.get("hecho")),
        "requisitos_total": len(requisitos),
    }


def _sql_listado(filtro: str | None, kind: str | None = None, columnas: str = _COLUMNAS) -> str:
    """El SELECT del listado para un carril; el estado viaja como `:estado`.

    Vive aparte para que el test del plan de consulta use el mismo SQL que
    `list_ideas`, no una copia que se quede atrás al cambiar el listado.

    El filtro se compone en vez de escribir `(:estado IS NULL OR ...)`: esa
    forma deja la condición fuera del alcance del índice y SQLite recorre la
    tabla entera aunque el índice esté. Con la igualdad suelta, el filtro por
    estado entra por `idea_node_estado`.
    """
    condiciones = []
    if kind is not None:
        condiciones.append("idea_data.kind = :kind")
    if filtro is not None:
        condiciones.append("idea_node.estado = :estado")
    where = f" WHERE {' AND '.join(condiciones)}" if condiciones else ""
    # En cola, el orden es la posición; roadmap y verificación, la entrada
    # en el nodo; el resto, por fecha de creación.
    if filtro == "proposed":
        orden = "idea_node.posicion ASC, idea_data.created_at ASC"
    elif filtro in ("roadmap", "verificacion"):
        orden = "idea_node.entered_at ASC, idea_data.created_at ASC"
    else:
        # La fecha y el `id` están copiados en el nodo (0033) para que el índice
        # los ordene sin B-tree temporal; el `id` desempata como antes.
        orden = "idea_node.created_at DESC, idea_node.id DESC"
    return (
        f"SELECT {columnas} FROM idea_data"
        " JOIN idea_node ON idea_node.uid = idea_data.uid"
        f"{where}"  # compuesto, no `IS NULL OR`: ver el docstring
        f" ORDER BY {orden}"
        " LIMIT :limit OFFSET :offset"
    )


def list_ideas(
    repo: str,
    *,
    status: str | None = None,
    kind: str | None = None,
    limit: int = 100,
    offset: int = 0,
    incluir_contenido: bool = False,
) -> list[dict[str, Any]]:
    with closing(connect(ensure_repo(repo))) as conn:
        # El estado es una columna del nodo, no la presencia en una ficha: el
        # filtro es el mismo para los seis carriles y `superseded` sigue
        # leyéndose como el descarte que es.
        filtro = _grupo(status) if status else None
        rows = conn.execute(
            _sql_listado(filtro, kind, _COLUMNAS if incluir_contenido else _COLUMNAS_RESUMEN),
            {"kind": kind, "estado": filtro, "limit": limit, "offset": offset},
        ).fetchall()
        uids = [str(r["uid"]) for r in rows]
        # El resumen solo necesita las fases, para sus contadores: ni el cuerpo
        # ni las fichas de carril se leen.
        if not incluir_contenido:
            fases = _fases_en_lote(conn, uids)
            return [_resumen(r, fases.get(str(r["uid"]), [])) for r in rows]
        roadmaps, verificaciones, revisiones, rechazos, fases = _en_lote(conn, uids)
        return [
            _fila(
                r,
                roadmaps.get(str(r["uid"])),
                verificaciones.get(str(r["uid"])),
                revisiones.get(str(r["uid"])),
                rechazos.get(str(r["uid"])),
                fases.get(str(r["uid"])),
            )
            for r in rows
        ]


def get_idea(repo: str, uid: str) -> dict[str, Any]:
    with closing(connect(ensure_repo(repo))) as conn:
        row = conn.execute(
            f"SELECT {_COLUMNAS} FROM idea_data"
            " JOIN idea_node ON idea_node.uid = idea_data.uid"
            " WHERE idea_data.uid = ?",
            (uid,),
        ).fetchone()
        if row is None:
            raise KeyError(uid)
        return _row(conn, row)


def listar_protocolos(repo: str) -> list[dict[str, Any]]:
    """Las uniones permitidas entre carriles (`protocolo_flujo`).

    La UI las lee para no ofrecer flujos prohibidos; la que impone de verdad
    es `update_idea`. Son configuración del almacén, no estado: el reinicio
    de laboratorio no las toca.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        filas = conn.execute(
            "SELECT origen, destino, exige_fases, exige_fases_listas, exige_fases_completas"
            " FROM protocolo_flujo ORDER BY origen, destino"
        ).fetchall()
    return [
        {
            "origen": fila[0],
            "destino": fila[1],
            "exige_fases": bool(fila[2]),
            "exige_fases_listas": bool(fila[3]),
            "exige_fases_completas": bool(fila[4]),
        }
        for fila in filas
    ]


def map_snapshot(repo: str) -> dict[str, Any]:
    """Lee el mapa entero en una sola transacción de lectura."""
    with closing(open_read_only(ensure_repo(repo))) as conn:
        conn.execute("BEGIN")
        rows = conn.execute(
            "SELECT idea_data.uid, idea_data.title, idea_data.description,"
            " idea_data.depende_de, idea_data.created_at, idea_data.id,"
            " idea_node.estado, idea_node.entered_at,"
            " rejected_node.rejected_description"
            " FROM idea_data"
            " JOIN idea_node ON idea_node.uid = idea_data.uid"
            " LEFT JOIN rejected_node ON rejected_node.uid = idea_data.uid"
            # El mapa se pinta en el orden en que llega, así que cada carril
            # tiene que salir como lo lista `/ideas`: la cola por posición
            # (volver de verificación estrena posición, al final) y roadmap y
            # verificación por entrada en el nodo. El resto, por creación.
            " ORDER BY"
            " CASE idea_node.estado"
            " WHEN 'proposed' THEN 0"
            " WHEN 'roadmap' THEN 1"
            " WHEN 'verificacion' THEN 2"
            " WHEN 'revision_aprobada' THEN 3"
            " WHEN 'rejected' THEN 4"
            " ELSE 5 END,"
            " idea_node.posicion ASC,"
            " idea_node.entered_at ASC,"
            " idea_data.created_at DESC, idea_data.id DESC"
        ).fetchall()
        fases = _fases_en_lote(conn, [str(row[0]) for row in rows])
        ideas = [
            {
                **dict(row),
                "status": str(row["estado"]),
                "rejected_at": (row["entered_at"] if str(row["estado"]) == "rejected" else None),
                "depende_de": _tags_json(row["depende_de"]),
                # El JOIN da `NULL` sin descarte; el contrato dice texto.
                "rejected_description": row["rejected_description"] or "",
                "fases": fases.get(str(row["uid"]), []),
            }
            for row in rows
        ]
        return {"ideas": ideas}


# La conexión vigilante vive en `db.vigilante` (es la misma que usa el stream de
# eventos): `data_version` solo sube en una conexión que **ya existía** cuando
# otra escribe. Se comparte entre los hilos del pool de uvicorn, así que las
# lecturas se serializan aquí para no mezclarlas.
_VIGILANTES_LOCK = threading.RLock()
# Un vigilante nuevo puede empezar por la misma versión aunque cambió el mapa.

_REVISION_INSTANCE = uuid.uuid4().hex


def revision(repo: str) -> dict[str, Any]:
    """Firma barata del almacén para saber si hay que releer.

    `PRAGMA data_version` cambia cuando **otra** conexión hace commit, así que la
    UI puede sondear esto cada par de segundos en vez de traerse todas las ideas.
    `data_version` es por conexión (un vigilante nuevo vuelve a empezar), así que
    la firma lleva además lo que no depende de ella: el conteo del mapa y el
    `max(id)` del log. Ese último es el que mueve la firma cuando el productor
    escribe eventos sin tocar ideas.
    """
    db_file = ensure_repo(repo)
    with _VIGILANTES_LOCK:
        conn = vigilante(db_file, compartida=True)
        # La tabla vive como `idea_data` desde la 0020; antes, `idea_entry`.
        tabla_idea = "idea_data" if _existe(conn, "idea_data") else "ideas"
        return {
            "instance": _REVISION_INSTANCE,
            "data_version": data_version(conn),
            "ideas": conn.execute(f"SELECT count(*) FROM {tabla_idea}").fetchone()[0],
            # El log se vacía al reiniciar: `coalesce` devuelve 0 y no `NULL`.
            "ultimo_evento": conn.execute("SELECT coalesce(max(id), 0) FROM event").fetchone()[0],
        }
