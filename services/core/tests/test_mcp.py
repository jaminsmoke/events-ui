"""Servidor MCP por stdio: protocolo, herramientas, recurso y escritura."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from events_core import mcp_servidor, migracion


def _peticion(metodo: str, params: dict | None = None, ident: int = 1) -> dict:
    mensaje = {"jsonrpc": "2.0", "id": ident, "method": metodo}
    if params is not None:
        mensaje["params"] = params
    return mensaje


def test_initialize_negocia_version_y_capacidades() -> None:
    respuesta = mcp_servidor.manejar(
        _peticion(
            "initialize",
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "test", "version": "0"},
            },
        )
    )

    assert respuesta["result"]["protocolVersion"] == "2025-06-18"
    assert respuesta["result"]["serverInfo"] == {
        "name": "events-ui",
        "version": mcp_servidor.__version__,
    }
    assert "tools" in respuesta["result"]["capabilities"]
    assert "resources" in respuesta["result"]["capabilities"]


def test_tools_list_por_defecto_solo_lectura() -> None:
    herramientas = mcp_servidor.manejar(_peticion("tools/list"))["result"]["tools"]
    nombres = {herramienta["name"] for herramienta in herramientas}

    assert {"doctor", "item_list", "item_get", "migrate_scan", "migrate_check"} <= nombres
    assert not (nombres & mcp_servidor.HERRAMIENTAS_ESCRITURA)


def test_tools_list_con_permiso_anuncia_escritura() -> None:
    herramientas = mcp_servidor.manejar(_peticion("tools/list"), permitir_escritura=True)["result"][
        "tools"
    ]
    nombres = {herramienta["name"] for herramienta in herramientas}

    assert {"item_create", "item_edit", "item_move", "item_fases", "item_requisito"} <= nombres
    assert {"migrate_apply", "migrate_undo"} <= nombres


def test_escritura_sin_permiso_devuelve_is_error() -> None:
    respuesta = mcp_servidor.manejar(
        _peticion("tools/call", {"name": "item_create", "arguments": {"title": "Hola"}})
    )

    assert respuesta["result"]["isError"] is True
    assert "escritura desactivada" in respuesta["result"]["content"][0]["text"]


def test_tools_list_anuncia_fases_en_item_create() -> None:
    herramientas = mcp_servidor.manejar(_peticion("tools/list"), permitir_escritura=True)["result"][
        "tools"
    ]
    crear = next(h for h in herramientas if h["name"] == "item_create")

    assert crear["inputSchema"]["properties"]["fases"]["type"] == "array"


def test_item_create_con_fases_usa_un_temporal_y_lo_borra(monkeypatch) -> None:
    """Las fases inline viajan al CLI como fichero, igual que en `item_fases`."""
    visto: dict = {}

    def falso(argv):  # noqa: ANN001, ANN202
        ruta = Path(argv[argv.index("--fases") + 1])
        visto["fases"] = json.loads(ruta.read_text(encoding="utf-8"))
        visto["ruta"] = ruta
        print(json.dumps({"uid": "u1"}))
        return 0

    monkeypatch.setattr(mcp_servidor.cli, "main", falso)
    fases = [{"titulo": "Diseño", "requisitos": [{"titulo": "Cubre el borde"}]}]

    respuesta = mcp_servidor.manejar(
        _peticion(
            "tools/call",
            {"name": "item_create", "arguments": {"title": "A", "fases": fases}},
        ),
        permitir_escritura=True,
    )

    assert respuesta["result"].get("isError") is None
    assert visto["fases"] == fases
    assert not visto["ruta"].exists()


def test_tools_call_reutiliza_el_cli(monkeypatch) -> None:
    visto = {}

    def falso(argv):
        visto["argv"] = argv
        print(json.dumps([{"uid": "u1", "status": "proposed", "title": "Hola"}]))
        return 0

    monkeypatch.setattr(mcp_servidor.cli, "main", falso)

    respuesta = mcp_servidor.manejar(
        _peticion(
            "tools/call",
            {
                "name": "item_list",
                "arguments": {"repo": "lab", "status": "proposed", "limit": 5},
            },
        )
    )

    assert respuesta["result"].get("isError") is None
    datos = json.loads(respuesta["result"]["content"][0]["text"])
    assert datos[0]["uid"] == "u1"
    assert visto["argv"][:2] == ["item", "list"]
    assert "--json" in visto["argv"]
    assert visto["argv"][visto["argv"].index("--repo") + 1] == "lab"
    assert visto["argv"][visto["argv"].index("--limit") + 1] == "5"


def test_tools_call_devuelve_el_error_del_cli(monkeypatch) -> None:
    def falso(argv):
        print("error: no existe el ítem u1", file=sys.stderr)
        return 1

    monkeypatch.setattr(mcp_servidor.cli, "main", falso)

    respuesta = mcp_servidor.manejar(
        _peticion("tools/call", {"name": "item_get", "arguments": {"uid": "u1"}})
    )

    assert respuesta["result"]["isError"] is True
    assert "no existe el ítem" in respuesta["result"]["content"][0]["text"]


def test_campo_desconocido_es_error_de_protocolo(monkeypatch) -> None:
    """`fases` en `item_edit` no puede aceptarse y perderse en silencio."""
    visto: list[list[str]] = []
    monkeypatch.setattr(mcp_servidor.cli, "main", lambda argv: visto.append(argv) or 0)

    respuesta = mcp_servidor.manejar(
        _peticion(
            "tools/call",
            {"name": "item_edit", "arguments": {"uid": "u1", "content": "hola", "fases": []}},
        ),
        permitir_escritura=True,
    )

    assert respuesta["error"]["code"] == -32602
    assert "fases" in respuesta["error"]["message"]
    assert "item_fases" in respuesta["error"]["message"]
    assert visto == []


def test_campo_de_otra_herramienta_sugiere_la_suya() -> None:
    respuesta = mcp_servidor.manejar(
        _peticion(
            "tools/call",
            {"name": "item_get", "arguments": {"uid": "u1", "status": "roadmap"}},
        )
    )

    assert respuesta["error"]["code"] == -32602
    assert "item_move" in respuesta["error"]["message"]


def test_required_ausente_es_invalid_params(monkeypatch) -> None:
    monkeypatch.setattr(
        mcp_servidor.cli, "main", lambda argv: (_ for _ in ()).throw(AssertionError())
    )

    respuesta = mcp_servidor.manejar(_peticion("tools/call", {"name": "item_get", "arguments": {}}))

    assert respuesta["error"]["code"] == -32602
    assert "uid" in respuesta["error"]["message"]
    assert "isError" not in respuesta


def test_tipo_incorrecto_es_invalid_params() -> None:
    respuesta = mcp_servidor.manejar(
        _peticion("tools/call", {"name": "item_list", "arguments": {"limit": "cinco"}})
    )

    assert respuesta["error"]["code"] == -32602
    assert "limit" in respuesta["error"]["message"]


def test_tools_list_anuncia_additional_properties_false() -> None:
    """El esquema promete `additionalProperties: false`: el validador lo cumple."""
    for permitir_escritura in (False, True):
        herramientas = mcp_servidor.manejar(
            _peticion("tools/list"), permitir_escritura=permitir_escritura
        )["result"]["tools"]
        for herramienta in herramientas:
            esquema = herramienta["inputSchema"]
            assert esquema["type"] == "object", herramienta["name"]
            assert esquema["additionalProperties"] is False, herramienta["name"]
            assert set(esquema.get("required", [])) <= set(esquema["properties"]), herramienta[
                "name"
            ]


def test_item_fases_usa_un_temporal_y_lo_borra(monkeypatch) -> None:
    visto = {}

    def falso(argv):
        ruta = Path(argv[3])
        visto["ruta"] = ruta
        visto["fases"] = json.loads(ruta.read_text(encoding="utf-8"))
        print(json.dumps({"uid": "u1"}))
        return 0

    monkeypatch.setattr(mcp_servidor.cli, "main", falso)

    respuesta = mcp_servidor.manejar(
        _peticion(
            "tools/call",
            {
                "name": "item_fases",
                "arguments": {"uid": "u1", "fases": [{"titulo": "Preparar"}]},
            },
        ),
        permitir_escritura=True,
    )

    assert respuesta["result"].get("isError") is None
    assert visto["fases"] == [{"titulo": "Preparar"}]
    assert not visto["ruta"].exists()


def test_recurso_del_esquema_del_plan() -> None:
    recursos = mcp_servidor.manejar(_peticion("resources/list"))["result"]["resources"]
    assert recursos[0]["uri"] == mcp_servidor.URI_ESQUEMA

    respuesta = mcp_servidor.manejar(_peticion("resources/read", {"uri": mcp_servidor.URI_ESQUEMA}))
    esquema = json.loads(respuesta["result"]["contents"][0]["text"])
    assert esquema["properties"]["version"]["enum"] == [1, 2, 3]
    assert esquema["$id"]


def test_metodo_desconocido_es_error_de_protocolo() -> None:
    respuesta = mcp_servidor.manejar(_peticion("no/existe"))

    assert respuesta["error"]["code"] == -32601


def test_notificacion_no_tiene_respuesta() -> None:
    assert mcp_servidor.manejar({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None


def test_stdio_responde_y_sale_con_eof() -> None:
    entradas = (
        json.dumps(
            _peticion(
                "initialize",
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {},
                    "clientInfo": {"name": "test", "version": "0"},
                },
            )
        )
        + "\n"
        + json.dumps(_peticion("tools/list", ident=2))
        + "\n"
    )

    proceso = subprocess.run(
        [sys.executable, "-m", "events_core.mcp_servidor"],
        input=entradas,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )

    assert proceso.returncode == 0
    respuestas = [json.loads(linea) for linea in proceso.stdout.splitlines() if linea.strip()]
    assert respuestas[0]["result"]["serverInfo"]["name"] == "events-ui"
    assert respuestas[1]["result"]["tools"]
    assert all("isError" not in respuesta for respuesta in respuestas)


def test_tools_list_no_anuncia_alias() -> None:
    herramientas = mcp_servidor.manejar(_peticion("tools/list"), permitir_escritura=True)["result"][
        "tools"
    ]

    assert not [h for h in herramientas if h["name"].startswith("idea_")]
    assert not any("_meta" in h for h in herramientas)


def test_un_nombre_viejo_es_herramienta_desconocida(monkeypatch) -> None:
    visto: list[list[str]] = []
    monkeypatch.setattr(mcp_servidor.cli, "main", lambda argv: visto.append(argv) or 0)

    r = mcp_servidor.manejar(_peticion("tools/call", {"name": "idea_list", "arguments": {}}))

    assert r["error"]["code"] == -32602
    assert "herramienta desconocida" in r["error"]["message"]
    assert visto == []


def _herramienta(nombre: str) -> dict:
    herramientas = mcp_servidor.manejar(_peticion("tools/list"), permitir_escritura=True)["result"][
        "tools"
    ]
    return next(herramienta for herramienta in herramientas if herramienta["name"] == nombre)


def test_tools_list_anota_lectura_y_escritura() -> None:
    """Las pistas dicen qué lee y qué borra, y cuadran con HERRAMIENTAS_ESCRITURA."""
    lectura = mcp_servidor.manejar(_peticion("tools/list"))["result"]["tools"]
    todas = mcp_servidor.manejar(_peticion("tools/list"), permitir_escritura=True)["result"][
        "tools"
    ]

    for herramienta in lectura:
        anotaciones = herramienta["annotations"]
        assert anotaciones["readOnlyHint"] is True, herramienta["name"]
        assert anotaciones["destructiveHint"] is False, herramienta["name"]
        assert anotaciones["title"], herramienta["name"]
        assert herramienta["name"] not in mcp_servidor.HERRAMIENTAS_ESCRITURA

    escritura = [
        herramienta
        for herramienta in todas
        if herramienta["name"] in mcp_servidor.HERRAMIENTAS_ESCRITURA
    ]
    assert len(escritura) == len(mcp_servidor.HERRAMIENTAS_ESCRITURA)
    for herramienta in escritura:
        assert herramienta["annotations"]["readOnlyHint"] is False, herramienta["name"]

    assert {h["name"] for h in todas if h["annotations"]["destructiveHint"]} == {"migrate_undo"}
    assert {h["name"] for h in todas if h["annotations"]["idempotentHint"]} == {"migrate_apply"}


def test_item_list_devuelve_structured_content_envuelto(monkeypatch) -> None:
    """El protocolo pide un objeto: la lista viaja en `items` y el texto la repite."""
    filas = [
        {
            "uid": "u1",
            "title": "Hola",
            "status": "proposed",
            "created_at": "2026-01-01T00:00:00+00:00",
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
    ]

    def falso(_argv):  # noqa: ANN001, ANN202
        print(json.dumps(filas))
        return 0

    monkeypatch.setattr(mcp_servidor.cli, "main", falso)

    resultado = mcp_servidor.manejar(
        _peticion("tools/call", {"name": "item_list", "arguments": {"limit": 5}})
    )["result"]

    assert resultado["structuredContent"] == {"items": filas}
    assert json.loads(resultado["content"][0]["text"]) == filas

    esquema = _herramienta("item_list")["outputSchema"]
    assert migracion.validar_esquema(resultado["structuredContent"], esquema) == []

    # La envoltura ya está validada; la unión de filas no la entiende
    # `validar_esquema`, así que cada fila se prueba contra sus ramas, con los
    # `$ref` del propio esquema: uno roto revienta aquí.
    ramas = [
        {"$defs": esquema["$defs"], **rama} for rama in esquema["properties"]["items"]["anyOf"]
    ]
    for fila in filas:
        assert any(not migracion.validar_esquema([fila], rama) for rama in ramas), fila

    sin_uid = {clave: valor for clave, valor in filas[0].items() if clave != "uid"}
    assert all(migracion.validar_esquema([sin_uid], rama) for rama in ramas), (
        "una fila sin uid tiene que fallar en las dos ramas"
    )


def test_item_get_devuelve_structured_content_y_su_esquema(monkeypatch) -> None:
    item = {
        "uid": "u1",
        "title": "Hola",
        "status": "proposed",
        "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00",
        "fases": [
            {
                "orden": 1,
                "titulo": "Preparar",
                "entered_at": "2026-01-01T00:00:00+00:00",
            }
        ],
    }

    def falso(_argv):  # noqa: ANN001, ANN202
        print(json.dumps(item))
        return 0

    monkeypatch.setattr(mcp_servidor.cli, "main", falso)

    resultado = mcp_servidor.manejar(
        _peticion("tools/call", {"name": "item_get", "arguments": {"uid": "u1"}})
    )["result"]

    assert resultado["structuredContent"] == item
    esquema = _herramienta("item_get")["outputSchema"]
    assert migracion.validar_esquema(resultado["structuredContent"], esquema) == []

    # Un campo que no cuadra tiene que salir: el `estado` de la fase no existe.
    roto = {**item, "fases": [{**item["fases"][0], "estado": "inventado"}]}
    assert migracion.validar_esquema(roto, esquema) != []


def test_doctor_devuelve_structured_content_sin_output_schema(monkeypatch) -> None:
    """`doctor` arma su JSON a mano: estructura sí, esquema no (ficha 19c47c02)."""
    informe = {"ok": True, "url": "http://127.0.0.1:1", "version": "0.0.0", "comprobaciones": []}

    def falso(_argv):  # noqa: ANN001, ANN202
        print(json.dumps(informe))
        return 0

    monkeypatch.setattr(mcp_servidor.cli, "main", falso)

    resultado = mcp_servidor.manejar(_peticion("tools/call", {"name": "doctor", "arguments": {}}))[
        "result"
    ]

    assert resultado["structuredContent"] == informe
    assert "outputSchema" not in _herramienta("doctor")


def test_un_fallo_no_lleva_structured_content(monkeypatch) -> None:
    def falso(_argv):  # noqa: ANN001, ANN202
        print("error: no existe el ítem u1", file=sys.stderr)
        return 1

    monkeypatch.setattr(mcp_servidor.cli, "main", falso)

    resultado = mcp_servidor.manejar(
        _peticion("tools/call", {"name": "item_get", "arguments": {"uid": "u1"}})
    )["result"]

    assert resultado["isError"] is True
    assert "structuredContent" not in resultado
    assert "no existe el ítem" in resultado["content"][0]["text"]
