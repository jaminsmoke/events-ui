"""Un almacén de una versión posterior se nombra, no se adivina.

`ensure_repo` se volvía en silencio cuando `user_version >= SCHEMA_VERSION`, y
eso mezcla «está al día» con «lo migró un core más nuevo». La app instalada
abría ese almacén y respondía por casualidad hasta que una migración moviera
una columna que sí lee: entonces llegaba un 500 sin pista. Ahora el segundo
caso falla con el motivo y sin escribir nada.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from events_core import ideas


def _firmar(db: Path, version: int) -> None:
    with closing(sqlite3.connect(str(db))) as conn:
        conn.execute(f"PRAGMA user_version = {version}")
        conn.commit()


def _version(db: Path) -> int:
    with closing(sqlite3.connect(str(db))) as conn:
        return int(conn.execute("PRAGMA user_version").fetchone()[0])


def test_un_almacen_posterior_da_409_con_el_motivo(client, repo):  # noqa: ANN001, ANN202
    db = ideas.init_repo(repo)
    posterior = ideas.SCHEMA_VERSION + 1
    _firmar(db, posterior)

    r = client.get("/revision", params={"repo": repo})

    assert r.status_code == 409, r.json()
    detalle = r.json()["detail"]
    assert "versión más nueva" in detalle
    assert str(posterior) in detalle
    assert str(ideas.SCHEMA_VERSION) in detalle
    # Ni una escritura: la versión sigue donde la dejó el core nuevo.
    assert _version(db) == posterior
    # Y no es cosa de una ruta: el mapa tampoco lo abre a ciegas.
    assert client.get("/mapa", params={"repo": repo}).status_code == 409


def test_health_tambien_nombra_el_almacen_posterior(client, repo, monkeypatch):  # noqa: ANN001, ANN202
    """`/health` abre en solo lectura: no migra, pero no dice «ok» de lo que no entiende."""
    db = ideas.init_repo(repo)
    monkeypatch.setenv("EVENTSUI_DB", str(db))

    assert client.get("/health").json()["status"] == "ok"

    posterior = ideas.SCHEMA_VERSION + 1
    _firmar(db, posterior)
    r = client.get("/health")

    assert r.status_code == 409, r.json()
    assert "versión más nueva" in r.json()["detail"]
    assert _version(db) == posterior


def test_el_almacen_al_dia_sigue_abriendo(client, repo):  # noqa: ANN001, ANN202
    db = ideas.init_repo(repo)

    assert client.get("/revision", params={"repo": repo}).status_code == 200
    assert _version(db) == ideas.SCHEMA_VERSION
