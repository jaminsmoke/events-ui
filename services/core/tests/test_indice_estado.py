"""El índice de `idea_node.estado` (0032): el filtro del mapa sin escanear.

`list_ideas` filtra por estado y el esquema solo tenía los índices únicos de la
cola y del roadmap. El índice nuevo cubre el filtro y, con `posicion` detrás,
también el orden de la cola.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from events_core import ideas


def _indices_estado(db: Path) -> dict[str, list[str]]:
    """Las columnas del índice `idea_node_estado`, si está."""
    with closing(sqlite3.connect(db)) as conn:
        nombres = [
            str(fila[1])
            for fila in conn.execute("PRAGMA index_list('idea_node')").fetchall()
            if fila[1] == "idea_node_estado"
        ]
        return {
            nombre: [
                str(fila[2]) for fila in conn.execute(f"PRAGMA index_info('{nombre}')").fetchall()
            ]
            for nombre in nombres
        }


def test_el_esquema_fresco_trae_el_indice_de_estado(repo):  # noqa: ANN001, ANN202
    db = ideas.init_repo(repo)

    # Un solo índice compuesto: `estado` filtra y `posicion` ordena la cola.
    assert _indices_estado(db) == {"idea_node_estado": ["estado", "posicion"]}


def test_un_almacen_v31_sube_con_el_indice_y_sin_tocar_datos(repo):  # noqa: ANN001, ANN202
    db = ideas.init_repo(repo)
    uid = ideas.create_idea(repo, title="A")["uid"]
    # La versión anterior: sin el índice y firmando 31.
    with closing(sqlite3.connect(db)) as conn:
        conn.execute("DROP INDEX idea_node_estado")
        conn.execute("PRAGMA user_version = 31")
        conn.commit()

    ideas.ensure_repo(repo)

    with closing(sqlite3.connect(db)) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == ideas.SCHEMA_VERSION
        assert conn.execute("SELECT count(*) FROM idea_node").fetchone()[0] == 1
    assert _indices_estado(db) == {"idea_node_estado": ["estado", "posicion"]}
    assert ideas.get_idea(repo, uid)["uid"] == uid
