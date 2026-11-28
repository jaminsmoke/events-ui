"""Aplicar un plan: lote, transacción, procedencia e idempotencia."""

from __future__ import annotations

import hashlib
import json
from contextlib import closing

from events_core import items


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
    assert datos["items"] == 2
    uids = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}

    primera = client.get(f"/items/{uids['uno']}", params={"repo": str(tmp_path)}).json()
    segunda = client.get(f"/items/{uids['dos']}", params={"repo": str(tmp_path)}).json()
    assert primera["status"] == "proposed"
    assert primera["title"] == "Uno"
    assert primera["description"] == "Primera."
    assert primera["tags"] == ["backlog"]
    assert primera["fases"][0]["titulo"] == "Preparar"
    assert primera["fases"][0]["estado"] == "pendiente"
    assert primera["fases"][0]["requisitos"][0]["hecho"] is False
    assert segunda["depende_de"] == [uids["uno"]]

    with closing(items.connect(items.ensure_repo(str(tmp_path)))) as conn:
        lote = conn.execute("SELECT ideas, plan_sha256 FROM migracion_lote").fetchone()
        assert lote["ideas"] == 2
        assert lote["plan_sha256"] == datos["plan_sha256"]
        filas = conn.execute(
            "SELECT ref, ruta, desde_linea, hasta_linea, sha256 FROM migracion_item ORDER BY rowid"
        ).fetchall()
        assert [fila["ref"] for fila in filas] == ["uno", "dos"]
        assert filas[0]["ruta"] == "docs/backlog.md"
        assert (filas[0]["desde_linea"], filas[0]["hasta_linea"]) == (3, 5)
        tipos = {fila["type"] for fila in conn.execute("SELECT type FROM event")}
        assert {"item.created", "migracion.aplicada"} <= tipos


def test_aplicar_destinos_fechas_y_firma(client, tmp_path) -> None:
    archivo = tmp_path / "docs" / "backlog.md"
    archivo.parent.mkdir(parents=True, exist_ok=True)
    archivo.write_text("# Backlog\n\n## Uno\n\n- [ ] a\n", encoding="utf-8")
    sha = hashlib.sha256(archivo.read_bytes()).hexdigest()

    def item(ref, title, status, **extra):
        return {
            "ref": ref,
            "title": title,
            "description": "",
            "content": "",
            "kind": "idea",
            "status": status,
            "origen": {
                "ruta": "docs/backlog.md",
                "desde_linea": 3,
                "hasta_linea": 5,
                "sha256": sha,
            },
            **extra,
        }

    plan = {
        "version": 2,
        "ideas": [
            item("prop", "Prop", "proposed"),
            item("draft", "Draft", "draft"),
            item("hist", "Hist", "historial", fecha="2025-03-04T10:00:00+02:00"),
            item("rech", "Rech", "rejected", motivo="duplicada", fecha="2025-03-05"),
        ],
    }

    respuesta = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan)
    assert respuesta.status_code == 200, respuesta.text
    datos = respuesta.json()
    uids = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}

    historial = client.get(f"/items/{uids['hist']}", params={"repo": str(tmp_path)}).json()
    assert historial["status"] == "historial"
    assert historial["revision_approved_by"] == "sistema"
    assert historial["revision_nota"] == "Importado de docs/backlog.md"
    assert historial["revision_approved_at"] == "2025-03-04T08:00:00+00:00"
    assert historial["fases"] == []

    rechazada = client.get(f"/items/{uids['rech']}", params={"repo": str(tmp_path)}).json()
    assert rechazada["status"] == "rejected"
    assert rechazada["rejected_by"] == "sistema"
    assert rechazada["rejected_description"] == "duplicada"
    assert rechazada["rejected_at"] == "2025-03-05T00:00:00+00:00"

    borrador = client.get(f"/items/{uids['draft']}", params={"repo": str(tmp_path)}).json()
    assert borrador["status"] == "draft"

    with closing(items.connect(items.ensure_repo(str(tmp_path)))) as conn:
        estados = {
            fila["ref"]: fila["estado"]
            for fila in conn.execute("SELECT ref, estado FROM migracion_item")
        }
    assert estados == {
        "prop": "proposed",
        "draft": "draft",
        "hist": "historial",
        "rech": "rejected",
    }

    deshecho = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})
    assert deshecho.status_code == 200, deshecho.text
    assert deshecho.json()["borradas"] == 4
    assert client.get("/items", params={"repo": str(tmp_path)}).json() == []


def test_repetir_el_plan_no_duplica(client, tmp_path) -> None:
    plan = _plan(tmp_path)
    primero = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan).json()

    segundo = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan).json()

    assert segundo["repetido"] is True
    assert segundo["lote"] == primero["lote"]
    assert segundo["creadas"] == primero["creadas"]
    assert len(client.get("/items", params={"repo": str(tmp_path)}).json()) == 2


def test_un_origen_cambiado_no_aplica_nada(client, tmp_path) -> None:
    plan = _plan(tmp_path)
    (tmp_path / "docs" / "backlog.md").write_text("# otro\n", encoding="utf-8")

    respuesta = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan)

    assert respuesta.status_code == 400
    assert "cambió" in respuesta.json()["detail"]
    assert client.get("/items", params={"repo": str(tmp_path)}).json() == []


def test_el_contrato_rechaza_otro_estado(client, tmp_path) -> None:
    plan = _plan(tmp_path)
    plan["ideas"][0]["status"] = "roadmap"

    respuesta = client.post("/migracion/aplicar", params={"repo": str(tmp_path)}, json=plan)

    assert respuesta.status_code == 422
    assert client.get("/items", params={"repo": str(tmp_path)}).json() == []


def test_el_cli_recorre_check_apply_repetido_y_undo(client, tmp_path, monkeypatch, capsys) -> None:
    """El mismo camino que recorre un agente: `eui migrate` contra el core, con
    el plan en disco, un `depende_de` entre refs y el lote repetido."""
    from urllib.parse import urlsplit

    from events_core import cli

    plan = _plan(tmp_path)
    plan["ideas"][1]["depende_de"] = [plan["ideas"][0]["ref"]]
    fichero = tmp_path / "plan.json"
    fichero.write_text(json.dumps(plan), encoding="utf-8")

    def puente(url: str) -> str:
        partes = urlsplit(url)
        return partes.path + (f"?{partes.query}" if partes.query else "")

    def respuesta(r):  # noqa: ANN001, ANN202
        cuerpo = r.json() if r.content else None
        detalle = None if r.status_code < 400 else r.text
        return (cuerpo, detalle, r.status_code)

    monkeypatch.setattr(cli, "_get", lambda url: respuesta(client.get(puente(url))))
    monkeypatch.setattr(
        cli, "_post", lambda url, datos: respuesta(client.post(puente(url), json=datos))
    )
    monkeypatch.setattr(cli, "_delete", lambda url: respuesta(client.delete(puente(url))))

    def correr(*args: str) -> dict:
        assert cli.main([*args, "--repo", str(tmp_path), "--json"]) == 0
        return json.loads(capsys.readouterr().out)

    assert correr("migrate", "check", str(fichero))["ok"] is True

    aplicado = correr("migrate", "apply", str(fichero))
    assert aplicado["repetido"] is False
    assert aplicado["items"] == 2

    repetido = correr("migrate", "apply", str(fichero))
    assert repetido["repetido"] is True
    assert repetido["lote"] == aplicado["lote"]

    items = client.get("/items", params={"repo": str(tmp_path)}).json()
    assert len(items) == 2
    assert all(item["status"] == "proposed" for item in items)
    uids = {creada["ref"]: creada["uid"] for creada in aplicado["creadas"]}
    dependiente = next(item for item in items if item["uid"] == uids["dos"])
    assert dependiente["depende_de"] == [uids["uno"]]

    deshecho = correr("migrate", "undo", aplicado["lote"])
    assert deshecho["borradas"] == 2
    assert client.get("/items", params={"repo": str(tmp_path)}).json() == []


def test_undo_borra_el_lote(client, tmp_path) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 200, respuesta.text
    deshecho = respuesta.json()
    assert deshecho["borradas"] == 2
    assert deshecho["ausentes"] == 0
    assert client.get("/items", params={"repo": str(tmp_path)}).json() == []
    with closing(items.connect(items.ensure_repo(str(tmp_path)))) as conn:
        assert conn.execute("SELECT count(*) FROM migracion_lote").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM migracion_item").fetchone()[0] == 0
        tipos = {fila["type"] for fila in conn.execute("SELECT type FROM event")}
        assert "migracion.deshacer" in tipos


def test_undo_se_niega_si_la_item_cambio_de_carril(client, tmp_path) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()
    uid = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}["uno"]
    assert (
        client.patch(
            f"/items/{uid}", params={"repo": str(tmp_path)}, json={"status": "roadmap"}
        ).status_code
        == 200
    )

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 409
    assert "roadmap" in respuesta.json()["detail"]
    assert len(client.get("/items", params={"repo": str(tmp_path)}).json()) == 2


def test_undo_se_niega_si_la_item_se_edito(client, tmp_path) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()
    uid = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}["dos"]
    with closing(items.connect(items.ensure_repo(str(tmp_path)))) as conn:
        conn.execute(
            "UPDATE work_item_data SET updated_at = '2020-01-01T00:00:00+00:00' WHERE uid = ?",
            (uid,),
        )
        conn.commit()

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 409
    assert "se editó" in respuesta.json()["detail"]
    assert len(client.get("/items", params={"repo": str(tmp_path)}).json()) == 2


def test_undo_salta_las_items_que_ya_no_estaban(client, tmp_path) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()
    uid = {creada["ref"]: creada["uid"] for creada in datos["creadas"]}["dos"]
    assert (
        client.patch(
            f"/items/{uid}",
            params={"repo": str(tmp_path)},
            json={"status": "rejected", "rejected_description": "fuera del lote"},
        ).status_code
        == 200
    )
    assert client.delete(f"/items/{uid}", params={"repo": str(tmp_path)}).status_code == 204

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 200
    assert respuesta.json()["borradas"] == 1
    assert respuesta.json()["ausentes"] == 1
    assert client.get("/items", params={"repo": str(tmp_path)}).json() == []


def test_undo_lote_inexistente(client, tmp_path) -> None:
    respuesta = client.delete("/migracion/lotes/no-existe", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 404


def test_fallo_al_deshacer_no_borra_nada(client, tmp_path, monkeypatch) -> None:
    datos = client.post(
        "/migracion/aplicar", params={"repo": str(tmp_path)}, json=_plan(tmp_path)
    ).json()
    from events_core.items import migracion as lote

    llamadas = {"n": 0}
    original = lote._emitir

    def falla(conn, tipo, payload):
        if tipo == "item.deleted":
            llamadas["n"] += 1
            if llamadas["n"] == 2:
                raise RuntimeError("fallo simulado")
        original(conn, tipo, payload)

    monkeypatch.setattr(lote, "_emitir", falla)

    respuesta = client.delete(f"/migracion/lotes/{datos['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 500
    assert len(client.get("/items", params={"repo": str(tmp_path)}).json()) == 2
    with closing(items.connect(items.ensure_repo(str(tmp_path)))) as conn:
        assert conn.execute("SELECT count(*) FROM migracion_lote").fetchone()[0] == 1


def test_fallo_a_mitad_deshace_el_lote(client, tmp_path, monkeypatch) -> None:
    from events_core.items import migracion as lote

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
    assert client.get("/items", params={"repo": str(tmp_path)}).json() == []
    with closing(items.connect(items.ensure_repo(str(tmp_path)))) as conn:
        assert conn.execute("SELECT count(*) FROM migracion_lote").fetchone()[0] == 0
