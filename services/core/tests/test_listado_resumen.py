"""El listado como resumen: la fila no lleva el Markdown salvo que se pida.

`GET /ideas` es la pantalla de una lista, no la ficha: con 500 ideas y Markdown
absorbido, cada fila arrastraba su cuerpo entero. El detalle (`/ideas/{uid}`)
sigue trayéndolo, y `?incluir=contenido` mantiene el listado de antes para
quien lo necesite.
"""

from __future__ import annotations

import json


def _crear(client, repo, **campos):  # noqa: ANN001, ANN202
    r = client.post("/ideas", params={"repo": repo}, json=campos)
    assert r.status_code == 201, r.json()
    return r.json()


def test_el_listado_no_trae_el_cuerpo(client, repo):  # noqa: ANN001, ANN202
    _crear(client, repo, title="A", content="## Cuerpo")

    r = client.get("/ideas", params={"repo": repo})

    assert r.status_code == 200, r.text
    fila = r.json()[0]
    assert "content" not in fila
    assert fila["title"] == "A"
    assert fila["status"] == "draft"


def test_incluir_contenido_mantiene_el_listado_de_antes(client, repo):  # noqa: ANN001, ANN202
    _crear(client, repo, title="A", content="## Cuerpo")

    r = client.get("/ideas", params={"repo": repo, "incluir": "contenido"})

    assert r.status_code == 200, r.text
    assert r.json()[0]["content"] == "## Cuerpo"


def test_la_ficha_sigue_trayendo_el_cuerpo(client, repo):  # noqa: ANN001, ANN202
    creada = _crear(client, repo, title="A", content="## Cuerpo")

    r = client.get(f"/ideas/{creada['uid']}", params={"repo": repo})

    assert r.status_code == 200, r.text
    assert r.json()["content"] == "## Cuerpo"


def test_un_cuerpo_grande_no_engorda_la_fila(client, repo):  # noqa: ANN001, ANN202
    _crear(client, repo, title="A", content="x" * 20_000)

    resumen = client.get("/ideas", params={"repo": repo}).json()[0]
    completo = client.get("/ideas", params={"repo": repo, "incluir": "contenido"}).json()[0]

    assert len(json.dumps(resumen)) < 1024
    assert len(json.dumps(completo)) > 20_000


def test_el_resumen_cuenta_las_fases_y_los_requisitos(client, repo):  # noqa: ANN001, ANN202
    _crear(
        client,
        repo,
        title="A",
        fases=[
            {"titulo": "Primera", "requisitos": [{"titulo": "R1"}, {"titulo": "R2"}]},
            {"titulo": "Segunda", "requisitos": [{"titulo": "R3"}]},
        ],
    )

    fila = client.get("/ideas", params={"repo": repo}).json()[0]

    assert fila["fases_hechas"] == 0
    assert fila["fases_total"] == 2
    assert fila["requisitos_hechos"] == 0
    assert fila["requisitos_total"] == 3


def test_el_resumen_lleva_las_etiquetas_y_las_dependencias(client, repo):  # noqa: ANN001, ANN202
    base = _crear(client, repo, title="Base")
    _crear(client, repo, title="Otra", tags=["api"], depende_de=[base["uid"]])

    filas = client.get("/ideas", params={"repo": repo}).json()
    otra = next(fila for fila in filas if fila["title"] == "Otra")

    assert otra["tags"] == ["api"]
    assert otra["depende_de"] == [base["uid"]]
