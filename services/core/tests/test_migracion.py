"""Escaneo de Markdown: reconocimiento, límites, orden y CLI."""

from __future__ import annotations

import hashlib
import json

import pytest

from events_core import cli, config, migracion
from events_core.items.base.comun import InvalidInput


def test_escanear_reconoce_el_markdown(tmp_path) -> None:
    archivo = tmp_path / "docs" / "backlog.md"
    archivo.parent.mkdir()
    texto = (
        "---\n"
        "titulo: Backlog\n"
        "estado: viejo\n"
        "---\n"
        "\n"
        "# Backlog\n"
        "\n"
        "## Ideas\n"
        "\n"
        "- [ ] una\n"
        "- [x] otra\n"
        "\n"
        "```md\n"
        "## no cuenta\n"
        "- [ ] tampoco\n"
        "```\n"
    )
    archivo.write_text(texto, encoding="utf-8")

    informe = migracion.escanear(tmp_path, "docs")

    assert informe["ruta"] == "docs"
    assert informe["resumen"] == {"archivos": 1, "secciones": 1, "tareas": 2}
    assert informe["recortado"] is False
    (ficha,) = informe["archivos"]
    assert ficha["ruta"] == "docs/backlog.md"
    assert ficha["frontmatter"] == {"titulo": "Backlog", "estado": "viejo"}
    assert [titulo["texto"] for titulo in ficha["titulos"]] == ["Backlog", "Ideas"]
    assert ficha["tareas"] == {"total": 2, "hechas": 1}
    assert ficha["sha256"] == hashlib.sha256(archivo.read_bytes()).hexdigest()
    assert ficha["lineas"] == len(texto.splitlines())


def test_scan_ignora_ruido_y_ordena(tmp_path) -> None:
    for ruta in [
        "z.markdown",
        "b.md",
        "a.md",
        "notas.txt",
        ".git/dentro.md",
        "node_modules/dentro.md",
    ]:
        archivo = tmp_path / ruta
        archivo.parent.mkdir(parents=True, exist_ok=True)
        archivo.write_text("# t\n", encoding="utf-8")

    informe = migracion.escanear(tmp_path)

    assert [ficha["ruta"] for ficha in informe["archivos"]] == ["a.md", "b.md", "z.markdown"]


def test_scan_de_un_archivo_suelto(tmp_path) -> None:
    (tmp_path / "uno.md").write_text("## Uno\n", encoding="utf-8")

    informe = migracion.escanear(tmp_path, "uno.md")

    assert informe["ruta"] == "uno.md"
    assert [ficha["ruta"] for ficha in informe["archivos"]] == ["uno.md"]


def test_scan_no_sale_del_repo(tmp_path) -> None:
    with pytest.raises(InvalidInput):
        migracion.escanear(tmp_path, "..")


def test_scan_de_una_ruta_que_no_existe(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        migracion.escanear(tmp_path, "no-existe")


def test_scan_exige_markdown_si_es_un_fichero(tmp_path) -> None:
    (tmp_path / "notas.txt").write_text("x", encoding="utf-8")

    with pytest.raises(InvalidInput):
        migracion.escanear(tmp_path, "notas.txt")


def test_cli_migrate_scan_json(tmp_path, capsys) -> None:
    (tmp_path / "a.md").write_text("# Hola\n\n## Uno\n", encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "scan", "--json"]) == 0
    informe = json.loads(capsys.readouterr().out)
    assert informe["archivos"][0]["ruta"] == "a.md"
    assert informe["resumen"]["secciones"] == 1


def test_cli_migrate_scan_humano(tmp_path, capsys) -> None:
    (tmp_path / "a.md").write_text("- [ ] una\n", encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "scan"]) == 0
    salida = capsys.readouterr().out
    assert "a.md" in salida
    assert "1 tareas" in salida


def test_cli_migrate_sin_raiz(capsys) -> None:
    assert cli.main(["migrate", "scan"]) == 2
    assert "no hay raíz" in capsys.readouterr().err


def test_cli_migrate_ruta_invalida(tmp_path, capsys) -> None:
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "scan", ".."]) == 2
    assert "dentro del repo" in capsys.readouterr().err


def test_esquema_del_plan_cierra_lo_que_no_se_negocia() -> None:
    esquema = migracion.ESQUEMA_PLAN
    item = esquema["$defs"]["idea"]
    origen = esquema["$defs"]["origen"]
    documento = esquema["$defs"]["documento"]

    assert esquema["$id"] == "urn:events-ui:plan-migracion:1"
    assert set(esquema["required"]) == {"version", "ideas"}
    assert esquema["properties"]["version"]["enum"] == [1, 2, 3]
    assert item["required"] == ["ref", "title", "origen"]
    assert set(item["properties"]["status"]["enum"]) == {
        "proposed",
        "draft",
        "historial",
        "rejected",
    }
    assert item["properties"]["kind"]["const"] == "idea"
    assert origen["required"] == ["ruta", "desde_linea", "hasta_linea", "sha256"]
    assert origen["properties"]["sha256"]["pattern"] == "^[0-9a-f]{64}$"
    assert esquema["$defs"]["fase"]["properties"]["estado"]["enum"] == ["pendiente"]
    assert esquema["$defs"]["requisito"]["properties"]["hecho"]["const"] is False
    assert documento["required"] == ["ruta", "clase", "motivo", "destino"]
    assert set(documento["properties"]["clase"]["enum"]) == {
        "mapa",
        "referencia",
        "parcial",
    }


def test_cli_schema_migrate_pretty(capsys) -> None:
    assert cli.main(["schema", "migrate", "--pretty"]) == 0
    esquema = json.loads(capsys.readouterr().out)
    assert esquema["title"] == "Plan de migración de Markdown"


def test_cli_schema_migrate_en_una_linea(capsys) -> None:
    assert cli.main(["schema", "migrate"]) == 0
    salida = capsys.readouterr().out.strip()
    assert "\n" not in salida
    assert set(json.loads(salida)["$defs"]["idea"]["properties"]["status"]["enum"]) == {
        "proposed",
        "draft",
        "historial",
        "rejected",
    }


def test_plan_v2_acepta_los_cuatro_destinos(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["version"] = 2
    base = plan["ideas"][0]
    plan["ideas"] = [
        {**base, "ref": "prop", "title": "Prop", "status": "proposed"},
        {**base, "ref": "draft", "title": "Draft", "status": "draft"},
        {
            **base,
            "ref": "hist",
            "title": "Hist",
            "status": "historial",
            "fecha": "2025-03-04",
        },
        {
            **base,
            "ref": "rech",
            "title": "Rech",
            "status": "rejected",
            "motivo": "duplicada",
            "fecha": "2025-03-05T10:00:00+02:00",
        },
    ]

    informe = migracion.revisar(tmp_path, plan)

    assert informe["ok"] is True
    assert {crear["status"] for crear in informe["crear"]} == {
        "proposed",
        "draft",
        "historial",
        "rejected",
    }


def test_plan_v1_solo_admite_proposed(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["ideas"][0]["status"] = "draft"

    errores = migracion.revisar(tmp_path, plan)["errores"]

    assert any("versión 1" in error and "version 2" in error for error in errores)


def test_rejected_exige_motivo_y_fecha_valida(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["version"] = 2
    plan["ideas"][0]["status"] = "rejected"

    assert any("motivo" in error for error in migracion.revisar(tmp_path, plan)["errores"])

    plan["ideas"][0]["motivo"] = "duplicada"
    plan["ideas"][0]["fecha"] = "ayer"
    assert any("fecha inválida" in error for error in migracion.revisar(tmp_path, plan)["errores"])

    plan["ideas"][0]["fecha"] = "2025-03-04"
    assert migracion.revisar(tmp_path, plan)["ok"] is True


def test_historial_no_lleva_fases_y_fecha_solo_en_archivo(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["version"] = 2
    plan["ideas"][0]["status"] = "historial"
    plan["ideas"][0]["fases"] = [{"titulo": "A", "requisitos": [{"titulo": "B"}]}]

    errores = migracion.revisar(tmp_path, plan)["errores"]
    assert any("fases" in error for error in errores)

    plan["ideas"][0].pop("fases")
    plan["ideas"][0]["status"] = "proposed"
    plan["ideas"][0]["fecha"] = "2025-01-01"
    assert any("fecha" in error for error in migracion.revisar(tmp_path, plan)["errores"])


def _plan_valido(tmp_path, **cambios):
    """Un plan mínimo correcto: un Markdown, un ítem y su origen con hash."""
    archivo = tmp_path / "docs" / "backlog.md"
    archivo.parent.mkdir(parents=True, exist_ok=True)
    archivo.write_text("# Backlog\n\n## Idea uno\n\n- [ ] hacer algo\n", encoding="utf-8")
    item = {
        "ref": "idea-1",
        "title": "Idea uno",
        "description": "Hacer algo.",
        "content": "## Idea uno\n\n- [ ] hacer algo",
        "kind": "idea",
        "status": "proposed",
        "tags": ["backlog"],
        "origen": {
            "ruta": "docs/backlog.md",
            "desde_linea": 3,
            "hasta_linea": 5,
            "sha256": hashlib.sha256(archivo.read_bytes()).hexdigest(),
        },
    }
    item.update(cambios)
    return {"version": 1, "ideas": [item]}


def test_validar_esquema_rechaza_lo_que_no_toca(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["ideas"][0]["status"] = "roadmap"
    plan["ideas"][0]["origen"]["sha256"] = "abc"
    plan["ideas"][0]["sobra"] = True

    texto = "\n".join(migracion.validar_esquema(plan))

    assert "ideas[0].status" in texto and "proposed" in texto
    assert "ideas[0].origen.sha256" in texto
    assert "ideas[0].sobra" in texto


def test_validar_esquema_exige_titulo(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    del plan["ideas"][0]["title"]

    errores = migracion.validar_esquema(plan)

    assert any("ideas[0].title" in error and "falta" in error for error in errores)


def test_check_plan_correcto(tmp_path) -> None:
    informe = migracion.revisar(tmp_path, _plan_valido(tmp_path), plan_ruta="plan.json")

    assert informe["ok"] is True
    assert informe["errores"] == []
    assert informe["repo"] == str(tmp_path.resolve())
    assert [item["ref"] for item in informe["crear"]] == ["idea-1"]
    assert informe["resumen"] == {"ideas": 1, "archivos": 1, "refs": 1}


def test_check_ref_repetida(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["ideas"].append({**plan["ideas"][0], "title": "Otra"})

    informe = migracion.revisar(tmp_path, plan)

    assert informe["ok"] is False
    assert any("repetida" in error for error in informe["errores"])


def test_check_dependencia_inexistente(tmp_path) -> None:
    informe = migracion.revisar(tmp_path, _plan_valido(tmp_path, depende_de=["nadie"]))

    assert any("no existe el ítem" in error for error in informe["errores"])


def test_check_dependencia_circular(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["ideas"].append(
        {**plan["ideas"][0], "ref": "idea-2", "title": "Idea dos", "depende_de": ["idea-1"]}
    )
    plan["ideas"][0]["depende_de"] = ["idea-2"]

    informe = migracion.revisar(tmp_path, plan)

    assert any("dependencia circular" in error for error in informe["errores"])


def test_check_hash_obsoleto(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    (tmp_path / "docs" / "backlog.md").write_text("# otro\n", encoding="utf-8")

    informe = migracion.revisar(tmp_path, plan)

    assert any("cambió desde el scan" in error for error in informe["errores"])


def test_check_origen_fuera_del_repo(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["ideas"][0]["origen"]["ruta"] = "../fuera.md"

    informe = migracion.revisar(tmp_path, plan)

    assert any("dentro del repo" in error for error in informe["errores"])


def test_check_lineas_fuera_del_fichero(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["ideas"][0]["origen"]["hasta_linea"] = 99

    informe = migracion.revisar(tmp_path, plan)

    assert any("supera las" in error for error in informe["errores"])


def test_check_titulo_repetido_en_el_mismo_fichero(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["ideas"].append({**plan["ideas"][0], "ref": "idea-2"})

    informe = migracion.revisar(tmp_path, plan)

    assert any("ya sale en" in error for error in informe["errores"])


def test_cli_migrate_check_json(tmp_path, capsys) -> None:
    destino = tmp_path / "plan.json"
    destino.write_text(json.dumps(_plan_valido(tmp_path)), encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "check", str(destino), "--json"]) == 0
    informe = json.loads(capsys.readouterr().out)
    assert informe["ok"] is True
    assert informe["crear"][0]["ref"] == "idea-1"


def test_cli_migrate_check_con_problemas(tmp_path, capsys) -> None:
    destino = tmp_path / "plan.json"
    destino.write_text(json.dumps(_plan_valido(tmp_path, status="roadmap")), encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "check", str(destino)]) == 1
    assert "no se aplicaría" in capsys.readouterr().err


def test_cli_migrate_check_json_roto(tmp_path, capsys) -> None:
    destino = tmp_path / "plan.json"
    destino.write_text("{", encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "check", str(destino)]) == 2
    assert "JSON" in capsys.readouterr().err


def test_cli_migrate_check_sin_plan(tmp_path, capsys) -> None:
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "check", str(tmp_path / "no.json")]) == 1
    assert "no existe" in capsys.readouterr().err


def test_esquema_exige_requisito_en_cada_fase(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["ideas"][0]["fases"] = [{"titulo": "Sin criterio", "requisitos": []}]

    errores = migracion.validar_esquema(plan)

    assert any("fases[0].requisitos" in error for error in errores)


def test_huella_del_plan_ignora_el_orden_de_las_claves() -> None:
    assert migracion.huella_plan({"version": 1, "ideas": [{"ref": "a"}]}) == migracion.huella_plan(
        {"ideas": [{"ref": "a"}], "version": 1}
    )


def test_cli_migrate_apply_envia_el_plan(tmp_path, capsys, monkeypatch) -> None:
    destino = tmp_path / "plan.json"
    destino.write_text(json.dumps(_plan_valido(tmp_path)), encoding="utf-8")
    config.guardar(repo=str(tmp_path))
    visto = {}

    def falso(url, datos):
        visto["url"] = url
        visto["datos"] = datos
        return (
            {
                "repo": str(tmp_path),
                "lote": "lote-1",
                "plan_sha256": "x",
                "repetido": False,
                "ideas": 1,
                "creadas": [{"ref": "idea-1", "uid": "u1"}],
            },
            None,
            200,
        )

    monkeypatch.setattr(cli, "_post", falso)

    assert cli.main(["migrate", "apply", str(destino)]) == 0
    salida = capsys.readouterr().out
    assert "lote-1" in salida
    assert "u1" in salida
    assert "/migracion/aplicar" in visto["url"]
    assert visto["datos"]["ideas"][0]["ref"] == "idea-1"


def test_cli_migrate_apply_no_envia_un_plan_malo(tmp_path, capsys, monkeypatch) -> None:
    destino = tmp_path / "plan.json"
    destino.write_text(json.dumps(_plan_valido(tmp_path, status="roadmap")), encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    def no_llamar(*_args):
        raise AssertionError("no debe enviarse un plan inválido")

    monkeypatch.setattr(cli, "_post", no_llamar)

    assert cli.main(["migrate", "apply", str(destino)]) == 1
    assert "no se aplica nada" in capsys.readouterr().err


def test_cli_migrate_undo(tmp_path, capsys, monkeypatch) -> None:
    config.guardar(repo=str(tmp_path))
    visto = {}

    def falso(url):
        visto["url"] = url
        return (
            {
                "repo": str(tmp_path),
                "lote": "lote-1",
                "plan_sha256": "x",
                "borradas": 2,
                "ausentes": 1,
            },
            None,
            200,
        )

    monkeypatch.setattr(cli, "_delete", falso)

    assert cli.main(["migrate", "undo", "lote-1"]) == 0
    salida = capsys.readouterr().out
    assert "2 items borradas" in salida
    assert "1 ya no estaban" in salida
    assert "/migracion/lotes/lote-1" in visto["url"]


def test_cli_migrate_undo_conflicto(tmp_path, capsys, monkeypatch) -> None:
    config.guardar(repo=str(tmp_path))
    monkeypatch.setattr(
        cli,
        "_delete",
        lambda url: (None, "no se puede deshacer el lote lote-1: uno está en roadmap", 409),
    )

    assert cli.main(["migrate", "undo", "lote-1"]) == 1
    assert "roadmap" in capsys.readouterr().err


def test_cli_migrate_apply_repetido_lo_dice(tmp_path, capsys, monkeypatch) -> None:
    destino = tmp_path / "plan.json"
    destino.write_text(json.dumps(_plan_valido(tmp_path)), encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    def repetido(_url, _datos):
        return (
            {
                "repo": str(tmp_path),
                "lote": "lote-1",
                "plan_sha256": "x",
                "repetido": True,
                "ideas": 1,
                "creadas": [],
            },
            None,
            200,
        )

    monkeypatch.setattr(cli, "_post", repetido)

    assert cli.main(["migrate", "apply", str(destino)]) == 0
    assert "ya se aplicó" in capsys.readouterr().out


def _plan_v3(tmp_path, **cambios):
    """Plan v3 con manifiesto mapa que cubre el único bloque del fixture."""
    plan = _plan_valido(tmp_path, **cambios)
    plan["version"] = 3
    plan["documentos"] = [
        {
            "ruta": "docs/backlog.md",
            "clase": "mapa",
            "motivo": "backlog del fixture",
            "destino": "mapa",
        }
    ]
    return plan


def test_classify_propone_mapa_y_referencia(tmp_path) -> None:
    (tmp_path / "ROADMAP.md").write_text("- [ ] una\n", encoding="utf-8")
    (tmp_path / "README.md").write_text("# Hola\n\nTexto.\n", encoding="utf-8")
    (tmp_path / "notas.md").write_text("- [ ] tarea\n", encoding="utf-8")

    informe = migracion.clasificar(tmp_path)

    por_ruta = {doc["ruta"]: doc for doc in informe["documentos"]}
    assert por_ruta["ROADMAP.md"]["clase"] == "mapa"
    assert por_ruta["ROADMAP.md"]["destino"] == "mapa"
    assert por_ruta["README.md"]["clase"] == "referencia"
    assert por_ruta["notas.md"]["clase"] == "mapa"
    assert set(informe["resumen"]) == {"documentos", "mapa", "referencia"}


def test_cli_migrate_classify_y_alias_plan(tmp_path, capsys) -> None:
    (tmp_path / "backlog.md").write_text("- [ ] x\n", encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "classify", "--json"]) == 0
    informe = json.loads(capsys.readouterr().out)
    assert informe["documentos"][0]["ruta"] == "backlog.md"

    assert cli.main(["migrate", "plan", "--json"]) == 0
    alias = json.loads(capsys.readouterr().out)
    assert alias["documentos"] == informe["documentos"]


def test_plan_v3_ok_con_documentos(tmp_path) -> None:
    informe = migracion.revisar(tmp_path, _plan_v3(tmp_path))

    assert informe["ok"] is True
    assert informe["documentos"] == [
        {"ruta": "docs/backlog.md", "clase": "mapa", "destino": "mapa"}
    ]


def test_plan_v3_exige_documentos(tmp_path) -> None:
    plan = _plan_valido(tmp_path)
    plan["version"] = 3

    errores = migracion.revisar(tmp_path, plan)["errores"]

    assert any("documentos" in error and "versión 3" in error for error in errores)


def test_plan_v2_no_admite_documentos(tmp_path) -> None:
    plan = _plan_v3(tmp_path)
    plan["version"] = 2

    errores = migracion.revisar(tmp_path, plan)["errores"]

    assert any("documentos" in error and "version 3" in error for error in errores)


def test_check_rechaza_item_en_referencia(tmp_path) -> None:
    plan = _plan_v3(tmp_path)
    plan["documentos"][0]["clase"] = "referencia"
    plan["documentos"][0]["destino"] = "referencia"

    errores = migracion.revisar(tmp_path, plan)["errores"]

    assert any("referencia" in error and "mapa" in error for error in errores)


def test_check_exige_bloques_clasificados(tmp_path) -> None:
    plan = _plan_v3(tmp_path)
    archivo = tmp_path / "docs" / "backlog.md"
    archivo.write_text(
        "# Backlog\n\n## Idea uno\n\n- [ ] hacer algo\n\n- [ ] otra sin item\n",
        encoding="utf-8",
    )
    plan["ideas"][0]["origen"]["sha256"] = hashlib.sha256(archivo.read_bytes()).hexdigest()

    errores = migracion.revisar(tmp_path, plan)["errores"]

    assert any("bloques sin clasificar" in error for error in errores)


def test_parcial_exige_rangos_y_cubre_items(tmp_path) -> None:
    plan = _plan_v3(tmp_path)
    plan["documentos"][0]["clase"] = "parcial"
    plan["documentos"][0]["destino"] = "mapa"

    assert any("rangos" in error for error in migracion.revisar(tmp_path, plan)["errores"])

    plan["documentos"][0]["rangos"] = [{"desde": 1, "hasta": 2}]
    errores = migracion.revisar(tmp_path, plan)["errores"]
    assert any("fuera de los rangos parciales" in error for error in errores)

    plan["documentos"][0]["rangos"] = [{"desde": 1, "hasta": 5}]
    assert migracion.revisar(tmp_path, plan)["ok"] is True
