"""Absorción en seco: cobertura por fichero, copia y stub sin escribir."""

from __future__ import annotations

import hashlib
import json

import pytest

from events_core import cli, config, migracion


def _documento(tmp_path, texto: str):
    archivo = tmp_path / "ROADMAP.md"
    archivo.write_text(texto, encoding="utf-8")
    return archivo


def _plan(archivo, ideas: list[tuple[str, str, int]]) -> dict:
    sha = hashlib.sha256(archivo.read_bytes()).hexdigest()
    return {
        "version": 1,
        "ideas": [
            {
                "ref": ref,
                "title": title,
                "origen": {
                    "ruta": "ROADMAP.md",
                    "desde_linea": linea,
                    "hasta_linea": linea,
                    "sha256": sha,
                },
            }
            for ref, title, linea in ideas
        ],
    }


def _aplicar(client, archivo, ideas: list[tuple[str, str, int]]) -> dict:
    respuesta = client.post(
        "/migracion/aplicar",
        params={"repo": str(archivo.parent)},
        json=_plan(archivo, ideas),
    )
    assert respuesta.status_code == 200, respuesta.text
    return respuesta.json()


def test_absorb_cubre_el_fichero_entre_varios_lotes(client, tmp_path) -> None:
    texto = "# ROADMAP\n\n- **Uno.** Hecho.\n- **Dos.** Hecho.\n- **Tres.** Pendiente.\n"
    archivo = _documento(tmp_path, texto)
    primero = _aplicar(client, archivo, [("uno", "Uno", 3), ("dos", "Dos", 4)])
    segundo = _aplicar(client, archivo, [("tres", "Tres", 5)])

    informe = migracion.revisar_absorcion(tmp_path, segundo["lote"])

    assert informe["ok"] is True
    assert informe["dry_run"] is True
    assert informe["retirar"] == ["ROADMAP.md"]
    assert informe["resumen"] == {
        "archivos": 1,
        "ideas_lote": 1,
        "ideas_fichero": 3,
        "bloques": 3,
        "cubiertos": 3,
        "sin_migrar": 0,
    }
    (ficha,) = informe["archivos"]
    assert ficha["ideas_lote"] == 1
    assert ficha["ideas_fichero"] == 3
    assert ficha["cubiertos"] == 3
    assert ficha["sin_migrar"] == []
    assert set(ficha["lotes"]) == {primero["lote"], segundo["lote"]}
    assert ficha["copia"]["destino"] == f".EUI/migracion/{segundo['lote']}/ROADMAP.md"
    assert ficha["copia"]["sha256"] == ficha["hash_actual"]
    assert ficha["stub"]["ruta"] == "ROADMAP.md"
    assert "- Ideas: 3" in ficha["stub"]["contenido"]
    assert "- Lotes: 2" in ficha["stub"]["contenido"]
    assert archivo.read_text(encoding="utf-8") == texto
    assert not (tmp_path / ".EUI" / "migracion").exists()


def test_absorb_no_retira_si_queda_un_bloque_sin_migrar(client, tmp_path) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n- **Dos.** Pendiente.\n")
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])

    informe = migracion.revisar_absorcion(tmp_path, lote["lote"])

    assert informe["ok"] is False
    assert informe["retirar"] == []
    (ficha,) = informe["archivos"]
    assert ficha["cubiertos"] == 1
    assert [hueco["linea"] for hueco in ficha["sin_migrar"]] == [4]
    assert informe["resumen"]["sin_migrar"] == 1


def test_absorb_no_fia_de_un_fichero_cambiado(client, tmp_path) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n")
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])
    archivo.write_text("# ROADMAP\n\n- **Uno.** Cambiado.\n", encoding="utf-8")

    informe = migracion.revisar_absorcion(tmp_path, lote["lote"])

    assert informe["ok"] is False
    assert any("cambió" in error for error in informe["errores"])


def test_absorb_exige_bloques_accionables(client, tmp_path) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\nSolo contexto.\n")
    lote = _aplicar(client, archivo, [("uno", "Contexto", 1)])

    informe = migracion.revisar_absorcion(tmp_path, lote["lote"])

    assert informe["ok"] is False
    assert any("no hay bloques" in error for error in informe["errores"])


def test_absorb_de_un_lote_inexistente(client, tmp_path) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n")
    _aplicar(client, archivo, [("uno", "Uno", 3)])

    with pytest.raises(KeyError):
        migracion.revisar_absorcion(tmp_path, "no-existe")


def test_cli_absorb_json(client, tmp_path, capsys) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n")
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "absorb", lote["lote"], "--dry-run", "--json"]) == 0
    salida = json.loads(capsys.readouterr().out)
    assert salida["ok"] is True
    assert salida["archivos"][0]["stub"]["ruta"] == "ROADMAP.md"


def test_cli_absorb_con_huecos_sale_con_1(client, tmp_path, capsys) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n- **Dos.** Pendiente.\n")
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "absorb", lote["lote"]]) == 1
    assert "sin migrar" in capsys.readouterr().err


def test_cli_absorb_lote_inexistente(tmp_path, capsys) -> None:
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "absorb", "no-existe", "--json"]) == 1
    assert "no existe el lote" in capsys.readouterr().err
