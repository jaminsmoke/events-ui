"""Las conexiones vigilantes se reutilizan, pero no se quedan pegadas.

`data_version` solo sube en una conexión que ya existía cuando otra escribe,
así que hay que reutilizarla; lo que no puede es sobrevivir al fichero ni
quedarse para siempre.
"""

from __future__ import annotations

import sqlite3
import threading
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

import pytest

from events_core import db


def _almacen(tmp_path: Path) -> Path:
    ruta = tmp_path / ".EUI" / "EUI_DATABASE.sqlite"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(ruta)) as conn:
        conn.execute("CREATE TABLE t (x INTEGER)")
    return ruta


@pytest.fixture(autouse=True)
def _suelta_al_terminar():  # noqa: ANN202
    yield
    db.cerrar_vigilantes()


def test_la_conexion_se_reutiliza(tmp_path):  # noqa: ANN001, ANN202
    ruta = _almacen(tmp_path)

    assert db.vigilante(ruta) is db.vigilante(ruta)


def test_un_fichero_recreado_suelta_las_conexiones_viejas(tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    ruta = _almacen(tmp_path)
    vieja = db.vigilante(ruta)

    # La identidad del inodo cambia: es lo que se ve tras borrar y recrear el
    # almacén (sin tocar el fichero, que en Windows estaría bloqueado).
    monkeypatch.setattr(db, "_identidad", lambda _ruta: (1, 2))
    nueva = db.vigilante(ruta)

    assert nueva is not vieja
    with pytest.raises(sqlite3.ProgrammingError):
        vieja.execute("PRAGMA data_version")


def test_sin_fichero_no_hay_identidad(tmp_path):  # noqa: ANN001, ANN202
    ruta = _almacen(tmp_path)
    antes = db._identidad(ruta)
    ruta.unlink()

    assert antes is not None
    assert db._identidad(ruta) is None


def test_la_conexion_caduca_por_inactividad(tmp_path, monkeypatch):  # noqa: ANN001, ANN202
    ruta = _almacen(tmp_path)
    reloj = [1000.0]
    monkeypatch.setattr(db, "time", SimpleNamespace(monotonic=lambda: reloj[0]))

    vieja = db.vigilante(ruta)
    reloj[0] += db._VIGILANTE_TTL + 1
    nueva = db.vigilante(ruta)

    assert nueva is not vieja


def test_con_vigilante_retiene_el_lock_hasta_salir_del_bloque(tmp_path):  # noqa: ANN001, ANN202
    """La firma de `/revision` lee dentro del lock: otro hilo no entra a la vez.

    `vigilante` suelta el lock al devolver la conexión, así que sin el bloque el
    registro y las lecturas se pisarían en la conexión compartida.
    """
    ruta = _almacen(tmp_path)
    libre = []

    def intenta_entrar():  # noqa: ANN202
        libre.append(db._VIGILANTES_LOCK.acquire(timeout=0.2))
        if libre[-1]:
            db._VIGILANTES_LOCK.release()

    with db.con_vigilante(ruta, compartida=True) as conn:
        assert conn is db.vigilante(ruta, compartida=True)
        hilo = threading.Thread(target=intenta_entrar)
        hilo.start()
        hilo.join()

    # Dentro del bloque el lock está tomado; al salir, libre otra vez.
    assert libre == [False]
    assert db._VIGILANTES_LOCK.acquire(timeout=0)
    db._VIGILANTES_LOCK.release()


def test_cerrar_vigilantes_las_suelta_todas(tmp_path):  # noqa: ANN001, ANN202
    ruta = _almacen(tmp_path)
    vieja = db.vigilante(ruta)

    db.cerrar_vigilantes()

    with pytest.raises(sqlite3.ProgrammingError):
        vieja.execute("PRAGMA data_version")
    assert db.vigilante(ruta) is not vieja
