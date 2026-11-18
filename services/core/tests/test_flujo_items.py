"""El flujo completo de items (0013): entrada, cola, roadmap y verificación.

Cubre: el recorrido entero con sus campos propios, el regreso de
verificación a cola (al final de la cola), las transiciones prohibidas y
la regla de un solo item activo en roadmap.
"""

from __future__ import annotations

import sqlite3

from events_core import ideas


def _crear(client, repo, **kw):  # noqa: ANN001, ANN202
    return client.post("/ideas", params={"repo": repo}, json={"title": "A", **kw}).json()["uid"]


def _paso(client, repo, uid, status, **detalle):  # noqa: ANN001, ANN202
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": status, **detalle})
    assert r.status_code == 200, r.json()
    return r.json()


def test_flujo_completo_con_campos_y_regreso_a_cola(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo)
    segunda = _crear(client, repo, status="proposed")

    _paso(client, repo, uid, "proposed")
    roadmap = _paso(
        client,
        repo,
        uid,
        "roadmap",
        roadmap_resultado="Hecho",
        roadmap_referencia="commit abc",
    )
    assert roadmap["status"] == "roadmap"
    assert roadmap["roadmap_started_at"] is not None
    assert roadmap["roadmap_resultado"] == "Hecho"
    assert roadmap["roadmap_referencia"] == "commit abc"

    verificacion = _paso(
        client,
        repo,
        uid,
        "verificacion",
        verificacion_resultado="Necesita ajuste",
        verificacion_comentario="Retocar el texto",
    )
    assert verificacion["status"] == "verificacion"
    assert verificacion["verificacion_started_at"] is not None
    assert verificacion["verificacion_intentos"] == 1
    assert verificacion["verificacion_ultimo_resultado"] == "Necesita ajuste"
    assert verificacion["roadmap_completed_at"] is not None

    # El regreso va al final de la cola, no conserva la posición vieja.
    _paso(client, repo, uid, "proposed")
    r = client.get("/ideas", params={"repo": repo, "status": "proposed"})
    assert [i["uid"] for i in r.json()] == [segunda, uid]

    _paso(client, repo, uid, "roadmap")
    _paso(client, repo, uid, "verificacion")
    aprobada = _paso(
        client,
        repo,
        uid,
        "revision_aprobada",
        approved_by="agente",
        revision_nota="Correcta",
    )
    assert aprobada["status"] == "revision_aprobada"
    assert aprobada["revision_approved_at"] is not None
    assert aprobada["revision_approved_by"] == "agente"
    assert aprobada["revision_nota"] == "Correcta"

    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    for tabla in ("idea_cola", "idea_roadmap", "idea_verificacion"):
        conteo = conn.execute(f"SELECT count(*) FROM {tabla} WHERE uid = ?", (uid,)).fetchone()[0]
        assert conteo == 0
    revision = conn.execute("SELECT count(*) FROM idea_revision WHERE uid = ?", (uid,)).fetchone()[
        0
    ]
    assert revision == 1
    conn.close()


def test_editar_ficha_activa_sin_cambiar_estado(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap", roadmap_resultado="Hecho", roadmap_referencia="commit abc")

    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"roadmap_resultado": "Hecho dos"},
    )
    assert r.status_code == 200, r.json()
    assert r.json()["roadmap_resultado"] == "Hecho dos"

    r = client.get(f"/ideas/{uid}", params={"repo": repo})
    assert r.json()["roadmap_resultado"] == "Hecho dos"
    assert r.json()["roadmap_referencia"] == "commit abc"


def test_campos_de_otra_ficha_se_rechazan(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap", roadmap_resultado="Hecho")

    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"verificacion_resultado": "Todavía no"},
    )
    assert r.status_code == 400
    assert "verificacion_resultado" in r.json()["detail"]
    assert "roadmap" in r.json()["detail"]

    r = client.get(f"/ideas/{uid}", params={"repo": repo})
    assert r.json()["roadmap_resultado"] == "Hecho"
    assert r.json()["verificacion_ultimo_resultado"] == ""


def test_transiciones_no_listadas_se_rechazan(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo)
    for destino in ("roadmap", "verificacion", "revision_aprobada"):
        r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": destino})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]

    _paso(client, repo, uid, "proposed")
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "verificacion"})
    assert r.status_code == 400

    _paso(client, repo, uid, "roadmap")
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert r.status_code == 400

    _paso(client, repo, uid, "verificacion")
    for destino in ("draft", "roadmap", "rejected"):
        r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": destino})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]


def test_roadmap_solo_un_activo(client, repo):  # noqa: ANN001, ANN202
    primera = _crear(client, repo, status="proposed")
    segunda = _crear(client, repo, status="proposed")
    _paso(client, repo, primera, "roadmap")

    r = client.patch(f"/ideas/{segunda}", params={"repo": repo}, json={"status": "roadmap"})
    assert r.status_code == 400
    assert "solo admite un item activo" in r.json()["detail"]
    r = client.get("/ideas", params={"repo": repo, "status": "proposed"})
    assert [i["uid"] for i in r.json()] == [segunda]


def test_filtros_por_estado_nuevo(client, repo):  # noqa: ANN001, ANN202
    # El harness siembra el estado inicial al crear, igual que el resto de
    # pruebas: aquí solo se comprueba el filtro, no el traslado.
    esperados = {
        "draft": _crear(client, repo),
        "proposed": _crear(client, repo, status="proposed"),
        "roadmap": _crear(client, repo, status="roadmap"),
        "verificacion": _crear(client, repo, status="verificacion"),
        "revision_aprobada": _crear(client, repo, status="revision_aprobada"),
        "rejected": _crear(client, repo, status="rejected"),
    }
    for estado, uid in esperados.items():
        r = client.get("/ideas", params={"repo": repo, "status": estado})
        assert [i["uid"] for i in r.json()] == [uid]
