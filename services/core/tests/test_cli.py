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
