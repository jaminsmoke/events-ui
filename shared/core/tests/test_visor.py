"""Lectura de archivos para el visor (`GET /archivo`).

El visor pide texto, no binarios: la respuesta se acota a 512 KiB, tolera
bytes UTF-8 inválidos y una ruta con `..` no sale de la raíz del repo.
"""

from __future__ import annotations

from pathlib import Path

from events_core import arbol


def _pedir(client, carpeta: Path, ruta: str):  # noqa: ANN001, ANN202
    return client.get("/archivo", params={"repo": str(carpeta), "ruta": ruta})


def test_lee_texto_y_devuelve_la_ruta_canonica(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "lectura"
    (carpeta / "docs").mkdir(parents=True)
    texto = "# hola\n\nAñadido.\n"
    # Bytes, no `write_text`: en Windows traduciría los saltos a CRLF.
    (carpeta / "docs" / "nota.md").write_bytes(texto.encode("utf-8"))

    r = _pedir(client, carpeta, "docs/./../docs/nota.md")

    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["ruta"] == "docs/nota.md"
    assert datos["texto"] == texto
    assert datos["bytes"] == len(texto.encode("utf-8"))
    assert datos["truncado"] is False


def test_un_archivo_vacio_es_texto_vacio(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "vacio"
    carpeta.mkdir()
    (carpeta / "vacio.txt").write_text("", encoding="utf-8")

    datos = _pedir(client, carpeta, "vacio.txt").json()

    assert datos["texto"] == ""
    assert datos["bytes"] == 0


def test_404_si_no_existe_o_es_una_carpeta(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "ausente"
    (carpeta / "docs").mkdir(parents=True)

    assert _pedir(client, carpeta, "no-existe.txt").status_code == 404
    assert _pedir(client, carpeta, "docs").status_code == 404


def test_una_ruta_que_se_sale_del_repo_es_400(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "dentro"
    carpeta.mkdir()
    (tmp_path / "secreto.txt").write_text("fuera", encoding="utf-8")

    r = _pedir(client, carpeta, "../secreto.txt")

    assert r.status_code == 400, r.text
    # El detalle nombra la ruta pedida, pero no se devuelve el contenido.
    assert "texto" not in r.json()


def test_un_binario_es_415(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "binario"
    carpeta.mkdir()
    (carpeta / "imagen.png").write_bytes(b"\x89PNG\r\n\x1a\n\x00\x00resto")

    r = _pedir(client, carpeta, "imagen.png")

    assert r.status_code == 415, r.text
    assert "texto legible" in r.json()["detail"]


def test_los_bytes_utf8_invalidos_se_sustituyen(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "codificacion"
    carpeta.mkdir()
    (carpeta / "raro.txt").write_bytes(b"hola \xff mundo")

    r = _pedir(client, carpeta, "raro.txt")

    assert r.status_code == 200, r.text
    datos = r.json()
    assert datos["texto"].startswith("hola ")
    assert "\ufffd" in datos["texto"]
    assert datos["truncado"] is False


def test_se_corta_en_el_limite_y_lo_avisa(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "grande"
    carpeta.mkdir()
    contenido = b"a" * (arbol.LIMITE_ARCHIVO + 10)
    (carpeta / "grande.txt").write_bytes(contenido)

    datos = _pedir(client, carpeta, "grande.txt").json()

    assert datos["truncado"] is True
    assert len(datos["texto"]) == arbol.LIMITE_ARCHIVO
    assert datos["bytes"] == len(contenido)
