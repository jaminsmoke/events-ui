"""La cola es estado real y ordenable (`idea_cola`), no una vista del log.

Cubre: fresco en v9 sin `idea_lane_log`, estados desde la cola/completada/
rechazada (el cajón es no tener fila), el orden de la cola y la migración
0009 desde un almacén v8 con historial.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from events_core import ideas


def _esquema_v8(conn: sqlite3.Connection) -> None:
    """Las tablas de un almacén v8, tal como las dejó el 0006/0007/0008."""
    conn.execute(
        "CREATE TABLE idea_entry ("
        " id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, title TEXT NOT NULL,"
        " description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',"
        " kind TEXT NOT NULL DEFAULT 'idea', tags TEXT NOT NULL DEFAULT '[]',"
        " created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE idea_lane_log ("
        " id INTEGER PRIMARY KEY,"
        " uid TEXT NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,"
        " lane TEXT NOT NULL CHECK (lane IN ('cola', 'descartadas', 'completada')),"
        " entered_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE idea_rejected ("
        " uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,"
        " rejected_at TEXT NOT NULL, rejected_description TEXT NOT NULL DEFAULT '',"
        " rejected_by TEXT NOT NULL DEFAULT 'usuario',"
        " superseded_by_uid TEXT REFERENCES idea_entry (uid))"
    )
    conn.execute(
        "CREATE TABLE connections ("
        " id INTEGER PRIMARY KEY,"
        " parent_uid TEXT NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,"
        " child_uid TEXT NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,"
        " kind TEXT NOT NULL DEFAULT 'child', created_at TEXT NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE event ("
        " id INTEGER PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL,"
        " payload TEXT NOT NULL DEFAULT '{}', dedupe_key TEXT)"
    )


def test_fresco_en_v9_sin_lane_log(client, repo):  # noqa: ANN001, ANN202
    db = ideas.ensure_repo(repo)
    conn = sqlite3.connect(str(db))
    tablas = {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 9
    assert "idea_cola" in tablas
    assert "idea_completada" in tablas
    assert "idea_rejected" in tablas
    assert "idea_lane_log" not in tablas


def test_draft_no_tiene_fila(client, repo):  # noqa: ANN001, ANN202
    r = client.post("/ideas", params={"repo": repo}, json={"title": "A"})
    assert r.status_code == 201
    assert r.json()["status"] == "draft"


def test_proposed_entra_en_cola_y_sale(client, repo):  # noqa: ANN001, ANN202
    uid = client.post("/ideas", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert r.json()["status"] == "proposed"

    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    assert conn.execute("SELECT count(*) FROM idea_cola").fetchone()[0] == 1
    conn.close()

    # Volver a draft saca la fila: la idea queda en el cajón.
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "draft"})
    assert r.json()["status"] == "draft"
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    assert conn.execute("SELECT count(*) FROM idea_cola").fetchone()[0] == 0


def test_cola_ordenada_por_posicion(client, repo):  # noqa: ANN001, ANN202
    uids = [
        client.post(
            "/ideas",
            params={"repo": repo},
            json={"title": f"Idea {i}", "status": "proposed"},
        ).json()["uid"]
        for i in (1, 2, 3)
    ]
    r = client.get("/ideas", params={"repo": repo, "status": "proposed"})
    assert [i["uid"] for i in r.json()] == uids

    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    posiciones = [r_[0] for r_ in conn.execute("SELECT posicion FROM idea_cola ORDER BY posicion")]
    assert posiciones == [1, 2, 3]


def test_rejected_sale_de_cola(client, repo):  # noqa: ANN001, ANN202
    uid = client.post(
        "/ideas", params={"repo": repo}, json={"title": "A", "status": "proposed"}
    ).json()["uid"]
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"status": "rejected", "rejected_description": "ruido"},
    )
    assert r.json()["status"] == "rejected"
    assert r.json()["rejected_description"] == "ruido"
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    assert conn.execute("SELECT count(*) FROM idea_cola").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM idea_rejected").fetchone()[0] == 1


def test_accepted_sale_de_cola_y_vive_en_completada(client, repo):  # noqa: ANN001, ANN202
    uid = client.post(
        "/ideas", params={"repo": repo}, json={"title": "A", "status": "proposed"}
    ).json()["uid"]
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "accepted"})
    assert r.json()["status"] == "accepted"

    r = client.get("/ideas", params={"repo": repo, "status": "accepted"})
    assert [i["uid"] for i in r.json()] == [uid]
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    assert conn.execute("SELECT count(*) FROM idea_cola").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM idea_completada").fetchone()[0] == 1


def test_reiniciar_vacia_todo(client, repo):  # noqa: ANN001, ANN202
    client.post("/ideas", params={"repo": repo}, json={"title": "A", "status": "proposed"})
    r = client.post("/reiniciar", params={"repo": repo})
    assert r.json()["ideas_eliminadas"] == 1
    assert r.json()["conexiones_eliminadas"] == 0
    assert client.get("/ideas", params={"repo": repo}).json() == []
    assert client.get("/mapa", params={"repo": repo}).json()["ideas"] == []
    db = ideas.db_file_for(repo)
    conn = sqlite3.connect(str(db))
    for tabla in ("idea_entry", "idea_cola", "idea_completada", "idea_rejected", "connections"):
        assert conn.execute(f"SELECT count(*) FROM {tabla}").fetchone()[0] == 0
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 9


def test_migracion_0009_solo_estado_final(client, repo):  # noqa: ANN001, ANN202
    """Un v8 con historial (cola→descartadas, cola→completada→cola,
    cola→descartadas→completada) migra a su último estado."""
    db = ideas.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    _esquema_v8(conn)
    for uid in ("a", "b", "c", "d", "e"):
        conn.execute(
            "INSERT INTO idea_entry (uid, title, description, content, kind, tags,"
            " created_at, updated_at) VALUES (?, ?, '', '', 'idea', '[]',"
            " '2026-11-18T00:00:00Z', '2026-11-18T00:00:00Z')",
            (uid, uid.upper()),
        )
    conn.executemany(
        "INSERT INTO idea_lane_log (uid, lane, entered_at) VALUES (?, ?, '2026-11-18T00:00:00Z')",
        [
            ("a", "cola"),
            ("a", "descartadas"),
            ("b", "cola"),
            ("b", "completada"),
            ("b", "cola"),
            ("c", "cola"),
            ("c", "descartadas"),
            ("c", "completada"),
            ("d", "cola"),
        ],
    )
    conn.execute(
        "INSERT INTO idea_rejected (uid, rejected_at, rejected_description)"
        " VALUES ('a', '2026-11-18T00:00:00Z', 'ruido')"
    )
    conn.execute("PRAGMA user_version = 8")
    conn.commit()
    conn.close()

    ideas.ensure_repo(repo)  # <- migra aquí

    conn = sqlite3.connect(str(db))
    conn.execute("PRAGMA foreign_keys = ON")
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 9
    tablas = {
        r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
    }
    assert "idea_lane_log" not in tablas
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    cola = [r[0] for r in conn.execute("SELECT uid FROM idea_cola ORDER BY posicion")]
    assert cola == ["b", "d"]
    completada = [r[0] for r in conn.execute("SELECT uid FROM idea_completada")]
    assert completada == ["c"]

    r = client.get("/mapa", params={"repo": repo})
    estados = {i["title"]: i["status"] for i in r.json()["ideas"]}
    assert estados == {
        "A": "rejected",
        "B": "proposed",
        "C": "accepted",
        "D": "proposed",
        "E": "draft",
    }
