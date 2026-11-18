"""`core:seed` sobre un almacén existente lo migra, no lo marca a ciegas.

Antes, `init_repo` reaplicaba solo `schema/*.sql`: en un v12 creaba las
tablas nuevas, dejaba la idea completada en `idea_completada` y fijaba
`user_version = 13` sin copiarla ni ampliar `protocolo_flujo`. El mapa la
leía como borrador (draft) y los protocolos nuevos no llegaban.
"""

from __future__ import annotations

import sqlite3
import subprocess
import sys
from pathlib import Path

from events_core import ideas

_ESPERADOS = {
    ("draft", "proposed"),
    ("draft", "rejected"),
    ("proposed", "roadmap"),
    ("proposed", "rejected"),
    ("roadmap", "verificacion"),
    ("verificacion", "proposed"),
    ("verificacion", "revision_aprobada"),
}


def _esquema_v12(conn: sqlite3.Connection) -> None:
    """Un almacén tal como lo dejó la 0012: completada vieja y protocolos con `accepted`."""
    conn.executescript(
        """
        CREATE TABLE idea_entry (
            id INTEGER PRIMARY KEY, uid TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT 'idea', tags TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE idea_cola (
            uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
            posicion INTEGER NOT NULL UNIQUE, entered_at TEXT NOT NULL);
        CREATE TABLE idea_completada (
            uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
            completed_at TEXT NOT NULL);
        CREATE TABLE idea_rejected (
            uid TEXT PRIMARY KEY REFERENCES idea_entry (uid) ON DELETE CASCADE,
            rejected_at TEXT NOT NULL, rejected_description TEXT NOT NULL DEFAULT '',
            rejected_by TEXT NOT NULL DEFAULT 'usuario',
            superseded_by_uid TEXT REFERENCES idea_entry (uid));
        CREATE TABLE connections (
            id INTEGER PRIMARY KEY,
            parent_uid TEXT NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
            child_uid TEXT NOT NULL REFERENCES idea_entry (uid) ON DELETE CASCADE,
            kind TEXT NOT NULL DEFAULT 'child', created_at TEXT NOT NULL,
            UNIQUE (parent_uid, child_uid, kind), CHECK (parent_uid <> child_uid));
        CREATE TABLE event (
            id INTEGER PRIMARY KEY, ts TEXT NOT NULL, type TEXT NOT NULL,
            payload TEXT NOT NULL DEFAULT '{}', origen TEXT NOT NULL DEFAULT 'externo',
            dedupe_key TEXT);
        CREATE TABLE protocolo_flujo (
            origen TEXT NOT NULL
              CHECK (origen IN ('draft', 'proposed', 'accepted', 'rejected')),
            destino TEXT NOT NULL
              CHECK (destino IN ('draft', 'proposed', 'accepted', 'rejected')),
            PRIMARY KEY (origen, destino));
        INSERT INTO protocolo_flujo VALUES
            ('draft', 'proposed'), ('draft', 'rejected'), ('proposed', 'rejected');
        INSERT INTO idea_entry (uid, title, created_at, updated_at) VALUES
            ('hecha', 'Hecha', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
        INSERT INTO idea_completada VALUES ('hecha', '2026-01-02T00:00:00Z');
        PRAGMA user_version = 12;
        """
    )


def _db_v12(repo: str) -> Path:
    db = ideas.db_file_for(repo)
    db.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db))
    try:
        _esquema_v12(conn)
        conn.commit()
    finally:
        conn.close()
    return db


def _seed(repo: str) -> None:
    """El comando real, no la función: `python -m events_core.seed <repo>`."""
    core = Path(__file__).resolve().parents[1]
    subprocess.run(
        [sys.executable, "-m", "events_core.seed", repo],
        cwd=core,
        check=True,
        capture_output=True,
        text=True,
    )


def _comprobar_migrado(client, repo, esperados=_ESPERADOS):  # noqa: ANN001, ANN202
    # La API es la que abre el repo: en el caso del v13 mal migrado, esta
    # lectura es la que tiene que terminar la 0013 antes de leer el mapa.
    mapa = client.get("/mapa", params={"repo": repo}).json()
    assert {i["uid"]: i["status"] for i in mapa["ideas"]} == {"hecha": "revision_aprobada"}

    db = ideas.db_file_for(repo)
    conn = sqlite3.connect(str(db))
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 15
        tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "idea_completada" not in tablas
        assert conn.execute("SELECT uid, approved_at FROM idea_revision").fetchall() == [
            ("hecha", "2026-01-02T00:00:00Z")
        ]
        protocolos = set(conn.execute("SELECT origen, destino FROM protocolo_flujo").fetchall())
        assert protocolos == esperados
    finally:
        conn.close()


def test_seed_migra_un_v12_y_es_idempotente(client, repo):  # noqa: ANN001, ANN202
    _db_v12(repo)
    _seed(repo)
    _comprobar_migrado(client, repo)

    # Segunda ejecución: no duplica, no falla y no cambia el estado.
    _seed(repo)
    _comprobar_migrado(client, repo)


def test_seed_v12_conserva_un_protocolo_retirado(client, repo):  # noqa: ANN001, ANN202
    """Un v12 con `draft → rejected` retirado migra sin volver a habilitarlo."""
    db = _db_v12(repo)
    conn = sqlite3.connect(str(db))
    try:
        conn.execute("DELETE FROM protocolo_flujo WHERE origen = 'draft' AND destino = 'rejected'")
        conn.commit()
    finally:
        conn.close()

    _seed(repo)
    _comprobar_migrado(client, repo, _ESPERADOS - {("draft", "rejected")})


def test_un_v13_mal_migrado_se_repara_al_abrir(client, repo):  # noqa: ANN001, ANN202
    """El fallo anterior: `aplicar_esquema` firmó v13 sin terminar la 0013.

    Al abrir el repo (la API lo hace en cada lectura) debe terminarse la
    migración: la completada pasa a revisión y llegan los protocolos nuevos.
    """
    db = _db_v12(repo)
    conn = sqlite3.connect(str(db))
    try:
        ideas.aplicar_esquema(conn)
        conn.commit()
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 15
        assert conn.execute("SELECT count(*) FROM idea_revision").fetchone()[0] == 0
    finally:
        conn.close()

    _comprobar_migrado(client, repo)
    # Y queda reparado: abrirlo otra vez no vuelve a copiar ni a tocar nada.
    _comprobar_migrado(client, repo)


def test_reparacion_v13_no_reinserta_un_protocolo_retirado(client, repo):  # noqa: ANN001, ANN202
    """Si el repo había retirado `draft → rejected`, la reparación no lo devuelve."""
    db = _db_v12(repo)
    conn = sqlite3.connect(str(db))
    try:
        conn.execute("DELETE FROM protocolo_flujo WHERE origen = 'draft' AND destino = 'rejected'")
        # El v13 mal migrado: la versión subió sin terminar la 0013. No se
        # aplica el esquema fresco (eso re-sembraría la fila); solo se firma.
        conn.execute("PRAGMA user_version = 13")
        conn.commit()
    finally:
        conn.close()

    _comprobar_migrado(client, repo, _ESPERADOS - {("draft", "rejected")})
