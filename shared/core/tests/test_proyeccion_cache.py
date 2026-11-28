"""La proyección no repite `git status` cuando el repo está quieto.

Se pide cada ~6 s por cliente y lanzaba 5-6 procesos de Git cada vez, con
`status --untracked-files=all` recorriendo el árbol. Ahora la parte de Git se
recuerda por la huella del índice y de HEAD, y el árbol se sondea con
`diff-index --quiet`, que no enumera los no seguidos.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from events_core import proyeccion

GIT = shutil.which("git")

pytestmark = pytest.mark.skipif(GIT is None, reason="git no está instalado")


def _git(carpeta: Path, *args: str) -> None:
    subprocess.run(
        [GIT or "git", "-C", str(carpeta), *args], check=True, capture_output=True, text=True
    )


def _repo(tmp_path: Path) -> Path:
    carpeta = tmp_path / "repo"
    carpeta.mkdir()
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")
    (carpeta / "nota.txt").write_text("uno\n", encoding="utf-8")
    _git(carpeta, "add", ".")
    _git(carpeta, "commit", "-m", "inicial")
    return carpeta


def _cambios(datos: dict) -> set[tuple[str, str]]:
    return {(cambio["estado"], cambio["ruta"]) for cambio in datos["git_cambios"]}


def test_un_repo_quieto_no_lanza_git_status(tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    carpeta = _repo(tmp_path)
    proyeccion.repo_estado_actual(str(carpeta))

    llamadas: list[Path] = []
    original = proyeccion.cambios

    def cambios_contados(ruta: Path) -> list[dict[str, str]]:
        llamadas.append(ruta)
        return original(ruta)

    monkeypatch.setattr(proyeccion, "cambios", cambios_contados)
    for _ in range(3):
        datos = proyeccion.repo_estado_actual(str(carpeta))

    assert llamadas == []
    assert datos["commit"] is not None
    assert datos["git_cambios"] == []


def test_un_fichero_tocado_se_ve_en_la_siguiente_lectura(tmp_path):  # noqa: ANN001, ANN202
    carpeta = _repo(tmp_path)
    proyeccion.repo_estado_actual(str(carpeta))

    (carpeta / "nota.txt").write_text("dos\n", encoding="utf-8")

    assert ("M", "nota.txt") in _cambios(proyeccion.repo_estado_actual(str(carpeta)))


def test_un_commit_se_ve_en_la_siguiente_lectura(tmp_path):  # noqa: ANN001, ANN202
    carpeta = _repo(tmp_path)
    antes = proyeccion.repo_estado_actual(str(carpeta))

    (carpeta / "nota.txt").write_text("dos\n", encoding="utf-8")
    _git(carpeta, "add", ".")
    _git(carpeta, "commit", "-m", "segundo")

    despues = proyeccion.repo_estado_actual(str(carpeta))
    assert despues["commit"] != antes["commit"]
    assert despues["git_cambios"] == []


def test_un_no_seguido_se_ve_al_tocarle_el_turno(tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    """Los no seguidos no dejan huella en `.git`: se revisan cada TTL."""
    carpeta = _repo(tmp_path)
    proyeccion.repo_estado_actual(str(carpeta))
    (carpeta / "nuevo.txt").write_text("nuevo\n", encoding="utf-8")

    monkeypatch.setattr(proyeccion, "TTL_NO_SEGUIDOS", 0.0)

    assert ("??", "nuevo.txt") in _cambios(proyeccion.repo_estado_actual(str(carpeta)))


def test_ignorar_el_almacen_no_devuelve_lo_recordado(client, tmp_path):  # noqa: ANN001, ANN202
    """Un `.gitignore` nuevo no mueve índice ni HEAD: hay que tirar la caché."""
    carpeta = _repo(tmp_path)
    antes = client.get("/proyecciones/repo", params={"repo": str(carpeta)}).json()
    assert antes["eui_ignorado"] is False

    r = client.post("/git/ignorar-almacen", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    assert r.json()["eui_ignorado"] is True


def test_inicializar_el_repo_se_ve_al_instante(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "sin-git"
    carpeta.mkdir()
    assert client.get("/proyecciones/repo", params={"repo": str(carpeta)}).json()["git"] is False

    r = client.post("/git/inicializar", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    assert r.json()["git"] is True
    assert r.json()["branch"] == "main"
