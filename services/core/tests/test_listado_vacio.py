"""El listado de un almacén sin ideas: la primera pantalla de un repo."""

from __future__ import annotations


def test_el_almacen_vacio_lista_sin_fallar(client, repo):  # noqa: ANN001, ANN202
    r = client.get("/ideas", params={"repo": repo})
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_un_offset_pasado_devuelve_lista_vacia(client, repo):  # noqa: ANN001, ANN202
    r = client.post("/ideas", params={"repo": repo}, json={"title": "A"})
    assert r.status_code == 201, r.json()

    r = client.get("/ideas", params={"repo": repo, "offset": 5})
    assert r.status_code == 200, r.text
    assert r.json() == []


def test_un_filtro_sin_resultados_devuelve_lista_vacia(client, repo):  # noqa: ANN001, ANN202
    r = client.get("/ideas", params={"repo": repo, "status": "roadmap"})
    assert r.status_code == 200, r.text
    assert r.json() == []
