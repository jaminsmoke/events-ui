"""El corte de retención se compara como instante, no como texto."""

from __future__ import annotations

import sqlite3
from contextlib import closing
from datetime import UTC, datetime, timedelta

from events_core import eventos, ideas, registro


def _instantes(dias: int) -> tuple[str, str]:
    """Primer y último segundo del día del corte, en ISO-8601 UTC.

    Los dos están a la vez en el mismo día del corte, que es justo donde la
    comparación textual fallaba: `T` ordena después del espacio de
    `datetime('now', …)`.
    """
    corte = datetime.now(UTC) - timedelta(days=dias)
    inicio = corte.replace(hour=0, minute=0, second=0, microsecond=0)
    fin = corte.replace(hour=23, minute=59, second=59, microsecond=0)
    return inicio.isoformat(timespec="seconds"), fin.isoformat(timespec="seconds")


def test_evento_del_mismo_dia_anterior_al_corte(repo) -> None:
    ideas.init_repo(repo)
    antes, despues = _instantes(5)
    db_file = ideas.db_file_for(repo)
    with closing(sqlite3.connect(db_file)) as conn:
        conn.executemany(
            "INSERT INTO event (ts, type, payload, origen) VALUES (?, 'prueba', ?, 'test')",
            [(antes, '{"uid": "antes"}'), (despues, '{"uid": "despues"}')],
        )
        conn.commit()

    resumen = eventos.compactar(repo, dias=5, max_eventos=1_000)
    assert resumen["por_edad"] == 1

    with closing(sqlite3.connect(db_file)) as conn:
        quedan = [fila[0] for fila in conn.execute("SELECT payload FROM event")]
    assert quedan == ['{"uid": "despues"}']


def test_registro_del_mismo_dia_anterior_al_corte(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("EVENTSUI_REGISTRO_DB", str(tmp_path / "registro.sqlite"))
    antes, despues = _instantes(5)
    with closing(registro.conectar()) as conn:
        conn.executemany(
            "INSERT INTO registro (ts, nivel, origen, mensaje) VALUES (?, 'info', 'test', ?)",
            [(antes, "antes"), (despues, "despues")],
        )
        conn.commit()

    assert registro.purgar(dias=5, max_entradas=1_000) == {"por_edad": 1, "por_conteo": 0}
    assert [fila["mensaje"] for fila in registro.listar()] == ["despues"]
