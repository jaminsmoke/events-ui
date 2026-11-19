"""La tabla del registro se prepara una vez por proceso, no en cada línea.

Antes, cada `registro.escribir` pagaba su `CREATE TABLE/INDEX IF NOT EXISTS`.
Ahora la primera conexión prepara el fichero y las siguientes solo insertan; si
el fichero desaparece por debajo, la marca se olvida y se vuelve a preparar.
"""

from __future__ import annotations

from events_core import registro


def _mensajes() -> list[str]:
    return [fila["mensaje"] for fila in registro.listar()]


def test_la_tabla_se_prepara_una_sola_vez(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setenv(registro.REGISTRO_ENV_VAR, str(tmp_path / "registro.sqlite"))
    monkeypatch.setattr(registro, "_PREPARADOS", set())

    llamadas: list[int] = []
    original = registro._preparar

    def contar(conn) -> None:  # noqa: ANN001
        llamadas.append(1)
        original(conn)

    monkeypatch.setattr(registro, "_preparar", contar)

    registro.escribir("info", "uno")
    registro.escribir("info", "dos")
    registro.listar()

    assert llamadas == [1]
    assert _mensajes() == ["dos", "uno"]


def test_un_fichero_recreado_se_vuelve_a_preparar(tmp_path, monkeypatch) -> None:  # noqa: ANN001
    destino = tmp_path / "registro.sqlite"
    monkeypatch.setenv(registro.REGISTRO_ENV_VAR, str(destino))
    monkeypatch.setattr(registro, "_PREPARADOS", set())

    registro.escribir("info", "antes")
    destino.unlink()
    registro.escribir("info", "después")

    assert _mensajes() == ["después"]
