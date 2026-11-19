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
        json={
            "status": "roadmap",
            "fases": [
                {"titulo": "Diseño", "requisitos": [{"titulo": "Cubre el borde"}]},
                {"titulo": "Prueba", "requisitos": [{"titulo": "Pasa lint"}]},
            ],
        },
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
        json={
            "status": "roadmap",
            "fases": [
                {"titulo": "Una", "requisitos": [{"titulo": "Comprobar"}]},
                {"titulo": "Dos", "requisitos": [{"titulo": "Comprobar"}]},
            ],
        },
    )
    fechas = [f["entered_at"] for f in r.json()["fases"]]

    # Mismo estado, misma fecha; estado nuevo, fecha nueva.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                },
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
                {"titulo": "Tres", "requisitos": [{"titulo": "Comprobar"}]},
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
        ([{"titulo": "A"}], 400),
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
        json={
            "status": "roadmap",
            "fases": [{"titulo": "Única", "requisitos": [{"titulo": "Uno"}]}],
        },
    )
    assert r.status_code == 200, r.json()

    assert client.delete(f"/ideas/{uid}", params={"repo": repo}).status_code == 204
    with sqlite3.connect(str(ideas.db_file_for(repo))) as conn:
        assert conn.execute("SELECT count(*) FROM idea_fase").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM idea_requisito").fetchone()[0] == 0


def test_salir_de_roadmap_exige_fases_cerradas(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "roadmap",
            "fases": [
                {"titulo": "Una", "requisitos": [{"titulo": "Comprobar"}]},
                {"titulo": "Dos", "requisitos": [{"titulo": "Comprobar"}]},
            ],
        },
    )
    assert r.status_code == 200, r.json()

    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "verificacion"})
    assert r.status_code == 400
    assert "sin cerrar" in r.json()["detail"]
    assert "Una" in r.json()["detail"] and "Dos" in r.json()["detail"]
    assert client.get(f"/ideas/{uid}", params={"repo": repo}).json()["status"] == "roadmap"

    # Cerrar una y dejar la otra fallida tampoco basta.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "verificacion",
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                },
                {
                    "orden": 2,
                    "titulo": "Dos",
                    "estado": "fallida",
                    "nota": "No pasa la carga",
                },
            ],
        },
    )
    assert r.status_code == 400
    assert "Dos" in r.json()["detail"]

    # `rechazada` cuenta como cerrada: el paso entra con la lista en el PATCH.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "verificacion",
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                },
                {"orden": 2, "titulo": "Dos", "estado": "rechazada"},
            ],
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json()["status"] == "verificacion"
    assert r.json()["verificacion_intentos"] == 1


def test_aprobar_revision_exige_todas_completadas(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "roadmap",
            "fases": [
                {"titulo": "Una", "requisitos": [{"titulo": "Comprobar"}]},
                {"titulo": "Dos", "requisitos": [{"titulo": "Comprobar"}]},
            ],
        },
    )
    assert r.status_code == 200, r.json()

    # Rechazar Dos basta para salir de roadmap, pero no para aprobar.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "verificacion",
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                },
                {"orden": 2, "titulo": "Dos", "estado": "rechazada"},
            ],
        },
    )
    assert r.status_code == 200, r.json()

    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "revision_aprobada"})
    assert r.status_code == 400
    assert "sin completar" in r.json()["detail"]
    assert "Dos" in r.json()["detail"]
    assert client.get(f"/ideas/{uid}", params={"repo": repo}).json()["status"] == "verificacion"

    # Completarla en el mismo PATCH deja aprobar.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "revision_aprobada",
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                },
                {
                    "orden": 2,
                    "titulo": "Dos",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                },
            ],
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json()["status"] == "revision_aprobada"


def test_aprobar_revision_exige_al_menos_una_fase(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "roadmap",
            "fases": [{"titulo": "Una", "requisitos": [{"titulo": "Comprobar"}]}],
        },
    )
    assert r.status_code == 200, r.json()
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "verificacion",
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                }
            ],
        },
    )
    assert r.status_code == 200, r.json()

    # Sin fases, «todas completadas» se cumpliría por vacuidad: el protocolo
    # pide además al menos una para aprobar.
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"fases": []})
    assert r.status_code == 200, r.json()
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "revision_aprobada"})
    assert r.status_code == 400
    assert "al menos una fase" in r.json()["detail"]
    assert client.get(f"/ideas/{uid}", params={"repo": repo}).json()["status"] == "verificacion"

    # Añadirla completada en el mismo PATCH sí deja aprobar.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "revision_aprobada",
            "fases": [
                {
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"titulo": "Comprobar", "hecho": True}],
                }
            ],
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json()["status"] == "revision_aprobada"


def test_fuera_de_roadmap_las_fases_estan_pendientes(client, repo):  # noqa: ANN001, ANN202
    """En la entrada y la cola la fase es un plan: completarla no vale."""
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"titulo": "Comprobar"}],
                }
            ]
        },
    )
    assert r.status_code == 400
    assert "pendientes" in r.json()["detail"]
    assert _fases(client, repo, uid) == []

    # En roadmap sí, y cerrar en el mismo PATCH que cruza a verificación sigue
    # valiendo (el gate mira la lista que queda).
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "roadmap",
            "fases": [{"titulo": "Una", "requisitos": [{"titulo": "Comprobar"}]}],
        },
    )
    assert r.status_code == 200, r.json()
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                }
            ]
        },
    )
    assert r.status_code == 200, r.json()
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "verificacion"})
    assert r.status_code == 200, r.json()


def test_volver_a_la_cola_reinicia_las_fases(client, repo):  # noqa: ANN001, ANN202
    """Al volver a la cola las fases cerradas vuelven a pendientes."""
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "roadmap",
            "fases": [
                {"titulo": "Una", "requisitos": [{"titulo": "Comprobar"}]},
                {"titulo": "Dos", "requisitos": [{"titulo": "Comprobar"}]},
            ],
        },
    )
    assert r.status_code == 200, r.json()
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Una",
                    "estado": "completada",
                    "requisitos": [{"orden": 1, "titulo": "Comprobar", "hecho": True}],
                },
                {"orden": 2, "titulo": "Dos", "estado": "rechazada"},
            ]
        },
    )
    assert r.status_code == 200, r.json()
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "verificacion"})
    assert r.status_code == 200, r.json()

    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert r.status_code == 200, r.json()
    assert [f["estado"] for f in r.json()["fases"]] == ["pendiente", "pendiente"]

    # Y el PATCH no deja volver a cerrarlas desde la cola.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"fases": [{"orden": 1, "titulo": "Una", "estado": "completada"}]},
    )
    assert r.status_code == 400


def test_volver_a_la_cola_conserva_el_motivo(client, repo):  # noqa: ANN001, ANN202
    """Reiniciar una fase a pendiente no borra su nota: el motivo de por qué
    falló o se rechazó se queda con ella."""
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "status": "roadmap",
            "fases": [{"titulo": "Revisar", "requisitos": [{"titulo": "Comprobar"}]}],
        },
    )
    assert r.status_code == 200, r.json()
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Revisar",
                    "estado": "rechazada",
                    "nota": "No cubre el borde",
                }
            ]
        },
    )
    assert r.status_code == 200, r.json()
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "verificacion"})
    assert r.status_code == 200, r.json()

    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert r.status_code == 200, r.json()
    fase = r.json()["fases"][0]
    assert fase["estado"] == "pendiente"
    assert fase["nota"] == "No cubre el borde"


def _crear_roadmap(client, repo, fases):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}", params={"repo": repo}, json={"status": "roadmap", "fases": fases}
    )
    assert r.status_code == 200, r.json()
    return uid, r.json()


def test_los_requisitos_viajan_con_su_fase(client, repo):  # noqa: ANN001, ANN202
    _, ficha = _crear_roadmap(
        client,
        repo,
        [
            {
                "titulo": "Diseño",
                "requisitos": [{"titulo": "Cubre el borde"}, {"titulo": "Pasa lint"}],
            }
        ],
    )
    requisitos = ficha["fases"][0]["requisitos"]
    assert [(r["orden"], r["titulo"], r["hecho"], r["done_at"]) for r in requisitos] == [
        (1, "Cubre el borde", False, None),
        (2, "Pasa lint", False, None),
    ]


def test_completar_una_fase_exige_sus_requisitos(client, repo):  # noqa: ANN001, ANN202
    uid, _ = _crear_roadmap(
        client,
        repo,
        [{"titulo": "Diseño", "requisitos": [{"titulo": "Uno"}, {"titulo": "Dos"}]}],
    )

    def patch(estado, hechos):  # noqa: ANN001, ANN202
        return client.patch(
            f"/ideas/{uid}",
            params={"repo": repo},
            json={
                "fases": [
                    {
                        "orden": 1,
                        "titulo": "Diseño",
                        "estado": estado,
                        "requisitos": [
                            {"orden": 1, "titulo": "Uno", "hecho": hechos[0]},
                            {"orden": 2, "titulo": "Dos", "hecho": hechos[1]},
                        ],
                    }
                ]
            },
        )

    r = patch("completada", (False, False))
    assert r.status_code == 400
    assert "requisitos sin completar" in r.json()["detail"]
    assert "Uno" in r.json()["detail"] and "Dos" in r.json()["detail"]

    # Marcar uno sella su fecha; la fase sigue pendiente.
    r = patch("pendiente", (True, False))
    assert r.status_code == 200, r.json()
    requisitos = r.json()["fases"][0]["requisitos"]
    assert requisitos[0]["hecho"] is True and requisitos[0]["done_at"]
    assert requisitos[1]["hecho"] is False and requisitos[1]["done_at"] is None

    r = patch("completada", (True, False))
    assert r.status_code == 400
    assert "Dos" in r.json()["detail"]

    r = patch("completada", (True, True))
    assert r.status_code == 200, r.json()
    assert r.json()["fases"][0]["estado"] == "completada"


def test_sin_requisitos_en_el_patch_se_conservan(client, repo):  # noqa: ANN001, ANN202
    uid, _ = _crear_roadmap(
        client,
        repo,
        [{"titulo": "Diseño", "requisitos": [{"titulo": "Uno"}, {"titulo": "Dos"}]}],
    )
    r = client.patch(
        f"/ideas/{uid}", params={"repo": repo}, json={"fases": [{"orden": 1, "titulo": "Diseño"}]}
    )
    assert r.status_code == 200, r.json()
    assert [q["titulo"] for q in r.json()["fases"][0]["requisitos"]] == ["Uno", "Dos"]

    # Una lista vacía tampoco vale: toda fase necesita al menos un requisito.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"fases": [{"orden": 1, "titulo": "Diseño", "requisitos": []}]},
    )
    assert r.status_code == 400
    assert "al menos un requisito" in r.json()["detail"]
    assert [q["titulo"] for q in _fases(client, repo, uid)[0]["requisitos"]] == ["Uno", "Dos"]


def test_volver_a_la_cola_reinicia_los_requisitos(client, repo):  # noqa: ANN001, ANN202
    uid, _ = _crear_roadmap(
        client,
        repo,
        [{"titulo": "Diseño", "requisitos": [{"titulo": "Uno"}, {"titulo": "Dos"}]}],
    )
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Diseño",
                    "estado": "completada",
                    "requisitos": [
                        {"orden": 1, "titulo": "Uno", "hecho": True},
                        {"orden": 2, "titulo": "Dos", "hecho": True},
                    ],
                }
            ]
        },
    )
    assert r.status_code == 200, r.json()
    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "verificacion"})
    assert r.status_code == 200, r.json()

    r = client.patch(f"/ideas/{uid}", params={"repo": repo}, json={"status": "proposed"})
    assert r.status_code == 200, r.json()
    fase = r.json()["fases"][0]
    assert fase["estado"] == "pendiente"
    assert [(q["titulo"], q["hecho"], q["done_at"]) for q in fase["requisitos"]] == [
        ("Uno", False, None),
        ("Dos", False, None),
    ]

    # Y desde la cola no se pueden volver a marcar.
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Diseño",
                    "requisitos": [
                        {"orden": 1, "titulo": "Uno", "hecho": True},
                        {"orden": 2, "titulo": "Dos"},
                    ],
                }
            ]
        },
    )
    assert r.status_code == 400
    assert "requisitos están pendientes" in r.json()["detail"]


def test_requisitos_invalidos_no_escriben(client, repo):  # noqa: ANN001, ANN202
    uid, _ = _crear_roadmap(client, repo, [{"titulo": "Diseño", "requisitos": [{"titulo": "Uno"}]}])
    for requisitos, codigo in (
        ([{"titulo": "   "}], 400),
        ([{"orden": 1, "titulo": "A"}, {"orden": 1, "titulo": "B"}], 400),
        ([{"orden": 0, "titulo": "A"}], 422),
    ):
        r = client.patch(
            f"/ideas/{uid}",
            params={"repo": repo},
            json={"fases": [{"orden": 1, "titulo": "Diseño", "requisitos": requisitos}]},
        )
        assert r.status_code == codigo, requisitos

    assert [q["titulo"] for q in _fases(client, repo, uid)[0]["requisitos"]] == ["Uno"]


def test_una_fase_sin_requisitos_no_vale(client, repo):  # noqa: ANN001, ANN202
    uid = _crear(client, repo, status="proposed")
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"status": "roadmap", "fases": [{"titulo": "Diseño"}]},
    )
    assert r.status_code == 400
    assert "al menos un requisito" in r.json()["detail"]
    assert _fases(client, repo, uid) == []


def test_una_fase_fallida_exige_motivo(client, repo):  # noqa: ANN001, ANN202
    uid, _ = _crear_roadmap(
        client, repo, [{"titulo": "Diseño", "requisitos": [{"titulo": "Uno"}]}]
    )
    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={"fases": [{"orden": 1, "titulo": "Diseño", "estado": "fallida"}]},
    )
    assert r.status_code == 400
    assert "motivo" in r.json()["detail"]

    r = client.patch(
        f"/ideas/{uid}",
        params={"repo": repo},
        json={
            "fases": [
                {
                    "orden": 1,
                    "titulo": "Diseño",
                    "estado": "fallida",
                    "nota": "No pasa la carga",
                }
            ]
        },
    )
    assert r.status_code == 200, r.json()
    assert r.json()["fases"][0]["estado"] == "fallida"
    assert r.json()["fases"][0]["nota"] == "No pasa la carga"


def test_protocolos_publican_el_requisito(client, repo):  # noqa: ANN001, ANN202
    filas = client.get("/protocolos", params={"repo": repo}).json()
    exigidas = {(f["origen"], f["destino"]) for f in filas if f["exige_fases"]}
    assert exigidas == {("proposed", "roadmap"), ("verificacion", "revision_aprobada")}
    listas = {(f["origen"], f["destino"]) for f in filas if f["exige_fases_listas"]}
    assert listas == {("roadmap", "verificacion")}
    completas = {(f["origen"], f["destino"]) for f in filas if f["exige_fases_completas"]}
    assert completas == {("verificacion", "revision_aprobada")}
    assert all(
        isinstance(f["exige_fases"], bool)
        and isinstance(f["exige_fases_listas"], bool)
        and isinstance(f["exige_fases_completas"], bool)
        for f in filas
    )
