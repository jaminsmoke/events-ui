"""La web instalada se puede montar en un core que ya está vivo.

El desktop enciende el core sin `EUI_WEB_DIST`; `eui web` le pasa el `dist` del
paquete npm con `POST /webapp`. Aquí se prueba el montaje, que cambiar de dist
en caliente sirve el nuevo y que la web lee `DIST_WEB` en cada petición: el
montaje no guarda la carpeta dentro de un `StaticFiles` mutable.
"""

from pathlib import Path

from fastapi.testclient import TestClient

from events_core import webapp


def _dist(base: Path, titulo: str) -> Path:
    dist = base / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text(f"<!doctype html><title>{titulo}</title>", encoding="utf-8")
    (dist / "assets" / "app.js").write_text("console.log('web')", encoding="utf-8")
    return dist


def test_montar_la_web_en_caliente(client: TestClient, tmp_path: Path) -> None:
    original = webapp.DIST_WEB
    dist = _dist(tmp_path, "web")

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
        webapp.DIST_WEB = original


def test_cambiar_de_dist_en_caliente(client: TestClient, tmp_path: Path) -> None:
    original = webapp.DIST_WEB
    primero = _dist(tmp_path / "uno", "uno")
    segundo = _dist(tmp_path / "dos", "dos")

    try:
        assert client.post("/webapp", json={"dist": str(primero)}).status_code == 200
        assert "<title>uno</title>" in client.get("/").text

        assert client.post("/webapp", json={"dist": str(segundo)}).status_code == 200
        assert "<title>dos</title>" in client.get("/").text
    finally:
        webapp.DIST_WEB = original


def test_la_web_lee_el_dist_en_cada_peticion(client: TestClient, tmp_path: Path) -> None:
    """`DIST_WEB` es el único mando: se mira al atender, no al montar.

    Antes el `dist` quedaba fijado dentro del `StaticFiles` montado y solo
    cambiaba mutando `directory`/`all_directories`, atributos internos de
    Starlette. Ahora mover `DIST_WEB` cambia lo que sirve la siguiente petición,
    que es justo lo que hace `POST /webapp`.
    """
    original = webapp.DIST_WEB
    primero = _dist(tmp_path / "uno", "uno")
    segundo = _dist(tmp_path / "dos", "dos")

    try:
        assert client.post("/webapp", json={"dist": str(primero)}).status_code == 200
        assert "<title>uno</title>" in client.get("/").text

        webapp.DIST_WEB = segundo
        assert "<title>dos</title>" in client.get("/").text
    finally:
        webapp.DIST_WEB = original


def test_rechaza_una_carpeta_que_no_es_un_dist(client: TestClient, tmp_path: Path) -> None:
    respuesta = client.post("/webapp", json={"dist": str(tmp_path)})
    assert respuesta.status_code == 400
    assert "index.html" in respuesta.json()["detail"]
