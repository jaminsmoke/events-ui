"""Las etiquetas son una lista de cadenas, también para escritores externos."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

import pytest

from events_core import items


def _almacen_v16(db: Path) -> None:
    """Un almacén de la 0016: `tags` solo pedía JSON válido."""
    with closing(sqlite3.connect(db)) as conn:
        conn.execute(
            "CREATE TABLE idea_entry ("
            " id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE,"
            " title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',"
            " content TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL DEFAULT 'idea',"
            " tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),"
            " verificacion_intentos INTEGER NOT NULL DEFAULT 0,"
            " created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE protocolo_flujo ("
            " origen TEXT NOT NULL CHECK (origen IN ('draft', 'proposed', 'roadmap',"
            " 'verificacion', 'revision_aprobada', 'rejected')),"
            " destino TEXT NOT NULL CHECK (destino IN ('draft', 'proposed', 'roadmap',"
            " 'verificacion', 'revision_aprobada', 'rejected')),"
            " PRIMARY KEY (origen, destino))"
        )
        # Las cinco fichas de la 0013, que la 0020 lee para construir el nodo.
        conn.execute(
            "CREATE TABLE idea_cola ("
            " uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,"
            " posicion INTEGER NOT NULL UNIQUE, entered_at TEXT NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE idea_roadmap ("
            " uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,"
            " started_at TEXT NOT NULL, completed_at TEXT,"
            " resultado TEXT NOT NULL DEFAULT '', referencia TEXT NOT NULL DEFAULT '')"
        )
        conn.execute(
            "CREATE TABLE idea_verificacion ("
            " uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,"
            " started_at TEXT NOT NULL, intentos INTEGER NOT NULL DEFAULT 1,"
            " ultimo_resultado TEXT NOT NULL DEFAULT '',"
            " comentario TEXT NOT NULL DEFAULT '', roadmap_completed_at TEXT)"
        )
        conn.execute(
            "CREATE TABLE idea_revision ("
            " uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,"
            " approved_at TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT 'usuario',"
            " nota TEXT NOT NULL DEFAULT '')"
        )
        conn.execute(
            "CREATE TABLE idea_rejected ("
            " uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,"
            " rejected_at TEXT NOT NULL, rejected_description TEXT NOT NULL DEFAULT '',"
            " rejected_by TEXT NOT NULL DEFAULT 'usuario',"
            " superseded_by_uid TEXT REFERENCES idea_entry (uid))"
        )
        for uid, tags in (("vieja", "{}"), ("mixta", '[1, "dos"]'), ("buena", '["tres"]')):
            conn.execute(
                "INSERT INTO idea_entry (uid, title, tags, created_at, updated_at)"
                " VALUES (?, ?, ?, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
                (uid, uid, tags),
            )
        conn.execute("PRAGMA user_version = 16")
        conn.commit()


def test_la_api_solo_acepta_cadenas(client, repo):  # noqa: ANN001, ANN202
    rechazo = client.post("/items", params={"repo": repo}, json={"title": "Uno", "tags": [1]})
    assert rechazo.status_code == 422

    creada = client.post("/items", params={"repo": repo}, json={"title": "Dos", "tags": ["a"]})
    assert creada.status_code == 201
    assert creada.json()["tags"] == ["a"]


def test_sqlite_rechaza_tags_que_no_son_lista(repo):  # noqa: ANN001, ANN202
    items.init_repo(repo)
    with (
        closing(sqlite3.connect(items.db_file_for(repo))) as conn,
        pytest.raises(sqlite3.IntegrityError),
    ):
        conn.execute(
            "INSERT INTO work_item_data (uid, title, tags, created_at, updated_at)"
            " VALUES ('x', 'X', '{}', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
        )


def test_la_migracion_sanea_las_etiquetas(repo):  # noqa: ANN001, ANN202
    db = items.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    _almacen_v16(db)

    items.ensure_repo(repo)

    with closing(sqlite3.connect(db)) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == items.SCHEMA_VERSION
        filas = dict(conn.execute("SELECT uid, tags FROM work_item_data").fetchall())
    assert filas == {"vieja": "[]", "mixta": '[1, "dos"]', "buena": '["tres"]'}


def test_el_listado_aguanta_una_fila_con_tags_no_lista(client, repo):  # noqa: ANN001, ANN202
    """Una fila escrita con los CHECK relajados se lee como lista vacía, no 500."""
    items.init_repo(repo)
    uid = items.create_item(repo, title="Vieja")["uid"]
    with closing(sqlite3.connect(items.db_file_for(repo))) as conn:
        conn.execute("PRAGMA ignore_check_constraints = ON")
        conn.execute("UPDATE work_item_data SET tags = '{}' WHERE uid = ?", (uid,))
        conn.commit()

    r = client.get("/items", params={"repo": repo})
    assert r.status_code == 200, r.json()
    assert r.json()[0]["tags"] == []

    # De una lista se leen solo las cadenas; el número no rompe el listado.
    with closing(sqlite3.connect(items.db_file_for(repo))) as conn:
        conn.execute("PRAGMA ignore_check_constraints = ON")
        conn.execute("UPDATE work_item_data SET tags = '[1, \"dos\"]' WHERE uid = ?", (uid,))
        conn.commit()
    r = client.get("/items", params={"repo": repo})
    assert r.status_code == 200, r.json()
    assert r.json()[0]["tags"] == ["dos"]
