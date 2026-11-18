"""La cola es estado real y ordenable (`idea_cola`), no una vista del log.

Cubre: fresco en v16 sin `idea_lane_log`, estados desde la cola/revisión
aprobada/rechazada (la entrada es no tener fila), el orden de la cola y la
migración 0009 desde un almacén v8 con historial.
"""

from __future__ import annotations

import sqlite3

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


def _esquema_inicial(conn: sqlite3.Connection) -> None:
    """El fichero histórico: `ideas` (con `status`), conexiones a `ideas` y sin versión."""
    conn.executescript(
        """
        CREATE TABLE ideas (
            id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT NOT NULL UNIQUE,
            title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
            content TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'idea'
                CHECK (kind IN ('idea', 'adr', 'note')),
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
        INSERT INTO ideas
            (uid, title, description, content, kind, status, tags, created_at, updated_at) VALUES
            ('vieja', 'Vieja', 'Desc', 'Cuerpo', 'idea', 'proposed', '["old"]',
             '2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z'),
            ('hija', 'Hija', '', '', 'idea', 'draft', '[]',
             '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z'),
            ('aceptada', 'Aceptada', '', '', 'idea', 'accepted', '[]',
             '2025-01-01T00:00:00Z', '2025-01-04T00:00:00Z'),
            ('rechazada', 'Rechazada', '', '', 'idea', 'rejected', '[]',
             '2025-01-01T00:00:00Z', '2025-01-05T00:00:00Z');
        INSERT INTO connections (parent_uid, child_uid, kind, created_at)
            VALUES ('vieja', 'hija', 'child', '2025-01-03T00:00:00Z');
        PRAGMA user_version = 0;
        """
    )


def _comprobar_historico(client, repo):  # noqa: ANN001, ANN202
    r = client.get("/mapa", params={"repo": repo})  # <- migra aquí
    assert r.status_code == 200
    ideas_mapa = {i["uid"]: i for i in r.json()["ideas"]}
    assert ideas_mapa["vieja"]["status"] == "proposed"
    assert ideas_mapa["hija"]["status"] == "draft"
    assert ideas_mapa["aceptada"]["status"] == "revision_aprobada"
    assert ideas_mapa["rechazada"]["status"] == "rejected"
    assert r.json()["connections"] == [
        {
            "id": 1,
            "parent_uid": "vieja",
            "child_uid": "hija",
            "kind": "child",
            "created_at": "2025-01-03T00:00:00Z",
        }
    ]
    ficha = client.get("/ideas/vieja", params={"repo": repo}).json()
    assert ficha["title"] == "Vieja"
    assert ficha["description"] == "Desc"
    assert ficha["content"] == "Cuerpo"
    assert ficha["tags"] == ["old"]

    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    try:
        tablas = {
            row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        }
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 16
        assert "ideas" not in tablas
        assert conn.execute("SELECT count(*) FROM idea_entry").fetchone()[0] == 4
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        conn.close()


def test_tipos_historicos_se_leen_sin_romper(client, repo):  # noqa: ANN001, ANN202
    """Un almacén con `kind = 'adr'` y `'note'` se lee entero: el listado y la
    ficha conservan el tipo en vez de devolver 500."""
    db = ideas.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    _esquema_v8(conn)
    conn.executemany(
        "INSERT INTO idea_entry"
        " (uid, title, description, content, kind, tags, created_at, updated_at)"
        " VALUES (?, ?, '', '', ?, '[]', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
        [("adr-1", "ADR uno", "adr"), ("nota-1", "Nota uno", "note")],
    )
    conn.execute("PRAGMA user_version = 8")
    conn.commit()
    conn.close()

    lista = client.get("/ideas", params={"repo": repo})
    assert lista.status_code == 200, lista.json()
    assert {i["uid"]: i["kind"] for i in lista.json()} == {"adr-1": "adr", "nota-1": "note"}

    for uid, kind in (("adr-1", "adr"), ("nota-1", "note")):
        ficha = client.get(f"/ideas/{uid}", params={"repo": repo})
        assert ficha.status_code == 200, ficha.json()
        assert ficha.json()["kind"] == kind

    mapa = client.get("/mapa", params={"repo": repo})
    assert mapa.status_code == 200, mapa.json()
    assert {i["uid"]: i["status"] for i in mapa.json()["ideas"]} == {
        "adr-1": "draft",
        "nota-1": "draft",
    }


def test_fresco_sin_lane_log(client, repo):  # noqa: ANN001, ANN202
    db = ideas.ensure_repo(repo)
    conn = sqlite3.connect(str(db))
    tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 16
    assert "idea_cola" in tablas
    assert "idea_roadmap" in tablas
    assert "idea_verificacion" in tablas
    assert "idea_revision" in tablas
    assert "idea_completada" not in tablas
    assert "idea_rejected" in tablas
    assert "idea_lane_log" not in tablas


def test_draft_no_tiene_fila(client, repo):  # noqa: ANN001, ANN202
    r = client.post("/ideas", params={"repo": repo}, json={"title": "A"})
    assert r.status_code == 201
    assert r.json()["status"] == "draft"


def test_proposed_entra_en_cola_y_no_vuelve_al_cajon(client, repo):  # noqa: ANN001, ANN202
    uid = client.post("/ideas", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert r.json()["status"] == "proposed"

    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    assert conn.execute("SELECT count(*) FROM idea_cola").fetchone()[0] == 1
    conn.close()

    # El protocolo prohíbe volver al cajón: la cola no se deshace a mano.
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "draft"})
    assert r.status_code == 400
    assert "protocolo" in r.json()["detail"]
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    assert conn.execute("SELECT count(*) FROM idea_cola").fetchone()[0] == 1
    conn.close()


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


def test_revision_aprobada_es_terminal(client, repo):  # noqa: ANN001, ANN202
    # La ficha final (0013) solo la siembra el harness (status al crear);
    # por API no se puede llegar a ella fuera de verificación ni salir.
    uid = client.post(
        "/ideas", params={"repo": repo}, json={"title": "A", "status": "revision_aprobada"}
    ).json()["uid"]
    r = client.get("/ideas", params={"repo": repo, "status": "revision_aprobada"})
    assert [i["uid"] for i in r.json()] == [uid]
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    assert conn.execute("SELECT count(*) FROM idea_cola").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM idea_revision").fetchone()[0] == 1
    conn.close()

    uid2 = client.post("/ideas", params={"repo": repo}, json={"title": "B"}).json()["uid"]
    r = client.patch(f"/ideas/{uid2}", params={"repo": repo}, json={"status": "revision_aprobada"})
    assert r.status_code == 400
    assert "protocolo" in r.json()["detail"]

    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert r.status_code == 400
    assert "protocolo" in r.json()["detail"]


def test_reiniciar_vacia_todo(client, repo):  # noqa: ANN001, ANN202
    client.post("/ideas", params={"repo": repo}, json={"title": "A", "status": "proposed"})
    r = client.post("/reiniciar", params={"repo": repo})
    assert r.json()["ideas_eliminadas"] == 1
    assert r.json()["conexiones_eliminadas"] == 0
    assert client.get("/ideas", params={"repo": repo}).json() == []
    assert client.get("/mapa", params={"repo": repo}).json()["ideas"] == []
    db = ideas.db_file_for(repo)
    conn = sqlite3.connect(str(db))
    for tabla in (
        "idea_entry",
        "idea_cola",
        "idea_roadmap",
        "idea_verificacion",
        "idea_revision",
        "idea_rejected",
        "connections",
    ):
        assert conn.execute(f"SELECT count(*) FROM {tabla}").fetchone()[0] == 0
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 16


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
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 16
    tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert "idea_lane_log" not in tablas
    assert "idea_completada" not in tablas
    assert "idea_revision" in tablas
    assert conn.execute("PRAGMA foreign_key_check").fetchall() == []
    cola = [r[0] for r in conn.execute("SELECT uid FROM idea_cola ORDER BY posicion")]
    assert cola == ["b", "d"]
    revisiones = [r[0] for r in conn.execute("SELECT uid FROM idea_revision")]
    assert revisiones == ["c"]

    r = client.get("/mapa", params={"repo": repo})
    estados = {i["title"]: i["status"] for i in r.json()["ideas"]}
    assert estados == {
        "A": "rejected",
        "B": "proposed",
        "C": "revision_aprobada",
        "D": "proposed",
        "E": "draft",
    }


def test_historico_sin_version_conserva_ideas_y_conexiones(client, repo):  # noqa: ANN001, ANN202
    """Un fichero anterior a `user_version` trae `ideas`, no `idea_entry`.

    Abrirlo no puede marcar al día dejando la fila en la tabla vieja: el mapa
    tiene que conservar el UID, los campos, el estado y la conexión.
    """
    db = ideas.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    _esquema_inicial(conn)
    conn.commit()
    conn.close()

    _comprobar_historico(client, repo)


def test_historico_ya_marcado_se_recupera(client, repo):  # noqa: ANN001, ANN202
    """El fichero ya abierto una vez: al día y con la fila en `ideas` y cero en
    `idea_entry`."""
    db = ideas.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    _esquema_inicial(conn)
    ideas.aplicar_esquema(conn)  # lo que hacía el código anterior
    conn.commit()
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 16
    assert conn.execute("SELECT count(*) FROM idea_entry").fetchone()[0] == 0
    assert conn.execute("SELECT count(*) FROM ideas").fetchone()[0] == 4
    conn.close()

    _comprobar_historico(client, repo)
