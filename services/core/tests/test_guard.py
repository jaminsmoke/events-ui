"""La guarda del flujo: documentos, puertas y el veredicto de un hook."""

from __future__ import annotations

import io
import json
import sys
from pathlib import Path

from events_core import cli, config

MARCADOR = "- [eui:0123456789abcdef0123456789abcdef] Uno\n"


def _en_repo(carpeta: Path) -> None:
    config.guardar(repo=str(carpeta))


def _hook(monkeypatch, evento: object) -> None:  # noqa: ANN001
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(evento)))


def test_guard_en_verde(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    _en_repo(tmp_path)

    assert cli.main(["guard"]) == 0
    assert "sin documentos fuera del flujo" in capsys.readouterr().out


def test_guard_falla_con_documentos_ajenos(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    (tmp_path / "PARCIAL.md").write_text(MARCADOR, encoding="utf-8")
    _en_repo(tmp_path)

    assert cli.main(["guard"]) == 1
    salida = capsys.readouterr().out
    assert "PARCIAL.md" in salida
    assert "marcador" in salida


def test_guard_json(tmp_path: Path, capsys) -> None:  # noqa: ANN001
    _en_repo(tmp_path)

    assert cli.main(["guard", "--json"]) == 0
    datos = json.loads(capsys.readouterr().out)

    assert datos["ok"] is True
    assert datos["documentos"] == []
    assert {p["id"] for p in datos["puertas"]} == {"sin-ficha-activa"}


def test_guard_sin_raiz_sale_con_2(capsys) -> None:  # noqa: ANN001
    assert cli.main(["guard"]) == 2
    assert "no hay raíz" in capsys.readouterr().err


def test_hook_permite_lo_que_no_esta_cerrado(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001
    _en_repo(tmp_path)
    _hook(monkeypatch, {"tool": "item_get"})

    assert cli.main(["guard", "--hook"]) == 0


def test_hook_deniega_una_herramienta_cerrada(tmp_path: Path, monkeypatch, capsys) -> None:  # noqa: ANN001
    _en_repo(tmp_path)
    _hook(monkeypatch, {"tool": "item_fases"})

    assert cli.main(["guard", "--hook"]) == 2
    assert "puerta cerrada" in capsys.readouterr().err


def test_hook_deniega_un_markdown_dentro_de_eui(tmp_path: Path, monkeypatch, capsys) -> None:  # noqa: ANN001
    _en_repo(tmp_path)
    _hook(monkeypatch, {"ruta": ".EUI/ROADMAP.md"})

    assert cli.main(["guard", "--hook"]) == 2
    assert "ruta no permitida" in capsys.readouterr().err


def test_hook_permite_la_politica(tmp_path: Path, monkeypatch) -> None:  # noqa: ANN001
    _en_repo(tmp_path)
    _hook(monkeypatch, {"ruta": ".EUI/protocolos.json"})

    assert cli.main(["guard", "--hook"]) == 0


def test_hook_con_json_roto_sale_con_2(tmp_path: Path, monkeypatch, capsys) -> None:  # noqa: ANN001
    _en_repo(tmp_path)
    monkeypatch.setattr(sys, "stdin", io.StringIO("{no"))

    assert cli.main(["guard", "--hook"]) == 2
    assert "JSON válido" in capsys.readouterr().err
