"""Las mutaciones del core solo aceptan orígenes de la propia UI.

CORS impide leer una respuesta ajena, no ejecutar la petición: un POST simple
desde otra web llega al handler igual. El middleware corta antes.

La lista es exacta —esquema, host y puerto—: el webview de Tauri, lo que liste
`EVENTSUI_ORIGENES` y el propio origen del core. El comodín de bucle local solo
existe con `EVENTSUI_DESARROLLO`, que ponen `pnpm dev` y el runner e2e porque
Vite salta de puerto.
"""

from __future__ import annotations

from events_core import config


def _mismo_origen() -> tuple[str, str]:
    """Origen y Host con los que la web de `/webapp` se sirve a sí misma."""
    puerto = config.PUERTO_POR_DEFECTO
    return f"http://127.0.0.1:{puerto}", f"127.0.0.1:{puerto}"


def _post(client, repo, origen):  # noqa: ANN001, ANN202
    return client.post(
        "/items",
        params={"repo": repo},
        json={"title": "A"},
        headers={"Origin": origen},
    )


def test_un_post_de_otra_web_no_se_ejecuta(client, repo):  # noqa: ANN001, ANN202
    r = _post(client, repo, "https://evil.example")

    assert r.status_code == 403, r.json()
    assert r.json() == {"detail": "origen no permitido"}
    assert client.get("/mapa", params={"repo": repo}).json() == {"items": []}


def test_la_ui_de_dev_si_puede(client, repo, monkeypatch):  # noqa: ANN001, ANN202
    # `pnpm dev` arranca el core con el comodín local: Vite salta de puerto.
    monkeypatch.setenv("EVENTSUI_DESARROLLO", "1")

    assert _post(client, repo, "http://localhost:15175").status_code == 201


def test_sin_desarrollo_un_localhost_no_listado_no_pasa(client, repo, monkeypatch):  # noqa: ANN001, ANN202
    # El core de la app (y cualquier arranque sin el comodín) solo admite la
    # lista: otro dev server de la máquina no entra.
    monkeypatch.delenv("EVENTSUI_DESARROLLO", raising=False)
    monkeypatch.delenv("EVENTSUI_ORIGENES", raising=False)

    assert _post(client, repo, "http://localhost:15176").status_code == 403


def test_la_lista_del_entorno_abre_solo_sus_origenes(client, repo, monkeypatch):  # noqa: ANN001, ANN202
    monkeypatch.delenv("EVENTSUI_DESARROLLO", raising=False)
    monkeypatch.setenv("EVENTSUI_ORIGENES", "http://localhost:15176, http://127.0.0.1:15174")

    assert _post(client, repo, "http://localhost:15176").status_code == 201
    assert _post(client, repo, "http://127.0.0.1:15174").status_code == 201
    assert _post(client, repo, "http://localhost:15177").status_code == 403


def test_la_web_del_core_muta_desde_su_propio_origen(client, repo, monkeypatch):  # noqa: ANN001, ANN202
    # La web montada en `/webapp` habla con el mismo origen: el navegador manda
    # `Origin` igual y no es otra aplicación.
    monkeypatch.delenv("EVENTSUI_DESARROLLO", raising=False)

    origen, host = _mismo_origen()
    r = client.post(
        "/items",
        params={"repo": repo},
        json={"title": "A"},
        headers={"Origin": origen, "Host": host},
    )

    assert r.status_code == 201


def test_un_host_ajeno_no_pasa_por_parecer_el_mismo_origen(client, repo, monkeypatch):  # noqa: ANN001, ANN202
    # DNS rebinding: `evil.example` resuelto a 127.0.0.1 manda su propio Host y
    # Origin; coinciden, pero el Host no es de bucle local.
    monkeypatch.delenv("EVENTSUI_DESARROLLO", raising=False)

    _, host = _mismo_origen()
    r = client.post(
        "/items",
        params={"repo": repo},
        json={"title": "A"},
        headers={
            "Origin": f"http://evil.example:{host.split(':')[-1]}",
            "Host": f"evil.example:{host.split(':')[-1]}",
        },
    )

    assert r.status_code == 403


def test_sin_origin_pasa(client, repo):  # noqa: ANN001, ANN202
    # curl, la CLI, el runner e2e y los tests no son una web: no hay Origin
    # que comprobar y un navegador no puede omitirlo.
    assert client.post("/items", params={"repo": repo}, json={"title": "A"}).status_code == 201


def test_el_bloqueo_cubre_patch_y_delete(client, repo):  # noqa: ANN001, ANN202
    uid = client.post("/items", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    ajeno = {"Origin": "https://evil.example"}

    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"title": "B"}, headers=ajeno)
    assert r.status_code == 403
    r = client.delete(f"/items/{uid}", params={"repo": repo}, headers=ajeno)
    assert r.status_code == 403
    assert client.get(f"/items/{uid}", params={"repo": repo}).json()["title"] == "A"


def test_la_ui_en_otro_puerto_tambien_puede(client, repo, monkeypatch):  # noqa: ANN001, ANN202
    # Vite salta de puerto si el 15175 está ocupado (la app abierta, el runner
    # e2e): en desarrollo el comodín cubre el puerto real.
    monkeypatch.setenv("EVENTSUI_DESARROLLO", "1")

    assert _post(client, repo, "http://localhost:15176").status_code == 201


def test_un_host_que_solo_parece_localhost_no_pasa(client, repo):  # noqa: ANN001, ANN202
    assert _post(client, repo, "http://localhost.evil.example").status_code == 403
