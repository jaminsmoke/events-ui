"""`event.origen` (0010): de qué tabla viene cada fila del log.

`idea` es lo que emite el core (`_emitir`), `externo` lo escribe el
productor y las tablas futuras traerán la suya. La migración rellena los
eventos de ideas ya escritos por su `type` y crea la tabla en los
almacenes sembrados que aún no la tenían (Lab1, por ejemplo).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from events_core import ideas

EVENTOS_VIEJO = (
    "CREATE TABLE event ("
    " id INTEGER PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL,"
    " payload TEXT NOT NULL DEFAULT '{}', dedupe_key TEXT,"
    " UNIQUE (dedupe_key))"
)


def _sembrar_event(repo) -> None:
    """La tabla del log tal como la deja el esquema final (la app no la crea:
    el productor sí)."""
    ideas.ensure_repo(repo)
    db = ideas.db_file_for(repo)
    conn = sqlite3.connect(str(db))
    esquema = (Path(ideas.SCHEMA_DIR) / "eventos.sql").read_text(encoding="utf-8")
    conn.executescript(esquema)
    conn.commit()
    conn.close()


def test_emitir_escribe_origen_idea(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    uid = client.post("/ideas", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    r = client.get("/eventos", params={"repo": repo})
    assert [e["type"] for e in r.json()] == ["idea.created"]
    assert all(e["origen"] == "idea" for e in r.json())
    assert r.json()[0]["payload"]["uid"] == uid


def test_externo_y_filtro(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    conn.execute(
        "INSERT INTO event (ts, type, payload, origen) VALUES ('2026-11-18T00:00:00Z',"
        " 'sistema.reinicio', '{}', 'externo')"
    )
    conn.execute(
        "INSERT INTO event (ts, type, payload, origen) VALUES ('2026-11-18T00:00:00Z',"
        " 'idea.created', '{\"uid\": \"x\"}', 'idea')"
    )
    conn.commit()
    conn.close()

    todos = client.get("/eventos", params={"repo": repo}).json()
    assert [e["type"] for e in todos] == ["sistema.reinicio", "idea.created"]

    externos = client.get("/eventos", params={"repo": repo, "origen": "externo"}).json()
    assert [e["type"] for e in externos] == ["sistema.reinicio"]

    de_ideas = client.get("/eventos", params={"repo": repo, "origen": "idea"}).json()
    assert [e["type"] for e in de_ideas] == ["idea.created"]


def test_migracion_0010_rellena_origen(client, repo):  # noqa: ANN001, ANN202
    """Un almacén v9 con eventos sin columna migra sin perder ninguno."""
    db = ideas.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    conn.execute(
        "CREATE TABLE idea_entry ("
        " id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, title TEXT NOT NULL,"
        " description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',"
        " kind TEXT NOT NULL DEFAULT 'idea', tags TEXT NOT NULL DEFAULT '[]',"
        " created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    conn.execute(EVENTOS_VIEJO)
    conn.execute(
        "INSERT INTO event (ts, type, payload) VALUES ('2026-11-18T00:00:00Z',"
        " 'idea.created', '{\"uid\": \"x\"}')"
    )
    conn.execute(
        "INSERT INTO event (ts, type, payload) VALUES ('2026-11-18T00:00:00Z',"
        " 'sistema.reinicio', '{}')"
    )
    conn.execute("PRAGMA user_version = 9")
    conn.commit()
    conn.close()

    ideas.ensure_repo(repo)

    conn = sqlite3.connect(str(db))
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 14
    columnas = [r[1] for r in conn.execute("PRAGMA table_info(event)")]
    assert "origen" in columnas
    filas = conn.execute("SELECT type, origen FROM event ORDER BY id").fetchall()
    assert filas == [("idea.created", "idea"), ("sistema.reinicio", "externo")]
    indices = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
    assert "idx_event_origen" in indices


def test_migracion_0010_sin_tabla_event_crea_acceso(client, repo):  # noqa: ANN001, ANN202
    """Un sembrado al que el productor nunca llegó (como Lab1) tampoco rompe:
    la migración le crea la tabla con la columna ya puesta."""
    db = ideas.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    conn.execute(
        "CREATE TABLE idea_entry ("
        " id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, title TEXT NOT NULL,"
        " description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',"
        " kind TEXT NOT NULL DEFAULT 'idea', tags TEXT NOT NULL DEFAULT '[]',"
        " created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    conn.execute("PRAGMA user_version = 9")
    conn.commit()
    conn.close()

    ideas.ensure_repo(repo)

    conn = sqlite3.connect(str(db))
    assert conn.execute("PRAGMA user_version").fetchone()[0] == 14
    assert conn.execute("SELECT count(*) FROM event").fetchone()[0] == 0
    columnas = [r[1] for r in conn.execute("PRAGMA table_info(event)")]
    assert "origen" in columnas
    r = client.get("/eventos", params={"repo": repo})
    assert r.status_code == 200 and r.json() == []
