"""`ensure_repo` no abre el almacén dos veces por petición.

Un almacén que este proceso ya comprobó y que no ha cambiado no necesita otra
conexión para volver a leer `user_version`: con su huella (`mtime_ns`, tamaño)
basta. Si el fichero cambia —una copia restaurada, una migración desde fuera— se
vuelve a comprobar.
"""

from __future__ import annotations

import os

from events_core import ideas
from events_core.ideas.base import migraciones


def _vigilar_conexiones(monkeypatch) -> list[object]:  # noqa: ANN001, ANN202
    """Cuenta las conexiones que abre `migraciones` para comprobar el almacén."""
    llamadas: list[object] = []
    original = migraciones.connect

    def contar(db_file, **kwargs):  # noqa: ANN001, ANN202
        llamadas.append(db_file)
        return original(db_file, **kwargs)

    monkeypatch.setattr(migraciones, "connect", contar)
    return llamadas


def test_el_almacen_ya_comprobado_no_se_abre_otra_vez(repo, monkeypatch):  # noqa: ANN001, ANN202
    ideas.init_repo(repo)
    llamadas = _vigilar_conexiones(monkeypatch)

    ideas.ensure_repo(repo)  # la primera lectura comprueba la versión
    ideas.ensure_repo(repo)  # la segunda ya lo sabe
    ideas.ensure_repo(repo)
    assert len(llamadas) == 1


def test_un_fichero_que_cambia_se_vuelve_a_comprobar(repo, monkeypatch):  # noqa: ANN001, ANN202
    db = ideas.init_repo(repo)
    ideas.ensure_repo(repo)  # queda al día y recordado
    llamadas = _vigilar_conexiones(monkeypatch)

    ideas.ensure_repo(repo)
    assert llamadas == []

    # El fichero cambia por detrás (aquí, la fecha): la huella ya no coincide.
    os.utime(db, ns=(0, 0))

    ideas.ensure_repo(repo)
    assert len(llamadas) == 1
