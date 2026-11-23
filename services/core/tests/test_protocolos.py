"""Los protocolos de flujo: qué carriles pueden unirse a cuáles.

La tabla `protocolo_flujo` es una allowlist sembrada con el esquema: lo que
no está listado se prohíbe (las descartadas y la revisión aprobada son
terminales, y la cola no se deshace a la entrada). El PATCH impone;
`GET /protocolos` las expone para que la UI no ofrezca lo prohibido.
"""


def _crear(client, repo, **kw):  # noqa: ANN001, ANN202
    return client.post("/items", params={"repo": repo}, json={"title": "A", **kw}).json()["uid"]


def test_protocolos_sembrados(client, repo):  # noqa: ANN001, ANN202
    r = client.get("/protocolos", params={"repo": repo})
    assert r.status_code == 200
    pares = {(p["origen"], p["destino"]) for p in r.json()}
    assert pares == {
        ("draft", "proposed"),
        ("draft", "rejected"),
        ("proposed", "roadmap"),
        ("proposed", "rejected"),
        ("roadmap", "verificacion"),
        ("verificacion", "proposed"),
        ("verificacion", "roadmap"),
        ("verificacion", "rejected"),
        ("verificacion", "revision_aprobada"),
    }
    # `superseded` comparte grupo con `rejected`: no lleva filas propias.
    assert all("superseded" not in par for par in pares)


def test_a_revision_no_se_llega_directo(client, repo):  # noqa: ANN001, ANN202
    # La revisión aprobada solo entra desde verificación, no desde la
    # entrada ni desde la cola.
    for origen_kw in ({}, {"status": "proposed"}):
        uid = _crear(client, repo, **origen_kw)
        r = client.patch(
            f"/items/{uid}", params={"repo": repo}, json={"status": "revision_aprobada"}
        )
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]


def test_revision_aprobada_es_terminal(client, repo):  # noqa: ANN001, ANN202
    # Ni siquiera las que siembra el harness (status al crear) salen.
    uid = _crear(client, repo, status="revision_aprobada")
    for destino in ("proposed", "rejected", "draft", "roadmap", "verificacion"):
        r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": destino})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]


def test_descartadas_son_terminales(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "rejected"})
    assert r.status_code == 200
    # Ni a cola, ni a entrada, ni a roadmap, verificación o revisión:
    # las descartadas no salen.
    for destino in ("proposed", "draft", "roadmap", "verificacion", "revision_aprobada"):
        r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": destino})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]


def test_el_rechazo_de_cola_pasa_y_de_cajon_tambien(client, repo):  # noqa: ANN001, ANN202
    # Los dos descartes que la UI ofrece: draft → rejected y proposed → rejected.
    uid_cajon = _crear(client, repo)
    r = client.patch(f"/items/{uid_cajon}", params={"repo": repo}, json={"status": "rejected"})
    assert r.status_code == 200
    uid_cola = _crear(client, repo, status="proposed")
    r = client.patch(f"/items/{uid_cola}", params={"repo": repo}, json={"status": "rejected"})
    assert r.status_code == 200


def test_reafirmar_no_es_traslado(client, repo):  # noqa: ANN001, ANN202
    # Reafirmar el mismo estado no consulta la allowlist: no es un traslado.
    uid = _crear(client, repo)
    r = client.patch(f"/items/{uid}", params={"repo": repo}, json={"status": "draft"})
    assert r.status_code == 200
