"""`ensure_repo` ordena `.EUI` una vez, no en cada lectura.

El `.gitignore` de `.EUI` se pone al día y lo ajeno se purga recorriendo el
árbol: hacerlo en cada `/revision` —cada 2 s por cliente— era trabajo de
escritorio sin que nada hubiera cambiado. Ahora solo se repite cuando la
carpeta cambia: otro nombre en `.EUI` o en su `migracion/`, o un `.gitignore`
tocado.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from events_core.items.base import esquema


@pytest.fixture
def repo(tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    monkeypatch.setenv("EVENTSUI_REPOS_ROOT", str(tmp_path))
    carpeta = tmp_path / "lab"
    carpeta.mkdir()
    return carpeta


def test_la_lectura_normal_no_recorre_eui(repo, monkeypatch):  # noqa: ANN001, ANN202
    """Tres lecturas seguidas sin cambios: ni un `rglob` sobre `.EUI`."""
    esquema.ensure_repo(str(repo))

    recorridos: list[str] = []
    ordenados: list[str] = []
    original = Path.rglob
    ignorar = esquema._ignorar_auxiliares

    def rglob_contado(self: Path, patron: str, **kwargs: object):  # noqa: ANN202
        recorridos.append(f"{self.name}/{patron}")
        return original(self, patron, **kwargs)  # type: ignore[arg-type]

    def ignorar_contado(db_file: Path) -> None:
        ordenados.append(str(db_file))
        ignorar(db_file)

    monkeypatch.setattr(Path, "rglob", rglob_contado)
    monkeypatch.setattr(esquema, "_ignorar_auxiliares", ignorar_contado)
    for _ in range(3):
        esquema.ensure_repo(str(repo))

    assert recorridos == []
    assert ordenados == []


def test_un_ajeno_nuevo_se_purga(repo):  # noqa: ANN001, ANN202
    """Un fichero que aparece después de ordenar mueve la huella y se purga."""
    esquema.ensure_repo(str(repo))
    eui = repo / ".EUI"
    (eui / "sobra.txt").write_text("x\n", encoding="utf-8")

    esquema.ensure_repo(str(repo))

    assert not (eui / "sobra.txt").exists()
    assert (eui / "EUI_DATABASE.sqlite").is_file()


def test_un_lote_sucio_en_migracion_se_purga(repo):  # noqa: ANN001, ANN202
    """La huella también mira `migracion/`, donde puede aparecer un plan suelto."""
    esquema.ensure_repo(str(repo))
    migracion = repo / ".EUI" / "migracion"
    migracion.mkdir()
    (migracion / "plan.json").write_text("{}\n", encoding="utf-8")

    esquema.ensure_repo(str(repo))

    assert not (migracion / "plan.json").exists()


def test_un_eui_recreado_se_vuelve_a_purgar(repo):  # noqa: ANN001, ANN202
    """Borrar `.EUI` y volver a sembrarlo no puede quedarse con lo ajeno dentro."""
    esquema.ensure_repo(str(repo))
    eui = repo / ".EUI"
    shutil.rmtree(eui)
    eui.mkdir()
    (eui / "sobra.txt").write_text("x\n", encoding="utf-8")

    esquema.ensure_repo(str(repo))

    assert (eui / "EUI_DATABASE.sqlite").is_file()
    assert not (eui / "sobra.txt").exists()
