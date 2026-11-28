"""CORS y mutaciones comparten la misma allowlist.

`VITE_API_URL` promete que una web estática puede apuntar al core: para eso el
core no solo tiene que ejecutar la petición, también dejar LEER la respuesta
desde ese origen. La lista es la misma que la de las mutaciones
(`EVENTSUI_ORIGENES`, el webview de Tauri y el comodín de desarrollo), así que
no hay dos modelos de confianza que se puedan desincronizar.
"""

from __future__ import annotations


def _leer(client, origen):  # noqa: ANN001, ANN202
    return client.get("/health", headers={"Origin": origen})


def _preflight(client, origen):  # noqa: ANN001, ANN202
    return client.options(
        "/items",
        headers={
            "Origin": origen,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )


def test_el_origen_de_la_lista_puede_leer(client, monkeypatch):  # noqa: ANN001, ANN202
    monkeypatch.delenv("EVENTSUI_DESARROLLO", raising=False)
    monkeypatch.setenv("EVENTSUI_ORIGENES", "http://localhost:15174")

    r = _leer(client, "http://localhost:15174")

    assert r.status_code == 200
    assert r.headers["access-control-allow-origin"] == "http://localhost:15174"


def test_el_preflight_del_origen_listado_pasa(client, monkeypatch):  # noqa: ANN001, ANN202
    monkeypatch.delenv("EVENTSUI_DESARROLLO", raising=False)
    monkeypatch.setenv("EVENTSUI_ORIGENES", "http://localhost:15174")

    r = _preflight(client, "http://localhost:15174")

    assert r.status_code == 200, r.text
    assert r.headers["access-control-allow-origin"] == "http://localhost:15174"
    assert "POST" in r.headers["access-control-allow-methods"]
    assert "content-type" in r.headers["access-control-allow-headers"].lower()


def test_un_origen_ajeno_no_recibe_permiso(client, monkeypatch):  # noqa: ANN001, ANN202
    monkeypatch.delenv("EVENTSUI_DESARROLLO", raising=False)
    monkeypatch.delenv("EVENTSUI_ORIGENES", raising=False)

    r = _leer(client, "https://evil.example")

    assert r.status_code == 200
    assert "access-control-allow-origin" not in r.headers


def test_el_webview_de_tauri_sigue_leyendo(client):  # noqa: ANN001, ANN202
    r = _leer(client, "tauri://localhost")

    assert r.headers["access-control-allow-origin"] == "tauri://localhost"


def test_en_desarrollo_la_ui_de_vite_lee(client, monkeypatch):  # noqa: ANN001, ANN202
    # En dev la UI habla con Vite (otro origen) y Vite proxyfica: el navegador
    # no necesita CORS. Pero si la web apunta directo al core con
    # `VITE_API_URL`, el comodín de desarrollo también la deja leer.
    monkeypatch.setenv("EVENTSUI_DESARROLLO", "1")

    r = _leer(client, "http://localhost:15175")

    assert r.headers["access-control-allow-origin"] == "http://localhost:15175"
