"""Las fases de la idea (0021): se exigen por protocolo y llevan su estado.

Cubre: el gate al entrar en roadmap (con y sin fases en el mismo PATCH), que
`entered_at` se conserve cuando el estado no cambia, las listas inválidas y la
cascada al borrar la idea.
"""

from __future__ import annotations

import sqlite3

from events_core import ideas


def _crear(client, repo, **kw):  # noqa: ANN001, ANN202
    r = client.post("/ideas", params={"repo": repo}, json={"title": "A", **kw})
    assert r.status_code == 201, r.json()
    return r.json()["uid"]


def _fases(client, repo, uid):  # noqa: ANN001, ANN202
    r = client.get(f"/ideas/{uid}", params={"repo": repo})
    assert r.status_code == 200, r.json()
    return r.json()["fases"]


def test_entrar_en_roadmap_exige_una_fase(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")

    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "roadmap"})
    assert r.status_code == 400
    assert "fase" in r.json()["detail"]
    assert client.get(f"/ideas/{uid}", params={"repo": repo}).json()["status"] == "proposed"
    assert _fases(client, repo, uid) == []

    # Las fases viajan en el mismo PATCH: el gate y el traslado son atómicos.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"status": "roadmap", "fases": [{"titulo": "Diseño"}, {"titulo": "Prueba"}]},
    )
    assert r.status_code == 200, r.json()
    ficha = r.json()
    assert ficha["status"] == "roadmap"
    assert [(f["orden"], f["titulo"], f["estado"]) for f in ficha["fases"]] == [
        (1, "Diseño", "pendiente"),
        (2, "Prueba", "pendiente"),
    ]
    assert all(f["entered_at"] for f in ficha["fases"])

    mapa = client.get("/mapa", params={"repo": repo}).json()["ideas"]
    assert [f["titulo"] for f in mapa[0]["fases"]] == ["Diseño", "Prueba"]


def test_fases_conservan_su_fecha_al_editar(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"status": "roadmap", "fases": [{"titulo": "Una"}, {"titulo": "Dos"}]},
    )
    fechas = [f["entered_at"] for f in r.json()["fases"]]

    # Mismo estado, misma fecha; estado nuevo, fecha nueva.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {"orden": 1, "titulo": "Una", "estado": "completada"},
                {"orden": 2, "titulo": "Dos", "estado": "pendiente"},
            ]
        },
    )
    assert r.status_code == 200, r.json()
    fases = r.json()["fases"]
    assert fases[0]["estado"] == "completada"
    # La que no cambió de estado conserva su fecha de entrada.
    assert fases[1]["entered_at"] == fechas[1]

    # Sin `orden`, la fase nueva se añade al final.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {"orden": 1, "titulo": "Una", "estado": "completada"},
                {"orden": 2, "titulo": "Dos", "estado": "pendiente"},
                {"titulo": "Tres"},
            ]
        },
    )
    assert [f["orden"] for f in r.json()["fases"]] == [1, 2, 3]


def test_fases_invalidas_no_escriben(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo)
    # `estado` y `orden` los valida el contrato (422); lo que solo puede ver el
    # core (título vacío, orden repetido) sale como 400.
    for fases, codigo in (
        ([{"titulo": "   "}], 400),
        ([{"titulo": "A", "estado": "hecha"}], 422),
        ([{"titulo": "A", "orden": 1}, {"titulo": "B", "orden": 1}], 400),
        ([{"titulo": "A", "orden": 0}], 422),
    ):
        r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"fases": fases})
        assert r.status_code == codigo, fases
        assert "detail" in r.json()

    assert _fases(client, repo, uid) == []


def test_borrar_la_idea_se_lleva_sus_fases(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"status": "roadmap", "fases": [{"titulo": "Única"}]},
    )
    assert r.status_code == 200, r.json()

    assert client.delete(f"/ideas/{uid}", params={"repo": repo}).status_code == 204
    with sqlite3.connect(str(ideas.db_file_for(repo))) as conn:
        assert conn.execute("SELECT count(*) FROM idea_fase").fetchone()[0] == 0


def test_protocolos_publican_el_requisito(client, repo):  # noqa: ANN001, ANN202
    filas = client.get("/protocolos", params={"repo": repo}).json()
    exigidas = {(f["origen"], f["destino"]) for f in filas if f["exige_fases"]}
    assert exigidas == {("proposed", "roadmap")}
    assert all(isinstance(f["exige_fases"], bool) for f in filas)
