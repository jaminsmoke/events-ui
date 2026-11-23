"""`.EUI` solo admite almacén, gitignore y lotes de migración."""

from __future__ import annotations

from pathlib import Path

import pytest

from events_core.items.base.comun import InvalidInput, escribir_atomico
from events_core.items.base.esquema import ensure_repo
from events_core.items.base.eui_fs import (
    es_permitida_en_eui,
    inventariar_ajenos,
    purgar_eui,
)


def test_permitidos_del_contrato() -> None:
    assert es_permitida_en_eui("EUI_DATABASE.sqlite")
    assert es_permitida_en_eui(".gitignore")
    assert es_permitida_en_eui("EUI_DATABASE.sqlite-wal")
    assert es_permitida_en_eui("migracion/a6af1c1d088044beb519fee2ad38c794/absorcion.json")
    assert es_permitida_en_eui("migracion/a6af1c1d088044beb519fee2ad38c794/docs/ROADMAP.md")


def test_rechaza_ajenos() -> None:
    assert not es_permitida_en_eui("build-release.log")
    assert not es_permitida_en_eui("updater/events-ui.key")
    assert not es_permitida_en_eui("verif41/setup.exe")
    assert not es_permitida_en_eui("migracion/plan.json")
    assert not es_permitida_en_eui("migracion/absorb-dry-run.json")
    assert not es_permitida_en_eui("migracion/no-es-un-lote/x.md")
    assert not es_permitida_en_eui("../fuera")


def test_purgar_deja_solo_el_contrato(tmp_path: Path) -> None:
    eui = tmp_path / ".EUI"
    lote = "a6af1c1d088044beb519fee2ad38c794"
    (eui / "migracion" / lote).mkdir(parents=True)
    (eui / "EUI_DATABASE.sqlite").write_bytes(b"db")
    (eui / ".gitignore").write_text("x\n", encoding="utf-8")
    (eui / "migracion" / lote / "absorcion.json").write_text("{}", encoding="utf-8")
    (eui / "migracion" / lote / "ROADMAP.md").write_text("#\n", encoding="utf-8")
    (eui / "core-dev.log").write_text("ruido\n", encoding="utf-8")
    (eui / "updater").mkdir()
    (eui / "updater" / "events-ui.key").write_text("secreto\n", encoding="utf-8")
    (eui / "migracion" / "plan.json").write_text("{}\n", encoding="utf-8")
    (eui / "verif41").mkdir()
    (eui / "verif41" / "setup.exe").write_bytes(b"exe")

    eliminados = purgar_eui(eui)

    assert (eui / "EUI_DATABASE.sqlite").is_file()
    assert (eui / ".gitignore").is_file()
    assert (eui / "migracion" / lote / "absorcion.json").is_file()
    assert (eui / "migracion" / lote / "ROADMAP.md").is_file()
    assert not (eui / "core-dev.log").exists()
    assert not (eui / "updater").exists()
    assert not (eui / "verif41").exists()
    assert not (eui / "migracion" / "plan.json").exists()
    assert "core-dev.log" in eliminados
    assert inventariar_ajenos(eui) == []


def test_escribir_atomico_bloquea_ajenos(tmp_path: Path) -> None:
    eui = tmp_path / ".EUI"
    eui.mkdir()
    with pytest.raises(InvalidInput, match="no permitida"):
        escribir_atomico(eui / "basura.log", b"no")
    escribir_atomico(eui / "EUI_DATABASE.sqlite", b"ok")
    assert (eui / "EUI_DATABASE.sqlite").read_bytes() == b"ok"


def test_ensure_repo_purga_ajenos(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EVENTSUI_REPOS_ROOT", str(tmp_path))
    repo = tmp_path / "lab"
    repo.mkdir()
    from events_core.items.base.esquema import init_repo

    init_repo(str(repo))
    eui = repo / ".EUI"
    (eui / "ruido.txt").write_text("x\n", encoding="utf-8")
    assert (eui / "ruido.txt").is_file()

    ensure_repo(str(repo))
    assert not (eui / "ruido.txt").exists()
    assert (eui / "EUI_DATABASE.sqlite").is_file()
