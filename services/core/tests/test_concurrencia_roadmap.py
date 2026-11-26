"""La comprobación del carril y la escritura, en la misma transacción.

Dos PATCH simultáneos leían «roadmap está libre» a la vez: el índice único
paraba al segundo, pero el 400 hablaba de `superseded_by_uid`. En el alta, el
choque de posición salía como 500. `BEGIN IMMEDIATE` serializa la comprobación
con la escritura, así que el segundo ve el estado real y recibe el 400 que toca.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Callable
from typing import Any

from events_core import items

FASES = [{"titulo": "Fase única", "requisitos": [{"titulo": "Comprobar"}]}]


def _en_paralelo(acciones: list[Callable[[], Any]]) -> list[object]:
    """Lanza las acciones a la vez y devuelve su resultado o su excepción."""
    barrera = threading.Barrier(len(acciones))
    salida: list[object] = [None] * len(acciones)

    def correr(indice: int, accion: Callable[[], Any]) -> None:
        barrera.wait()
        try:
            salida[indice] = accion()
        except Exception as exc:  # noqa: BLE001 - la prueba mira qué falló
            salida[indice] = exc

    hilos = [
        threading.Thread(target=correr, args=(indice, accion), daemon=True)
        for indice, accion in enumerate(acciones)
    ]
    for hilo in hilos:
        hilo.start()
    for hilo in hilos:
        hilo.join(timeout=30)
    return salida


def _posiciones(repo: str) -> list[int]:
    with sqlite3.connect(str(items.db_file_for(repo))) as conn:
        return [
            int(fila[0])
            for fila in conn.execute(
                "SELECT posicion FROM work_item_node WHERE estado = 'proposed' ORDER BY posicion"
            )
        ]


def _en_roadmap(repo: str) -> list[str]:
    with sqlite3.connect(str(items.db_file_for(repo))) as conn:
        return [
            str(fila[0])
            for fila in conn.execute("SELECT uid FROM work_item_node WHERE estado = 'roadmap'")
        ]


def test_dos_patch_a_roadmap_dejan_uno_y_el_otro_recibe_400(repo):  # noqa: ANN001
    primera = items.create_item(repo, title="Primera", status="proposed")
    segunda = items.create_item(repo, title="Segunda", status="proposed")

    salida = _en_paralelo(
        [
            lambda: items.update_item(repo, primera["uid"], {"status": "roadmap", "fases": FASES}),
            lambda: items.update_item(repo, segunda["uid"], {"status": "roadmap", "fases": FASES}),
        ]
    )

    ganadoras = [r for r in salida if isinstance(r, dict)]
    fallos = [r for r in salida if isinstance(r, Exception)]
    assert len(ganadoras) == 1, salida
    assert len(fallos) == 1, salida
    assert isinstance(fallos[0], items.InvalidInput)
    assert "solo admite un item activo" in str(fallos[0])
    assert _en_roadmap(repo) == [ganadoras[0]["uid"]]


def test_dos_patch_a_la_cola_estrenan_posicion_distinta(repo):  # noqa: ANN001
    primera = items.create_item(repo, title="Primera")
    segunda = items.create_item(repo, title="Segunda")

    salida = _en_paralelo(
        [
            lambda: items.update_item(repo, primera["uid"], {"status": "proposed"}),
            lambda: items.update_item(repo, segunda["uid"], {"status": "proposed"}),
        ]
    )

    assert all(isinstance(r, dict) for r in salida), salida
    assert _posiciones(repo) == [1, 2]


def test_dos_altas_en_roadmap_no_dan_500(repo):  # noqa: ANN001
    items.create_item(repo, title="Cebo")  # siembra el almacén antes de los hilos

    salida = _en_paralelo(
        [
            lambda: items.create_item(repo, title="A", status="roadmap", fases=FASES),
            lambda: items.create_item(repo, title="B", status="roadmap", fases=FASES),
        ]
    )

    ganadoras = [r for r in salida if isinstance(r, dict)]
    fallos = [r for r in salida if isinstance(r, Exception)]
    assert len(ganadoras) == 1, salida
    assert len(fallos) == 1, salida
    assert isinstance(fallos[0], items.InvalidInput)
    assert "solo admite un item activo" in str(fallos[0])
    assert _en_roadmap(repo) == [ganadoras[0]["uid"]]
