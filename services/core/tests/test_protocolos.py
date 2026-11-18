"""Los protocolos de flujo: qué carriles pueden unirse a cuáles.

La tabla `protocolo_flujo` es una allowlist sembrada con el esquema: lo que
no está listado se prohíbe (las descartadas son terminales, la cola no se
deshace al cajón y a completada no se puede llegar). El PATCH impone;
`GET /protocolos` las expone para que la UI no ofrezca lo prohibido.
"""


def _crear(client, repo, **kw):  # noqa: ANN001, ANN202
    return client.post("/ideas", params={"repo": repo}, json={"title": "A", **kw}).json()["uid"]


def test_protocolos_sembrados(client, repo):  # noqa: ANN001, ANN202
    r = client.get("/protocolos", params={"repo": repo})
    assert r.status_code == 200
    pares = {(p["origen"], p["destino"]) for p in r.json()}
    assert pares == {
        ("draft", "proposed"),
        ("draft", "rejected"),
        ("proposed", "rejected"),
    }
    # `superseded` comparte grupo con `rejected`: no lleva filas propias.
    assert all("superseded" not in par for par in pares)


def test_a_completada_no_se_puede_llegar(client, repo):  # noqa: ANN001, ANN202
    # Sin uniones que entren en `accepted`, ningún flujo llega a completada
    # (0012): la tabla queda como cimiento para cuando se diseñe el flujo.
    for origen_kw in ({}, {"status": "proposed"}):
        uid = _crear(client, repo, **origen_kw)
        r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "accepted"})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]


def test_completadas_no_salen(client, repo):  # noqa: ANN001, ANN202
    # Ni siquiera las que siembra el harness (status al crear) salen.
    uid = _crear(client, repo, status="accepted")
    for destino in ("proposed", "rejected", "draft"):
        r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": destino})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]


def test_descartadas_son_terminales(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "rejected"})
    assert r.status_code == 200
    # Ni a cola, ni al cajón, ni a completada: las descartadas no salen.
    for destino in ("proposed", "draft", "accepted"):
        r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": destino})
        assert r.status_code == 400
        assert "protocolo" in r.json()["detail"]


def test_el_rechazo_de_cola_pasa_y_de_cajon_tambien(client, repo):  # noqa: ANN001, ANN202
    # Los dos descartes que la UI ofrece: draft → rejected y proposed → rejected.
    uid_cajon = _crear(client, repo)
    r = client.patch(f"/ideas/{uid_cajon}", params={"repo": repo}, json={"status": "rejected"})
    assert r.status_code == 200
    uid_cola = _crear(client, repo, status="proposed")
    r = client.patch(f"/ideas/{uid_cola}", params={"repo": repo}, json={"status": "rejected"})
    assert r.status_code == 200


def test_reafirmar_no_es_traslado(client, repo):  # noqa: ANN001, ANN202
    # Reafirmar el mismo estado no consulta la allowlist: no es un traslado.
    uid = _crear(client, repo)
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "draft"})
    assert r.status_code == 200
