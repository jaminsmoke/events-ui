"""El listado por el CLI y por el MCP: resumen por defecto, cuerpo a propósito.

La ruta ya devuelve un resumen (`?incluir=contenido` para el listado viejo).
Aquí se fija lo que ven quien usa la terminal y quien usa el MCP: las dos
llaman al CLI, así que el cuerpo no puede colarse por la puerta de atrás.
Las peticiones del CLI se enrutan a la app de verdad (`TestClient`), no a un
doble: lo que se comprueba es el camino completo.
"""

from __future__ import annotations

import json
from urllib.parse import urlsplit

import pytest
from fastapi.testclient import TestClient

from events_core import cli, mcp_servidor
from events_core.main import app


@pytest.fixture()
def http_a_la_app(monkeypatch):  # noqa: ANN001, ANN202
    """`cli._get` contra la app, para que el CLI hable con el core real."""
    cliente = TestClient(app, raise_server_exceptions=False)

    def falso(url: str):
        partes = urlsplit(url)
        destino = partes.path + (f"?{partes.query}" if partes.query else "")
        respuesta = cliente.get(destino)
        if not respuesta.is_success:
            return (None, respuesta.text, respuesta.status_code)
        return (respuesta.json(), None, respuesta.status_code)

    monkeypatch.setattr(cli, "_get", falso)
    return cliente


def _crear(client, repo, **campos):  # noqa: ANN001, ANN202
    r = client.post("/items", params={"repo": repo}, json=campos)
    assert r.status_code == 201, r.json()
    return r.json()


def test_el_listado_del_cli_no_trae_el_cuerpo(http_a_la_app, repo, capsys):  # noqa: ANN001, ANN202
    _crear(http_a_la_app, repo, title="A", content="## Cuerpo")

    assert cli.main(["item", "list", "--json", "--repo", repo]) == 0

    filas = json.loads(capsys.readouterr().out)
    assert filas[0]["title"] == "A"
    assert "content" not in filas[0]


def test_el_cli_pide_el_cuerpo_con_incluir(http_a_la_app, repo, capsys):  # noqa: ANN001, ANN202
    _crear(http_a_la_app, repo, title="A", content="## Cuerpo")

    assert cli.main(["item", "list", "--json", "--incluir", "contenido", "--repo", repo]) == 0

    filas = json.loads(capsys.readouterr().out)
    assert filas[0]["content"] == "## Cuerpo"


def test_item_get_del_cli_sigue_trayendo_el_cuerpo(http_a_la_app, repo, capsys):  # noqa: ANN001, ANN202
    creada = _crear(http_a_la_app, repo, title="A", content="## Cuerpo")

    assert cli.main(["item", "get", creada["uid"], "--json", "--repo", repo]) == 0

    assert json.loads(capsys.readouterr().out)["content"] == "## Cuerpo"


def test_el_item_list_del_mcp_devuelve_el_resumen(http_a_la_app, repo):  # noqa: ANN001, ANN202
    _crear(http_a_la_app, repo, title="A", content="## Cuerpo")

    respuesta = mcp_servidor.manejar(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "item_list", "arguments": {"repo": repo}},
        }
    )

    filas = json.loads(respuesta["result"]["content"][0]["text"])
    assert filas[0]["title"] == "A"
    assert "content" not in filas[0]


def test_el_item_get_del_mcp_sigue_trayendo_el_cuerpo(http_a_la_app, repo):  # noqa: ANN001, ANN202
    creada = _crear(http_a_la_app, repo, title="A", content="## Cuerpo")

    respuesta = mcp_servidor.manejar(
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"name": "item_get", "arguments": {"repo": repo, "uid": creada["uid"]}},
        }
    )

    assert json.loads(respuesta["result"]["content"][0]["text"])["content"] == "## Cuerpo"


def test_el_input_schema_de_item_list_no_gana_campos() -> None:
    """El resumen no se pide desde el MCP: el contrato de la herramienta no cambia."""
    herramientas = mcp_servidor.manejar({"jsonrpc": "2.0", "id": 1, "method": "tools/list"})[
        "result"
    ]["tools"]
    item_list = next(h for h in herramientas if h["name"] == "item_list")

    assert set(item_list["inputSchema"]["properties"]) == {
        "repo",
        "url",
        "port",
        "status",
        "kind",
        "limit",
        "offset",
    }
