"""El flujo completo de items (0013): entrada, cola, roadmap y verificación.

Cubre: el recorrido entero con sus campos propios, el regreso de
verificación a cola (al final de la cola), las transiciones prohibidas y
la regla de un solo item activo en roadmap.
"""

from __future__ import annotations

import sqlite3
from contextlib import closing

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


def test_intentos_cuentan_las_vueltas(client, repo):  # noqa: ANN001, ANN202
    """Volver a cola y a roadmap no reinicia los intentos: la ficha de
    verificación se retira, pero el historial guarda cada vuelta."""
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap")
    primera = _paso(client, repo, uid, "verificacion")
    assert primera["verificacion_intentos"] == 1

    _paso(client, repo, uid, "proposed")
    _paso(client, repo, uid, "roadmap")
    segunda = _paso(client, repo, uid, "verificacion")
    assert segunda["verificacion_intentos"] == 2

    # La ficha se va al aprobar: el contador vive con ella.
    aprobada = _paso(client, repo, uid, "revision_aprobada")
    assert aprobada["verificacion_intentos"] == 0


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


def test_el_mapa_ordena_la_cola_por_posicion(client, repo):  # noqa: ANN001, ANN202
    """El mapa pinta la cola como la lista `/ideas`: quien vuelve de
    verificación estrena posición y aparece al final en los dos sitios."""
    primera = _crear(client, repo, status="proposed")
    segunda = _crear(client, repo, status="proposed")
    tercera = _crear(client, repo, status="proposed")

    # La segunda recorre roadmap y verificación y vuelve a la cola.
    _paso(client, repo, segunda, "roadmap")
    _paso(client, repo, segunda, "verificacion")
    _paso(client, repo, segunda, "proposed")

    esperado = [primera, tercera, segunda]
    r = client.get("/ideas", params={"repo": repo, "status": "proposed"})
    assert [i["uid"] for i in r.json()] == esperado

    mapa = client.get("/mapa", params={"repo": repo}).json()["ideas"]
    assert [i["uid"] for i in mapa if i["status"] == "proposed"] == esperado


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


def test_borrar_la_sustituta_conserva_el_vinculo(client, repo):  # noqa: ANN001, ANN202
    """Si otra ficha la usa como sustituta, el DELETE avisa y no borra nada."""
    sustituta = _crear(client, repo, title="Nueva")
    vieja = _crear(client, repo, title="Vieja", status="proposed")
    r = client.patch(
        f"/ideas/{vieja}",
        params={"repo": repo},
        json={"status": "rejected", "superseded_by_uid": sustituta},
    )
    assert r.status_code == 200, r.json()
    assert r.json()["superseded_by_uid"] == sustituta

    r = client.delete(f"/ideas/{sustituta}", params={"repo": repo})
    assert r.status_code == 400
    assert sustituta in r.json()["detail"]
    assert vieja in r.json()["detail"]

    # Las dos siguen ahí y el vínculo intacto.
    assert client.get(f"/ideas/{sustituta}", params={"repo": repo}).status_code == 200
    vieja_leida = client.get(f"/ideas/{vieja}", params={"repo": repo}).json()
    assert vieja_leida["status"] == "rejected"
    assert vieja_leida["superseded_by_uid"] == sustituta

    # Sin la ficha que la referencia, el borrado pasa.
    assert client.delete(f"/ideas/{vieja}", params={"repo": repo}).status_code == 204
    assert client.delete(f"/ideas/{sustituta}", params={"repo": repo}).status_code == 204


def test_mapa_devuelve_ciclos_de_enlaces_child(client, repo):  # noqa: ANN001, ANN202
    """Dos enlaces `child` recíprocos llegan de una importación y el mapa los
    devuelve enteros: cortar el ciclo es cosa de la vista, no de los datos."""
    a = _crear(client, repo, title="A", status="proposed")
    b = _crear(client, repo, title="B", status="proposed")
    with closing(sqlite3.connect(ideas.db_file_for(repo))) as conn:
        conn.executemany(
            "INSERT INTO connections (parent_uid, child_uid, kind, created_at)"
            " VALUES (?, ?, 'child', '2026-01-01T00:00:00+00:00')",
            [(a, b), (b, a)],
        )
        conn.commit()

    mapa = client.get("/mapa", params={"repo": repo}).json()
    assert {idea["uid"] for idea in mapa["ideas"]} == {a, b}
    assert {(c["parent_uid"], c["child_uid"]) for c in mapa["connections"]} == {
        (a, b),
        (b, a),
    }


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
