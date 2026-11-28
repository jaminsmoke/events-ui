"""Un PATCH que cambia de estado emite `item.status`; uno que no, edición.

Reafirmar el mismo estado no es un traslado: la cola no se reordena (su
posición se conserva) y el evento que sale es `item.updated`, no `item.status`.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from events_core import items


def _sembrar_event(repo) -> None:  # noqa: ANN001, ANN202
    """La tabla del log como la deja la app (el productor la crea de verdad)."""
    items.ensure_repo(repo)
    conn = sqlite3.connect(str(items.db_file_for(repo)))
    conn.executescript((Path(items.SCHEMA_DIR) / "eventos.sql").read_text(encoding="utf-8"))
    conn.commit()
    conn.close()


def _tipos(client, repo):  # noqa: ANN001, ANN202
    conn = sqlite3.connect(str(items.db_file_for(repo)))
    tipos = [r[0] for r in conn.execute("SELECT type FROM event ORDER BY id")]
    conn.close()
    return tipos


def test_reafirmar_estado_emite_edicion_y_no_reordena(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    uids = [
        client.post(
            "/items",
            params={"repo": repo},
            json={"title": f"Idea {i}", "status": "proposed"},
        ).json()["uid"]
        for i in (1, 2, 3)
    ]
    # Reafirmar `proposed` sobre la primera: no hay traslado ni reordenación.
    r = client.patch(f"/items/{uids[0]}", params={"repo": repo}, json={"status": "proposed"})
    assert r.json()["status"] == "proposed"

    # Al crear con estado inicial no hay `item.status` (el `created` ya lo
    # trae); la reafirmación sí, como edición.
    assert _tipos(client, repo) == [
        "item.created",
        "item.created",
        "item.created",
        "item.updated",
    ]
    r = client.get("/items", params={"repo": repo, "status": "proposed"})
    assert [i["uid"] for i in r.json()] == uids  # la posición se conserva


def test_editar_sin_estado_emite_edicion(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    uid = client.post("/items", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    client.patch(f"/items/{uid}", params={"repo": repo}, json={"title": "A2", "description": "x"})
    assert _tipos(client, repo) == ["item.created", "item.updated"]
