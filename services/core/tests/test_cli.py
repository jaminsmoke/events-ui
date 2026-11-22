"""`eui doctor` sin arrancar el core: evaluación, conexión y `config set`."""

from __future__ import annotations

import json

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


def test_idea_list_json_lleva_la_raiz(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    visto: dict[str, str] = {}

    def falso(url: str):
        visto["url"] = url
        return ([{"uid": "a1", "title": "Hola", "status": "proposed"}], None, 200)

    monkeypatch.setattr(cli, "_get", falso)

    assert cli.main(["idea", "list", "--json"]) == 0
    assert json.loads(capsys.readouterr().out)[0]["uid"] == "a1"
    assert "repo=" in visto["url"]


def test_idea_get_sin_raiz_es_uso_invalido(capsys) -> None:
    assert cli.main(["idea", "get", "a1"]) == 2
    assert "no hay raíz" in capsys.readouterr().err


def test_idea_get_inexistente_sale_con_1(tmp_path, capsys, monkeypatch) -> None:
    _con_raiz(tmp_path)
    monkeypatch.setattr(cli, "_get", lambda url: (None, "no existe la idea a1", 404))

    assert cli.main(["idea", "get", "a1"]) == 1
    assert "no existe la idea a1" in capsys.readouterr().err


def test_schema_imprime_el_contrato(capsys, monkeypatch) -> None:
    monkeypatch.setattr(cli, "_get", lambda url: ({"openapi": "3.1.0"}, None, 200))

    assert cli.main(["schema"]) == 0
    assert json.loads(capsys.readouterr().out)["openapi"] == "3.1.0"
