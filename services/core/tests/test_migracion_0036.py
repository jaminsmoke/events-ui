"""La 0036: el `kind` del dato deja de llamarse `idea`.

`work_item_data` tiene un `CHECK` sobre `kind` y SQLite no lo cambia con
`ALTER`, así que la migración reconstruye la tabla. Lo que se comprueba es que
las filas sobreviven con su `id`, que `idea` pasa a `work_item` y que los
históricos `adr`/`note` se quedan como estaban.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing

import pytest

from events_core import items
from events_core.items.base.esquema import SCHEMA_VERSION


def _kinds(conn: sqlite3.Connection) -> dict[str, str]:
    return dict(conn.execute("SELECT uid, kind FROM work_item_data"))


def test_la_0036_convierte_idea_en_work_item_y_respeta_adr_y_note(
    repo,  # noqa: ANN001
    bajar_a_la_0033,  # noqa: ANN001
):  # noqa: ANN202
    db = items.init_repo(repo)
    uid = items.create_item(repo, title="A")["uid"]

    with closing(sqlite3.connect(str(db))) as conn:
        conn.execute(
            "INSERT INTO work_item_data"
            " (uid, title, description, content, kind, tags, depende_de,"
            " created_at, updated_at)"
            " VALUES ('adr-1', 'ADR', '', '', 'adr', '[]', '[]',"
            " '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z')"
        )
        conn.execute(
            "INSERT INTO work_item_node (uid, estado, posicion, created_at, id, entered_at)"
            " SELECT uid, 'historial', NULL, created_at, id, created_at"
            " FROM work_item_data WHERE uid = 'adr-1'"
        )
        conn.commit()

    bajar_a_la_0033(db, 35)

    with closing(sqlite3.connect(str(db))) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 35
        assert _kinds(conn) == {uid: "idea", "adr-1": "adr"}

    items.ensure_repo(repo)

    with closing(sqlite3.connect(str(db))) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        assert _kinds(conn) == {uid: "work_item", "adr-1": "adr"}
        # El `id` sigue siendo el mismo: `work_item_node.id` lo copia.
        assert (
            conn.execute(
                "SELECT count(*) FROM work_item_node AS nodo"
                " JOIN work_item_data AS datos ON datos.uid = nodo.uid"
                " WHERE datos.id = nodo.id"
            ).fetchone()[0]
            == 2
        )
        # El `CHECK` nuevo ya no admite `idea`.
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO work_item_data"
                " (uid, title, kind, created_at, updated_at)"
                " VALUES ('x', 'X', 'idea', '2026-11-23T00:00:00Z',"
                " '2026-11-23T00:00:00Z')"
            )
