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
    # Entrar en roadmap exige al menos una fase (0021); estas pruebas son del
    # flujo, no de las fases, así que se añade una salvo que digan otra cosa.
    if status == "roadmap" and "fases" not in detalle:
        detalle["fases"] = [{"titulo": "Fase única"}]
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
    for tabla in ("roadmap_node", "verificacion_node"):
        conteo = conn.execute(f"SELECT count(*) FROM {tabla} WHERE uid = ?", (uid,)).fetchone()[0]
        assert conteo == 0
    revision = conn.execute("SELECT count(*) FROM revision_node WHERE uid = ?", (uid,)).fetchone()[
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


def test_roadmap_solo_un_activo(client, repo):  # noqa: ANN001, ANN202
    primera = _crear(client, repo, status="proposed")
    segunda = _crear(client, repo, status="proposed")
    _paso(client, repo, primera, "roadmap")

    r = client.patch(
        f"/ideas/{segunda}",
        params={"repo": repo},
        json={"status": "roadmap", "fases": [{"titulo": "Fase única"}]},
    )
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


def test_dependencia_bloquea_hasta_la_revision_aprobada(client, repo):  # noqa: ANN001, ANN202
    """Un ítem no entra en roadmap mientras otra idea de la que depende no esté
    aprobada; al aprobarse, el mismo movimiento pasa."""
    base = _crear(client, repo, title="Base")
    dependiente = _crear(client, repo, title="Dependiente", status="proposed")

    r = client.patch(f"/ideas/{dependiente}", params={"repo": repo}, json={"depende_de": [base]})
    assert r.status_code == 200, r.json()
    assert r.json()["depende_de"] == [base]

    r = client.patch(f"/ideas/{dependiente}", params={"repo": repo}, json={"status": "roadmap"})
    assert r.status_code == 400
    assert "Base" in r.json()["detail"]
    assert "revisión aprobada" in r.json()["detail"]
    assert client.get(f"/ideas/{dependiente}", params={"repo": repo}).json()["status"] == (
        "proposed"
    )

    _paso(client, repo, base, "proposed")
    _paso(client, repo, base, "roadmap")
    _paso(client, repo, base, "verificacion")
    _paso(client, repo, base, "revision_aprobada")

    assert _paso(client, repo, dependiente, "roadmap")["status"] == "roadmap"


def test_dependencia_descartada_no_libera(client, repo):  # noqa: ANN001, ANN202
    base = _crear(client, repo, title="Base", status="proposed")
    dependiente = _crear(client, repo, title="Dependiente", status="proposed")
    client.patch(f"/ideas/{dependiente}", params={"repo": repo}, json={"depende_de": [base]})

    _paso(client, repo, base, "rejected", rejected_description="no va")
    r = client.patch(f"/ideas/{dependiente}", params={"repo": repo}, json={"status": "roadmap"})
    assert r.status_code == 400
    assert "Base" in r.json()["detail"]


def test_dependencias_validan_uid_y_ciclos(client, repo):  # noqa: ANN001, ANN202
    a = _crear(client, repo, title="A")
    b = _crear(client, repo, title="B")

    r = client.patch(f"/ideas/{a}", params={"repo": repo}, json={"depende_de": ["no-existe"]})
    assert r.status_code == 400
    assert "no existen" in r.json()["detail"]

    r = client.patch(f"/ideas/{a}", params={"repo": repo}, json={"depende_de": [a]})
    assert r.status_code == 400
    assert "sí misma" in r.json()["detail"]

    assert (
        client.patch(f"/ideas/{a}", params={"repo": repo}, json={"depende_de": [b]}).status_code
        == 200
    )
    r = client.patch(f"/ideas/{b}", params={"repo": repo}, json={"depende_de": [a]})
    assert r.status_code == 400
    assert "ciclo" in r.json()["detail"]

    # Crear con dependencias: se guardan y el avance se frena igual.
    nueva = client.post(
        "/ideas", params={"repo": repo}, json={"title": "C", "depende_de": [a]}
    ).json()
    assert nueva["depende_de"] == [a]
    r = client.post(
        "/ideas",
        params={"repo": repo},
        json={"title": "D", "status": "roadmap", "depende_de": [a]},
    )
    assert r.status_code == 400
    assert "sin revisión aprobada" in r.json()["detail"]


def test_borrar_una_idea_la_quita_de_las_dependencias(client, repo):  # noqa: ANN001, ANN202
    a = _crear(client, repo, title="A")
    b = _crear(client, repo, title="B")
    client.patch(f"/ideas/{b}", params={"repo": repo}, json={"depende_de": [a]})

    assert client.delete(f"/ideas/{a}", params={"repo": repo}).status_code == 204
    assert client.get(f"/ideas/{b}", params={"repo": repo}).json()["depende_de"] == []
