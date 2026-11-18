"""Un PATCH que cambia de estado emite `idea.status`; uno que no, edición.

Reafirmar el mismo estado no es un traslado: la cola no se reordena (su
posición se conserva) y el evento que sale es `idea.updated`, no `idea.status`.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from events_core import ideas


def _sembrar_event(repo) -> None:  # noqa: ANN001, ANN202
    """La tabla del log como la deja la app (el productor la crea de verdad)."""
    ideas.ensure_repo(repo)
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    conn.executescript((Path(ideas.SCHEMA_DIR) / "eventos.sql").read_text(encoding="utf-8"))
    conn.commit()
    conn.close()


def _tipos(client, repo):  # noqa: ANN001, ANN202
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    tipos = [r[0] for r in conn.execute("SELECT type FROM event ORDER BY id")]
    conn.close()
    return tipos


def test_reafirmar_estado_emite_edicion_y_no_reordena(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    uids = [
        client.post(
            "/ideas",
            params={"repo": repo},
            json={"title": f"Idea {i}", "status": "proposed"},
        ).json()["uid"]
        for i in (1, 2, 3)
    ]
    # Reafirmar `proposed` sobre la primera: no hay traslado ni reordenación.
    r = client.patch(f"/ideas/{uids[0]}", params={"repo": repo}, json={"status": "proposed"})
    assert r.json()["status"] == "proposed"

    # Al crear con estado inicial no hay `idea.status` (el `created` ya lo
    # trae); la reafirmación sí, como edición.
    assert _tipos(client, repo) == [
        "idea.created",
        "idea.created",
        "idea.created",
        "idea.updated",
    ]
    r = client.get("/ideas", params={"repo": repo, "status": "proposed"})
    assert [i["uid"] for i in r.json()] == uids  # la posición se conserva


def test_editar_sin_estado_emite_edicion(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    uid = client.post("/ideas", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"title": "A2", "description": "x"})
    assert _tipos(client, repo) == ["idea.created", "idea.updated"]
