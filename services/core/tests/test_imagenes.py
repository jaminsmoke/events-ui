"""Imágenes para el visor (`GET /archivo-bytes`).

Solo se sirven tipos `image/*`, con su `Content-Type` y hasta 12 MiB; las
mismas guardas de ruta que `/archivo` y `/arbol`.
"""

from __future__ import annotations

from pathlib import Path

from events_core import arbol

# Cabecera PNG mínima: basta para que el tipo y los bytes viajen enteros.
PNG = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489")


def _pedir(client, carpeta: Path, ruta: str):  # noqa: ANN001, ANN202
    return client.get("/archivo-bytes", params={"repo": str(carpeta), "ruta": ruta})


def test_sirve_una_imagen_con_su_tipo(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "imagenes"
    carpeta.mkdir()
    (carpeta / "pixel.png").write_bytes(PNG)

    r = _pedir(client, carpeta, "pixel.png")

    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.content == PNG


def test_un_svg_tambien_es_imagen(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "svg"
    carpeta.mkdir()
    (carpeta / "icono.svg").write_bytes(b'<svg xmlns="http://www.w3.org/2000/svg"/>')

    r = _pedir(client, carpeta, "icono.svg")

    assert r.status_code == 200, r.text
    assert r.headers["content-type"] == "image/svg+xml"


def test_un_texto_no_se_sirve_como_imagen(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "texto"
    carpeta.mkdir()
    (carpeta / "nota.txt").write_bytes(b"hola")

    r = _pedir(client, carpeta, "nota.txt")

    assert r.status_code == 415, r.text
    assert "No es una imagen" in r.json()["detail"]


def test_404_si_no_existe_o_es_una_carpeta(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "ausente"
    (carpeta / "docs").mkdir(parents=True)

    assert _pedir(client, carpeta, "no-existe.png").status_code == 404
    assert _pedir(client, carpeta, "docs").status_code == 404


def test_una_ruta_que_se_sale_del_repo_es_400(client, tmp_path):  # noqa: ANN001, ANN202
    carpeta = tmp_path / "dentro"
    carpeta.mkdir()
    (tmp_path / "secreto.png").write_bytes(PNG)

    r = _pedir(client, carpeta, "../secreto.png")

    assert r.status_code == 400, r.text
    assert "detail" in r.json()


def test_413_si_supera_el_tope(client, tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    monkeypatch.setattr(arbol, "LIMITE_IMAGEN", 10)
    carpeta = tmp_path / "grande"
    carpeta.mkdir()
    (carpeta / "grande.png").write_bytes(PNG)

    r = _pedir(client, carpeta, "grande.png")

    assert r.status_code == 413, r.text
    assert "12 MiB" in r.json()["detail"]
