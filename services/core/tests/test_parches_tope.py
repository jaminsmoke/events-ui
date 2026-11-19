"""El tope global de parches por almacén: lo viejo pierde el contenido."""

from __future__ import annotations

import shutil
import sqlite3
import subprocess
from pathlib import Path

import pytest

from events_core.ideas.trabajo import anotacion

GIT = shutil.which("git")


def _ruta_db(carpeta: Path) -> Path:
    return carpeta / ".EUI" / "EUI_DATABASE.sqlite"


def _idea(client, carpeta: Path) -> str:  # noqa: ANN001
    """Una idea nueva: el core crea el almacén y su esquema."""
    r = client.post("/ideas", params={"repo": str(carpeta)}, json={"title": "A"})
    assert r.status_code == 201, r.json()
    return r.json()["uid"]


def _bytes(conn: sqlite3.Connection) -> int:
    return int(
        conn.execute(
            "SELECT COALESCE(SUM(LENGTH(CAST(contenido AS BLOB))), 0) FROM idea_fase_archivo"
        ).fetchone()[0]
    )


def _sembrar(conn: sqlite3.Connection, uid: str, fases: dict[int, tuple[str, str]]) -> None:
    """Una fase cerrada con un archivo y su parche, por cada entrada del mapa."""
    for orden, (entered_at, contenido) in fases.items():
        conn.execute(
            "INSERT INTO idea_fase (idea_uid, orden, titulo, estado, nota, entered_at)"
            " VALUES (?, ?, ?, 'completada', '', ?)",
            (uid, orden, f"Fase {orden}", entered_at),
        )
        conn.execute(
            "INSERT INTO idea_fase_archivo"
            " (idea_uid, fase_orden, requisito_orden, ruta, estado, desde, contenido)"
            " VALUES (?, ?, 0, ?, 'modificado', NULL, ?)",
            (uid, orden, f"f{orden}.txt", contenido),
        )
    conn.commit()


def _contenidos(conn: sqlite3.Connection) -> list[int]:
    return [
        int(fila[0])
        for fila in conn.execute(
            "SELECT fase_orden FROM idea_fase_archivo"
            " WHERE contenido IS NOT NULL ORDER BY fase_orden"
        )
    ]


def test_suelta_los_parches_de_las_fases_mas_viejas(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "tope"
    carpeta.mkdir()
    uid = _idea(client, carpeta)
    with sqlite3.connect(_ruta_db(carpeta)) as conn:
        _sembrar(
            conn,
            uid,
            {
                1: ("2026-01-01T00:00:00+00:00", "a" * 4000),
                2: ("2026-02-01T00:00:00+00:00", "b" * 4000),
                3: ("2026-03-01T00:00:00+00:00", "c" * 4000),
            },
        )
        monkeypatch.setattr(anotacion, "LIMITE_PARQUES", 8000)

        assert anotacion._podar_parches(conn) == 1
        assert _bytes(conn) == 8000
        assert _contenidos(conn) == [2, 3]


def test_si_cabe_no_toca_nada(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "cabe"
    carpeta.mkdir()
    uid = _idea(client, carpeta)
    with sqlite3.connect(_ruta_db(carpeta)) as conn:
        _sembrar(conn, uid, {1: ("2026-01-01T00:00:00+00:00", "a" * 4000)})
        monkeypatch.setattr(anotacion, "LIMITE_PARQUES", 8000)

        assert anotacion._podar_parches(conn) == 0
        assert _bytes(conn) == 4000
        assert _contenidos(conn) == [1]


def _git(carpeta: Path, *args: str) -> None:
    subprocess.run([GIT or "git", *args], cwd=carpeta, check=True, capture_output=True, text=True)


def _payload(client, carpeta: Path, uid: str):  # noqa: ANN001, ANN202
    """Las fases como payload del PATCH, para retocarlas."""
    ficha = client.get(f"/ideas/{uid}", params={"repo": str(carpeta)}).json()
    return [
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
    ]


def _guardar(client, carpeta: Path, uid: str, fases):  # noqa: ANN001, ANN202
    r = client.patch(f"/ideas/{uid}", params={"repo": str(carpeta)}, json={"fases": fases})
    assert r.status_code == 200, r.json()
    return r.json()


@pytest.mark.skipif(GIT is None, reason="git no está instalado")
def test_el_cierre_poda_lo_viejo_y_conserva_lo_nuevo(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "tope-git"
    carpeta.mkdir()
    (carpeta / "grande.txt").write_text("uno" * 2000, encoding="utf-8")
    _git(carpeta, "init", "-b", "main")
    _git(carpeta, "config", "user.email", "test@example.com")
    _git(carpeta, "config", "user.name", "Test")
    _git(carpeta, "add", "-A")
    _git(carpeta, "commit", "-m", "inicial")

    r = client.post(
        "/ideas", params={"repo": str(carpeta)}, json={"title": "A", "status": "proposed"}
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

    (carpeta / "grande.txt").write_text("dos" * 2000, encoding="utf-8")
    fases = _payload(client, carpeta, uid)
    fases[0]["estado"] = "completada"
    fases[0]["requisitos"][0]["hecho"] = True
    primera = _guardar(client, carpeta, uid, fases)
    assert any(archivo["contenido"] for archivo in primera["fases"][0]["archivos"])

    fases = _payload(client, carpeta, uid)
    fases.append({"titulo": "Prueba", "requisitos": [{"titulo": "Pasa lint"}]})
    _guardar(client, carpeta, uid, fases)
    (carpeta / "pequeno.txt").write_text("x\n", encoding="utf-8")

    # Un tope entre el parche nuevo (unos cientos de bytes) y el viejo (miles):
    # al cerrar la segunda fase solo se poda la primera.
    monkeypatch.setattr(anotacion, "LIMITE_PARQUES", 1000)
    fases = _payload(client, carpeta, uid)
    fases[1]["estado"] = "completada"
    fases[1]["requisitos"][0]["hecho"] = True
    _guardar(client, carpeta, uid, fases)

    idea = client.get(f"/ideas/{uid}", params={"repo": str(carpeta)}).json()
    por_orden = {fase["orden"]: fase for fase in idea["fases"]}
    assert all(archivo["contenido"] is None for archivo in por_orden[1]["archivos"])
    assert any(archivo["contenido"] for archivo in por_orden[2]["archivos"])
