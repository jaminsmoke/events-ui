"""`/items` es la única ruta de ítems: los alias `/ideas` ya no existen."""

from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _crear(client: TestClient, repo: str, **campos: object) -> dict:
    r = client.post("/items", params={"repo": repo}, json={"title": "A", **campos})
    assert r.status_code == 201
    return r.json()


def _montar_web(client: TestClient, tmp_path: Path) -> None:
    """Monta un `dist` mínimo.

    Sin web, un GET a una ruta vieja no lo atiende nadie (el catch-all es solo
    de escritura) y devuelve 405: el 404 de las rutas viejas se comprueba con
    la web montada, que es el caso real.
    """
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html>", encoding="utf-8")
    assert client.post("/webapp", json={"dist": str(dist)}).status_code == 200


def test_las_rutas_viejas_responden_404(client: TestClient, repo: str, tmp_path: Path) -> None:
    uid = _crear(client, repo)["uid"]
    _montar_web(client, tmp_path)

    assert client.get("/ideas", params={"repo": repo}).status_code == 404
    assert client.post("/ideas", params={"repo": repo}, json={"title": "B"}).status_code == 404
    assert client.get(f"/ideas/{uid}", params={"repo": repo}).status_code == 404
    assert (
        client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"title": "B"}).status_code == 404
    )
    assert client.delete(f"/ideas/{uid}", params={"repo": repo}).status_code == 404


def test_listado_y_mapa_por_items(client: TestClient, repo: str) -> None:
    uid = _crear(client, repo)["uid"]

    principal = client.get("/items", params={"repo": repo}).json()

    assert principal[0]["uid"] == uid
    assert client.get("/mapa", params={"repo": repo}).json()["items"][0]["uid"] == uid


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


def test_openapi_solo_publica_items(client: TestClient) -> None:
    esquema = client.get("/openapi.json").json()
    rutas = esquema["paths"]

    assert "/items" in rutas
    assert "/items/{uid}" in rutas
    assert "/ideas" not in rutas
    assert "/ideas/{uid}" not in rutas
    assert "deprecated" not in rutas["/items"]["get"]

    nombres = set(esquema["components"]["schemas"])
    assert {
        "WorkItem",
        "WorkItemCreate",
        "WorkItemUpdate",
        "WorkItemResumen",
        "MapWorkItem",
    } <= nombres
    assert not (nombres & {"Idea", "IdeaCreate", "IdeaUpdate", "IdeaResumen", "MapIdea"})
