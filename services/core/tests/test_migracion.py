"""Escaneo de Markdown: reconocimiento, límites, orden y CLI."""

from __future__ import annotations

import hashlib
import json

import pytest

from events_core import cli, config, migracion
from events_core.ideas.base.comun import InvalidInput


def test_escanear_reconoce_el_markdown(tmp_path) -> None:
    archivo = tmp_path / "docs" / "backlog.md"
    archivo.parent.mkdir()
    texto = (
        "---\n"
        "titulo: Backlog\n"
        "estado: viejo\n"
        "---\n"
        "\n"
        "# Backlog\n"
        "\n"
        "## Ideas\n"
        "\n"
        "- [ ] una\n"
        "- [x] otra\n"
        "\n"
        "```md\n"
        "## no cuenta\n"
        "- [ ] tampoco\n"
        "```\n"
    )
    archivo.write_text(texto, encoding="utf-8")

    informe = migracion.escanear(tmp_path, "docs")

    assert informe["ruta"] == "docs"
    assert informe["resumen"] == {"archivos": 1, "secciones": 1, "tareas": 2}
    assert informe["recortado"] is False
    (ficha,) = informe["archivos"]
    assert ficha["ruta"] == "docs/backlog.md"
    assert ficha["frontmatter"] == {"titulo": "Backlog", "estado": "viejo"}
    assert [titulo["texto"] for titulo in ficha["titulos"]] == ["Backlog", "Ideas"]
    assert ficha["tareas"] == {"total": 2, "hechas": 1}
    assert ficha["sha256"] == hashlib.sha256(archivo.read_bytes()).hexdigest()
    assert ficha["lineas"] == len(texto.splitlines())


def test_scan_ignora_ruido_y_ordena(tmp_path) -> None:
    for ruta in [
        "z.markdown",
        "b.md",
        "a.md",
        "notas.txt",
        ".git/dentro.md",
        "node_modules/dentro.md",
    ]:
        archivo = tmp_path / ruta
        archivo.parent.mkdir(parents=True, exist_ok=True)
        archivo.write_text("# t\n", encoding="utf-8")

    informe = migracion.escanear(tmp_path)

    assert [ficha["ruta"] for ficha in informe["archivos"]] == ["a.md", "b.md", "z.markdown"]


def test_scan_de_un_archivo_suelto(tmp_path) -> None:
    (tmp_path / "uno.md").write_text("## Uno\n", encoding="utf-8")

    informe = migracion.escanear(tmp_path, "uno.md")

    assert informe["ruta"] == "uno.md"
    assert [ficha["ruta"] for ficha in informe["archivos"]] == ["uno.md"]


def test_scan_no_sale_del_repo(tmp_path) -> None:
    with pytest.raises(InvalidInput):
        migracion.escanear(tmp_path, "..")


def test_scan_de_una_ruta_que_no_existe(tmp_path) -> None:
    with pytest.raises(FileNotFoundError):
        migracion.escanear(tmp_path, "no-existe")


def test_scan_exige_markdown_si_es_un_fichero(tmp_path) -> None:
    (tmp_path / "notas.txt").write_text("x", encoding="utf-8")

    with pytest.raises(InvalidInput):
        migracion.escanear(tmp_path, "notas.txt")


def test_cli_migrate_scan_json(tmp_path, capsys) -> None:
    (tmp_path / "a.md").write_text("# Hola\n\n## Uno\n", encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "scan", "--json"]) == 0
    informe = json.loads(capsys.readouterr().out)
    assert informe["archivos"][0]["ruta"] == "a.md"
    assert informe["resumen"]["secciones"] == 1


def test_cli_migrate_scan_humano(tmp_path, capsys) -> None:
    (tmp_path / "a.md").write_text("- [ ] una\n", encoding="utf-8")
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "scan"]) == 0
    salida = capsys.readouterr().out
    assert "a.md" in salida
    assert "1 tareas" in salida


def test_cli_migrate_sin_raiz(capsys) -> None:
    assert cli.main(["migrate", "scan"]) == 2
    assert "no hay raíz" in capsys.readouterr().err


def test_cli_migrate_ruta_invalida(tmp_path, capsys) -> None:
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "scan", ".."]) == 2
    assert "dentro del repo" in capsys.readouterr().err


def test_esquema_del_plan_cierra_lo_que_no_se_negocia() -> None:
    esquema = migracion.ESQUEMA_PLAN
    idea = esquema["$defs"]["idea"]
    origen = esquema["$defs"]["origen"]

    assert esquema["$id"] == "urn:events-ui:plan-migracion:1"
    assert set(esquema["required"]) == {"version", "ideas"}
    assert idea["required"] == ["ref", "title", "origen"]
    assert idea["properties"]["status"]["const"] == "proposed"
    assert idea["properties"]["kind"]["const"] == "idea"
    assert origen["required"] == ["ruta", "desde_linea", "hasta_linea", "sha256"]
    assert origen["properties"]["sha256"]["pattern"] == "^[0-9a-f]{64}$"
    assert esquema["$defs"]["fase"]["properties"]["estado"]["enum"] == ["pendiente"]
    assert esquema["$defs"]["requisito"]["properties"]["hecho"]["const"] is False


def test_cli_schema_migrate_pretty(capsys) -> None:
    assert cli.main(["schema", "migrate", "--pretty"]) == 0
    esquema = json.loads(capsys.readouterr().out)
    assert esquema["title"] == "Plan de migración de Markdown"


def test_cli_schema_migrate_en_una_linea(capsys) -> None:
    assert cli.main(["schema", "migrate"]) == 0
    salida = capsys.readouterr().out.strip()
    assert "\n" not in salida
    assert json.loads(salida)["$defs"]["idea"]["properties"]["status"]["const"] == "proposed"
