"""El explorador de carpetas: listado, orden y guardas de ruta."""

from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


def _arbol(raiz: Path) -> None:
    (raiz / "repo" / ".EUI").mkdir(parents=True)
    (raiz / "otra").mkdir()
    (raiz / "sub").mkdir()
    (raiz / "sub" / "hijo").mkdir()
    (raiz / "archivo.txt").write_text("no se lista", encoding="utf-8")


def test_lista_el_nivel_con_carpetas_primero(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _arbol(tmp_path)
    monkeypatch.setenv("EVENTSUI_FS_ROOT", str(tmp_path))

    respuesta = client.get("/fs")
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["ruta"] == str(tmp_path.resolve())
    assert datos["padre"] is None
    assert datos["recortado"] is False
    assert [e["nombre"] for e in datos["entradas"]] == [
        "otra",
        "repo",
        "sub",
        "archivo.txt",
    ]
    por_nombre = {e["nombre"]: e for e in datos["entradas"]}
    assert por_nombre["repo"]["tipo"] == "carpeta"
    assert por_nombre["repo"]["es_repo"] is True
    assert por_nombre["otra"]["es_repo"] is False
    assert por_nombre["archivo.txt"]["tipo"] == "archivo"
    assert por_nombre["archivo.txt"]["es_repo"] is False


def test_baja_y_sube_de_carpeta(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _arbol(tmp_path)
    monkeypatch.setenv("EVENTSUI_FS_ROOT", str(tmp_path))

    # Relativa a la raíz.
    respuesta = client.get("/fs", params={"path": "repo"})
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["ruta"] == str((tmp_path / "repo").resolve())
    assert datos["padre"] == str(tmp_path.resolve())
    assert [e["nombre"] for e in datos["entradas"]] == [".EUI"]

    # Absoluta, como la manda la UI al bajar.
    respuesta = client.get("/fs", params={"path": str((tmp_path / "sub").resolve())})
    assert respuesta.status_code == 200
    assert [e["nombre"] for e in respuesta.json()["entradas"]] == ["hijo"]


def test_rechaza_la_ruta_que_sale_de_la_raiz(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _arbol(tmp_path)
    monkeypatch.setenv("EVENTSUI_FS_ROOT", str(tmp_path))
    fuera = tmp_path.parent / "fuera-del-explorador"
    fuera.mkdir()

    for ruta in ("..", str(fuera), str(tmp_path / "archivo.txt")):
        respuesta = client.get("/fs", params={"path": ruta})
        assert respuesta.status_code == 400, ruta
        assert respuesta.json()["detail"]


def test_rechaza_un_symlink_que_escapa(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _arbol(tmp_path)
    monkeypatch.setenv("EVENTSUI_FS_ROOT", str(tmp_path))
    fuera = tmp_path.parent / "fuera-del-symlink"
    fuera.mkdir()
    enlace = tmp_path / "enlace"
    try:
        os.symlink(fuera, enlace, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("este sistema no permite crear symlinks en el test")

    respuesta = client.get("/fs", params={"path": str(enlace)})
    assert respuesta.status_code == 400
    assert "fuera de la raíz" in respuesta.json()["detail"]
