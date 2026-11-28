"""El índice de `work_item_node.estado` (0032): el filtro del mapa sin escanear.

`list_items` filtra por estado y el esquema solo tenía los índices únicos de la
cola y del roadmap. El índice nuevo cubre el filtro y, con `posicion` detrás,
también el orden de la cola.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from events_core import items
from events_core.items import consulta
from events_core.items.base import migraciones


def _indices_estado(db: Path) -> dict[str, list[str]]:
    """Las columnas del índice `work_item_node_estado`, si está."""
    with closing(sqlite3.connect(db)) as conn:
        nombres = [
            str(fila[1])
            for fila in conn.execute("PRAGMA index_list('work_item_node')").fetchall()
            if fila[1] == "work_item_node_estado"
        ]
        return {
            nombre: [
                str(fila[2]) for fila in conn.execute(f"PRAGMA index_info('{nombre}')").fetchall()
            ]
            for nombre in nombres
        }


def test_el_esquema_fresco_trae_el_indice_de_estado(repo):  # noqa: ANN001, ANN202
    db = items.init_repo(repo)

    # Un solo índice compuesto: `estado` filtra y `posicion` ordena la cola.
    assert _indices_estado(db) == {"work_item_node_estado": ["estado", "posicion"]}


def test_un_almacen_v31_sube_con_el_indice_y_sin_tocar_datos(
    repo,  # noqa: ANN001
    bajar_a_la_0033,  # noqa: ANN001
):  # noqa: ANN202
    db = items.init_repo(repo)
    uid = items.create_item(repo, title="A")["uid"]
    # La versión anterior: sin el índice, sin la fecha en el nodo y firmando 31.
    bajar_a_la_0033(db, 31)

    items.ensure_repo(repo)

    with closing(sqlite3.connect(db)) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == items.SCHEMA_VERSION
        assert conn.execute("SELECT count(*) FROM work_item_node").fetchone()[0] == 1
    assert _indices_estado(db) == {"work_item_node_estado": ["estado", "posicion"]}
    assert items.get_item(repo, uid)["uid"] == uid


# El almacén de la 0003: `ideas` con su estado, conexiones y sin versión. Lo
# que la app se encuentra en un repo de hace meses.
_ESQUEMA_V2 = """
CREATE TABLE ideas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'idea' CHECK (kind IN ('idea', 'adr', 'note')),
    status TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft', 'proposed', 'accepted', 'rejected', 'superseded')),
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE connections (
    id INTEGER PRIMARY KEY,
    parent_uid TEXT NOT NULL REFERENCES ideas (uid) ON DELETE CASCADE,
    child_uid TEXT NOT NULL REFERENCES ideas (uid) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'child', created_at TEXT NOT NULL,
    UNIQUE (parent_uid, child_uid, kind));
INSERT INTO ideas (uid, title, description, content, kind, status, tags, created_at, updated_at)
    VALUES ('vieja', 'Vieja', '', '', 'idea', 'proposed', '[]',
            '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'),
           ('hija', 'Hija', '', '', 'idea', 'draft', '[]',
            '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
PRAGMA user_version = 2;
"""


def test_el_listado_por_estado_usa_el_indice(repo):  # noqa: ANN001, ANN202
    db = items.init_repo(repo)
    with closing(sqlite3.connect(db)) as conn:
        plan = " ".join(
            str(fila[3])
            for fila in conn.execute(
                "EXPLAIN QUERY PLAN " + consulta._sql_listado("proposed"),
                {"kind": None, "estado": "proposed", "limit": 10, "offset": 0},
            )
        )

    assert "work_item_node_estado" in plan
    assert "SCAN work_item_node" not in plan


def test_un_almacen_v12_sube_al_dia_sin_tocar_datos(repo):  # noqa: ANN001, ANN202
    db = items.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(db)) as conn:
        conn.executescript(_ESQUEMA_V2)
        conn.isolation_level = None
        # Los pasos reales hasta la 12: un almacén de esa versión, no una copia.
        for numero, script in migraciones._pasos(2):
            if numero > 12:
                break
            migraciones._aplicar_paso(conn, numero, script)
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 12

    items.ensure_repo(repo)  # lo que hace la app al abrir el almacén

    with closing(sqlite3.connect(db)) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == items.SCHEMA_VERSION
        filas = dict(conn.execute("SELECT uid, estado FROM work_item_node").fetchall())
    # `draft` y `proposed` compartían carril en el modelo viejo (0006), así que
    # las dos items llegan a la cola; lo que importa es que no se pierde ninguna.
    assert filas == {"vieja": "proposed", "hija": "proposed"}
    assert _indices_estado(db) == {"work_item_node_estado": ["estado", "posicion"]}
