"""El plan de un PATCH manda: `update_item` solo comprueba y aplica.

La planificación (`modelo/plan.py`) es el único sitio que decide qué escribir,
qué comprobar y qué anotar. Aquí se prueba que decidir no toca la base y que las
cuatro compuertas del flujo se pueden ejercitar sobre un plan, sin montar un
PATCH entero ni pasar por HTTP.
"""

from __future__ import annotations

from contextlib import closing

import pytest

from events_core.items import InvalidInput
from events_core.items.base.esquema import connect, ensure_repo
from events_core.items.crud import create_item, update_item
from events_core.items.modelo.estados import _estado
from events_core.items.modelo.plan import _comprobar, _huella_fases, _planificar
from events_core.items.trabajo.fases import _fases

REQUISITO = {"titulo": "Criterio", "hecho": False}


def _fase(estado: str = "pendiente", hecho: bool = False) -> list[dict]:
    return [
        {
            "titulo": "Una",
            "estado": estado,
            "requisitos": [{**REQUISITO, "hecho": hecho}],
        }
    ]


def _en_roadmap(repo: str, *, estado: str = "pendiente", hecho: bool = False) -> str:
    return create_item(repo, title="A", status="roadmap", fases=_fase(estado, hecho))["uid"]


def _en_verificacion(repo: str) -> str:
    uid = _en_roadmap(repo, estado="completada", hecho=True)
    update_item(repo, uid, {"status": "verificacion"})
    return uid


def test_el_plan_no_escribe_en_la_base(repo: str) -> None:  # noqa: ANN001
    uid = _en_roadmap(repo)
    with closing(connect(ensure_repo(repo))) as conn:
        antes = (_estado(conn, uid), _huella_fases(_fases(conn, uid)))
        plan = _planificar(conn, repo, uid, {"status": "verificacion"})
        despues = (_estado(conn, uid), _huella_fases(_fases(conn, uid)))

    assert plan.cambiado_estado
    assert plan.destino == "verificacion"
    assert antes == despues


def test_la_compuerta_de_fases_exige_lista(repo: str) -> None:  # noqa: ANN001
    # proposed → roadmap exige al menos una fase.
    uid = create_item(repo, title="A", status="proposed")["uid"]
    with closing(connect(ensure_repo(repo))) as conn:
        plan = _planificar(conn, repo, uid, {"status": "roadmap"})
        with pytest.raises(InvalidInput, match="al menos una fase"):
            _comprobar(conn, plan)


def test_la_compuerta_de_fases_abiertas(repo: str) -> None:  # noqa: ANN001
    uid = _en_roadmap(repo)
    with closing(connect(ensure_repo(repo))) as conn:
        plan = _planificar(conn, repo, uid, {"status": "verificacion"})
        with pytest.raises(InvalidInput, match="quedan fases sin cerrar"):
            _comprobar(conn, plan)


def test_la_compuerta_de_fases_completas(repo: str) -> None:  # noqa: ANN001
    uid = _en_verificacion(repo)
    rechazada = [
        {
            "orden": 1,
            "titulo": "Una",
            "estado": "rechazada",
            "requisitos": [{"orden": 1, "titulo": "Criterio", "hecho": True}],
        }
    ]
    update_item(repo, uid, {"fases": rechazada})
    with closing(connect(ensure_repo(repo))) as conn:
        plan = _planificar(conn, repo, uid, {"status": "revision_aprobada"})
        with pytest.raises(InvalidInput, match="hay fases sin completar"):
            _comprobar(conn, plan)


def test_la_compuerta_de_aprobacion_mira_los_requisitos(repo: str) -> None:  # noqa: ANN001
    # Un almacén incoherente (fase completada con un requisito a medias) no se
    # archiva: la aprobación mira la lista que quedará, no confía en la fase.
    uid = _en_verificacion(repo)
    with closing(connect(ensure_repo(repo))) as conn:
        conn.execute("UPDATE work_item_requisito SET hecho = 0 WHERE work_item_uid = ?", (uid,))
        conn.commit()
        plan = _planificar(conn, repo, uid, {"status": "revision_aprobada"})
        with pytest.raises(InvalidInput, match="quedan requisitos sin completar"):
            _comprobar(conn, plan)
