"""La 0034: las tablas `idea_*` pasan a `work_item_*` sin copiar filas.

Renombrado puro con `ALTER TABLE … RENAME TO` y `RENAME COLUMN`, así que lo que
se comprueba es que los datos, las claves foráneas y los índices sobreviven al
cambio de nombre. El almacén de partida es real: uno recién creado al que se le
deshace la 0034 (`bajar_a_la_0033`) después de llenarlo.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing

from events_core import items

_TABLAS_NUEVAS = {
    "work_item_data",
    "work_item_node",
    "work_item_fase",
    "work_item_requisito",
    "work_item_foto",
    "work_item_fase_archivo",
}
_TABLAS_VIEJAS = {
    "idea_data",
    "idea_node",
    "idea_fase",
    "idea_requisito",
    "idea_foto",
    "idea_fase_archivo",
}
_INDICES_NUEVOS = {
    "work_item_cola_orden",
    "work_item_roadmap_unico",
    "work_item_node_estado",
    "work_item_node_estado_fecha",
    "migracion_item_uid",
}


def test_la_0034_renombra_tablas_y_columnas_con_los_datos_dentro(
    repo,  # noqa: ANN001
    bajar_a_la_0033,  # noqa: ANN001
):  # noqa: ANN202
    db = items.init_repo(repo)
    uid = items.create_item(
        repo,
        title="Vieja",
        fases=[{"titulo": "Preparar", "requisitos": [{"titulo": "Uno"}]}],
    )["uid"]

    # Las tres tablas que no llena el alta, con su fila para verlas cruzar.
    with closing(sqlite3.connect(str(db))) as conn:
        conn.execute(
            "INSERT INTO work_item_foto (work_item_uid, ts, archivos)"
            " VALUES (?, '2026-11-23T00:00:00Z', '')",
            (uid,),
        )
        conn.execute(
            "INSERT INTO work_item_fase_archivo"
            " (work_item_uid, fase_orden, requisito_orden, ruta, estado)"
            " VALUES (?, 1, 0, 'a.py', 'modificado')",
            (uid,),
        )
        conn.execute(
            "INSERT INTO migracion_lote (id, plan_sha256, creado_at, ideas)"
            " VALUES ('lote', 'huella', '2026-11-23T00:00:00Z', 1)"
        )
        conn.execute(
            "INSERT INTO migracion_item"
            " (lote_id, work_item_uid, ref, ruta, desde_linea, hasta_linea, sha256, creada_at)"
            " VALUES ('lote', ?, 'r', 'doc.md', 1, 2, 'hash', '2026-11-23T00:00:00Z')",
            (uid,),
        )
        conn.commit()

    bajar_a_la_0033(db, 33)

    # El punto de partida es la 0033 de verdad: nombres viejos y datos dentro.
    with closing(sqlite3.connect(str(db))) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 33
        assert conn.execute("SELECT count(*) FROM idea_data").fetchone()[0] == 1
        assert conn.execute("SELECT idea_uid FROM idea_fase").fetchone()[0] == uid
        assert conn.execute("SELECT idea_uid FROM migracion_idea").fetchone()[0] == uid

    items.ensure_repo(repo)

    with closing(sqlite3.connect(str(db))) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 35
        tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert _TABLAS_NUEVAS.issubset(tablas)
        assert not (_TABLAS_VIEJAS & tablas)

        columnas = {r[1] for r in conn.execute("PRAGMA table_info('work_item_fase')")}
        assert "work_item_uid" in columnas
        assert "idea_uid" not in columnas
        columnas = {r[1] for r in conn.execute("PRAGMA table_info('migracion_item')")}
        assert "work_item_uid" in columnas
        assert "idea_uid" not in columnas

        assert conn.execute("SELECT count(*) FROM work_item_requisito").fetchone()[0] == 1
        assert conn.execute("SELECT work_item_uid FROM work_item_foto").fetchone()[0] == uid
        assert conn.execute("SELECT work_item_uid FROM migracion_item").fetchone()[0] == uid
        assert conn.execute("SELECT count(*) FROM work_item_fase_archivo").fetchone()[0] == 1
        assert conn.execute("PRAGMA foreign_key_check").fetchall() == []

        indices = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        assert _INDICES_NUEVOS.issubset(indices)
        assert not any(nombre.startswith("idea_") for nombre in indices)

    ficha = items.get_item(repo, uid)
    assert ficha["title"] == "Vieja"
    assert [fase["titulo"] for fase in ficha["fases"]] == ["Preparar"]


def test_la_0035_renombra_el_lote_sin_tocar_datos(
    repo,  # noqa: ANN001
    bajar_a_la_0033,  # noqa: ANN001
):  # noqa: ANN202
    db = items.init_repo(repo)
    uid = items.create_item(repo, title="A")["uid"]

    with closing(sqlite3.connect(str(db))) as conn:
        conn.execute(
            "INSERT INTO migracion_lote (id, plan_sha256, creado_at, ideas)"
            " VALUES ('lote', 'huella', '2026-11-23T00:00:00Z', 1)"
        )
        conn.execute(
            "INSERT INTO migracion_item"
            " (lote_id, work_item_uid, ref, ruta, desde_linea, hasta_linea, sha256, creada_at)"
            " VALUES ('lote', ?, 'r', 'doc.md', 1, 2, 'hash', '2026-11-23T00:00:00Z')",
            (uid,),
        )
        conn.commit()

    bajar_a_la_0033(db, 34)

    # En la 0034 la tabla del lote todavía se llamaba `migracion_idea`.
    with closing(sqlite3.connect(str(db))) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 34
        tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "migracion_idea" in tablas
        assert conn.execute("SELECT work_item_uid FROM migracion_idea").fetchone()[0] == uid

    items.ensure_repo(repo)

    with closing(sqlite3.connect(str(db))) as conn:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 35
        tablas = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert "migracion_item" in tablas
        assert "migracion_idea" not in tablas
        assert conn.execute("SELECT work_item_uid FROM migracion_item").fetchone()[0] == uid
        indices = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'")}
        assert "migracion_item_uid" in indices
