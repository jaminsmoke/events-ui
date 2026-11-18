"""La ruta del registro operativo no depende del directorio de arranque."""

from __future__ import annotations

from pathlib import Path

from events_core import registro


def test_el_destino_por_defecto_es_la_raiz_del_repo(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv(registro.REGISTRO_ENV_VAR, raising=False)
    esperada = Path(registro.__file__).resolve().parents[4] / "data" / "registro.sqlite"

    monkeypatch.chdir(tmp_path)
    primera = registro.ruta()
    (tmp_path / "otro").mkdir()
    monkeypatch.chdir(tmp_path / "otro")

    assert primera == esperada
    assert registro.ruta() == primera


def test_el_override_sigue_mandando(tmp_path, monkeypatch) -> None:
    destino = tmp_path / "propio.sqlite"
    monkeypatch.setenv(registro.REGISTRO_ENV_VAR, str(destino))
    monkeypatch.chdir(tmp_path)

    assert registro.ruta() == destino.resolve()
