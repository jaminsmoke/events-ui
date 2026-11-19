"""Las mutaciones del core solo aceptan orígenes de la propia UI.

CORS impide leer una respuesta ajena, no ejecutar la petición: un POST simple
desde otra web llega al handler igual. El middleware corta antes.
"""

from __future__ import annotations


def test_un_post_de_otra_web_no_se_ejecuta(client, repo):  # noqa: ANN001, ANN202
    r = client.post(
        "/ideas",
        params={"repo": repo},
        json={"title": "A"},
        headers={"Origin": "https://evil.example"},
    )

    assert r.status_code == 403, r.json()
    assert r.json() == {"detail": "origen no permitido"}
    assert client.get("/mapa", params={"repo": repo}).json() == {"ideas": []}


def test_la_ui_de_dev_si_puede(client, repo):  # noqa: ANN001, ANN202
    r = client.post(
        "/ideas",
        params={"repo": repo},
        json={"title": "A"},
        headers={"Origin": "http://localhost:15175"},
    )

    assert r.status_code == 201, r.json()


def test_sin_origin_pasa(client, repo):  # noqa: ANN001, ANN202
    # curl, la CLI, el runner e2e y los tests no son una web: no hay Origin
    # que comprobar y un navegador no puede omitirlo.
    assert client.post("/ideas", params={"repo": repo}, json={"title": "A"}).status_code == 201


def test_el_bloqueo_cubre_patch_y_delete(client, repo):  # noqa: ANN001, ANN202
    uid = client.post("/ideas", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    ajeno = {"Origin": "https://evil.example"}

    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"title": "B"}, headers=ajeno)
    assert r.status_code == 403
    r = client.delete(f"/ideas/{uid}", params={"repo": repo}, headers=ajeno)
    assert r.status_code == 403
    assert client.get(f"/ideas/{uid}", params={"repo": repo}).json()["title"] == "A"
