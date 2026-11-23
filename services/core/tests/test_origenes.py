"""Las mutaciones del core solo aceptan orígenes de la propia UI.

CORS impide leer una respuesta ajena, no ejecutar la petición: un POST simple
desde otra web llega al handler igual. El middleware corta antes.
"""

from __future__ import annotations


def test_un_post_de_otra_web_no_se_ejecuta(client, repo):  # noqa: ANN001, ANN202
    r = client.post(
        "/items",
        params={"repo": repo},
        json={"title": "A"},
        headers={"Origin": "https://evil.example"},
    )

    assert r.status_code == 403, r.json()
    assert r.json() == {"detail": "origen no permitido"}
    assert client.get("/mapa", params={"repo": repo}).json() == {"ideas": []}


def test_la_ui_de_dev_si_puede(client, repo):  # noqa: ANN001, ANN202
    r = client.post(
        "/items",
        params={"repo": repo},
        json={"title": "A"},
        headers={"Origin": "http://localhost:15175"},
    )

    assert r.status_code == 201, r.json()


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


def test_la_ui_en_otro_puerto_tambien_puede(client, repo):  # noqa: ANN001, ANN202
    # Vite salta de puerto si el 15175 está ocupado (la app abierta, el runner
    # e2e): el origen cambia de puerto y el commit del panel no puede quedarse
    # fuera por eso.
    r = client.post(
        "/items",
        params={"repo": repo},
        json={"title": "A"},
        headers={"Origin": "http://localhost:15176"},
    )

    assert r.status_code == 201, r.json()


def test_un_host_que_solo_parece_localhost_no_pasa(client, repo):  # noqa: ANN001, ANN202
    r = client.post(
        "/items",
        params={"repo": repo},
        json={"title": "A"},
        headers={"Origin": "http://localhost.evil.example"},
    )

    assert r.status_code == 403
