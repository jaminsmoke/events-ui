"""Servidor MCP por stdio: el CLI (`eui`) como herramientas para agentes.

Habla JSON-RPC 2.0 por líneas (el transporte stdio de MCP): una petición por
línea y una respuesta por línea, sin nada más en stdout. No reimplementa el
cliente: cada herramienta arma el argv del CLI y ejecuta `cli.main` capturando
su salida, así que las validaciones, los payloads y los códigos de salida son
los mismos que usa un humano.

Lectura por defecto. Las herramientas que escriben (`idea_create`, `idea_edit`,
`idea_move`, `idea_fases`, `idea_requisito`, `migrate_apply`, `migrate_undo`)
solo se anuncian y se ejecutan con `--permitir-escritura` o
`EVENTSUI_MCP_ESCRITURA=1`.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any

from . import __version__, cli, migracion

# Versiones del protocolo que este servidor entiende. Si el cliente pide otra,
# se responde con la última: el cliente decide si sigue o se desconecta.
PROTOCOLOS = ("2024-11-05", "2025-03-26", "2025-06-18")
PROTOCOLO = PROTOCOLOS[-1]

URI_ESQUEMA = "eui://schema/plan-migracion"

INSTRUCCIONES = (
    "Cliente de Events UI. Lee con doctor, repo_actual, repo_list, idea_list, "
    "idea_get, migrate_scan, migrate_classify y migrate_check. Las herramientas que escriben solo "
    "aparecen si el servidor arrancó con --permitir-escritura o "
    "EVENTSUI_MCP_ESCRITURA=1."
)

_REPO = {
    "type": "string",
    "description": "Raíz absoluta o nombre del laboratorio; por defecto, la configurada",
}
_URL = {
    "type": "string",
    "description": "Base del core; por defecto, la del puerto configurado",
}
_PORT = {"type": "integer", "minimum": 1, "maximum": 65535}

_COMUNES = {"repo": _REPO, "url": _URL, "port": _PORT}


def _esquema(
    propiedades: dict[str, Any], requeridos: tuple[str, ...] | list[str] = ()
) -> dict[str, Any]:
    esquema: dict[str, Any] = {
        "type": "object",
        "properties": propiedades,
        "additionalProperties": False,
    }
    if requeridos:
        esquema["required"] = list(requeridos)
    return esquema


_LECTURA: tuple[dict[str, Any], ...] = (
    {
        "name": "doctor",
        "description": "Comprueba configuración, core, versión, raíz y permiso de escritura.",
        "inputSchema": _esquema(_COMUNES),
    },
    {
        "name": "repo_actual",
        "description": "La raíz configurada y la URL del core, o null si no hay raíz.",
        "inputSchema": _esquema(_COMUNES),
    },
    {
        "name": "repo_list",
        "description": "Carpetas del laboratorio que ya tienen almacén.",
        "inputSchema": _esquema({"url": _URL, "port": _PORT}),
    },
    {
        "name": "idea_list",
        "description": "Lista las ideas del mapa con filtros de estado, tipo y paginación.",
        "inputSchema": _esquema(
            {
                **_COMUNES,
                "status": {"type": "string"},
                "kind": {"type": "string", "enum": ["idea", "adr", "note"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 500},
                "offset": {"type": "integer", "minimum": 0},
            }
        ),
    },
    {
        "name": "idea_get",
        "description": "La ficha completa de una idea: campos, fases, requisitos y procedencia.",
        "inputSchema": _esquema({**_COMUNES, "uid": {"type": "string"}}, ["uid"]),
    },
    {
        "name": "migrate_scan",
        "description": (
            "Lee los Markdown de una carpeta del repo y devuelve su sha256 y estructura."
        ),
        "inputSchema": _esquema({**_COMUNES, "ruta": {"type": "string"}}),
    },
    {
        "name": "migrate_classify",
        "description": (
            "Propone el manifiesto documentos (mapa/referencia/parcial) a partir del scan."
        ),
        "inputSchema": _esquema({**_COMUNES, "ruta": {"type": "string"}}),
    },
    {
        "name": "migrate_check",
        "description": (
            "Valida un plan.json sin escribir: esquema, refs, ciclos, origen, "
            "hash y clasificación de documentos."
        ),
        "inputSchema": _esquema({**_COMUNES, "plan": {"type": "string"}}, ["plan"]),
    },
)

_ESCRITURA: tuple[dict[str, Any], ...] = (
    {
        "name": "idea_create",
        "description": "Crea una idea (por defecto en draft) con etiquetas y dependencias.",
        "inputSchema": _esquema(
            {
                **_COMUNES,
                "title": {"type": "string"},
                "description": {"type": "string"},
                "content": {"type": "string"},
                "kind": {"type": "string", "enum": ["idea"]},
                "status": {"type": "string", "enum": list(cli.ESTADOS)},
                "tags": {"type": "array", "items": {"type": "string"}},
                "depende_de": {"type": "array", "items": {"type": "string"}},
                "fases": {"type": "array", "items": {"type": "object"}},
            },
            ["title"],
        ),
    },
    {
        "name": "idea_edit",
        "description": (
            "Edita solo los campos dados de una idea; permite vaciar etiquetas o dependencias."
        ),
        "inputSchema": _esquema(
            {
                **_COMUNES,
                "uid": {"type": "string"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "content": {"type": "string"},
                "tags": {"type": "array", "items": {"type": "string"}},
                "limpiar_tags": {"type": "boolean"},
                "depende_de": {"type": "array", "items": {"type": "string"}},
                "limpiar_dependencias": {"type": "boolean"},
            },
            ["uid"],
        ),
    },
    {
        "name": "idea_move",
        "description": "Mueve una idea de carril con los datos de la ficha de destino.",
        "inputSchema": _esquema(
            {
                **_COMUNES,
                "uid": {"type": "string"},
                "status": {"type": "string", "enum": list(cli.ESTADOS)},
                "resultado": {"type": "string"},
                "referencia": {"type": "string"},
                "verificacion_resultado": {"type": "string"},
                "verificacion_comentario": {"type": "string"},
                "aprobado_por": {
                    "type": "string",
                    "enum": ["usuario", "agente", "sistema"],
                },
                "nota": {"type": "string"},
                "motivo": {"type": "string"},
                "descartado_por": {
                    "type": "string",
                    "enum": ["usuario", "agente", "sistema"],
                },
                "sustituye_a": {"type": "string"},
            },
            ["uid", "status"],
        ),
    },
    {
        "name": "idea_fases",
        "description": (
            "Reemplaza las fases de una idea con la lista inline `fases` o con "
            'el JSON de `fichero` (lista o {"fases": [...]}).'
        ),
        "inputSchema": _esquema(
            {
                **_COMUNES,
                "uid": {"type": "string"},
                "fases": {"type": "array", "items": {"type": "object"}},
                "fichero": {"type": "string"},
            },
            ["uid"],
        ),
    },
    {
        "name": "idea_requisito",
        "description": "Marca o desmarca un requisito conservando estados, notas y el resto.",
        "inputSchema": _esquema(
            {
                **_COMUNES,
                "uid": {"type": "string"},
                "fase": {"type": "integer", "minimum": 1},
                "requisito": {"type": "integer", "minimum": 1},
                "hecho": {"type": "boolean"},
            },
            ["uid", "fase", "requisito", "hecho"],
        ),
    },
    {
        "name": "migrate_apply",
        "description": "Aplica un plan.json como lote atómico; repetirlo devuelve el mismo lote.",
        "inputSchema": _esquema({**_COMUNES, "plan": {"type": "string"}}, ["plan"]),
    },
    {
        "name": "migrate_undo",
        "description": "Deshace un lote si sus ideas no cambiaron de carril ni se editaron.",
        "inputSchema": _esquema({**_COMUNES, "lote": {"type": "string"}}, ["lote"]),
    },
)

HERRAMIENTAS = {herramienta["name"]: herramienta for herramienta in (*_LECTURA, *_ESCRITURA)}
HERRAMIENTAS_ESCRITURA = frozenset(herramienta["name"] for herramienta in _ESCRITURA)


def permite_escritura(flag: bool) -> bool:
    """El ámbito lo abre el flag o el entorno; nunca por defecto."""
    entorno = os.environ.get("EVENTSUI_MCP_ESCRITURA", "").strip().lower()
    return flag or entorno in ("1", "true", "si", "sí", "yes")


def _ok(ident: Any, resultado: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": ident, "result": resultado}


def _error(ident: Any, codigo: int, mensaje: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": ident, "error": {"code": codigo, "message": mensaje}}


def _lista_herramientas(permitir_escritura: bool) -> list[dict[str, Any]]:
    if permitir_escritura:
        return [*_LECTURA, *_ESCRITURA]
    return list(_LECTURA)


# Campos que no son de una herramienta pero sí de otra: el error dice dónde
# están, en vez de dejar al cliente adivinando qué herramienta los acepta.
_SUGERENCIAS = {
    "fases": "idea_fases",
    "fichero": "idea_fases",
    "status": "idea_move",
    "fase": "idea_requisito",
    "requisito": "idea_requisito",
    "hecho": "idea_requisito",
    "limpiar_tags": "idea_edit",
    "limpiar_dependencias": "idea_edit",
    "lote": "migrate_undo",
    "plan": "migrate_check",
}

_TIPOS = {"string": str, "integer": int, "boolean": bool, "array": list, "object": dict}


def _sugerencia(nombre: str, campo: str) -> str | None:
    """La herramienta que sí acepta `campo`, si hay una."""
    directa = _SUGERENCIAS.get(campo)
    if directa is not None and directa != nombre:
        return directa
    for otra, herramienta in HERRAMIENTAS.items():
        if otra != nombre and campo in herramienta["inputSchema"]["properties"]:
            return otra
    return None


def _validar_valor(campo: str, valor: Any, esquema: dict[str, Any]) -> str | None:
    """Un valor contra su trozo de `inputSchema`; `None` si encaja.

    Solo lo que usan los esquemas de este servidor: tipo, `enum`, `minimum`,
    `maximum` y el tipo de los elementos de un array. Un `bool` no vale como
    entero aunque en Python sea `int`.
    """
    tipo = esquema.get("type")
    if tipo == "integer":
        if isinstance(valor, bool) or not isinstance(valor, int):
            return f"`{campo}` tiene que ser un entero"
    else:
        esperado = _TIPOS.get(tipo)
        if esperado is not None and not isinstance(valor, esperado):
            return f"`{campo}` tiene que ser de tipo {tipo}"
    opciones = esquema.get("enum")
    if opciones is not None and valor not in opciones:
        return f"`{campo}` tiene que ser uno de {', '.join(str(o) for o in opciones)}"
    if tipo == "integer":
        if "minimum" in esquema and valor < esquema["minimum"]:
            return f"`{campo}` no puede ser menor que {esquema['minimum']}"
        if "maximum" in esquema and valor > esquema["maximum"]:
            return f"`{campo}` no puede ser mayor que {esquema['maximum']}"
    if tipo == "array":
        items = esquema.get("items") or {}
        for indice, elemento in enumerate(valor):
            problema = _validar_valor(f"{campo}[{indice}]", elemento, items)
            if problema is not None:
                return problema
    return None


def _validar_entrada(nombre: str, argumentos: dict[str, Any]) -> str | None:
    """La entrada contra el `inputSchema` de la herramienta; `None` si vale.

    `tools/list` anuncia `additionalProperties: false` y `required`: esto es lo
    que cumple el anuncio. Se llama antes de `_orden`, así que una clave
    desconocida no llega a descartarse en silencio.
    """
    esquema = HERRAMIENTAS[nombre]["inputSchema"]
    propiedades = esquema.get("properties") or {}
    for campo in argumentos:
        if campo not in propiedades:
            otra = _sugerencia(nombre, campo)
            aviso = f"campo desconocido: {campo}"
            return f"{aviso} (usa {otra})" if otra else aviso
    for campo in esquema.get("required") or ():
        if argumentos.get(campo) is None:
            return f"falta el campo obligatorio: {campo}"
    for campo, valor in argumentos.items():
        problema = _validar_valor(campo, valor, propiedades[campo])
        if problema is not None:
            return problema
    return None


def _comunes(argumentos: dict[str, Any], *, con_repo: bool = True) -> list[str]:
    extras: list[str] = []
    if con_repo and argumentos.get("repo"):
        extras += ["--repo", str(argumentos["repo"])]
    if argumentos.get("url"):
        extras += ["--url", str(argumentos["url"])]
    if argumentos.get("port"):
        extras += ["--port", str(int(argumentos["port"]))]
    return extras


def _orden(nombre: str, a: dict[str, Any]) -> tuple[list[str], str | None]:
    """El argv del CLI para una herramienta; el segundo valor es un temporal."""
    temporal: str | None = None
    if nombre == "doctor":
        argv = ["doctor"]
    elif nombre == "repo_actual":
        argv = ["repo"]
    elif nombre == "repo_list":
        argv = ["repo", "list"]
    elif nombre == "idea_list":
        argv = ["idea", "list"]
        if a.get("status"):
            argv += ["--status", str(a["status"])]
        if a.get("kind"):
            argv += ["--kind", str(a["kind"])]
        if a.get("limit") is not None:
            argv += ["--limit", str(int(a["limit"]))]
        if a.get("offset") is not None:
            argv += ["--offset", str(int(a["offset"]))]
    elif nombre == "idea_get":
        argv = ["idea", "get", str(a["uid"])]
    elif nombre == "idea_create":
        argv = ["idea", "create", "--title", str(a["title"])]
        for clave, bandera in (
            ("description", "--description"),
            ("content", "--content"),
            ("kind", "--kind"),
            ("status", "--status"),
        ):
            if a.get(clave) is not None:
                argv += [bandera, str(a[clave])]
        for tag in a.get("tags") or []:
            argv += ["--tag", str(tag)]
        for dep in a.get("depende_de") or []:
            argv += ["--dep", str(dep)]
        if a.get("fases") is not None:
            fases = a["fases"]
            if not isinstance(fases, list):
                raise ValueError("`fases` tiene que ser una lista")
            with tempfile.NamedTemporaryFile(
                "w", suffix=".json", delete=False, encoding="utf-8"
            ) as fichero:
                json.dump(fases, fichero, ensure_ascii=False)
                temporal = fichero.name
            argv += ["--fases", temporal]
    elif nombre == "idea_edit":
        argv = ["idea", "edit", str(a["uid"])]
        for clave, bandera in (
            ("title", "--title"),
            ("description", "--description"),
            ("content", "--content"),
        ):
            if a.get(clave) is not None:
                argv += [bandera, str(a[clave])]
        if a.get("limpiar_tags"):
            argv += ["--sin-etiquetas"]
        else:
            for tag in a.get("tags") or []:
                argv += ["--tag", str(tag)]
        if a.get("limpiar_dependencias"):
            argv += ["--sin-dependencias"]
        else:
            for dep in a.get("depende_de") or []:
                argv += ["--dep", str(dep)]
    elif nombre == "idea_move":
        argv = ["idea", "move", str(a["uid"]), str(a["status"])]
        for clave, bandera in (
            ("resultado", "--resultado"),
            ("referencia", "--referencia"),
            ("verificacion_resultado", "--verificacion-resultado"),
            ("verificacion_comentario", "--verificacion-comentario"),
            ("aprobado_por", "--aprobado-por"),
            ("nota", "--nota"),
            ("motivo", "--motivo"),
            ("descartado_por", "--descartado-por"),
            ("sustituye_a", "--sustituye-a"),
        ):
            if a.get(clave) is not None:
                argv += [bandera, str(a[clave])]
    elif nombre == "idea_fases":
        if a.get("fichero"):
            ruta = str(a["fichero"])
        else:
            fases = a.get("fases")
            if not isinstance(fases, list):
                raise ValueError("da `fases` (lista) o `fichero`")
            with tempfile.NamedTemporaryFile(
                "w", suffix=".json", delete=False, encoding="utf-8"
            ) as fichero:
                json.dump(fases, fichero, ensure_ascii=False)
                temporal = fichero.name
            ruta = temporal
        argv = ["idea", "fases", str(a["uid"]), ruta]
    elif nombre == "idea_requisito":
        argv = [
            "idea",
            "requisito",
            str(a["uid"]),
            str(int(a["fase"])),
            str(int(a["requisito"])),
            "--hecho" if a.get("hecho") else "--pendiente",
        ]
    elif nombre == "migrate_scan":
        argv = ["migrate", "scan"]
        if a.get("ruta"):
            argv.append(str(a["ruta"]))
    elif nombre == "migrate_classify":
        argv = ["migrate", "classify"]
        if a.get("ruta"):
            argv.append(str(a["ruta"]))
    elif nombre == "migrate_check":
        argv = ["migrate", "check", str(a["plan"])]
    elif nombre == "migrate_apply":
        argv = ["migrate", "apply", str(a["plan"])]
    elif nombre == "migrate_undo":
        argv = ["migrate", "undo", str(a["lote"])]
    else:
        raise KeyError(f"herramienta desconocida: {nombre}")

    argv += ["--json"]
    argv += _comunes(a, con_repo=nombre != "repo_list")
    return argv, temporal


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
    if codigo != 0:
        resultado["isError"] = True
    return resultado


def manejar(mensaje: Any, *, permitir_escritura: bool = False) -> dict[str, Any] | None:
    """Una petición JSON-RPC ya parseada; `None` si es una notificación."""
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
            return _ok(ident, {"tools": _lista_herramientas(permitir_escritura)})
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
                        }
                    ]
                },
            )
        if metodo == "resources/templates/list":
            return _ok(ident, {"resourceTemplates": []})
        if metodo == "resources/read":
            if params.get("uri") != URI_ESQUEMA:
                return _error(ident, -32602, f"recurso desconocido: {params.get('uri')!r}")
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
