"""El flujo completo de items (0013): entrada, cola, roadmap y verificación.

Cubre: el recorrido entero con sus campos propios, el regreso de
verificación a cola (al final de la cola), las transiciones prohibidas y
la regla de un solo item activo en roadmap.
"""

from __future__ import annotations

import sqlite3

from events_core import items


def _crear(client, repo, **kw):  # noqa: ANN001, ANN202
    return client.post("/items", params={"repo": repo}, json={"title": "A", **kw}).json()["uid"]


def _paso(client, repo, uid, status, **detalle):  # noqa: ANN001, ANN202
    # Entrar en roadmap exige al menos una fase (0021); estas pruebas son del
    # flujo, no de las fases, así que se añade una salvo que digan otra cosa.
    if status == "roadmap" and "fases" not in detalle:
        detalle["fases"] = [{"titulo": "Fase única", "requisitos": [{"titulo": "Comprobar"}]}]
    # Salir de roadmap exige las fases cerradas (0022) y una fase completada
    # exige sus requisitos hechos (0025); el flujo no prueba estados
    # intermedios, así que se cierran en el mismo paso.
    if status in ("verificacion", "revision_aprobada") and "fases" not in detalle:
        detalle["fases"] = [
            {
                "titulo": "Fase única",
                "estado": "completada",
                "requisitos": [{"titulo": "Comprobar", "hecho": True}],
            }
        ]
    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": status, **detalle})
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
    r = client.get("/items", params={"repo": repo, "status": "proposed"})
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
    # Aprobar archiva: el ítem queda en historial, con su firma y sus fases.
    assert aprobada["status"] == "historial"
    assert aprobada["revision_approved_at"] is not None
    assert aprobada["revision_approved_by"] == "agente"
    assert aprobada["revision_nota"] == "Correcta"
    assert aprobada["fases"][0]["estado"] == "completada"
    assert aprobada["fases"][0]["requisitos"][0]["hecho"] is True

    conn = sqlite3.connect(str(items.db_file_for(repo)))
    # El detalle de roadmap y el de verificación se conservan: la ficha archivada
    # cuenta con qué resultado se cerró roadmap (6dda6382) y cómo se verificó
    # (7188737b).
    roadmap_nodos = conn.execute(
        "SELECT count(*) FROM roadmap_node WHERE uid = ?", (uid,)
    ).fetchone()[0]
    verificacion_nodos = conn.execute(
        "SELECT count(*) FROM verificacion_node WHERE uid = ?", (uid,)
    ).fetchone()[0]
    assert roadmap_nodos == 1
    assert verificacion_nodos == 1
    revision = conn.execute("SELECT count(*) FROM revision_node WHERE uid = ?", (uid,)).fetchone()[
        0
    ]
    assert revision == 1
    conn.close()


def test_aprobar_conserva_el_detalle_de_verificacion(client, repo):  # noqa: ANN001, ANN202
    """La ficha archivada guarda cómo se verificó, no solo la firma."""
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap", roadmap_resultado="Hecho")
    _paso(
        client,
        repo,
        uid,
        "verificacion",
        verificacion_resultado="ok",
        verificacion_comentario="Revisado a mano",
    )

    archivada = _paso(
        client, repo, uid, "revision_aprobada", approved_by="usuario", revision_nota="Vale"
    )

    assert archivada["status"] == "historial"
    assert archivada["verificacion_ultimo_resultado"] == "ok"
    assert archivada["verificacion_comentario"] == "Revisado a mano"
    assert archivada["verificacion_intentos"] == 1
    assert archivada["roadmap_completed_at"] is not None
    # Las fechas de estancia no se rellenan fuera de su carril.
    assert archivada["verificacion_started_at"] is None

    # El listado con cuerpo trae la misma ficha que el detalle.
    listado = client.get(
        "/items", params={"repo": repo, "status": "historial", "incluir": "contenido"}
    ).json()
    (fila,) = [item for item in listado if item["uid"] == uid]
    assert fila["verificacion_ultimo_resultado"] == "ok"
    assert fila["verificacion_comentario"] == "Revisado a mano"


def test_aprobar_conserva_el_detalle_de_roadmap(client, repo):  # noqa: ANN001, ANN202
    """El resultado y la referencia con los que se cerró roadmap no se pierden al
    avanzar: la ficha archivada los conserva (6dda6382)."""
    uid = _crear(client, repo, status="proposed")
    _paso(
        client,
        repo,
        uid,
        "roadmap",
        roadmap_resultado="Hecho",
        roadmap_referencia="commit abc",
    )

    verificacion = _paso(client, repo, uid, "verificacion", verificacion_resultado="ok")
    assert verificacion["roadmap_resultado"] == "Hecho"
    assert verificacion["roadmap_referencia"] == "commit abc"
    assert verificacion["roadmap_completed_at"] is not None

    archivada = _paso(client, repo, uid, "revision_aprobada", approved_by="usuario")
    assert archivada["status"] == "historial"
    assert archivada["roadmap_resultado"] == "Hecho"
    assert archivada["roadmap_referencia"] == "commit abc"

    conn = sqlite3.connect(str(items.db_file_for(repo)))
    try:
        fila = conn.execute(
            "SELECT resultado, referencia FROM roadmap_node WHERE uid = ?", (uid,)
        ).fetchone()
    finally:
        conn.close()
    assert fila == ("Hecho", "commit abc")


def test_volver_a_la_cola_retira_el_detalle_de_roadmap(client, repo):  # noqa: ANN001, ANN202
    """Volver a la cola reinicia el plan: el detalle de roadmap se retira."""
    uid = _crear(client, repo, status="proposed")
    _paso(
        client,
        repo,
        uid,
        "roadmap",
        roadmap_resultado="Hecho",
        roadmap_referencia="commit abc",
    )
    _paso(client, repo, uid, "verificacion", verificacion_resultado="ok")

    en_cola = _paso(client, repo, uid, "proposed")
    assert en_cola["roadmap_resultado"] == ""
    assert en_cola["roadmap_referencia"] == ""

    conn = sqlite3.connect(str(items.db_file_for(repo)))
    try:
        nodos = conn.execute("SELECT count(*) FROM roadmap_node WHERE uid = ?", (uid,)).fetchone()
    finally:
        conn.close()
    assert nodos[0] == 0


def test_reentrar_en_roadmap_reescribe_la_estancia(client, repo):  # noqa: ANN001, ANN202
    """De verificación se puede volver a roadmap; la estancia nueva sustituye a la
    anterior en vez de chocar con su clave ni acumular detalle."""
    uid = _crear(client, repo, status="proposed")
    _paso(
        client,
        repo,
        uid,
        "roadmap",
        roadmap_resultado="Hecho",
        roadmap_referencia="commit abc",
    )
    _paso(client, repo, uid, "verificacion", verificacion_resultado="Necesita ajuste")

    segunda = _paso(
        client,
        repo,
        uid,
        "roadmap",
        roadmap_resultado="Hecho otra vez",
        roadmap_referencia="commit def",
    )
    assert segunda["roadmap_resultado"] == "Hecho otra vez"
    assert segunda["roadmap_referencia"] == "commit def"

    conn = sqlite3.connect(str(items.db_file_for(repo)))
    try:
        filas = conn.execute(
            "SELECT resultado, referencia FROM roadmap_node WHERE uid = ?", (uid,)
        ).fetchall()
    finally:
        conn.close()
    assert filas == [("Hecho otra vez", "commit def")]


def test_historial_puede_reabrir_la_verificacion(client, repo):  # noqa: ANN001, ANN202
    """Reverificar una ficha archivada no la desarchiva a mano: vuelve a
    verificación, suma una vuelta y escribe su propio resultado."""
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap")
    _paso(
        client,
        repo,
        uid,
        "verificacion",
        verificacion_resultado="ok",
        verificacion_comentario="Revisado a mano",
    )
    archivada = _paso(client, repo, uid, "revision_aprobada", approved_by="usuario")
    assert archivada["status"] == "historial"
    assert archivada["verificacion_intentos"] == 1

    # Las fases no se reenvían: sobrevivieron al archivo y reabrir no las toca.
    r = client.patch(
        f"/items/{uid}",
        params={"repo": repo},
        json={
            "status": "verificacion",
            "verificacion_resultado": "Repetida",
            "verificacion_comentario": "Segunda pasada",
        },
    )
    assert r.status_code == 200, r.json()
    reabierta = r.json()
    assert reabierta["status"] == "verificacion"
    assert reabierta["verificacion_started_at"] is not None
    assert reabierta["verificacion_intentos"] == 2
    assert reabierta["verificacion_ultimo_resultado"] == "Repetida"
    assert reabierta["verificacion_comentario"] == "Segunda pasada"
    # La firma anterior ya no vale: la revisión está abierta otra vez.
    assert reabierta["revision_approved_at"] is None
    assert reabierta["fases"][0]["estado"] == "completada"

    # Se vuelve a aprobar por el camino de siempre, conservando la cuenta.
    segunda = _paso(client, repo, uid, "revision_aprobada", approved_by="agente")
    assert segunda["status"] == "historial"
    assert segunda["verificacion_intentos"] == 2
    assert segunda["verificacion_ultimo_resultado"] == "Repetida"
    assert segunda["revision_approved_by"] == "agente"


def test_aprobar_exige_todos_los_requisitos(client, repo):  # noqa: ANN001, ANN202
    """Una fase completada a mano no basta: sus requisitos son el criterio."""
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap")
    _paso(client, repo, uid, "verificacion")

    # Se simula una fase marcada completada con un requisito pendiente, algo
    # que la API no deja escribir pero un almacén antiguo podría traer.
    conn = sqlite3.connect(str(items.db_file_for(repo)))
    try:
        conn.execute("UPDATE work_item_requisito SET hecho = 0 WHERE work_item_uid = ?", (uid,))
        conn.commit()
    finally:
        conn.close()

    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "revision_aprobada"})
    assert r.status_code == 400
    assert "requisitos sin completar" in r.json()["detail"]
    assert client.get(f"/items/{uid}", params={"repo": repo}).json()["status"] == "verificacion"


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

    # Al aprobar el detalle se conserva, y el contador viaja con él.
    aprobada = _paso(client, repo, uid, "revision_aprobada")
    assert aprobada["verificacion_intentos"] == 2


def test_intentos_no_se_inventan_ceros_fuera_de_verificacion(client, repo):  # noqa: ANN001, ANN202
    """El contador es del ítem: una vuelta a cola no lo pone a cero en la lectura."""
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap")
    _paso(client, repo, uid, "verificacion")

    en_cola = _paso(client, repo, uid, "proposed")
    assert en_cola["verificacion_intentos"] == 1
    assert en_cola["verificacion_started_at"] is None

    leida = client.get(f"/items/{uid}", params={"repo": repo}).json()
    assert leida["verificacion_intentos"] == 1


def test_volver_a_cola_retira_resultado_y_conserva_intentos(client, repo):  # noqa: ANN001, ANN202
    """Documentado: al volver a `draft`/`proposed` se retiran resultado y
    comentario de la verificación, pero el contador de intentos se mantiene."""
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap")
    _paso(
        client,
        repo,
        uid,
        "verificacion",
        verificacion_resultado="Necesita ajuste",
        verificacion_comentario="Retocar el texto",
    )

    en_cola = _paso(client, repo, uid, "proposed")
    assert en_cola["verificacion_ultimo_resultado"] == ""
    assert en_cola["verificacion_comentario"] == ""
    assert en_cola["verificacion_intentos"] == 1

    _paso(client, repo, uid, "roadmap")
    _paso(
        client,
        repo,
        uid,
        "verificacion",
        verificacion_resultado="ok",
        verificacion_comentario="Vale",
    )
    de_nuevo = _paso(client, repo, uid, "proposed")
    assert de_nuevo["verificacion_ultimo_resultado"] == ""
    assert de_nuevo["verificacion_comentario"] == ""
    assert de_nuevo["verificacion_intentos"] == 2


def test_editar_ficha_activa_sin_cambiar_estado(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap", roadmap_resultado="Hecho", roadmap_referencia="commit abc")

    r = client.patch(
        f"/items/{uid}",
        params={"repo": repo},
        json={"roadmap_resultado": "Hecho dos"},
    )
    assert r.status_code == 200, r.json()
    assert r.json()["roadmap_resultado"] == "Hecho dos"

    r = client.get(f"/items/{uid}", params={"repo": repo})
    assert r.json()["roadmap_resultado"] == "Hecho dos"
    assert r.json()["roadmap_referencia"] == "commit abc"


def test_campos_de_otra_ficha_se_rechazan(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap", roadmap_resultado="Hecho")

    r = client.patch(
        f"/items/{uid}",
        params={"repo": repo},
        json={"verificacion_resultado": "Todavía no"},
    )
    assert r.status_code == 400
    assert "verificacion_resultado" in r.json()["detail"]
    assert "roadmap" in r.json()["detail"]

    r = client.get(f"/items/{uid}", params={"repo": repo})
    assert r.json()["roadmap_resultado"] == "Hecho"
    assert r.json()["verificacion_ultimo_resultado"] == ""


def test_el_mapa_ordena_la_cola_por_posicion(client, repo):  # noqa: ANN001, ANN202
    """El mapa pinta la cola como la lista `/items`: quien vuelve de
    verificación estrena posición y aparece al final en los dos sitios."""
    primera = _crear(client, repo, status="proposed")
    segunda = _crear(client, repo, status="proposed")
    tercera = _crear(client, repo, status="proposed")

    # La segunda recorre roadmap y verificación y vuelve a la cola.
    _paso(client, repo, segunda, "roadmap")
    _paso(client, repo, segunda, "verificacion")
    _paso(client, repo, segunda, "proposed")

    esperado = [primera, tercera, segunda]
    r = client.get("/items", params={"repo": repo, "status": "proposed"})
    assert [i["uid"] for i in r.json()] == esperado

    mapa = client.get("/mapa", params={"repo": repo}).json()["items"]
    assert [i["uid"] for i in mapa if i["status"] == "proposed"] == esperado


def test_transiciones_no_listadas_se_rechazan(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo)
    for destino in ("roadmap", "verificacion", "revision_aprobada"):
        r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": destino})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]

    _paso(client, repo, uid, "proposed")
    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "verificacion"})
    assert r.status_code == 400

    _paso(client, repo, uid, "roadmap")
    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert r.status_code == 400

    _paso(client, repo, uid, "verificacion")
    for destino in ("draft", "historial"):
        r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": destino})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]


def test_verificacion_puede_volver_a_roadmap_o_descartarse(client, repo):  # noqa: ANN001, ANN202
    """La revisión rechazada no crea carril: vuelve a roadmap o se descarta."""
    uid = _crear(client, repo, status="proposed")
    _paso(client, repo, uid, "roadmap")
    _paso(client, repo, uid, "verificacion")

    # Rechazo con rehacer: vuelve a roadmap sin reemplazar las fases que ya
    # tenía; el PATCH de retorno solo cambia el carril.
    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "roadmap"})
    assert r.status_code == 200, r.json()
    vuelve = r.json()
    assert vuelve["status"] == "roadmap"
    assert vuelve["fases"][0]["estado"] == "completada"

    # Y desde verificación también se puede descartar con motivo.
    _paso(client, repo, uid, "verificacion")
    descartada = _paso(
        client,
        repo,
        uid,
        "rejected",
        rejected_description="No supera la revisión",
    )
    assert descartada["status"] == "rejected"
    assert descartada["rejected_description"] == "No supera la revisión"


def test_borrar_la_sustituta_conserva_el_vinculo(client, repo):  # noqa: ANN001, ANN202
    """Si otra ficha la usa como sustituta, el DELETE avisa y no borra nada."""
    sustituta = _crear(client, repo, title="Nueva")
    vieja = _crear(client, repo, title="Vieja", status="proposed")
    r = client.patch(
        f"/items/{vieja}",
        params={"repo": repo},
        json={"status": "rejected", "superseded_by_uid": sustituta},
    )
    assert r.status_code == 200, r.json()
    assert r.json()["superseded_by_uid"] == sustituta

    # La sustituta también tiene que estar en Descartadas para poder intentar
    # el borrado definitivo; el vínculo sigue bloqueando.
    assert (
        client.patch(
            f"/items/{sustituta}",
            params={"repo": repo},
            json={"status": "rejected", "rejected_description": "sustituta de prueba"},
        ).status_code
        == 200
    )
    r = client.delete(f"/items/{sustituta}", params={"repo": repo})
    assert r.status_code == 400
    assert sustituta in r.json()["detail"]
    assert vieja in r.json()["detail"]

    # Las dos siguen ahí y el vínculo intacto.
    assert client.get(f"/items/{sustituta}", params={"repo": repo}).status_code == 200
    vieja_leida = client.get(f"/items/{vieja}", params={"repo": repo}).json()
    assert vieja_leida["status"] == "rejected"
    assert vieja_leida["superseded_by_uid"] == sustituta

    # Sin la ficha que la referencia, el borrado pasa.
    assert client.delete(f"/items/{vieja}", params={"repo": repo}).status_code == 204
    assert client.delete(f"/items/{sustituta}", params={"repo": repo}).status_code == 204


def test_borrar_exige_descartadas(client, repo):  # noqa: ANN001, ANN202
    """El DELETE no salta Descartadas: primero se descarta, luego se elimina."""
    uid = _crear(client, repo, status="proposed")
    r = client.delete(f"/items/{uid}", params={"repo": repo})
    assert r.status_code == 400
    assert "descártala" in r.json()["detail"]
    assert client.get(f"/items/{uid}", params={"repo": repo}).status_code == 200

    assert (
        client.patch(
            f"/items/{uid}",
            params={"repo": repo},
            json={"status": "rejected", "rejected_description": "fuera"},
        ).status_code
        == 200
    )
    assert client.delete(f"/items/{uid}", params={"repo": repo}).status_code == 204
    assert client.get(f"/items/{uid}", params={"repo": repo}).status_code == 404


def test_roadmap_solo_un_activo(client, repo):  # noqa: ANN001, ANN202
    primera = _crear(client, repo, status="proposed")
    segunda = _crear(client, repo, status="proposed")
    _paso(client, repo, primera, "roadmap")

    r = client.patch(
        f"/items/{segunda}",
        params={"repo": repo},
        json={
            "status": "roadmap",
            "fases": [{"titulo": "Fase única", "requisitos": [{"titulo": "Comprobar"}]}],
        },
    )
    assert r.status_code == 400
    assert "solo admite un item activo" in r.json()["detail"]
    r = client.get("/items", params={"repo": repo, "status": "proposed"})
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
        r = client.get("/items", params={"repo": repo, "status": estado})
        assert [i["uid"] for i in r.json()] == [uid]


def test_dependencia_bloquea_hasta_la_revision_aprobada(client, repo):  # noqa: ANN001, ANN202
    """Un ítem no entra en roadmap mientras otra item de la que depende no esté
    aprobada; al aprobarse, el mismo movimiento pasa."""
    base = _crear(client, repo, title="Base")
    dependiente = _crear(client, repo, title="Dependiente", status="proposed")

    r = client.patch(f"/items/{dependiente}", params={"repo": repo}, json={"depende_de": [base]})
    assert r.status_code == 200, r.json()
    assert r.json()["depende_de"] == [base]

    r = client.patch(f"/items/{dependiente}", params={"repo": repo}, json={"status": "roadmap"})
    assert r.status_code == 400
    assert "Base" in r.json()["detail"]
    assert "revisión aprobada" in r.json()["detail"]
    assert client.get(f"/items/{dependiente}", params={"repo": repo}).json()["status"] == (
        "proposed"
    )

    _paso(client, repo, base, "proposed")
    _paso(client, repo, base, "roadmap")
    _paso(client, repo, base, "verificacion")
    aprobada = _paso(client, repo, base, "revision_aprobada")
    # El historial sigue contando como aprobado para las dependencias.
    assert aprobada["status"] == "historial"

    assert _paso(client, repo, dependiente, "roadmap")["status"] == "roadmap"


def test_dependencia_descartada_no_libera(client, repo):  # noqa: ANN001, ANN202
    base = _crear(client, repo, title="Base", status="proposed")
    dependiente = _crear(client, repo, title="Dependiente", status="proposed")
    client.patch(f"/items/{dependiente}", params={"repo": repo}, json={"depende_de": [base]})

    _paso(client, repo, base, "rejected", rejected_description="no va")
    r = client.patch(f"/items/{dependiente}", params={"repo": repo}, json={"status": "roadmap"})
    assert r.status_code == 400
    assert "Base" in r.json()["detail"]


def test_dependencias_validan_uid_y_ciclos(client, repo):  # noqa: ANN001, ANN202
    a = _crear(client, repo, title="A")
    b = _crear(client, repo, title="B")

    r = client.patch(f"/items/{a}", params={"repo": repo}, json={"depende_de": ["no-existe"]})
    assert r.status_code == 400
    assert "no existen" in r.json()["detail"]

    r = client.patch(f"/items/{a}", params={"repo": repo}, json={"depende_de": [a]})
    assert r.status_code == 400
    assert "sí misma" in r.json()["detail"]

    assert (
        client.patch(f"/items/{a}", params={"repo": repo}, json={"depende_de": [b]}).status_code
        == 200
    )
    r = client.patch(f"/items/{b}", params={"repo": repo}, json={"depende_de": [a]})
    assert r.status_code == 400
    assert "ciclo" in r.json()["detail"]

    # Crear con dependencias: se guardan y el avance se frena igual.
    nueva = client.post(
        "/items", params={"repo": repo}, json={"title": "C", "depende_de": [a]}
    ).json()
    assert nueva["depende_de"] == [a]
    r = client.post(
        "/items",
        params={"repo": repo},
        json={"title": "D", "status": "roadmap", "depende_de": [a]},
    )
    assert r.status_code == 400
    assert "sin revisión aprobada" in r.json()["detail"]


def test_borrar_una_item_la_quita_de_las_dependencias(client, repo):  # noqa: ANN001, ANN202
    a = _crear(client, repo, title="A")
    b = _crear(client, repo, title="B")
    client.patch(f"/items/{b}", params={"repo": repo}, json={"depende_de": [a]})

    assert (
        client.patch(
            f"/items/{a}",
            params={"repo": repo},
            json={"status": "rejected", "rejected_description": "ya no"},
        ).status_code
        == 200
    )
    assert client.delete(f"/items/{a}", params={"repo": repo}).status_code == 204
    assert client.get(f"/items/{b}", params={"repo": repo}).json()["depende_de"] == []
