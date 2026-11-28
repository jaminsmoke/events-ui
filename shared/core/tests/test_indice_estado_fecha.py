"""El orden del listado sin B-tree temporal: `created_at` en el nodo (0033).

`list_items` ordena por `created_at DESC` y la fecha vive en `work_item_data`,
así que el filtro por estado y el orden no los podía servir el mismo índice:
SQLite leía las coincidencias y las ordenaba en un B-tree temporal. La 0033
copia la fecha al nodo (no cambia nunca) y pone `(estado, created_at, id)`.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from events_core import items
from events_core.items import consulta

INDICE = "work_item_node_estado_fecha"


def _columnas(db: Path, indice: str) -> list[str]:
    with closing(sqlite3.connect(db)) as conn:
        return [str(fila[2]) for fila in conn.execute(f"PRAGMA index_info('{indice}')").fetchall()]


def _indice_estado_fecha(db: Path) -> dict[str, list[str]]:
    """Las columnas de `work_item_node_estado_fecha`, si está."""
    with closing(sqlite3.connect(db)) as conn:
        nombres = [
            str(fila[1])
            for fila in conn.execute("PRAGMA index_list('work_item_node')").fetchall()
            if fila[1] == INDICE
        ]
    return {nombre: _columnas(db, nombre) for nombre in nombres}


def _plan(db: Path, estado: str) -> str:
    with closing(sqlite3.connect(db)) as conn:
        return " | ".join(
            str(fila[3])
            for fila in conn.execute(
                "EXPLAIN QUERY PLAN " + consulta._sql_listado(estado),
                {"kind": None, "estado": estado, "limit": 100, "offset": 0},
            )
        )


def test_el_esquema_fresco_trae_la_fecha_en_el_nodo_y_su_indice(repo):  # noqa: ANN001, ANN202
    db = items.init_repo(repo)

    assert _indice_estado_fecha(db) == {INDICE: ["estado", "created_at", "id"]}
    with closing(sqlite3.connect(db)) as conn:
        columnas = {str(fila[1]) for fila in conn.execute("PRAGMA table_info('work_item_node')")}
    assert {"created_at", "id"} <= columnas


def test_la_fecha_del_nodo_es_la_de_la_item(repo):  # noqa: ANN001, ANN202
    db = items.init_repo(repo)
    uid = items.create_item(repo, title="A")["uid"]

    with closing(sqlite3.connect(db)) as conn:
        nodo = conn.execute(
            "SELECT created_at FROM work_item_node WHERE uid = ?", (uid,)
        ).fetchone()[0]
        dato = conn.execute(
            "SELECT created_at FROM work_item_data WHERE uid = ?", (uid,)
        ).fetchone()[0]

    assert nodo == dato


def test_el_listado_por_historial_no_ordena_en_memoria(repo):  # noqa: ANN001, ANN202
    db = items.init_repo(repo)

    plan = _plan(db, "historial")

    assert INDICE in plan
    assert "TEMP B-TREE" not in plan


def test_el_listado_sigue_de_mas_nueva_a_mas_vieja(repo):  # noqa: ANN001, ANN202
    uids = [items.create_item(repo, title=f"Idea {n}")["uid"] for n in range(3)]

    listado = items.list_items(repo)

    assert [item["uid"] for item in listado] == list(reversed(uids))


def test_un_almacen_v32_sube_con_la_fecha_copiada_y_sin_tocar_datos(
    repo,  # noqa: ANN001
    bajar_a_la_0033,  # noqa: ANN001
):  # noqa: ANN202
    db = items.init_repo(repo)
    uid = items.create_item(repo, title="A")["uid"]
    # La versión anterior: el nodo sin la fecha, sin el `id` y sin el índice.
    bajar_a_la_0033(db, 32)

    items.ensure_repo(repo)

    with closing(sqlite3.connect(db)) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == items.SCHEMA_VERSION
        fecha_nodo = conn.execute(
            "SELECT created_at FROM work_item_node WHERE uid = ?", (uid,)
        ).fetchone()[0]
        fecha_dato = conn.execute(
            "SELECT created_at FROM work_item_data WHERE uid = ?", (uid,)
        ).fetchone()[0]
    assert fecha_nodo == fecha_dato
    assert _indice_estado_fecha(db) == {INDICE: ["estado", "created_at", "id"]}
    assert items.get_item(repo, uid)["uid"] == uid
