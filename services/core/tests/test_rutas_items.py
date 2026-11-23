"""`/items` es la ruta principal y `/ideas` su alias con `Deprecation`."""

from __future__ import annotations

from fastapi.testclient import TestClient


def _crear(client: TestClient, repo: str, **campos: object) -> dict:
    r = client.post("/items", params={"repo": repo}, json={"title": "A", **campos})
    assert r.status_code == 201
    return r.json()


def test_items_y_el_alias_items_devuelven_lo_mismo(client: TestClient, repo: str) -> None:
    uid = _crear(client, repo)["uid"]

    principal = client.get(f"/items/{uid}", params={"repo": repo})
    alias = client.get(f"/ideas/{uid}", params={"repo": repo})

    assert principal.status_code == alias.status_code == 200
    assert principal.json() == alias.json()
    assert "Deprecation" not in principal.headers
    assert alias.headers["Deprecation"] == "true"


def test_el_alias_tambien_crea_y_marca_la_cabecera(client: TestClient, repo: str) -> None:
    r = client.post("/ideas", params={"repo": repo}, json={"title": "B"})

    assert r.status_code == 201
    assert r.headers["Deprecation"] == "true"
    assert client.get("/items", params={"repo": repo}).json()[0]["uid"] == r.json()["uid"]


def test_listado_y_mapa_por_items(client: TestClient, repo: str) -> None:
    uid = _crear(client, repo)["uid"]

    principal = client.get("/items", params={"repo": repo}).json()
    alias = client.get("/ideas", params={"repo": repo})

    assert principal == alias.json()
    assert principal[0]["uid"] == uid
    assert alias.headers["Deprecation"] == "true"
    assert client.get("/mapa", params={"repo": repo}).json()["ideas"][0]["uid"] == uid


def test_patch_y_delete_por_items(client: TestClient, repo: str) -> None:
    uid = _crear(client, repo)["uid"]

    movida = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert movida.status_code == 200
    assert movida.json()["status"] == "proposed"

    otra = _crear(client, repo, title="B")["uid"]
    descarte = client.patch(
        f"/items/{otra}",
        params={"repo": repo},
        json={"status": "rejected", "rejected_description": "prueba"},
    )
    assert descarte.status_code == 200
    borrada = client.delete(f"/items/{otra}", params={"repo": repo})
    assert borrada.status_code == 204
    assert [i["uid"] for i in client.get("/items", params={"repo": repo}).json()] == [uid]


def test_openapi_publica_items_y_marca_el_alias(client: TestClient) -> None:
    esquema = client.get("/openapi.json").json()
    rutas = esquema["paths"]

    assert "/items" in rutas
    assert "/items/{uid}" in rutas
    assert "deprecated" not in rutas["/items"]["get"]
    assert rutas["/ideas"]["get"]["deprecated"] is True
    assert rutas["/ideas/{uid}"]["patch"]["deprecated"] is True
    assert rutas["/ideas"]["post"]["deprecated"] is True
    assert rutas["/ideas/{uid}"]["delete"]["deprecated"] is True

    nombres = set(esquema["components"]["schemas"])
    assert {
        "WorkItem",
        "WorkItemCreate",
        "WorkItemUpdate",
        "WorkItemResumen",
        "MapWorkItem",
    } <= nombres
    assert not (nombres & {"Idea", "IdeaCreate", "IdeaUpdate", "IdeaResumen", "MapIdea"})
