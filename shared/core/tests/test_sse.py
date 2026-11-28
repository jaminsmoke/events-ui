"""El SSE suelta la primera; no hace falta matar el cliente para que pare.

`generar_streamo` es un generador asíncrono que, en vivo, pregunta
`desconectado()` antes de seguir sondeando: con el cliente ido, el stream
termina en vez de seguir dejando pings.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3

from events_core import eventos, items


def _sembrar_rafaga(repo, cuantos: int) -> None:  # noqa: ANN001, ANN202
    """Una sola transacción con `cuantos` eventos, como un lote del productor."""
    conn = sqlite3.connect(str(items.db_file_for(repo)))
    conn.executemany(
        "INSERT INTO event (ts, type, payload) VALUES ('2026-11-18T00:00:00Z', 'testigo', ?)",
        [(json.dumps({"n": i}),) for i in range(cuantos)],
    )
    conn.commit()
    conn.close()


def _ids(frames: list[str]) -> list[int]:
    return [int(f.split(": ", 1)[1].split("\n", 1)[0]) for f in frames if f.startswith("id: ")]


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
    client.post("/items", params={"repo": repo}, json={"title": "A"})
    frames = _recolecta(repo, None)
    assert any("item.created" in f for f in frames)


def test_desconexion_corta_el_vivo(client, repo):  # noqa: ANN001, ANN202
    client.post("/items", params={"repo": repo}, json={"title": "A"})

    def desconectado() -> bool:
        return True

    # Backfill sí; y en vivo corta a la primera pregunta, sin sondear pings.
    frames = _recolecta(repo, desconectado, max_esperas=240)
    assert any("item.created" in f for f in frames)
    assert not any("ping" in f for f in frames)


def test_rafaga_mayor_que_la_pagina_llega_entera(client, repo):  # noqa: ANN001, ANN202
    """Una transacción de 250 eventos entrega los 250, no la primera página."""
    sembrada: list[bool] = []

    def escribir_en_vivo() -> bool:
        if not sembrada:
            _sembrar_rafaga(repo, 250)
            sembrada.append(True)
        return False

    frames = _recolecta(repo, escribir_en_vivo, max_esperas=4)
    assert _ids(frames) == list(range(1, 251))


def test_un_vaciado_reinicia_el_cursor_en_vivo(client, repo):  # noqa: ANN001, ANN202
    """Con el cliente conectado, vaciar el log vuelve a empezar los IDs: se
    reinicia el cursor en vez de esperar números que ya no existen."""
    client.post("/items", params={"repo": repo}, json={"title": "A"})
    client.post("/items", params={"repo": repo}, json={"title": "B"})
    assert [e["id"] for e in client.get("/eventos", params={"repo": repo}).json()] == [1, 2]

    hecho: list[bool] = []

    def vaciar_en_vivo() -> bool:
        if not hecho:
            client.post("/reiniciar", params={"repo": repo})
            client.post("/items", params={"repo": repo}, json={"title": "C"})
            hecho.append(True)
        return False

    frames = _recolecta(repo, vaciar_en_vivo, max_esperas=4)
    assert _ids(frames) == [1, 2, 1]


def test_reconexion_con_cursor_viejo_tras_vaciar(client, repo):  # noqa: ANN001, ANN202
    """Reconectar con `Last-Event-ID` 2 tras un vaciado no omite el alta."""
    client.post("/items", params={"repo": repo}, json={"title": "A"})
    client.post("/items", params={"repo": repo}, json={"title": "B"})
    client.post("/reiniciar", params={"repo": repo})
    client.post("/items", params={"repo": repo}, json={"title": "C"})

    async def _desde_2() -> list[str]:
        return [
            frame async for frame in eventos.generar_streamo(repo, 2, intervalo=0.01, max_esperas=0)
        ]

    assert _ids(asyncio.run(_desde_2())) == [1]


def test_primer_item_created_se_consulta(client, repo):  # noqa: ANN001, ANN202
    """Un almacén recién creado ya tiene su log: el primer alta se lee."""
    uid = client.post("/items", params={"repo": repo}, json={"title": "A"}).json()["uid"]
    r = client.get("/eventos", params={"repo": repo})
    assert r.status_code == 200, r.json()
    assert [(e["type"], e["payload"]["uid"]) for e in r.json()] == [("item.created", uid)]


def test_stream_route_responde(client, repo):  # noqa: ANN001, ANN202
    """El endpoint HTTP entrega frames por el canal SSE."""
    client.post("/items", params={"repo": repo}, json={"title": "A"})
    with client.stream("GET", "/eventos/stream?repo=" + repo, headers={"Last-Event-ID": "0"}) as r:
        assert r.status_code == 200
        texto = ""
        for linea in r.iter_lines():
            texto += linea
            if "item.created" in texto:
                break
        assert "item.created" in texto
