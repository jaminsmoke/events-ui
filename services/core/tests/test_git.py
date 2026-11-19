"""Detección de Git en la proyección del repo.

El nodo Git del mapa no puede depender de que el ejecutable exista: tiene que
haber un work tree. Un `git init` sin commits ya cuenta, pero una carpeta
ignorada por el repo que la contiene no. Es el caso del laboratorio dentro del
repo de la aplicación.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

GIT = shutil.which("git")


pytestmark = pytest.mark.skipif(GIT is None, reason="git no está instalado")


def _git(carpeta: Path, *args: str) -> None:
    subprocess.run(
        [GIT or "git", *args],
        cwd=carpeta,
        check=True,
        capture_output=True,
        text=True,
    )


def _inicializar(carpeta: Path) -> None:
    carpeta.mkdir(parents=True, exist_ok=True)
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")


def _proyeccion(client, carpeta: Path) -> dict:  # noqa: ANN001
    r = client.get("/proyecciones/repo", params={"repo": str(carpeta)})
    assert r.status_code == 200, r.json()
    return r.json()


def test_carpeta_sin_git_se_queda_apagada(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "suelta"
    carpeta.mkdir()

    datos = _proyeccion(client, carpeta)

    assert datos["git"] is False
    assert datos["git_root"] is None
    assert datos["branch"] is None
    assert datos["commit"] is None
    assert datos["git_cambios"] == []


def test_git_init_sin_commits_enciende_y_conserva_la_rama(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "nuevo"
    _inicializar(carpeta)

    datos = _proyeccion(client, carpeta)

    assert datos["git"] is True
    assert Path(datos["git_root"]).resolve() == carpeta.resolve()
    assert datos["branch"] == "main"
    assert datos["commit"] is None


def test_repo_con_commit_expone_rama_y_hash(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "con-commit"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")
    _git(carpeta, "add", "nota.txt")
    _git(carpeta, "commit", "-m", "inicial")

    datos = _proyeccion(client, carpeta)

    assert datos["git"] is True
    assert datos["branch"] == "main"
    assert isinstance(datos["commit"], str) and len(datos["commit"]) >= 7


def test_cambios_sin_commit_incluyen_modificados_y_sin_seguimiento(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "cambios"
    _inicializar(carpeta)
    (carpeta / "nota.txt").write_text("hola", encoding="utf-8")
    _git(carpeta, "add", "nota.txt")
    _git(carpeta, "commit", "-m", "inicial")
    (carpeta / "nota.txt").write_text("hola cambiado", encoding="utf-8")
    (carpeta / "nuevo.txt").write_text("nuevo", encoding="utf-8")

    datos = _proyeccion(client, carpeta)

    cambios = {(cambio["estado"], cambio["ruta"]) for cambio in datos["git_cambios"]}
    assert ("M", "nota.txt") in cambios
    assert ("??", "nuevo.txt") in cambios


def test_subcarpeta_de_un_repo_hereda_el_work_tree(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "raiz"
    _inicializar(raiz)
    (raiz / "nota.txt").write_text("hola", encoding="utf-8")
    _git(raiz, "add", "nota.txt")
    _git(raiz, "commit", "-m", "inicial")
    sub = raiz / "sub"
    sub.mkdir()

    datos = _proyeccion(client, sub)

    assert datos["git"] is True
    assert Path(datos["git_root"]).resolve() == raiz.resolve()
    assert datos["branch"] == "main"
    assert datos["commit"] is not None


def test_carpeta_ignorada_por_el_repo_contenedor_no_cuenta(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / ".gitignore").write_text("ignorado/\n", encoding="utf-8")
    _git(raiz, "add", ".gitignore")
    _git(raiz, "commit", "-m", "ignorar laboratorio")
    ignorado = raiz / "ignorado"
    ignorado.mkdir()

    datos = _proyeccion(client, ignorado)

    assert datos["git"] is False
    assert datos["git_root"] is None
    assert datos["branch"] is None
    assert datos["commit"] is None
    assert datos["git_cambios"] == []


def test_repo_propio_dentro_de_una_carpeta_ignorada_si_cuenta(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / ".gitignore").write_text("laboratorio/\n", encoding="utf-8")
    _git(raiz, "add", ".gitignore")
    _git(raiz, "commit", "-m", "ignorar laboratorio")
    laboratorio = raiz / "laboratorio"
    _inicializar(laboratorio)

    datos = _proyeccion(client, laboratorio)

    assert datos["git"] is True
    assert Path(datos["git_root"]).resolve() == laboratorio.resolve()
    assert datos["branch"] == "main"
    assert datos["commit"] is None


def test_crear_repo_local_enciende_el_puente(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "suelta"
    carpeta.mkdir()

    r = client.post("/git/inicializar", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    datos = r.json()
    assert datos["git"] is True
    assert datos["branch"] == "main"
    assert (carpeta / ".git").is_dir()


def test_eliminar_repo_local_apaga_el_puente(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "propio"
    _inicializar(carpeta)

    r = client.post("/git/eliminar", params={"repo": str(carpeta)})

    assert r.status_code == 200, r.json()
    assert r.json()["git"] is False
    assert not (carpeta / ".git").exists()


def test_eliminar_rechaza_el_repo_del_contenedor(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / "nota.txt").write_text("hola", encoding="utf-8")
    _git(raiz, "add", "nota.txt")
    _git(raiz, "commit", "-m", "inicial")
    sub = raiz / "sub"
    sub.mkdir()

    r = client.post("/git/eliminar", params={"repo": str(sub)})

    assert r.status_code == 400, r.json()
    assert (raiz / ".git").is_dir()


def test_inicializar_rechaza_un_repo_ya_existente(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "propio"
    _inicializar(carpeta)

    r = client.post("/git/inicializar", params={"repo": str(carpeta)})

    assert r.status_code == 400, r.json()


def test_inicializar_no_anida_en_subcarpeta_de_un_repo(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / "nota.txt").write_text("hola", encoding="utf-8")
    _git(raiz, "add", "nota.txt")
    _git(raiz, "commit", "-m", "inicial")
    sub = raiz / "sub"
    sub.mkdir()

    r = client.post("/git/inicializar", params={"repo": str(sub)})

    assert r.status_code == 400, r.json()
    assert not (sub / ".git").exists()


def test_inicializar_en_carpeta_ignorada_gana_al_contenedor(client, tmp_path):  # noqa: ANN001, ANN202
    raiz = tmp_path / "contenedor"
    _inicializar(raiz)
    (raiz / ".gitignore").write_text("laboratorio/\n", encoding="utf-8")
    _git(raiz, "add", ".gitignore")
    _git(raiz, "commit", "-m", "ignorar laboratorio")
    laboratorio = raiz / "laboratorio"
    laboratorio.mkdir()

    r = client.post("/git/inicializar", params={"repo": str(laboratorio)})

    assert r.status_code == 200, r.json()
    assert r.json()["git"] is True
    assert (laboratorio / ".git").is_dir()
