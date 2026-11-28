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


def test_sin_raiz_de_proyecto_usa_los_datos_del_usuario(tmp_path, monkeypatch) -> None:
    # El sidecar congelado no ve el `pyproject.toml` del paquete: no puede usar
    # el CWD, que es el que herede del lanzador.
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.delenv("XDG_STATE_HOME", raising=False)

    assert registro.raiz_datos_usuario() == tmp_path / "EventsUI"


def test_la_raiz_se_reconoce_por_el_pyproject_y_no_por_la_carpeta(tmp_path) -> None:
    # Mover el core de carpeta (`services/core` → `shared/core`) no puede mover
    # la raíz del repo: con la marca vieja, el registro de dev se iría a
    # `%LOCALAPPDATA%` sin que nadie lo notara.
    raiz = tmp_path / "repo"
    paquete = raiz / "otra" / "core"
    (paquete / "src" / "events_core").mkdir(parents=True)
    (paquete / "pyproject.toml").write_text("[project]\n", encoding="utf-8")
    fichero = paquete / "src" / "events_core" / "registro.py"
    fichero.write_text("", encoding="utf-8")

    assert registro._raiz_del_repo(fichero) == raiz


def test_sin_pyproject_al_lado_no_hay_raiz_de_proyecto(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.delenv("XDG_STATE_HOME", raising=False)
    fichero = tmp_path / "paquete" / "src" / "events_core" / "registro.py"
    fichero.parent.mkdir(parents=True)
    fichero.write_text("", encoding="utf-8")

    assert registro._raiz_del_repo(fichero) == tmp_path / "EventsUI"
