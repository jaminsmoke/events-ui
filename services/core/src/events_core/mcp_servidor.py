"""Servidor MCP por stdio: el CLI (`eui`) como herramientas para agentes.

Habla JSON-RPC 2.0 por líneas (el transporte stdio de MCP): una petición por
línea y una respuesta por línea, sin nada más en stdout. No reimplementa el
cliente: cada herramienta arma el argv del CLI y ejecuta `cli.main` capturando
su salida, así que las validaciones, los payloads y los códigos de salida son
los mismos que usa un humano.

Lectura por defecto. Las herramientas que escriben (`item_create`, `item_edit`,
`item_move`, `item_fases`, `item_requisito`, `migrate_apply`, `migrate_undo`)
solo se anuncian y se ejecutan con `--permitir-escritura` o
`EVENTSUI_MCP_ESCRITURA=1`.

Las puertas del flujo (`.EUI/protocolos.json` y el mapa) retiran herramientas de
`tools/list` y rechazan su `tools/call` con el motivo. La política se pregunta
por el CLI, no se reimplementa: es la misma que ve un humano.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import tempfile
from contextlib import redirect_stderr, redirect_stdout
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter

from . import __version__, cli, migracion
from .contrato import (
    InformeClasificacion,
    InformeDoctor,
    InformeRevision,
    InformeScan,
    MapSnapshot,
    MigracionAplicada,
    MigracionDeshecha,
    Repo,
    RepoActual,
    WorkItem,
    WorkItemResumen,
)

# Versiones del protocolo que este servidor entiende. Si el cliente pide otra,
# se responde con la última: el cliente decide si sigue o se desconecta.
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


@dataclass(frozen=True)
class Campo:
    """Un campo de entrada y cómo viaja al CLI.

    El tipo, el enum y los límites van al `inputSchema`; `posicional`, `bandera`,
    `repetible`, `temporal` y `pareja` dicen cómo se escribe en el argv. Con eso,
    una herramienta nueva se declara una vez y las dos cosas salen de aquí.
    """

    tipo: str = "string"
    descripcion: str = ""
    requerido: bool = False
    opciones: tuple[str, ...] = ()
    minimo: int | None = None
    maximo: int | None = None
    elemento: str = "string"
    posicional: int | None = None
    bandera: str | None = None
    repetible: bool = False
    temporal: bool = False
    pareja: tuple[str, str | None] | None = None
    omite_si: str | None = None

    def esquema(self) -> dict[str, Any]:
        """El trozo de JSON Schema que anuncia `tools/list`."""
        salida: dict[str, Any] = {"type": self.tipo}
        if self.descripcion:
            salida["description"] = self.descripcion
        if self.opciones:
            salida["enum"] = list(self.opciones)
        if self.minimo is not None:
            salida["minimum"] = self.minimo
        if self.maximo is not None:
            salida["maximum"] = self.maximo
        if self.tipo == "array":
            salida["items"] = {"type": self.elemento}
        return salida


@dataclass(frozen=True)
class Herramienta:
    """Una herramienta del catálogo: lo que se anuncia y el argv que la ejecuta."""

    nombre: str
    titulo: str
    descripcion: str
    orden: tuple[str, ...]
    campos: dict[str, Campo] = field(default_factory=dict)
    escritura: bool = False
    destructiva: bool = False
    idempotente: bool = False
    con_repo: bool = True


def _comun(*, con_repo: bool = True) -> dict[str, Campo]:
    """Los campos que llevan casi todas: el repo, el core y su puerto."""
    campos: dict[str, Campo] = {}
    if con_repo:
        campos["repo"] = Campo(
            descripcion="Raíz absoluta o nombre del laboratorio; por defecto, la configurada"
        )
    campos["url"] = Campo(descripcion="Base del core; por defecto, la del puerto configurado")
    campos["port"] = Campo(tipo="integer", minimo=1, maximo=65535)
    return campos


_COMUNES = ("repo", "url", "port")

_CATALOGO: tuple[Herramienta, ...] = (
    Herramienta(
        nombre="doctor",
        titulo="Diagnóstico",
        descripcion="Comprueba configuración, core, versión, raíz y permiso de escritura.",
        orden=("doctor",),
        campos=_comun(),
    ),
    Herramienta(
        nombre="repo_actual",
        titulo="Repo actual",
        descripcion="La raíz configurada y la URL del core, o null si no hay raíz.",
        orden=("repo",),
        campos=_comun(),
    ),
    Herramienta(
        nombre="repo_list",
        titulo="Repos del laboratorio",
        descripcion="Carpetas del laboratorio que ya tienen almacén.",
        orden=("repo", "list"),
        campos=_comun(con_repo=False),
    ),
    Herramienta(
        nombre="item_list",
        titulo="Listar ítems",
        descripcion="Lista los ítems del mapa con filtros de estado, tipo y paginación.",
        orden=("item", "list"),
        campos={
            **_comun(),
            "status": Campo(bandera="--status"),
            "kind": Campo(bandera="--kind", opciones=("work_item", "adr", "note")),
            "limit": Campo(tipo="integer", minimo=1, maximo=500, bandera="--limit"),
            "offset": Campo(tipo="integer", minimo=0, bandera="--offset"),
        },
    ),
    Herramienta(
        nombre="item_get",
        titulo="Leer un ítem",
        descripcion="La ficha completa de un ítem: campos, fases, requisitos y procedencia.",
        orden=("item", "get"),
        campos={
            **_comun(),
            "uid": Campo(posicional=1, requerido=True),
        },
    ),
    Herramienta(
        nombre="mapa",
        titulo="Mapa",
        descripcion=(
            "El mapa entero en una lectura: cada ítem con su carril, sus dependencias y sus fases."
        ),
        orden=("mapa",),
        campos=_comun(),
    ),
    Herramienta(
        nombre="migrate_scan",
        titulo="Escanear documentos",
        descripcion="Lee los Markdown de una carpeta del repo y devuelve su sha256 y estructura.",
        orden=("migrate", "scan"),
        campos={
            **_comun(),
            "ruta": Campo(posicional=1),
        },
    ),
    Herramienta(
        nombre="migrate_classify",
        titulo="Clasificar documentos",
        descripcion="Propone el manifiesto documentos (mapa/referencia/parcial) a partir del scan.",
        orden=("migrate", "classify"),
        campos={
            **_comun(),
            "ruta": Campo(posicional=1),
        },
    ),
    Herramienta(
        nombre="migrate_check",
        titulo="Validar un plan",
        descripcion=(
            "Valida un plan.json sin escribir: esquema, refs, ciclos, origen, hash y "
            "clasificación de documentos."
        ),
        orden=("migrate", "check"),
        campos={
            **_comun(),
            "plan": Campo(posicional=1, requerido=True),
        },
    ),
    Herramienta(
        nombre="item_create",
        titulo="Crear un ítem",
        descripcion="Crea un ítem (por defecto en draft) con etiquetas y dependencias.",
        orden=("item", "create"),
        escritura=True,
        campos={
            **_comun(),
            "title": Campo(bandera="--title", requerido=True),
            "description": Campo(bandera="--description"),
            "content": Campo(bandera="--content"),
            "kind": Campo(bandera="--kind", opciones=("work_item",)),
            "status": Campo(bandera="--status", opciones=tuple(cli.ESTADOS)),
            "tags": Campo(tipo="array", bandera="--tag", repetible=True),
            "depende_de": Campo(tipo="array", bandera="--dep", repetible=True),
            "fases": Campo(tipo="array", elemento="object", bandera="--fases", temporal=True),
        },
    ),
    Herramienta(
        nombre="item_edit",
        titulo="Editar un ítem",
        descripcion=(
            "Edita solo los campos dados de un ítem; permite vaciar etiquetas o dependencias."
        ),
        orden=("item", "edit"),
        escritura=True,
        campos={
            **_comun(),
            "uid": Campo(posicional=1, requerido=True),
            "title": Campo(bandera="--title"),
            "description": Campo(bandera="--description"),
            "content": Campo(bandera="--content"),
            "tags": Campo(tipo="array", bandera="--tag", repetible=True, omite_si="limpiar_tags"),
            "limpiar_tags": Campo(tipo="boolean", pareja=("--sin-etiquetas", None)),
            "depende_de": Campo(
                tipo="array", bandera="--dep", repetible=True, omite_si="limpiar_dependencias"
            ),
            "limpiar_dependencias": Campo(tipo="boolean", pareja=("--sin-dependencias", None)),
        },
    ),
    Herramienta(
        nombre="item_move",
        titulo="Mover un ítem",
        descripcion="Mueve un ítem de carril con los datos de la ficha de destino.",
        orden=("item", "move"),
        escritura=True,
        campos={
            **_comun(),
            "uid": Campo(posicional=1, requerido=True),
            "status": Campo(posicional=2, requerido=True, opciones=tuple(cli.ESTADOS)),
            "resultado": Campo(bandera="--resultado"),
            "referencia": Campo(bandera="--referencia"),
            "verificacion_resultado": Campo(bandera="--verificacion-resultado"),
            "verificacion_comentario": Campo(bandera="--verificacion-comentario"),
            "aprobado_por": Campo(
                bandera="--aprobado-por", opciones=("usuario", "agente", "sistema")
            ),
            "nota": Campo(bandera="--nota"),
            "motivo": Campo(bandera="--motivo"),
            "descartado_por": Campo(
                bandera="--descartado-por", opciones=("usuario", "agente", "sistema")
            ),
            "sustituye_a": Campo(bandera="--sustituye-a"),
        },
    ),
    Herramienta(
        nombre="item_fases",
        titulo="Fases de un ítem",
        descripcion=(
            "Reemplaza las fases de un ítem con la lista inline `fases` o con "
            'el JSON de `fichero` (lista o {"fases": [...]}).'
        ),
        orden=("item", "fases"),
        escritura=True,
        campos={
            **_comun(),
            "uid": Campo(posicional=1, requerido=True),
            "fases": Campo(tipo="array", elemento="object", posicional=2, temporal=True),
            "fichero": Campo(posicional=2),
        },
    ),
    Herramienta(
        nombre="item_requisito",
        titulo="Marcar un requisito",
        descripcion="Marca o desmarca un requisito conservando estados, notas y el resto.",
        orden=("item", "requisito"),
        escritura=True,
        campos={
            **_comun(),
            "uid": Campo(posicional=1, requerido=True),
            "fase": Campo(tipo="integer", minimo=1, posicional=2, requerido=True),
            "requisito": Campo(tipo="integer", minimo=1, posicional=3, requerido=True),
            "hecho": Campo(tipo="boolean", requerido=True, pareja=("--hecho", "--pendiente")),
        },
    ),
    Herramienta(
        nombre="migrate_apply",
        titulo="Aplicar un plan",
        descripcion="Aplica un plan.json como lote atómico; repetirlo devuelve el mismo lote.",
        orden=("migrate", "apply"),
        escritura=True,
        idempotente=True,
        campos={
            **_comun(),
            "plan": Campo(posicional=1, requerido=True),
        },
    ),
    Herramienta(
        nombre="migrate_undo",
        titulo="Deshacer un lote",
        descripcion="Deshace un lote si sus ítems no cambiaron de carril ni se editaron.",
        orden=("migrate", "undo"),
        escritura=True,
        destructiva=True,
        campos={
            **_comun(),
            "lote": Campo(posicional=1, requerido=True),
        },
    ),
)

HERRAMIENTAS = {herramienta.nombre: herramienta for herramienta in _CATALOGO}
HERRAMIENTAS_ESCRITURA = frozenset(
    herramienta.nombre for herramienta in _CATALOGO if herramienta.escritura
)


def _esquema(herramienta: Herramienta) -> dict[str, Any]:
    """El `inputSchema` de la herramienta, derivado de sus campos."""
    esquema: dict[str, Any] = {
        "type": "object",
        "properties": {nombre: campo.esquema() for nombre, campo in herramienta.campos.items()},
        "additionalProperties": False,
    }
    requeridos = [nombre for nombre, campo in herramienta.campos.items() if campo.requerido]
    if requeridos:
        esquema["required"] = requeridos
    return esquema


def _anotaciones(herramienta: Herramienta) -> dict[str, Any]:
    """Las pistas de `tools/list`: qué lee, qué borra y qué se puede repetir."""
    return {
        "title": herramienta.titulo,
        "readOnlyHint": not herramienta.escritura,
        "destructiveHint": herramienta.destructiva,
        "idempotentHint": herramienta.idempotente,
        # Todo es local: el repo y el core en loopback, nunca un servicio fuera.
        "openWorldHint": False,
    }


def permite_escritura(flag: bool) -> bool:
    """El ámbito lo abre el flag o el entorno; nunca por defecto."""
    entorno = os.environ.get("EVENTSUI_MCP_ESCRITURA", "").strip().lower()
    return flag or entorno in ("1", "true", "si", "sí", "yes")


def _ok(ident: Any, resultado: Any) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": ident, "result": resultado}


def _error(ident: Any, codigo: int, mensaje: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": ident, "error": {"code": codigo, "message": mensaje}}


# `structuredContent` es siempre un objeto, así que las dos salidas que son
# listas van dentro de su clave; el texto de respaldo sigue siendo la lista.
_ENVUELTAS = {"item_list": "items", "repo_list": "repos"}


def _envoltura(clave: str, tipo: Any) -> dict[str, Any]:
    """El esquema de una lista, envuelto en el objeto que espera el protocolo."""
    esquema = TypeAdapter(tipo).json_schema()
    # Los `$ref` apuntan a la raíz del documento: `$defs` sube con la envoltura.
    defs = esquema.pop("$defs", None)
    salida: dict[str, Any] = {
        "type": "object",
        "additionalProperties": False,
        "required": [clave],
        "properties": {clave: esquema},
    }
    if defs:
        salida["$defs"] = defs
    return salida


# Las herramientas cuyo `--json` es un modelo del contrato: el esquema sale del
# modelo, así que no puede quedarse atrás. Las dieciséis lo son: los informes de
# `doctor`, `repo_actual`, `migrate_scan`, `migrate_classify` y `migrate_check`
# también son modelos (ficha `19c47c02`).
_SALIDAS: dict[str, dict[str, Any]] = {
    "doctor": TypeAdapter(InformeDoctor).json_schema(),
    "repo_actual": TypeAdapter(RepoActual).json_schema(),
    "repo_list": _envoltura("repos", list[Repo]),
    "item_list": _envoltura("items", list[WorkItemResumen] | list[WorkItem]),
    "item_get": TypeAdapter(WorkItem).json_schema(),
    "mapa": TypeAdapter(MapSnapshot).json_schema(),
    "item_create": TypeAdapter(WorkItem).json_schema(),
    "item_edit": TypeAdapter(WorkItem).json_schema(),
    "item_move": TypeAdapter(WorkItem).json_schema(),
    "item_fases": TypeAdapter(WorkItem).json_schema(),
    "item_requisito": TypeAdapter(WorkItem).json_schema(),
    "migrate_scan": TypeAdapter(InformeScan).json_schema(),
    "migrate_classify": TypeAdapter(InformeClasificacion).json_schema(),
    "migrate_check": TypeAdapter(InformeRevision).json_schema(),
    "migrate_apply": TypeAdapter(MigracionAplicada).json_schema(),
    "migrate_undo": TypeAdapter(MigracionDeshecha).json_schema(),
}


def _herramienta_publica(herramienta: Herramienta) -> dict[str, Any]:
    """Lo que ve el cliente: el catálogo, sus pistas y su salida si la hay."""
    publica = {
        "name": herramienta.nombre,
        "description": herramienta.descripcion,
        "inputSchema": _esquema(herramienta),
        "annotations": _anotaciones(herramienta),
    }
    if herramienta.nombre in _SALIDAS:
        publica["outputSchema"] = _SALIDAS[herramienta.nombre]
    return publica


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


def _lista_herramientas(
    permitir_escritura: bool, cerradas: dict[str, str] | None = None
) -> list[dict[str, Any]]:
    """Las herramientas a la vista, con sus anotaciones y su salida.

    Las que una puerta cierra ahora no se anuncian: el cliente no las ofrece y
    el agente no las intenta. `tools/call` las rechaza igual, porque la lista
    puede venir de antes del cambio de mapa.
    """
    fuera = cerradas or {}
    return [
        _herramienta_publica(herramienta)
        for herramienta in _CATALOGO
        if (permitir_escritura or not herramienta.escritura) and herramienta.nombre not in fuera
    ]


# Campos que no son de una herramienta pero sí de otra: el error dice dónde
# están, en vez de dejar al cliente adivinando qué herramienta los acepta.
_SUGERENCIAS = {
    "fases": "item_fases",
    "fichero": "item_fases",
    "status": "item_move",
    "fase": "item_requisito",
    "requisito": "item_requisito",
    "hecho": "item_requisito",
    "limpiar_tags": "item_edit",
    "limpiar_dependencias": "item_edit",
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
        if otra != nombre and campo in herramienta.campos:
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
    herramienta = HERRAMIENTAS[nombre]
    campos = herramienta.campos
    for campo in argumentos:
        if campo not in campos:
            otra = _sugerencia(nombre, campo)
            aviso = f"campo desconocido: {campo}"
            return f"{aviso} (usa {otra})" if otra else aviso
    for campo, definicion in campos.items():
        if definicion.requerido and argumentos.get(campo) is None:
            return f"falta el campo obligatorio: {campo}"
    for campo, valor in argumentos.items():
        problema = _validar_valor(campo, valor, campos[campo].esquema())
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


def _temporal(datos: Any) -> str:
    """Un JSON en un fichero temporal: es como el CLI recibe listas y objetos."""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8"
    ) as fichero:
        json.dump(datos, fichero, ensure_ascii=False)
        return fichero.name


def _orden(nombre: str, a: dict[str, Any]) -> tuple[list[str], str | None]:
    """El argv del CLI para una herramienta; el segundo valor es un temporal.

    Todo sale del catálogo: un posicional ocupa su hueco, una bandera se escribe
    con su valor, un repetible se escribe una vez por elemento, una pareja elige
    su forma según el booleano y lo que no cabe en la línea viaja en un fichero
    que se borra al terminar.
    """
    herramienta = HERRAMIENTAS[nombre]
    argv = [*herramienta.orden]
    temporal: str | None = None

    huecos = sorted(
        {
            campo.posicional
            for clave, campo in herramienta.campos.items()
            if campo.posicional is not None and clave not in _COMUNES
        }
    )
    for hueco in huecos:
        elegido = next(
            (
                (clave, campo)
                for clave, campo in herramienta.campos.items()
                if campo.posicional == hueco and clave not in _COMUNES and a.get(clave) is not None
            ),
            None,
        )
        if elegido is None:
            continue
        clave, campo = elegido
        valor = a[clave]
        if campo.temporal:
            if not isinstance(valor, list):
                raise ValueError(f"`{clave}` tiene que ser una lista")
            argv.append(_temporal(valor))
            temporal = argv[-1]
        else:
            argv.append(str(valor))

    for clave, campo in herramienta.campos.items():
        if clave in _COMUNES or campo.posicional is not None:
            continue
        valor = a.get(clave)
        if campo.omite_si and a.get(campo.omite_si):
            continue
        if campo.pareja is not None:
            if valor:
                argv.append(campo.pareja[0])
            elif campo.pareja[1] is not None:
                argv.append(campo.pareja[1])
            continue
        if valor is None:
            continue
        if campo.bandera is None:
            raise KeyError(f"{nombre}.{clave} no dice cómo viajar al CLI")
        if campo.repetible:
            for elemento in valor:
                argv += [campo.bandera, str(elemento)]
        elif campo.temporal:
            if not isinstance(valor, list):
                raise ValueError(f"`{clave}` tiene que ser una lista")
            argv += [campo.bandera, _temporal(valor)]
            temporal = argv[-1]
        else:
            argv += [campo.bandera, str(valor)]
    if herramienta.nombre == "item_fases" and "fases" not in a and not a.get("fichero"):
        raise ValueError("da `fases` (lista) o `fichero`")

    argv += ["--json"]
    argv += _comunes(a, con_repo=herramienta.con_repo)
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
            return _ok(
                ident,
                {"tools": _lista_herramientas(permitir_escritura, _puertas_cerradas({}))},
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
            cerradas = _puertas_cerradas(argumentos)
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
