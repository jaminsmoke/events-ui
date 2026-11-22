"""Absorción en seco: cobertura, copia y retirada sin escribir."""

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
    assert "stub" not in ficha
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


def test_absorb_no_cuenta_la_cabecera_con_subitems(client, tmp_path) -> None:
    archivo = _documento(
        tmp_path,
        "# ROADMAP\n\n- **Grupo.**\n  - **Uno.** Hecho.\n  - **Dos.** Pendiente.\n",
    )
    lote = _aplicar(client, archivo, [("uno", "Uno", 4)])

    informe = migracion.revisar_absorcion(tmp_path, lote["lote"])

    (ficha,) = informe["archivos"]
    assert ficha["bloques"] == 2
    assert [hueco["linea"] for hueco in ficha["sin_migrar"]] == [5]


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


def test_absorb_confirmar_copia_borra_y_exporta(client, tmp_path) -> None:
    texto = "# ROADMAP\n\n- **Uno.** Hecho.\n"
    archivo = _documento(tmp_path, texto)
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])

    informe = migracion.confirmar_absorcion(tmp_path, lote["lote"])

    assert informe["absorbido"] is True
    assert informe["dry_run"] is False
    assert informe["manifest"] == f".EUI/migracion/{lote['lote']}/absorcion.json"
    copia = tmp_path / ".EUI" / "migracion" / lote["lote"] / "ROADMAP.md"
    assert copia.read_text(encoding="utf-8") == texto
    assert not archivo.exists()
    assert (tmp_path / ".EUI" / "migracion" / lote["lote"] / "absorcion.json").is_file()

    exportado = migracion.exportar_documento(tmp_path, "ROADMAP.md")
    assert "# ROADMAP" in exportado
    assert "## Backlog" in exportado
    assert "**Uno**" in exportado


def test_absorb_confirmar_no_escribe_si_hay_huecos(client, tmp_path) -> None:
    texto = "# ROADMAP\n\n- **Uno.** Hecho.\n- **Dos.** Pendiente.\n"
    archivo = _documento(tmp_path, texto)
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])

    with pytest.raises(migracion.InvalidInput):
        migracion.confirmar_absorcion(tmp_path, lote["lote"])

    assert archivo.read_text(encoding="utf-8") == texto
    assert not (tmp_path / ".EUI" / "migracion" / lote["lote"]).exists()


def test_undo_restaura_el_documento_absorbido(client, tmp_path) -> None:
    texto = "# ROADMAP\n\n- **Uno.** Hecho.\n"
    archivo = _documento(tmp_path, texto)
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])
    migracion.confirmar_absorcion(tmp_path, lote["lote"])
    assert not archivo.exists()

    respuesta = client.delete(f"/migracion/lotes/{lote['lote']}", params={"repo": str(tmp_path)})

    assert respuesta.status_code == 200, respuesta.text
    assert archivo.read_text(encoding="utf-8") == texto
    assert not (tmp_path / ".EUI" / "migracion" / lote["lote"]).exists()
    assert client.get("/ideas", params={"repo": str(tmp_path)}).json() == []


def test_exportacion_ordena_y_agrupa_por_estado(client, tmp_path) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n- **Dos.** Pendiente.\n")
    _aplicar(client, archivo, [("uno", "Uno", 3), ("dos", "Dos", 4)])

    exportado = migracion.exportar_documento(tmp_path, "ROADMAP.md")

    assert exportado.index("## Backlog") < exportado.index("**Uno**")
    assert "**Dos**" in exportado
    assert "2 ítems" in exportado


def test_cli_absorb_json(client, tmp_path, capsys) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n")
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "absorb", lote["lote"], "--dry-run", "--json"]) == 0
    salida = json.loads(capsys.readouterr().out)
    assert salida["ok"] is True
    assert "stub" not in salida["archivos"][0]


def test_cli_absorb_confirmar_y_export(client, tmp_path, capsys) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n")
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])
    config.guardar(repo=str(tmp_path))

    assert cli.main(["migrate", "absorb", lote["lote"], "--confirmar", "--json"]) == 0
    salida = json.loads(capsys.readouterr().out)
    assert salida["absorbido"] is True
    assert salida["manifest"].endswith("absorcion.json")
    assert not archivo.exists()

    assert cli.main(["migrate", "export", "ROADMAP.md", "--salida", "vista.md"]) == 0
    vista = (tmp_path / "vista.md").read_text(encoding="utf-8")
    assert "## Backlog" in vista
    assert "**Uno**" in vista


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


def test_api_documentos_lista_y_exporta_sin_el_original(client, tmp_path) -> None:
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n")
    lote = _aplicar(client, archivo, [("uno", "Uno", 3)])
    migracion.confirmar_absorcion(tmp_path, lote["lote"])
    assert not archivo.exists()

    listado = client.get("/documentos", params={"repo": str(tmp_path)})
    assert listado.status_code == 200, listado.text
    (documento,) = listado.json()
    assert documento["ruta"] == "ROADMAP.md"
    assert documento["lote"] == lote["lote"]
    assert documento["items"] == 1
    assert documento["copia"] == f".EUI/migracion/{lote['lote']}/ROADMAP.md"

    vista = client.get(
        "/documentos/markdown",
        params={"repo": str(tmp_path), "ruta": "ROADMAP.md"},
    )
    assert vista.status_code == 200, vista.text
    assert vista.json()["ruta"] == "ROADMAP.md"
    assert "## Backlog" in vista.json()["texto"]
    assert "**Uno**" in vista.json()["texto"]


def test_api_documentos_inexistente(client, tmp_path) -> None:
    # La BD tiene que existir: el 404 que se prueba es el del documento, no el
    # de un repo que aún no se ha abierto nunca.
    archivo = _documento(tmp_path, "# ROADMAP\n\n- **Uno.** Hecho.\n")
    _aplicar(client, archivo, [("uno", "Uno", 3)])

    respuesta = client.get(
        "/documentos/markdown",
        params={"repo": str(tmp_path), "ruta": "NO-EXISTE.md"},
    )

    assert respuesta.status_code == 404
    assert "no hay un documento absorbido" in respuesta.json()["detail"]
