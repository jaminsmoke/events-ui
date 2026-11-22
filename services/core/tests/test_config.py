"""Configuración compartida: fichero, endpoint y lo que publica `/health`."""

from __future__ import annotations

import json

import pytest

from events_core import __version__, config
from events_core.ideas.base.comun import InvalidInput


def test_sin_fichero_usa_los_defectos() -> None:
    assert config.leer() == config.Config()
    assert config.leer_segura() == config.Config()


def test_guardar_y_leer_normaliza_la_raiz(tmp_path) -> None:
    raiz = tmp_path / "repo"
    raiz.mkdir()

    ajustes = config.guardar(repo=str(raiz), port=19000)

    assert ajustes == config.Config(repo=raiz.resolve(), port=19000)
    assert json.loads(config.ruta().read_text(encoding="utf-8")) == {
        "repo": str(raiz.resolve()),
        "port": 19000,
    }
    assert config.leer() == ajustes


def test_guardar_un_solo_campo_conserva_el_otro(tmp_path) -> None:
    raiz = tmp_path / "repo"
    raiz.mkdir()
    config.guardar(repo=str(raiz), port=19000)

    assert config.guardar(port=19001).repo == raiz.resolve()
    assert config.leer().port == 19001


def test_puerto_fuera_de_rango() -> None:
    with pytest.raises(InvalidInput):
        config.guardar(port=70000)


def test_fichero_roto_lo_dice_leer_y_no_revienta_leer_segura() -> None:
    config.ruta().parent.mkdir(parents=True, exist_ok=True)
    config.ruta().write_text("{", encoding="utf-8")

    with pytest.raises(config.ConfigInvalida):
        config.leer()
    assert config.leer_segura() == config.Config()


def test_health_publica_version_y_raiz(client, tmp_path) -> None:
    datos = client.get("/health").json()
    assert datos["version"] == __version__
    assert datos["repo"] is None

    raiz = tmp_path / "repo"
    raiz.mkdir()
    guardado = client.put("/config", json={"repo": str(raiz)})

    assert guardado.status_code == 200
    assert guardado.json()["repo"] == str(raiz.resolve())
    assert client.get("/config").json()["repo"] == str(raiz.resolve())
    assert client.get("/health").json()["repo"] == str(raiz.resolve())


def test_put_config_limpia_la_raiz(client, tmp_path) -> None:
    raiz = tmp_path / "repo"
    raiz.mkdir()
    client.put("/config", json={"repo": str(raiz)})

    limpio = client.put("/config", json={"repo": None})

    assert limpio.status_code == 200
    assert limpio.json()["repo"] is None
    assert config.leer().repo is None


def test_put_config_valida(client) -> None:
    assert client.put("/config", json={"port": 0}).status_code == 422
    assert client.put("/config", json={"repo": "../fuera"}).status_code == 400


def test_dos_guardados_no_comparten_el_temporal(tmp_path, monkeypatch) -> None:
    """Dos PUT concurrentes no pueden usar el mismo `.tmp` (WinError 32)."""
    from concurrent.futures import ThreadPoolExecutor
    from pathlib import Path

    raiz = tmp_path / "repo"
    raiz.mkdir()
    nombres: list[str] = []
    reemplazar_original = config.os.replace

    def reemplazar(origen, destino) -> None:
        nombres.append(Path(origen).name)
        reemplazar_original(origen, destino)

    monkeypatch.setattr(config.os, "replace", reemplazar)
    with ThreadPoolExecutor(max_workers=2) as pool:
        futuros = [
            pool.submit(config.guardar, repo=str(raiz), port=puerto) for puerto in (19000, 19001)
        ]
        for futuro in futuros:
            futuro.result()

    assert len(nombres) == 2
    assert nombres[0] != nombres[1]
    assert config.leer().port in (19000, 19001)
