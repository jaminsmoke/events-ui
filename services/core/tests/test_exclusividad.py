"""La exclusividad de fichas vive también en SQLite, no solo en el core."""

from __future__ import annotations

import sqlite3
from contextlib import closing

import pytest

from events_core import ideas

TS = "2026-01-01T00:00:00+00:00"


def _conectar(repo: str) -> sqlite3.Connection:
    ideas.init_repo(repo)
    conn = sqlite3.connect(ideas.db_file_for(repo))
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def test_una_idea_no_vive_en_cola_y_roadmap_a_la_vez(repo) -> None:
    uid = ideas.create_idea(repo, title="Uno", status="proposed")["uid"]
    with (
        closing(_conectar(repo)) as conn,
        pytest.raises(sqlite3.IntegrityError, match="otra ficha"),
    ):
        conn.execute("INSERT INTO idea_roadmap (uid, started_at) VALUES (?, ?)", (uid, TS))

    # La escritura rechazada no tocó el estado anterior.
    assert ideas.get_idea(repo, uid)["status"] == "proposed"
    with closing(sqlite3.connect(ideas.db_file_for(repo))) as conn:
        assert conn.execute("SELECT count(*) FROM idea_roadmap").fetchone()[0] == 0


def test_roadmap_solo_admite_una_ficha(repo) -> None:
    ideas.init_repo(repo)
    uno = ideas.create_idea(repo, title="Uno", status="roadmap")["uid"]
    dos = ideas.create_idea(repo, title="Dos")["uid"]
    with (
        closing(_conectar(repo)) as conn,
        pytest.raises(sqlite3.IntegrityError, match="un item activo"),
    ):
        conn.execute("INSERT INTO idea_roadmap (uid, started_at) VALUES (?, ?)", (dos, TS))

    assert ideas.get_idea(repo, dos)["status"] == "draft"
    assert ideas.get_idea(repo, uno)["status"] == "roadmap"


def test_redescartar_actualiza_su_propia_ficha(repo) -> None:
    """El trigger del descarte no se estorba con el upsert de la misma idea."""
    uid = ideas.create_idea(repo, title="Uno", status="proposed")["uid"]
    ideas.update_idea(repo, uid, {"status": "rejected", "rejected_description": "primera"})
    ideas.update_idea(repo, uid, {"status": "rejected", "rejected_description": "segunda"})

    assert ideas.get_idea(repo, uid)["rejected_description"] == "segunda"
