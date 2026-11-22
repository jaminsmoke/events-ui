"""Aplicar un plan: lote, transacción, procedencia e idempotencia."""

from __future__ import annotations

import hashlib
from contextlib import closing

from events_core import ideas


def _plan(tmp_path):
    archivo = tmp_path / "docs" / "backlog.md"
    archivo.parent.mkdir(parents=True, exist_ok=True)
    archivo.write_text("# Backlog\n\n## Uno\n\n- [ ] a\n\n## Dos\n\n- [ ] b\n", encoding="utf-8")
    sha = hashlib.sha256(archivo.read_bytes()).hexdigest()

    def origen(desde, hasta):
        return {
            "ruta": "docs/backlog.md",
            "desde_linea": desde,
            "hasta_linea": hasta,
            "sha256": sha,
        }

    return {
        "version": 1,
        "ideas": [
            {
                "ref": "uno",
                "title": "Uno",
                "description": "Primera.",
                "status": "proposed",
                "kind": "idea",
                "tags": ["backlog"],
                "origen": origen(3, 5),
                "fases": [
                    {
                        "titulo": "Preparar",
                        "requisitos": [{"titulo": "Listo"}],
                    }
                ],
            },
            {
                "ref": "dos",
                "title": "Dos",
                "status": "proposed",
                "kind": "idea",
                "depende_de": ["uno"],
                "origen": origen(7, 9),
            },
        ],
    }


def test_aplicar_crea_el_lote_completo(client, tmp_path) -> None:
    plan = _plan(tmp_path)

    respuesta = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan)

    assert respuesta.status_code == 200, respuesta.text
    datos = respuesta.json()
    assert datos["repetido"] is False
    assert datos["ideas"] == 2
    uids = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}

    primera = client.get(f"/ideas/{uids['uno']}", params={"repo": str(tmp_path)}).json()
    segunda = client.get(f"/ideas/{uids['dos']}", params={"repo": str(tmp_path)}).json()
    assert primera["status"] == "proposed"
    assert primera["title"] == "Uno"
    assert primera["description"] == "Primera."
    assert primera["tags"] == ["backlog"]
    assert primera["fases"][0]["titulo"] == "Preparar"
    assert primera["fases"][0]["estado"] == "pendiente"
    assert primera["fases"][0]["requisitos"][0]["hecho"] is False
    assert segunda["depende_de"] == [uids["uno"]]

    with closing(ideas.connect(ideas.ensure_repo(str(tmp_path)))) as conn:
        lote = conn.execute("SELECT ideas, plan_sha256 FROM migracion_lote").fetchone()
        assert lote["ideas"] == 2
        assert lote["plan_sha256"] == datos["plan_sha256"]
        filas = conn.execute(
            "SELECT ref, ruta, desde_linea, hasta_linea, sha256 FROM migracion_idea ORDER BY rowid"
        ).fetchall()
        assert [fila["ref"] for fila in filas] == ["uno", "dos"]
        assert filas[0]["ruta"] == "docs/backlog.md"
        assert (filas[0]["desde_linea"], filas[0]["hasta_linea"]) == (3, 5)
        tipos = {fila["type"] for fila in conn.execute("SELECT type FROM event")}
        assert {"idea.created", "migracion.aplicada"} <= tipos


def test_repetir_el_plan_no_duplica(client, tmp_path) -> None:
    plan = _plan(tmp_path)
    primero = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan).json()

    segundo = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan).json()

    assert segundo["repetido"] is True
    assert segundo["lote"] == primero["lote"]
    assert segundo["creadas"] == primero["creadas"]
    assert len(client.get("/ideas", params={"repo": str(tmp_path)}).json()) == 2


def test_un_origen_cambiado_no_aplica_nada(client, tmp_path) -> None:
    plan = _plan(tmp_path)
    (tmp_path / "docs" / "backlog.md").write_text("# otro\n", encoding="utf-8")

    respuesta = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan)

    assert respuesta.status_code == 400
    assert "cambió" in respuesta.json()["detail"]
    assert client.get("/ideas", params={"repo": str(tmp_path)}).json() == []


def test_el_contrato_rechaza_otro_estado(client, tmp_path) -> None:
    plan = _plan(tmp_path)
    plan["ideas"][0]["status"] = "roadmap"

    respuesta = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan)

    assert respuesta.status_code == 422
    assert client.get("/ideas", params={"repo": str(tmp_path)}).json() == []


def test_undo_borra_el_lote(client, tmp_path) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 200, respuesta.text
    deshecho = respuesta.json()
    assert deshecho["borradas"] == 2
    assert deshecho["ausentes"] == 0
    assert client.get("/ideas", params={"repo": str(tmp_path)}).json() == []
    with closing(ideas.connect(ideas.ensure_repo(str(tmp_path)))) as conn:
        assert conn.execute("SELECT count(*) FROM migracion_lote").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM migracion_idea").fetchone()[0] == 0
        tipos = {fila["type"] for fila in conn.execute("SELECT type FROM event")}
        assert "migracion.deshacer" in tipos


def test_undo_se_niega_si_la_idea_cambio_de_carril(client, tmp_path) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()
    uid = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}["uno"]
    assert (
        client.patch(
            f"/ideas/{uid}", params={"repo": str(tmp_path)}, json={"status": "roadmap"}
        ).status_code
        == 200
    )

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 409
    assert "roadmap" in respuesta.json()["detail"]
    assert len(client.get("/ideas", params={"repo": str(tmp_path)}).json()) == 2


def test_undo_se_niega_si_la_idea_se_edito(client, tmp_path) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()
    uid = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}["dos"]
    with closing(ideas.connect(ideas.ensure_repo(str(tmp_path)))) as conn:
        conn.execute(
            "UPDATE idea_data SET updated_at = '2020-01-01T00:00:00+00:00' WHERE uid = ?", (uid,)
        )
        conn.commit()

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 409
    assert "se editó" in respuesta.json()["detail"]
    assert len(client.get("/ideas", params={"repo": str(tmp_path)}).json()) == 2


def test_undo_salta_las_ideas_que_ya_no_estaban(client, tmp_path) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()
    uid = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}["dos"]
    assert client.delete(f"/ideas/{uid}", params={"repo": str(tmp_path)}).status_code == 204

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 200
    assert respuesta.json()["borradas"] == 1
    assert respuesta.json()["ausentes"] == 1
    assert client.get("/ideas", params={"repo": str(tmp_path)}).json() == []


def test_undo_lote_inexistente(client, tmp_path) -> None:
    respuesta = client.delete("/migracion/lotes/no-existe", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 404


def test_fallo_al_deshacer_no_borra_nada(client, tmp_path, monkeypatch) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()
    from events_core.ideas import migracion as lote

    llamadas = {"n": 0}
    original = lote._emitir

    def falla(conn, tipo, payload):
        if tipo == "idea.deleted":
            llamadas["n"] += 1
            if llamadas["n"] == 2:
                raise RuntimeError("fallo simulado")
        original(conn, tipo, payload)

    monkeypatch.setattr(lote, "_emitir", falla)

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 500
    assert len(client.get("/ideas", params={"repo": str(tmp_path)}).json()) == 2
    with closing(ideas.connect(ideas.ensure_repo(str(tmp_path)))) as conn:
        assert conn.execute("SELECT count(*) FROM migracion_lote").fetchone()[0] == 1


def test_fallo_a_mitad_deshace_el_lote(client, tmp_path, monkeypatch) -> None:
    from events_core.ideas import migracion as lote

    llamadas = {"n": 0}
    original = lote._emitir

    def falla(conn, tipo, payload):
        llamadas["n"] += 1
        if llamadas["n"] == 2:
            raise RuntimeError("fallo simulado")
        original(conn, tipo, payload)

    monkeypatch.setattr(lote, "_emitir", falla)

    respuesta = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    )

    assert respuesta.status_code == 500
    assert client.get("/ideas", params={"repo": str(tmp_path)}).json() == []
    with closing(ideas.connect(ideas.ensure_repo(str(tmp_path)))) as conn:
        assert conn.execute("SELECT count(*) FROM migracion_lote").fetchone()[0] == 0
