"""Los archivos de cada fase (0028): fotos por evento, sin watcher.

Cubre las dos caras: sin Git se anotan las rutas y su estado —sin contenido— y
con Git se añade el parche. También la cadena entre fases (cada cierre mide
desde el anterior) y que reabrir una fase suelta lo anotado.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

GIT = shutil.which("git")


def _git(carpeta: Path, *args: str) -> None:
    subprocess.run([GIT or "git", *args], cwd=carpeta, check=True, capture_output=True, text=True)


def _en_roadmap(client, carpeta: Path) -> str:  # noqa: ANN001
    """Una idea en roadmap con una fase pendiente: ahí empieza el trabajo."""
    r = client.post(
        "/ideas",
        params={"repo": str(carpeta)},
        json={"title": "A", "status": "proposed"},
    )
    assert r.status_code == 201, r.json()
    uid = r.json()["uid"]
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": str(carpeta)},
        json={
            "status": "roadmap",
            "fases": [{"titulo": "Diseño", "requisitos": [{"titulo": "Cubre el borde"}]}],
        },
    )
    assert r.status_code == 200, r.json()
    return uid


def _cerrar(client, carpeta: Path, uid: str, orden: int = 1, titulo: str = "Diseño"):  # noqa: ANN001, ANN202
    """Cierra la fase por la vía normal: requisito hecho y estado completada."""
    ficha = client.get(f"/ideas/{uid}", params={"repo": str(carpeta)}).json()
    fases = [
        {
            "orden": fase["orden"],
            "titulo": fase["titulo"],
            "estado": fase["estado"],
            "requisitos": [
                {"orden": requisito["orden"], "titulo": requisito["titulo"], "hecho": True}
                for requisito in fase["requisitos"]
            ],
        }
        for fase in ficha["fases"]
    ]
    for fase in fases:
        if fase["orden"] == orden:
            fase["estado"] = "completada"
    r = client.patch(f"/ideas/{uid}", params={"repo": str(carpeta)}, json={"fases": fases})
    assert r.status_code == 200, r.json()
    return next(fase for fase in r.json()["fases"] if fase["orden"] == orden)


def test_sin_git_anota_rutas_y_estado_sin_contenido(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "sin-git"
    carpeta.mkdir()
    (carpeta / "base.txt").write_text("hola", encoding="utf-8")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "nuevo.txt").write_text("más", encoding="utf-8")
    (carpeta / "base.txt").write_text("hola, más largo", encoding="utf-8")
    fase = _cerrar(client, carpeta, uid)

    assert [(archivo["ruta"], archivo["estado"]) for archivo in fase["archivos"]] == [
        ("base.txt", "modificado"),
        ("nuevo.txt", "nuevo"),
    ]
    # Sin Git no se guarda contenido; la base del propio repo tampoco cuenta.
    assert all(archivo["contenido"] is None for archivo in fase["archivos"])


def test_sin_git_anota_el_borrado(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "borrado"
    carpeta.mkdir()
    (carpeta / "se-va.txt").write_text("x", encoding="utf-8")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "se-va.txt").unlink()
    fase = _cerrar(client, carpeta, uid)

    assert fase["archivos"] == [{"ruta": "se-va.txt", "estado": "borrado", "contenido": None}]


def test_cada_cierre_mide_desde_el_anterior(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "cadena"
    carpeta.mkdir()
    (carpeta / "uno.txt").write_text("uno", encoding="utf-8")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "uno.txt").write_text("uno, tocado", encoding="utf-8")
    assert [archivo["ruta"] for archivo in _cerrar(client, carpeta, uid)["archivos"]] == ["uno.txt"]

    # Segunda fase: la foto de referencia es el cierre de la primera, no el
    # principio del roadmap; el archivo de antes ya no se vuelve a anotar.
    ficha = client.get(f"/ideas/{uid}", params={"repo": str(carpeta)}).json()
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": str(carpeta)},
        json={
            "fases": [
                *[
                    {
                        "orden": fase["orden"],
                        "titulo": fase["titulo"],
                        "estado": fase["estado"],
                        "requisitos": [
                            {
                                "orden": requisito["orden"],
                                "titulo": requisito["titulo"],
                                "hecho": requisito["hecho"],
                            }
                            for requisito in fase["requisitos"]
                        ],
                    }
                    for fase in ficha["fases"]
                ],
                {"titulo": "Prueba", "requisitos": [{"titulo": "Pasa lint"}]},
            ]
        },
    )
    assert r.status_code == 200, r.json()

    (carpeta / "dos.txt").write_text("dos", encoding="utf-8")
    segunda = _cerrar(client, carpeta, uid, orden=2, titulo="Prueba")
    assert [archivo["ruta"] for archivo in segunda["archivos"]] == ["dos.txt"]


def test_reabrir_la_fase_suelta_sus_archivos(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "reabrir"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    (carpeta / "tocado.txt").write_text("x", encoding="utf-8")
    assert _cerrar(client, carpeta, uid)["archivos"]

    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": str(carpeta)},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Diseño",
                    "estado": "pendiente",
                    "requisitos": [{"orden": 1, "titulo": "Cubre el borde"}],
                }
            ]
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json()["fases"][0]["archivos"] == []


def test_el_mapa_lleva_el_recuento_sin_el_parche(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "mapa"
    carpeta.mkdir()
    uid = _en_roadmap(client, carpeta)
    (carpeta / "a.txt").write_text("a", encoding="utf-8")
    _cerrar(client, carpeta, uid)

    idea = client.get("/mapa", params={"repo": str(carpeta)}).json()["ideas"][0]
    assert [archivo["ruta"] for archivo in idea["fases"][0]["archivos"]] == ["a.txt"]
    assert all(archivo["contenido"] is None for archivo in idea["fases"][0]["archivos"])


@pytest.mark.skipif(GIT is None, reason="git no está instalado")
def test_con_git_guarda_el_parche(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "con-git"
    carpeta.mkdir()
    (carpeta / "modulo.py").write_text("uno\n", encoding="utf-8")
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")
    _git(carpeta, "add", "-A")
    _git(carpeta, "commit", "-m", "inicial")
    uid = _en_roadmap(client, carpeta)

    (carpeta / "modulo.py").write_text("uno\ndos\n", encoding="utf-8")
    (carpeta / "nuevo.txt").write_text("hola\n", encoding="utf-8")
    fase = _cerrar(client, carpeta, uid)
    por_ruta = {archivo["ruta"]: archivo for archivo in fase["archivos"]}

    assert por_ruta["modulo.py"]["estado"] == "modificado"
    assert "+dos" in (por_ruta["modulo.py"]["contenido"] or "")
    assert por_ruta["nuevo.txt"]["estado"] == "nuevo"
    assert "hola" in (por_ruta["nuevo.txt"]["contenido"] or "")
    # La base del repo se escribe sola: no es un archivo de la fase.
    assert all(".EUI" not in archivo["ruta"] for archivo in fase["archivos"])
