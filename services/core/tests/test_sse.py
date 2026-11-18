"""El SSE suelta la primera; no hace falta matar el cliente para que pare.

`generar_streamo` es un generador asíncrono que, en vivo, pregunta
`desconectado()` antes de seguir sondeando: con el cliente ido, el stream
termina en vez de seguir dejando pings.
"""

from __future__ import annotations

import asyncio
import sqlite3
from pathlib import Path

from events_core import eventos, ideas


def _sembrar_event(repo) -> None:  # noqa: ANN001, ANN202
    """La tabla del log como la deja la app (el productor la crea de verdad)."""
    ideas.ensure_repo(repo)
    conn = sqlite3.connect(str(ideas.db_file_for(repo)))
    conn.executescript((Path(ideas.SCHEMA_DIR) / "eventos.sql").read_text(encoding="utf-8"))
    conn.commit()
    conn.close()


def _recolecta(repo: str, desconectado, max_esperas: int = 0) -> list[str]:  # noqa: ANN001, ANN202
    async def _todo() -> list[str]:
        return [
            frame
            async for frame in eventos.generar_streamo(
                repo, 0, intervalo=0.01, max_esperas=max_esperas, desconectado=desconectado
            )
        ]

    return asyncio.run(_todo())


def test_backfill_sale_sin_esperar(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    client.post("/ideas", params={"repo": repo}, json={"title": "A"})
    frames = _recolecta(repo, None)
    assert any("idea.created" in f for f in frames)


def test_desconexion_corta_el_vivo(client, repo):  # noqa: ANN001, ANN202
    _sembrar_event(repo)
    client.post("/ideas", params={"repo": repo}, json={"title": "A"})

    def desconectado() -> bool:
        return True

    # Backfill sí; y en vivo corta a la primera pregunta, sin sondear pings.
    frames = _recolecta(repo, desconectado, max_esperas=240)
    assert any("idea.created" in f for f in frames)
    assert not any("ping" in f for f in frames)


def test_stream_route_responde(client, repo):  # noqa: ANN001, ANN202
    """El endpoint HTTP entrega frames por el canal SSE."""
    _sembrar_event(repo)
    client.post("/ideas", params={"repo": repo}, json={"title": "A"})
    with client.stream("GET", "/eventos/stream?repo=" + repo, headers={"Last-Event-ID": "0"}) as r:
        assert r.status_code == 200
        texto = ""
        for linea in r.iter_lines():
            texto += linea
            if "idea.created" in texto:
                break
        assert "idea.created" in texto
