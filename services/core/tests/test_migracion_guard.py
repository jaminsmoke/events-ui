"""La guarda de documentos: lo que suplanta al flujo se lista, no se toca."""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path

import pytest

from events_core import cli, migracion
from events_core.items.base.esquema import init_repo


def _store(repo: Path) -> Path:
    init_repo(str(repo))
    return repo / ".EUI" / "EUI_DATABASE.sqlite"


def test_un_readme_a_mano_no_es_un_documento(tmp_path: Path) -> None:
    (tmp_path / "README.md").write_text("# Proyecto\n\n- Instalar.\n", encoding="utf-8")

    assert migracion.documentos_ajenos(tmp_path) == []


def test_marca_un_markdown_suelto_dentro_de_eui(tmp_path: Path) -> None:
    (tmp_path / ".EUI").mkdir()
    (tmp_path / ".EUI" / "ROADMAP.md").write_text("# ROADMAP\n", encoding="utf-8")

    ajenos = migracion.documentos_ajenos(tmp_path)

    assert [documento["ruta"] for documento in ajenos] == [".EUI/ROADMAP.md"]
    assert "copia de absorción" in ajenos[0]["motivo"]


def test_la_copia_de_absorcion_no_es_ajena(tmp_path: Path) -> None:
    lote = "a6af1c1d088044beb519fee2ad38c794"
    copia = tmp_path / ".EUI" / "migracion" / lote / "ROADMAP.md"
    copia.parent.mkdir(parents=True)
    copia.write_text("# ROADMAP\n", encoding="utf-8")

    assert migracion.documentos_ajenos(tmp_path) == []


def test_marca_la_ruta_absorbida_que_vuelve(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    (tmp_path / "ROADMAP.md").write_text("# ROADMAP\n", encoding="utf-8")
    monkeypatch.setattr(
        migracion,
        "listar_documentos_absorbidos",
        lambda raiz: [{"ruta": "ROADMAP.md", "lote": "x", "absorbido_at": "", "items": 1}],
    )

    ajenos = migracion.documentos_ajenos(tmp_path)

    assert [documento["ruta"] for documento in ajenos] == ["ROADMAP.md"]
    assert "absorción retiró" in ajenos[0]["motivo"]


def test_marca_un_marcador_que_el_almacen_no_conoce(tmp_path: Path) -> None:
    db = _store(tmp_path)
    conocido = uuid.uuid4().hex
    desconocido = uuid.uuid4().hex
    with sqlite3.connect(db) as conn:
        conn.execute(
            "INSERT INTO work_item_data (uid, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
            (conocido, "Uno", "2026-01-01T00:00:00+00:00", "2026-01-01T00:00:00+00:00"),
        )
    (tmp_path / "PARCIAL.md").write_text(
        f"- [eui:{conocido}] Uno\n- [eui:{desconocido}] Dos\n", encoding="utf-8"
    )

    ajenos = migracion.documentos_ajenos(tmp_path)

    assert [documento["ruta"] for documento in ajenos] == ["PARCIAL.md"]
    assert desconocido in ajenos[0]["motivo"]
    assert conocido not in ajenos[0]["motivo"]


def test_guard_sale_con_uno_y_lista(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    (tmp_path / ".EUI").mkdir()
    (tmp_path / ".EUI" / "ROADMAP.md").write_text("# ROADMAP\n", encoding="utf-8")

    codigo = cli.main(["migrate", "guard", "--repo", str(tmp_path)])

    assert codigo == 1
    assert ".EUI/ROADMAP.md" in capsys.readouterr().out


def test_guard_en_verde(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    (tmp_path / "README.md").write_text("# Proyecto\n", encoding="utf-8")

    codigo = cli.main(["migrate", "guard", "--repo", str(tmp_path)])

    assert codigo == 0
    assert "sin documentos fuera del flujo" in capsys.readouterr().out
