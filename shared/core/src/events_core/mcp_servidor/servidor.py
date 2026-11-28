"""El servidor MCP: JSON-RPC por stdio y las herramientas del catálogo."""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any

from .. import __version__, cli, migracion
from .argv import _comunes, _orden, _validar_entrada
from .catalogo import _ENVUELTAS, HERRAMIENTAS, HERRAMIENTAS_ESCRITURA, _lista_herramientas

PROTOCOLOS = ("2024-11-05", "2025-03-26", "2025-06-18")
PROTOCOLO = PROTOCOLOS[-1]

URI_ESQUEMA = "eui://schema/plan-migracion"

# El mapa no lleva parámetros: un recurso se pide por URI, así que lee la raíz
# configurada, la misma que usa `eui mapa` sin `--repo`.
URI_MAPA = "eui://mapa"

INSTRUCCIONES = (
    "Cliente de Events UI. Lee con doctor, repo_actual, repo_list, item_list, "
    "item_get, mapa, migrate_scan, migrate_classify y migrate_check. Las "
    "herramientas que escriben solo aparecen si el servidor arrancó con "
    "--permitir-escritura o EVENTSUI_MCP_ESCRITURA=1. Las puertas del flujo "
    "retiran herramientas según el mapa; `eui puertas` dice cuáles están cerradas."
)


def permite_escritura(flag: bool) -> bool:
    """El ámbito lo abre el flag o el entorno; nunca por defecto."""
    entorno = os.environ.get("EVENTSUI_MCP_ESCRITURA", "").strip().lower()
    return flag or entorno in ("1", "true", "si", "sí", "yes")


def _ok(ident: Any, resultado: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": ident, "result": resultado}


def _error(ident: Any, codigo: int, mensaje: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": ident, "error": {"code": codigo, "message": mensaje}}


def _puertas_cerradas(argumentos: dict[str, Any]) -> dict[str, str]:
    """Las herramientas que una puerta cierra ahora, con su motivo.

    Se pregunta al CLI, no al almacén: el MCP es un cliente del core y la
    política tiene que ser la misma que ve un humano. Si la consulta falla se
    devuelve vacío y se anuncia todo: sin core no hay nada que cerrar, y la
    herramienta fallará por su cuenta con el error de verdad. Un fallo de la
    consulta no puede dejar al agente sin herramientas.
    """
    codigo, salida, _ = _cli(["puertas", "--json", *_comunes(argumentos)])
    if codigo != 0:
        return {}
    try:
        datos = json.loads(salida)
    except (TypeError, ValueError):
        return {}
    cerradas: dict[str, str] = {}
    for puerta in datos if isinstance(datos, list) else ():
        if not isinstance(puerta, dict):
            continue
        motivo = str(puerta.get("motivo") or puerta.get("id") or "puerta cerrada")
        for nombre in puerta.get("cierra") or ():
            cerradas.setdefault(str(nombre), motivo)
    return cerradas


def _cli(argv: list[str]) -> tuple[int, str, str]:
    """Ejecuta el CLI en proceso con la salida capturada."""
    salida, error = io.StringIO(), io.StringIO()
    try:
        with redirect_stdout(salida), redirect_stderr(error):
            codigo = int(cli.main(argv))
    except SystemExit as exc:
        codigo = int(exc.code or 2)
    except Exception as exc:  # noqa: BLE001 - una herramienta no tumba el servidor
        error.write(f"{type(exc).__name__}: {exc}")
        codigo = 2
    return codigo, salida.getvalue(), error.getvalue()


def _ejecutar(nombre: str, a: dict[str, Any], permitir: bool) -> dict[str, Any]:
    if nombre in HERRAMIENTAS_ESCRITURA and not permitir:
        return {
            "content": [
                {
                    "type": "text",
                    "text": (
                        "escritura desactivada: arranca el servidor con "
                        "--permitir-escritura o EVENTSUI_MCP_ESCRITURA=1"
                    ),
                }
            ],
            "isError": True,
        }
    try:
        argv, temporal = _orden(nombre, a)
    except (KeyError, TypeError, ValueError) as exc:
        return {
            "content": [{"type": "text", "text": f"argumentos inválidos: {exc}"}],
            "isError": True,
        }
    try:
        codigo, salida, error = _cli(argv)
    finally:
        if temporal is not None:
            Path(temporal).unlink(missing_ok=True)

    texto = salida.strip() or error.strip() or f"exit {codigo}"
    resultado: dict[str, Any] = {"content": [{"type": "text", "text": texto}]}
    if codigo == 0:
        estructura = _estructura(nombre, texto)
        if estructura is not None:
            resultado["structuredContent"] = estructura
    else:
        # Un fallo no lleva estructura: el texto y `isError` ya lo dicen todo.
        resultado["isError"] = True
    return resultado


def _estructura(nombre: str, texto: str) -> dict[str, Any] | None:
    """El `--json` del CLI como `structuredContent`, o `None` si no lo es."""
    try:
        datos = json.loads(texto)
    except (TypeError, ValueError):
        return None
    clave = _ENVUELTAS.get(nombre)
    if clave is not None:
        return {clave: datos} if isinstance(datos, list) else None
    return datos if isinstance(datos, dict) else None


def manejar(
    mensaje: Any, *, permitir_escritura: bool = False, puertas: Any = None
) -> dict[str, Any] | None:
    """Una petición JSON-RPC ya parseada; `None` si es una notificación.

    `puertas` es la consulta de puertas cerradas; la fachada pasa la suya para
    que sus pruebas puedan sustituirla sin tocar el servidor.
    """
    consulta = puertas if puertas is not None else _puertas_cerradas
    if not isinstance(mensaje, dict) or mensaje.get("jsonrpc") != "2.0":
        return _error(None, -32600, "petición JSON-RPC inválida")
    metodo = mensaje.get("method")
    if not isinstance(metodo, str):
        return _error(mensaje.get("id"), -32600, "falta `method`")
    if metodo.startswith("notifications/") or "id" not in mensaje:
        return None

    ident = mensaje.get("id")
    params = mensaje.get("params") or {}
    if not isinstance(params, dict):
        return _error(ident, -32602, "`params` tiene que ser un objeto")

    try:
        if metodo == "initialize":
            solicitada = params.get("protocolVersion")
            version = solicitada if solicitada in PROTOCOLOS else PROTOCOLO
            return _ok(
                ident,
                {
                    "protocolVersion": version,
                    "capabilities": {"tools": {}, "resources": {}},
                    "serverInfo": {"name": "events-ui", "version": __version__},
                    "instructions": INSTRUCCIONES,
                },
            )
        if metodo == "ping":
            return _ok(ident, {})
        if metodo == "tools/list":
            return _ok(
                ident,
                {"tools": _lista_herramientas(permitir_escritura, consulta({}))},
            )
        if metodo == "tools/call":
            nombre = params.get("name")
            argumentos = params.get("arguments") or {}
            if not isinstance(nombre, str) or nombre not in HERRAMIENTAS:
                return _error(ident, -32602, f"herramienta desconocida: {nombre!r}")
            if not isinstance(argumentos, dict):
                return _error(ident, -32602, "`arguments` tiene que ser un objeto")
            problema = _validar_entrada(nombre, argumentos)
            if problema is not None:
                return _error(ident, -32602, problema)
            # La lista pudo quedarse vieja: la llamada se vuelve a comprobar, y
            # el rechazo es un resultado con `isError`, no un error de protocolo:
            # el agente tiene que poder leer el motivo y corregir.
            cerradas = consulta(argumentos)
            if nombre in cerradas:
                return _ok(
                    ident,
                    {
                        "content": [
                            {"type": "text", "text": f"puerta cerrada: {cerradas[nombre]}"}
                        ],
                        "isError": True,
                    },
                )
            return _ok(ident, _ejecutar(nombre, argumentos, permitir_escritura))
        if metodo == "resources/list":
            return _ok(
                ident,
                {
                    "resources": [
                        {
                            "uri": URI_ESQUEMA,
                            "name": "Esquema del plan de migración",
                            "description": (
                                "JSON Schema 2020-12 del plan que propone el agente "
                                "para `migrate check` y `migrate apply`."
                            ),
                            "mimeType": "application/schema+json",
                        },
                        {
                            "uri": URI_MAPA,
                            "name": "Mapa",
                            "description": (
                                "El mapa entero en una lectura, con el mismo JSON que "
                                "`GET /mapa`: carriles, dependencias y fases."
                            ),
                            "mimeType": "application/json",
                        },
                    ]
                },
            )
        if metodo == "resources/templates/list":
            return _ok(ident, {"resourceTemplates": []})
        if metodo == "resources/read":
            uri = params.get("uri")
            if uri == URI_ESQUEMA:
                return _ok(
                    ident,
                    {
                        "contents": [
                            {
                                "uri": URI_ESQUEMA,
                                "mimeType": "application/schema+json",
                                "text": json.dumps(migracion.ESQUEMA_PLAN, indent=2),
                            }
                        ]
                    },
                )
            if uri == URI_MAPA:
                # El recurso pasa por el CLI como las herramientas: una sola
                # fuente para el snapshot y los mismos errores que un humano ve.
                codigo, salida, error = _cli(["mapa", "--json"])
                if codigo != 0:
                    texto = salida.strip() or error.strip() or f"exit {codigo}"
                    return _error(ident, -32603, f"no se pudo leer el mapa: {texto}")
                return _ok(
                    ident,
                    {
                        "contents": [
                            {
                                "uri": URI_MAPA,
                                "mimeType": "application/json",
                                "text": salida.strip(),
                            }
                        ]
                    },
                )
            return _error(ident, -32602, f"recurso desconocido: {uri!r}")
        return _error(ident, -32601, f"método desconocido: {metodo}")
    except Exception as exc:  # noqa: BLE001 - el bucle no puede caerse
        return _error(ident, -32603, f"error interno: {exc}")


def servir(
    *,
    permitir_escritura: bool = False,
    entrada: Any = None,
    salida: Any = None,
) -> int:
    """Bucle stdio: una línea de entrada, una de salida; los logs van a stderr."""
    # MCP exige UTF-8 en el transporte. En Windows, stdout redirigido usa la
    # codificación local (cp1252) y `ó` viajaría como 0xF3: se fuerza aquí,
    # no en cada respuesta.
    if entrada is None:
        entrada = sys.stdin
        if hasattr(entrada, "reconfigure"):
            entrada.reconfigure(encoding="utf-8")
    if salida is None:
        salida = sys.stdout
        if hasattr(salida, "reconfigure"):
            salida.reconfigure(encoding="utf-8")
    for linea in entrada:
        if not linea.strip():
            continue
        try:
            mensaje = json.loads(linea)
        except ValueError:
            respuesta = _error(None, -32700, "JSON inválido")
        else:
            respuesta = manejar(mensaje, permitir_escritura=permitir_escritura)
        if respuesta is not None:
            salida.write(json.dumps(respuesta, ensure_ascii=False) + "\n")
            salida.flush()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="eui mcp", description="Servidor MCP por stdio para agentes."
    )
    parser.add_argument(
        "--permitir-escritura",
        action="store_true",
        help="Anuncia y permite las herramientas que escriben",
    )
    args = parser.parse_args(argv)
    return servir(permitir_escritura=permite_escritura(args.permitir_escritura))


if __name__ == "__main__":
    raise SystemExit(main())
