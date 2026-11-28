"""Niveles: de qué color va cada evento y la etiqueta del registro.

- El evento trae `nivel` derivado de su tipo (`item.deleted` → aviso, el
  resto info), salvo que el `payload` traiga `nivel` explícito.
- El registro de la app admite filtro `?origen=` (la etiqueta: `core`,
  `seed`, `reiniciar`, `compactar`…).
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from events_core import items


def _sembrar_event(repo) -> None:  # noqa: ANN001, ANN202
    """La tabla del log del repo (el productor la crea de verdad)."""
    items.ensure_repo(repo)
    conn = sqlite3.connect(str(items.db_file_for(repo)))
    conn.executescript((Path(items.SCHEMA_DIR) / "eventos.sql").read_text(encoding="utf-8"))
    conn.commit()
    conn.close()


def test_nivel_por_tipo(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    uid = client.post("/items", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    assert (
        client.patch(
            f"/items/{uid}",
            params={"repo": repo},
            json={"status": "rejected", "rejected_description": "log"},
        ).status_code
        == 200
    )
    client.delete(f"/items/{uid}", params={"repo": repo})

    eventos = client.get("/eventos", params={"repo": repo}).json()
    por_tipo = {e["type"]: e["nivel"] for e in eventos}
    assert por_tipo["item.created"] == "info"
    assert por_tipo["item.deleted"] == "aviso"


def test_un_log_viejo_sigue_coloreando(client, repo):  # noqa: ANN001, ANN202
    """Lo escrito como `idea.*` antes de la 0034 conserva su nivel."""
    _sembrar_event(repo)
    conn = sqlite3.connect(str(items.db_file_for(repo)))
    conn.execute(
        "INSERT INTO event (ts, type, payload, origen) VALUES ('2026-11-18T00:00:00Z',"
        " 'idea.deleted', '{\"uid\": \"x\"}', 'idea')"
    )
    conn.commit()
    conn.close()

    eventos = client.get("/eventos", params={"repo": repo}).json()
    assert [(e["type"], e["nivel"]) for e in eventos] == [("idea.deleted", "aviso")]


def test_nivel_de_payload_manda(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    conn = sqlite3.connect(str(items.db_file_for(repo)))
    conn.execute(
        "INSERT INTO event (ts, type, payload, origen) VALUES ('2026-11-18T00:00:00Z',"
        " 'sistema.alerta', '{\"nivel\": \"error\"}', 'externo')"
    )
    conn.commit()
    conn.close()

    eventos = client.get("/eventos", params={"repo": repo}).json()
    assert eventos[0]["nivel"] == "error"


def test_filtro_origen_en_registro(client, repo):  # noqa: ANN001, ANN202
    # Una entrada con etiqueta (el reinicio la escribe con `reiniciar`).
    client.post("/reiniciar", params={"repo": repo})

    del_reinicio = client.get("/log", params={"origen": "reiniciar"}).json()
    assert any(str(e["origen"]) == "reiniciar" for e in del_reinicio)

    del_core = client.get("/log", params={"origen": "core"}).json()
    assert all(str(e["origen"]) == "core" for e in del_core)

    todos = client.get("/log").json()
    assert len(del_reinicio) + len(del_core) <= len(todos)
