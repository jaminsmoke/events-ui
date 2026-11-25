"""La web instalada se puede montar en un core que ya está vivo.

El desktop enciende el core sin `EUI_WEB_DIST`; `eui web` le pasa el `dist` del
paquete npm con `POST /webapp`. Aquí se prueba el montaje y que la API sigue
respondiendo con el mismo origen.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from events_core import main


def _dist(tmp_path: Path) -> Path:
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>web</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('web')", encoding="utf-8")
    return dist


def test_montar_la_web_en_caliente(client: TestClient, tmp_path: Path) -> None:
    original = main.DIST_WEB
    estatica = main.WEB_STATIC
    directorio = estatica.directory if estatica else None
    directorios = list(estatica.all_directories) if estatica else None
    dist = _dist(tmp_path)

    try:
        respuesta = client.post("/webapp", json={"dist": str(dist)})
        assert respuesta.status_code == 200
        assert respuesta.json()["dist"] == str(dist.resolve())

        portada = client.get("/")
        assert portada.status_code == 200
        assert "<title>web</title>" in portada.text

        asset = client.get("/assets/app.js")
        assert asset.status_code == 200
        assert asset.text == "console.log('web')"

        # El mismo origen sigue sirviendo la API (el middleware quita `/api`).
        assert client.get("/api/health").status_code == 200
    finally:
        main.DIST_WEB = original
        if estatica is not None and directorio is not None and directorios is not None:
            estatica.directory = directorio
            estatica.all_directories = directorios


def test_rechaza_una_carpeta_que_no_es_un_dist(client: TestClient, tmp_path: Path) -> None:
    respuesta = client.post("/webapp", json={"dist": str(tmp_path)})
    assert respuesta.status_code == 400
    assert "index.html" in respuesta.json()["detail"]
