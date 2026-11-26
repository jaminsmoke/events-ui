"""El `git diff` de una fase no puede pasarse del límite de argv.

Con miles de rutas, `git diff HEAD -- ruta…` superaba el límite de línea de
comandos de Windows: git fallaba, `parches` devolvía `{}` y la fase se guardaba
sin parches, sin aviso. `git diff` no admite `--pathspec-from-file`, así que la
solución es repartir las rutas en lotes acotados: un lote que falla no se lleva
a los demás y deja aviso (salvo que el repo aún no tenga HEAD).
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from events_core import git_local, registro

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


def test_las_rutas_van_en_lotes_que_caben_en_el_argv(tmp_path, monkeypatch):  # noqa: ANN001
    capturados: list[list[str]] = []

    def falso(args, **kwargs):  # noqa: ANN001, ANN202
        capturados.append(list(args))
        return subprocess.CompletedProcess(args, 0, "", "")

    monkeypatch.setattr(git_local.proceso, "run", falso)
    rutas = {f"carpeta/archivo-{numero:04d}.txt" for numero in range(5000)}

    git_local.parches(tmp_path, rutas)

    assert len(capturados) > 1
    assert all(len(" ".join(args)) < 10_000 for args in capturados)
    enviadas = [ruta for args in capturados for ruta in args[args.index("--") + 1 :]]
    assert sorted(enviadas) == sorted(rutas)


def test_reparte_el_parche_de_cada_ruta(tmp_path):  # noqa: ANN001
    carpeta = tmp_path / "repo"
    _inicializar(carpeta)
    (carpeta / "uno.txt").write_text("uno\n", encoding="utf-8")
    (carpeta / "dos.txt").write_text("dos\n", encoding="utf-8")
    _git(carpeta, "add", ".")
    _git(carpeta, "commit", "-m", "inicial")
    (carpeta / "uno.txt").write_text("uno cambiado\n", encoding="utf-8")
    (carpeta / "dos.txt").write_text("dos cambiado\n", encoding="utf-8")

    parcheado = git_local.parches(carpeta, {"uno.txt", "dos.txt"})

    assert set(parcheado) == {"uno.txt", "dos.txt"}
    assert "uno cambiado" in parcheado["uno.txt"]
    assert "dos cambiado" in parcheado["dos.txt"]


def test_sin_head_no_rompe_ni_avisa(tmp_path, monkeypatch):  # noqa: ANN001
    avisos: list[str] = []
    monkeypatch.setattr(registro, "escribir", lambda nivel, texto, **kw: avisos.append(texto))
    carpeta = tmp_path / "sin-commits"
    _inicializar(carpeta)
    (carpeta / "nuevo.txt").write_text("nuevo\n", encoding="utf-8")

    assert git_local.parches(carpeta, {"nuevo.txt"}) == {}
    # Sin commits no hay diff que dar: no es un fallo del que avisar.
    assert avisos == []


def test_un_lote_fallido_conserva_los_demas_y_avisa(tmp_path, monkeypatch):  # noqa: ANN001
    avisos: list[str] = []
    monkeypatch.setattr(registro, "escribir", lambda nivel, texto, **kw: avisos.append(texto))
    monkeypatch.setattr(git_local, "MAX_RUTAS_POR_LOTE", 1)

    def falso(args, **kwargs):  # noqa: ANN001, ANN202
        if "malo.txt" in args:
            return subprocess.CompletedProcess(args, 128, "", "fatal: algo se rompió")
        return subprocess.CompletedProcess(
            args, 0, "diff --git a/bueno.txt b/bueno.txt\n@@ -1 +1 @@\n-uno\n+dos\n", ""
        )

    monkeypatch.setattr(git_local.proceso, "run", falso)

    parcheado = git_local.parches(tmp_path, {"bueno.txt", "malo.txt"})

    assert "bueno.txt" in parcheado
    assert "malo.txt" not in parcheado
    assert avisos and "lotes fallaron" in avisos[0]
    assert "algo se rompió" in avisos[0]
