"""`eui doctor` sin arrancar el core: evaluación, conexión y `config set`."""

from __future__ import annotations

import json

import pytest

from events_core import __version__, cli, config


def _estados(comprobaciones: list[dict[str, str]]) -> dict[str, str]:
    return {c["nombre"]: c["estado"] for c in comprobaciones}


def test_evaluar_en_verde(tmp_path) -> None:
    raiz = tmp_path / "repo"
    raiz.mkdir()

    comprobaciones = cli.evaluar(
        ajustes=config.Config(repo=raiz),
        problema=None,
        url="http://127.0.0.1:18765",
        health={"status": "ok", "version": __version__, "repo": str(raiz)},
        fallo=None,
        raiz=raiz,
        version=__version__,
    )

    estados = _estados(comprobaciones)
    # La configuración no tiene fichero en este test: aviso, no error.
    assert estados["configuración"] == "aviso"
    assert estados["conexión"] == "ok"
    assert estados["versión"] == "ok"
    assert estados["estado"] == "ok"
    assert estados["raíz"] == "ok"
    assert estados["escritura"] == "ok"


def test_evaluar_sin_raiz_avisa() -> None:
    comprobaciones = cli.evaluar(
        ajustes=config.Config(),
        problema=None,
        url="http://127.0.0.1:18765",
        health={"status": "degraded", "version": __version__, "repo": None},
        fallo=None,
        raiz=None,
        version=__version__,
    )

    estados = _estados(comprobaciones)
    assert estados["raíz"] == "aviso"
    assert "escritura" not in estados


def test_evaluar_version_distinta_es_error(tmp_path) -> None:
    raiz = tmp_path / "repo"
    raiz.mkdir()

    comprobaciones = cli.evaluar(
        ajustes=config.Config(repo=raiz),
        problema=None,
        url="http://127.0.0.1:18765",
        health={"status": "ok", "version": "9.9.9", "repo": str(raiz)},
        fallo=None,
        raiz=raiz,
        version=__version__,
    )

    assert _estados(comprobaciones)["versión"] == "error"


def test_doctor_sin_core(capsys) -> None:
    assert cli.main(["doctor", "--url", "http://127.0.0.1:1"]) == 1
    salida = capsys.readouterr().out
    assert "conexión" in salida
    assert "error" in salida


def test_doctor_json_sin_core(capsys) -> None:
    assert cli.main(["doctor", "--url", "http://127.0.0.1:1", "--json"]) == 1
    datos = json.loads(capsys.readouterr().out)
    assert datos["ok"] is False
    assert any(c["nombre"] == "conexión" for c in datos["comprobaciones"])


def test_config_set_y_lectura(tmp_path, capsys) -> None:
    raiz = tmp_path / "repo"
    raiz.mkdir()

    assert cli.main(["config", "set", "repo", str(raiz)]) == 0
    assert config.leer().repo == raiz.resolve()
    # La primera llamada también imprime: se drena antes de leer el JSON.
    capsys.readouterr()

    assert cli.main(["config", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)["repo"] == str(raiz.resolve())


def test_config_puerto_invalido_no_cambia_nada(capsys) -> None:
    assert cli.main(["config", "set", "port", "0"]) == 2
    assert "puerto inválido" in capsys.readouterr().err
    assert config.leer() == config.Config()


def _con_raiz(tmp_path) -> None:
    raiz = tmp_path / "repo"
    raiz.mkdir()
    config.guardar(repo=str(raiz))


def test_repo_sin_raiz_sale_con_1(capsys) -> None:
    assert cli.main(["repo", "--json"]) == 1
    assert json.loads(capsys.readouterr().out)["repo"] is None


def test_repo_list_es_una_linea_json(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)

    def falso(url: str):
        return ([{"repo": "lab", "db_path": "C:/lab/.EUI/EUI_DATABASE.sqlite"}], None, 200)

    monkeypatch.setattr(cli, "_get", falso)

    assert cli.main(["repo", "list", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["repo"] == "lab"


def test_el_comando_idea_ya_no_existe(capsys) -> None:
    """El alias se retiró: `eui idea` es un comando desconocido."""
    with pytest.raises(SystemExit) as salida:
        cli.main(["idea", "list"])
    assert salida.value.code == 2
    assert "invalid choice" in capsys.readouterr().err


def test_item_list_json_lleva_la_raiz(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    visto: dict[str, str] = {}

    def falso(url: str):
        visto["url"] = url
        return ([{"uid": "a1", "title": "Hola", "status": "proposed"}], None, 200)

    monkeypatch.setattr(cli, "_get", falso)

    assert cli.main(["item", "list", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["uid"] == "a1"
    assert "repo=" in visto["url"]


def test_item_get_sin_raiz_es_uso_invalido(capsys) -> None:
    assert cli.main(["item", "get", "a1"]) == 2
    assert "no hay raíz" in capsys.readouterr().err


def test_item_get_inexistente_sale_con_1(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    monkeypatch.setattr(cli, "_get", lambda url: (None, "no existe el ítem a1", 404))

    assert cli.main(["item", "get", "a1"]) == 1
    assert "no existe el ítem a1" in capsys.readouterr().err


def test_schema_imprime_el_contrato(capsys, monkeypatch) -> None:
    monkeypatch.setattr(cli, "_get", lambda url: ({"openapi": "3.1.0"}, None, 200))

    assert cli.main(["schema"]) == 0
    assert json.loads(capsys.readouterr().out)["openapi"] == "3.1.0"


def test_item_create_manda_el_cuerpo(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    visto = {}

    def falso(url, datos):
        visto["url"] = url
        visto["datos"] = datos
        return ({"uid": "u1", "title": datos["title"], "status": datos["status"]}, None, 201)

    monkeypatch.setattr(cli, "_post", falso)

    assert (
        cli.main(["item", "create", "--title", "Login", "--tag", "ui", "--dep", "u0", "--json"])
        == 0
    )
    assert json.loads(capsys.readouterr().out)["uid"] == "u1"
    assert visto["datos"] == {
        "title": "Login",
        "description": "",
        "content": "",
        "kind": "work_item",
        "status": "draft",
        "tags": ["ui"],
        "depende_de": ["u0"],
    }
    assert "/items?repo=" in visto["url"]


def test_item_create_con_fases_lee_el_fichero(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    visto: dict = {}

    def falso(url, datos):  # noqa: ANN001, ANN202
        visto["datos"] = datos
        return ({"uid": "u1", "title": datos["title"], "status": datos["status"]}, None, 201)

    monkeypatch.setattr(cli, "_post", falso)
    fases = [{"titulo": "Diseño", "requisitos": [{"titulo": "Cubre el borde"}]}]
    fichero = tmp_path / "fases.json"

    fichero.write_text(json.dumps(fases), encoding="utf-8")
    assert cli.main(["item", "create", "--title", "A", "--fases", str(fichero), "--json"]) == 0
    assert visto["datos"]["fases"] == fases

    # `{"fases": [...]}` vale igual: es el mismo formato que `item fases`.
    fichero.write_text(json.dumps({"fases": fases}), encoding="utf-8")
    assert cli.main(["item", "create", "--title", "A", "--fases", str(fichero), "--json"]) == 0
    assert visto["datos"]["fases"] == fases


def test_item_create_con_fases_ilegibles_no_crea(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    monkeypatch.setattr(
        cli, "_post", lambda url, datos: (_ for _ in ()).throw(AssertionError("no debería crear"))
    )
    fichero = tmp_path / "fases.json"

    fichero.write_text("{}", encoding="utf-8")
    assert cli.main(["item", "create", "--title", "A", "--fases", str(fichero)]) == 2
    assert "lista de fases" in capsys.readouterr().err

    assert cli.main(["item", "create", "--title", "A", "--fases", str(tmp_path / "no.json")]) == 1
    assert "no existe" in capsys.readouterr().err


def test_item_edit_solo_los_campos_dados(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    visto = {}

    def falso(url, datos):
        visto["url"] = url
        visto["datos"] = datos
        return ({"uid": "u1", "title": "Nuevo", "status": "proposed"}, None, 200)

    monkeypatch.setattr(cli, "_patch", falso)

    assert cli.main(["item", "edit", "u1", "--title", "Nuevo", "--sin-etiquetas"]) == 0
    assert visto["datos"] == {"title": "Nuevo", "tags": []}
    assert "/items/u1?repo=" in visto["url"]
    assert "Nuevo" in capsys.readouterr().out


def test_item_edit_sin_cambios_es_uso_invalido(tmp_path, capsys) -> None:
    _con_raiz(tmp_path)

    assert cli.main(["item", "edit", "u1"]) == 2
    assert "nada que editar" in capsys.readouterr().err


def test_item_move_descarta_con_motivo(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    visto = {}

    def falso(url, datos):
        visto["datos"] = datos
        return ({"uid": "u1", "title": "T", "status": "rejected"}, None, 200)

    monkeypatch.setattr(cli, "_patch", falso)

    assert (
        cli.main(
            [
                "item",
                "move",
                "u1",
                "rejected",
                "--motivo",
                "duplicada",
                "--descartado-por",
                "agente",
            ]
        )
        == 0
    )
    assert visto["datos"] == {
        "status": "rejected",
        "rejected_description": "duplicada",
        "rejected_by": "agente",
    }
    assert "rejected" in capsys.readouterr().out


def test_item_fases_reemplaza_desde_json(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    fichero = tmp_path / "fases.json"
    fases = [{"titulo": "Preparar", "requisitos": [{"titulo": "Listo"}]}]
    fichero.write_text(json.dumps(fases), encoding="utf-8")
    visto = {}

    def falso(url, datos):
        visto["url"] = url
        visto["datos"] = datos
        return ({"uid": "u1", "title": "T", "status": "proposed"}, None, 200)

    monkeypatch.setattr(cli, "_patch", falso)

    assert cli.main(["item", "fases", "u1", str(fichero)]) == 0
    assert visto["datos"] == {"fases": fases}
    assert "/items/u1?repo=" in visto["url"]


def test_item_requisito_marca_uno_y_conserva_el_resto(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    item = {
        "uid": "u1",
        "title": "T",
        "status": "proposed",
        "fases": [
            {
                "orden": 1,
                "titulo": "A",
                "estado": "pendiente",
                "nota": "nota",
                "requisitos": [
                    {"orden": 1, "titulo": "a", "hecho": False},
                    {"orden": 2, "titulo": "b", "hecho": False},
                ],
            },
            {
                "orden": 2,
                "titulo": "B",
                "estado": "pendiente",
                "nota": "",
                "requisitos": [{"orden": 1, "titulo": "c", "hecho": True}],
            },
        ],
    }
    visto = {}
    monkeypatch.setattr(cli, "_get", lambda url: (item, None, 200))

    def falso(url, datos):
        visto["datos"] = datos
        return (item, None, 200)

    monkeypatch.setattr(cli, "_patch", falso)

    assert cli.main(["item", "requisito", "u1", "1", "2", "--hecho"]) == 0
    fases = visto["datos"]["fases"]
    assert fases[0]["requisitos"][0]["hecho"] is False
    assert fases[0]["requisitos"][1]["hecho"] is True
    assert fases[0]["nota"] == "nota"
    assert fases[1]["requisitos"][0]["hecho"] is True
    assert "1.2" in capsys.readouterr().out


def test_item_requisito_inexistente_sale_con_1(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    monkeypatch.setattr(cli, "_get", lambda url: ({"uid": "u1", "fases": []}, None, 200))

    assert cli.main(["item", "requisito", "u1", "1", "1", "--hecho"]) == 1
    assert "no tiene la fase" in capsys.readouterr().err


def test_item_list_json_no_avisa_por_stderr(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)

    def falso(url: str):
        return ([{"uid": "a1", "title": "Hola", "status": "proposed"}], None, 200)

    monkeypatch.setattr(cli, "_get", falso)

    assert cli.main(["item", "list", "--json"]) == 0
    salida = capsys.readouterr()
    assert json.loads(salida.out)[0]["uid"] == "a1"
    assert salida.err == ""


def test_item_move_no_avisa_por_stderr(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    visto: list[dict[str, str]] = []

    def falso(url: str, datos: dict[str, str]):
        visto.append(datos)
        return ({"uid": "u1", "title": "T", "status": datos["status"]}, None, 200)

    monkeypatch.setattr(cli, "_patch", falso)

    assert cli.main(["item", "move", "u1", "roadmap", "--resultado", "listo"]) == 0
    assert visto[-1] == {"status": "roadmap", "roadmap_resultado": "listo"}
    assert "roadmap" in capsys.readouterr().out

    assert cli.main(["item", "move", "u1", "historial"]) == 0
    assert visto[-1] == {"status": "historial"}
    salida = capsys.readouterr()
    assert "historial" in salida.out
    assert salida.err == ""
