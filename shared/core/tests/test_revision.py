"""`/revision` cuenta el log además del mapa.

La firma que mira la UI (`useRepo`) no puede depender solo de
`PRAGMA data_version`: es por conexión y un vigilante nuevo vuelve a empezar
su cuenta. `ultimo_evento` sale del propio almacén, así que un evento escrito
por SQL mueve la firma aunque no se toque ningun ítem.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing

from events_core import items


def _revision(client, repo):  # noqa: ANN001, ANN202
    r = client.get("/revision", params={"repo": repo})
    assert r.status_code == 200, r.json()
    return r.json()


def test_almacen_sin_eventos_cuenta_cero(client, repo):  # noqa: ANN001, ANN202
    assert _revision(client, repo)["ultimo_evento"] == 0


def test_un_evento_mueve_la_firma_sin_tocar_items(client, repo):  # noqa: ANN001, ANN202
    antes = _revision(client, repo)
    with closing(sqlite3.connect(items.db_file_for(repo))) as conn:
        conn.execute(
            "INSERT INTO event (ts, type, payload) "
            "VALUES ('2026-11-18T00:00:00Z', 'externo.testigo', '{}')"
        )
        conn.commit()

    despues = _revision(client, repo)
    assert despues["items"] == antes["items"] == 0
    assert (antes["ultimo_evento"], despues["ultimo_evento"]) == (0, 1)


def test_el_vaciado_baja_la_firma(client, repo):  # noqa: ANN001, ANN202
    assert _revision(client, repo)["ultimo_evento"] == 0
    with closing(sqlite3.connect(items.db_file_for(repo))) as conn:
        conn.executemany(
            "INSERT INTO event (ts, type, payload) "
            "VALUES ('2026-11-18T00:00:00Z', 'externo.testigo', ?)",
            [('{"n": 1}',), ('{"n": 2}',)],
        )
        conn.commit()
    assert _revision(client, repo)["ultimo_evento"] == 2

    client.post("/reiniciar", params={"repo": repo})
    assert _revision(client, repo)["ultimo_evento"] == 0
