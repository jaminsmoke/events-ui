"""La retención del registro no se paga en cada línea.

`_anotar` hacía los dos barridos (edad y conteo) en cada entrada. Ahora se
purga una de cada `CADA_PURGA` escrituras o cada `PURGA_CADA_S` segundos, y
`POST /log/purgar` sigue forzando la pasada.
"""

from __future__ import annotations

from contextlib import closing
from datetime import UTC, datetime, timedelta

from events_core import registro


def _preparar(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    """Un registro propio por prueba, con las marcas de proceso en blanco."""
    monkeypatch.setenv(registro.REGISTRO_ENV_VAR, str(tmp_path / "registro.sqlite"))
    monkeypatch.setattr(registro, "_PREPARADOS", set())
    # `raising=False`: sin el arreglo la marca no existe y la prueba tiene que
    # fallar en lo que mide (las purgas), no al preparar el escenario.
    monkeypatch.setattr(registro, "_PENDIENTES", {}, raising=False)


def _contar_barridos(monkeypatch) -> list[int]:  # noqa: ANN001
    llamadas: list[int] = []
    original = registro.barridos_retencion

    def contar(*args, **kwargs):  # noqa: ANN002, ANN003
        llamadas.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(registro, "barridos_retencion", contar)
    return llamadas


def test_cien_lineas_pagan_una_purga(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    _preparar(tmp_path, monkeypatch)
    llamadas = _contar_barridos(monkeypatch)

    for i in range(100):
        registro.escribir("info", f"línea {i}")

    assert len(llamadas) == 1
    assert len(registro.listar(limite=500)) == 100


def test_la_retencion_de_conteo_sigue(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    _preparar(tmp_path, monkeypatch)
    monkeypatch.setattr(registro, "CADA_PURGA", 3)
    monkeypatch.setattr(registro, "MAX_ENTRADAS", 5)
    llamadas = _contar_barridos(monkeypatch)

    for i in range(9):
        registro.escribir("info", f"línea {i}")

    assert len(llamadas) == 3
    assert [fila["mensaje"] for fila in registro.listar(limite=50)] == [
        f"línea {i}" for i in range(8, 3, -1)
    ]


def test_la_retencion_de_edad_sigue(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    _preparar(tmp_path, monkeypatch)
    viejo = (datetime.now(UTC) - timedelta(days=registro.DIAS_RETENCION + 30)).isoformat(
        timespec="seconds"
    )
    with closing(registro.conectar()) as conn:
        conn.execute(
            "INSERT INTO registro (ts, nivel, origen, mensaje) VALUES (?, 'info', 'test', 'viejo')",
            (viejo,),
        )
        conn.commit()

    assert registro.purgar() == {"por_edad": 1, "por_conteo": 0}
    assert [fila["mensaje"] for fila in registro.listar()] == []


def test_purgar_reinicia_la_cuenta(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    _preparar(tmp_path, monkeypatch)
    llamadas = _contar_barridos(monkeypatch)

    registro.escribir("info", "uno")
    registro.purgar()
    registro.escribir("info", "dos")

    assert len(llamadas) == 1


def test_el_endpoint_de_purga_dice_que_se_llevo(client, tmp_path, monkeypatch) -> None:  # noqa: ANN001, ANN202
    """`/log` y `POST /log/purgar`, por HTTP: es lo que el e2e miraba."""
    _preparar(tmp_path, monkeypatch)
    registro.escribir("info", "línea")

    de_log = client.get("/log", params={"limite": 200})
    assert de_log.status_code == 200
    assert len(de_log.json()) > 0

    purga = client.post("/log/purgar")
    assert purga.status_code == 200
    cuerpo = purga.json()
    assert isinstance(cuerpo["por_edad"], int)
    assert isinstance(cuerpo["por_conteo"], int)


def test_el_tiempo_tambien_dispara_la_purga(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    _preparar(tmp_path, monkeypatch)
    monkeypatch.setattr(registro, "PURGA_CADA_S", 0.0)
    llamadas = _contar_barridos(monkeypatch)

    registro.escribir("info", "uno")
    registro.escribir("info", "dos")

    assert len(llamadas) == 2
