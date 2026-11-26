"""El presupuesto de contenido se mira antes de leer (no después).

`contenidos` leía cada archivo nuevo y solo luego comparaba el total: con miles
de nuevos eran cientos de MiB de IO y memoria para guardar medio. Ahora el
tamaño se mira con `stat` y lo que no cabe no se abre.
"""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

import pytest

from events_core import archivos


def _nuevo(ruta: str) -> dict[str, object]:
    return {"ruta": ruta, "estado": "nuevo", "contenido": None, "desde": None}


@pytest.fixture(autouse=True)
def _con_git(monkeypatch):  # noqa: ANN001, ANN202
    """Todo es `nuevo`: no hay diff, el contenido sale de los archivos."""
    monkeypatch.setattr(archivos, "hay_git", lambda _carpeta: True)


def test_no_abre_lo_que_no_cabe(tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    for nombre in ("a.txt", "b.txt", "c.txt"):
        (tmp_path / nombre).write_text(nombre[0] * 8, encoding="utf-8")
    (tmp_path / "grande.txt").write_text("g" * 11, encoding="utf-8")
    monkeypatch.setattr(archivos, "LIMITE_CONTENIDO", 10)
    monkeypatch.setattr(archivos, "LIMITE_TOTAL", 16)

    leidos: list[str] = []
    leer = archivos._leer_texto

    def leer_contado(fichero: Path) -> str | None:
        leidos.append(fichero.name)
        return leer(fichero)

    monkeypatch.setattr(archivos, "_leer_texto", leer_contado)
    cambios = [_nuevo(nombre) for nombre in ("a.txt", "b.txt", "c.txt", "grande.txt")]

    archivos.contenidos(tmp_path, cambios)

    # a y b llenan el total; c no cabe y grande pasa su tope: no se abren.
    assert leidos == ["a.txt", "b.txt"]
    assert [cambio["contenido"] for cambio in cambios] == ["a" * 8, "b" * 8, None, None]


def test_cinco_mil_nuevos_no_pasan_del_presupuesto(monkeypatch):  # noqa: ANN001, ANN202
    """5.000 archivos de 1 KiB con 512 KiB de tope: se leen 512, no 5.000."""
    monkeypatch.setattr(archivos, "LIMITE_CONTENIDO", 64 * 1024)
    monkeypatch.setattr(archivos, "LIMITE_TOTAL", 512 * 1024)
    leidos: list[str] = []

    def leer(fichero: object) -> str:
        leidos.append(str(fichero))
        return "x" * 1024

    monkeypatch.setattr(archivos, "_leer_texto", leer)

    class Fichero:
        def __init__(self, ruta: str) -> None:
            self.ruta = ruta

        def stat(self):  # noqa: ANN201
            return SimpleNamespace(st_size=1024)

        def __str__(self) -> str:
            return self.ruta

    class Carpeta:
        def __truediv__(self, ruta: str) -> Fichero:
            return Fichero(ruta)

    cambios = [_nuevo(f"nuevo-{numero:04d}.txt") for numero in range(5000)]

    archivos.contenidos(Carpeta(), cambios)  # type: ignore[arg-type]

    assert len(leidos) == 512
    assert sum(1 for cambio in cambios if cambio["contenido"]) == 512
