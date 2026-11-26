"""El parser de argparse del CLI: comandos, flags y valores.

(Parte del paquete `cli`; la fachada está en `events_core.cli`.)

Original: CLI `eui`: lo que un agente usa en vez de la API cruda.

Comandos: `doctor` (la puerta), `config`, y la lectura `repo`, `item` y
`schema`, todos sobre el mismo cliente HTTP. La migración llega después.
Los dos clientes se abren con `--webapp` (la web en el navegador) y
`--desktop`; si no están instalados, el CLI ofrece instalarlos.

    uv run --directory services/core python -m events_core.cli doctor
    uv run --directory services/core python -m events_core.cli config --json

Códigos de salida: 0 bien, 1 algo no cuadra, 2 uso o valor inválido (argparse
sale con 2 por su cuenta).
"""

from __future__ import annotations

import argparse

from .. import __version__
from ..items.modelo.estados import ESTADOS
from .cliente import _doctor
from .comun import _config, _repo
from .guardia import _guard, _puertas
from .items import (
    _item,
    _item_create,
    _item_edit,
    _item_fases,
    _item_move,
    _item_requisito,
    _mapa,
)
from .migraciones import (
    _migrar_absorb,
    _migrar_apply,
    _migrar_check,
    _migrar_classify,
    _migrar_export,
    _migrar_guard,
    _migrar_scan,
    _migrar_undo,
)
from .web import _mcp, _schema, _serve, _web


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eui", description="Cliente de Events UI para agentes.")
    parser.add_argument("--version", action="version", version=f"eui {__version__}")
    parser.add_argument(
        "--webapp",
        action="store_true",
        help="Abre la web app en el navegador (la instala si falta)",
    )
    parser.add_argument(
        "--desktop",
        action="store_true",
        help="Abre el desktop (lo instala si falta)",
    )
    parser.add_argument("--port", type=int, help="Puerto del core (con --webapp)")
    parser.add_argument(
        "--idle-minutes",
        type=float,
        default=10.0,
        help="Minutos sin uso antes de apagar el core (con --webapp)",
    )
    comandos = parser.add_subparsers(dest="comando")

    doctor = comandos.add_parser("doctor", help="Comprueba configuración, core, versión y raíz")
    doctor.add_argument("--url", help="Base del core (por defecto, el puerto configurado)")
    doctor.add_argument("--port", type=int, help="Puerto del core si no se da --url")
    doctor.add_argument("--repo", help="Raíz a comprobar en vez de la configurada")
    doctor.add_argument("--json", action="store_true", help="Una línea JSON para agentes")
    doctor.set_defaults(func=_doctor)

    ajustes = comandos.add_parser("config", help="Lee o cambia la configuración compartida")
    ajustes.add_argument("--json", action="store_true")
    acciones = ajustes.add_subparsers(dest="accion")
    fijar = acciones.add_parser("set", help="Cambia la raíz o el puerto")
    fijar.add_argument("clave", choices=["repo", "port"])
    fijar.add_argument("valor")
    ajustes.set_defaults(func=_config)

    def conexion(p: argparse.ArgumentParser, *, con_repo: bool = True) -> None:
        p.add_argument("--url", help="Base del core (por defecto, el puerto configurado)")
        p.add_argument("--port", type=int, help="Puerto del core si no se da --url")
        if con_repo:
            p.add_argument("--repo", help="Raíz a usar en vez de la configurada")

    repos = comandos.add_parser("repo", help="La raíz configurada o las del laboratorio")
    repos.add_argument(
        "accion", nargs="?", choices=["list"], help="`list`: carpetas del laboratorio"
    )
    repos.add_argument("--json", action="store_true")
    conexion(repos)
    repos.set_defaults(func=_repo)

    mapa = comandos.add_parser(
        "mapa", help="El mapa entero en una lectura: carriles, dependencias y fases"
    )
    mapa.add_argument("--json", action="store_true")
    conexion(mapa)
    mapa.set_defaults(func=_mapa)

    puertas = comandos.add_parser("puertas", help="Las puertas activas del flujo")
    puertas.add_argument("--json", action="store_true")
    conexion(puertas)
    puertas.set_defaults(func=_puertas)

    guardia = comandos.add_parser(
        "guard", help="Documentos fuera del flujo y puertas; o el veredicto de un hook"
    )
    guardia.add_argument(
        "--hook",
        action="store_true",
        help="Lee {tool, ruta} por stdin: sale 0 si permite y 2 si deniega",
    )
    guardia.add_argument("--json", action="store_true")
    conexion(guardia)
    guardia.set_defaults(func=_guard)

    items = comandos.add_parser("item", help="Lee y escribe los ítems del repo")
    acciones_item = items.add_subparsers(dest="accion", required=True)
    listar = acciones_item.add_parser("list", help="Lista los ítems del mapa")
    listar.add_argument("--status")
    listar.add_argument("--kind", choices=["work_item", "adr", "note"])
    listar.add_argument(
        "--incluir",
        choices=["contenido"],
        help="El cuerpo Markdown de cada fila; por defecto, el listado es un resumen",
    )
    listar.add_argument("--limit", type=int, default=100)
    listar.add_argument("--offset", type=int, default=0)
    listar.add_argument("--json", action="store_true")
    conexion(listar)
    listar.set_defaults(func=_item)
    ver = acciones_item.add_parser("get", help="La ficha completa de un ítem")
    ver.add_argument("uid")
    ver.add_argument("--json", action="store_true")
    conexion(ver)
    ver.set_defaults(func=_item)

    crear = acciones_item.add_parser("create", help="Crea un ítem en la cola de entrada")
    crear.add_argument("--title", required=True)
    crear.add_argument("--description", default="")
    crear.add_argument("--content", default="")
    crear.add_argument("--kind", choices=["work_item"], default="work_item")
    crear.add_argument("--status", choices=ESTADOS, default="draft")
    crear.add_argument("--tag", action="append", default=[], help="Etiqueta (repetible)")
    crear.add_argument("--dep", action="append", default=[], help="uid del que depende")
    crear.add_argument(
        "--fases", metavar="FICHERO", help='Lista de fases o {"fases": [...]} para el alta'
    )
    crear.add_argument("--json", action="store_true")
    conexion(crear)
    crear.set_defaults(func=_item_create)

    editar = acciones_item.add_parser("edit", help="Edita los campos dados de un ítem")
    editar.add_argument("uid")
    editar.add_argument("--title")
    editar.add_argument("--description")
    editar.add_argument("--content")
    editar.add_argument("--tag", action="append", default=[], help="Reemplaza las etiquetas")
    editar.add_argument("--sin-etiquetas", action="store_true", help="Deja la lista vacía")
    editar.add_argument("--dep", action="append", default=[], help="Reemplaza las dependencias")
    editar.add_argument("--sin-dependencias", action="store_true", help="Deja la lista vacía")
    editar.add_argument("--json", action="store_true")
    conexion(editar)
    editar.set_defaults(func=_item_edit)

    mover = acciones_item.add_parser(
        "move", help="Mueve un ítem de carril con los datos de su ficha"
    )
    mover.add_argument("uid")
    mover.add_argument("status", choices=ESTADOS)
    mover.add_argument("--resultado", help="Resultado de roadmap")
    mover.add_argument("--referencia", help="Referencia del trabajo en roadmap")
    mover.add_argument("--verificacion-resultado")
    mover.add_argument("--verificacion-comentario")
    mover.add_argument("--aprobado-por", choices=["usuario", "agente", "sistema"])
    mover.add_argument("--nota", help="Nota de la aprobación")
    mover.add_argument("--motivo", help="Motivo del descarte")
    mover.add_argument("--descartado-por", choices=["usuario", "agente", "sistema"])
    mover.add_argument("--sustituye-a", help="uid del ítem que releva")
    mover.add_argument("--json", action="store_true")
    conexion(mover)
    mover.set_defaults(func=_item_move)

    fases = acciones_item.add_parser("fases", help="Reemplaza las fases desde un JSON")
    fases.add_argument("uid")
    fases.add_argument("fichero", help='Lista de fases o {"fases": [...]}')
    fases.add_argument("--json", action="store_true")
    conexion(fases)
    fases.set_defaults(func=_item_fases)

    requisito = acciones_item.add_parser("requisito", help="Marca o desmarca un requisito")
    requisito.add_argument("uid")
    requisito.add_argument("fase", type=int)
    requisito.add_argument("requisito", type=int)
    marca = requisito.add_mutually_exclusive_group(required=True)
    marca.add_argument("--hecho", dest="hecho", action="store_true")
    marca.add_argument("--pendiente", dest="hecho", action="store_false")
    requisito.add_argument("--json", action="store_true")
    conexion(requisito)
    requisito.set_defaults(func=_item_requisito)

    esquema = comandos.add_parser(
        "schema", help="El OpenAPI del core o el esquema del plan de migración"
    )
    esquema.add_argument(
        "tema",
        nargs="?",
        choices=["migrate", "puertas"],
        help="`migrate`: el plan de migración; `puertas`: `.EUI/protocolos.json`",
    )
    esquema.add_argument("--pretty", action="store_true", help="Indentado para leerlo")
    conexion(esquema, con_repo=False)
    esquema.set_defaults(func=_schema)

    migrar = comandos.add_parser("migrate", help="Migración de Markdown (empieza por scan)")
    acciones_migrar = migrar.add_subparsers(dest="accion", required=True)
    escanear = acciones_migrar.add_parser(
        "scan", help="Lista los Markdown y lo que reconoce; no escribe"
    )
    escanear.add_argument("ruta", nargs="?", help="Carpeta o archivo; por defecto, la raíz")
    escanear.add_argument("--json", action="store_true")
    conexion(escanear)
    escanear.set_defaults(func=_migrar_scan)

    clasificar = acciones_migrar.add_parser(
        "classify",
        help="Propone el manifiesto documentos (mapa/referencia); no escribe",
        aliases=["plan"],
    )
    clasificar.add_argument("ruta", nargs="?", help="Carpeta o archivo; por defecto, la raíz")
    clasificar.add_argument("--json", action="store_true")
    conexion(clasificar)
    clasificar.set_defaults(func=_migrar_classify)

    comprobar = acciones_migrar.add_parser(
        "check", help="Valida el plan y enseña lo que se crearía; no escribe"
    )
    comprobar.add_argument("plan", help="Ruta del plan.json")
    comprobar.add_argument("--json", action="store_true")
    conexion(comprobar)
    comprobar.set_defaults(func=_migrar_check)

    aplicar = acciones_migrar.add_parser("apply", help="Aplica el plan como un lote; todo o nada")
    aplicar.add_argument("plan", help="Ruta del plan.json")
    aplicar.add_argument("--json", action="store_true")
    conexion(aplicar)
    aplicar.set_defaults(func=_migrar_apply)

    deshacer = acciones_migrar.add_parser(
        "undo", help="Deshace un lote si nadie tocó sus items después"
    )
    deshacer.add_argument("lote", help="Identificador del lote que devolvió apply")
    deshacer.add_argument("--json", action="store_true")
    conexion(deshacer)
    deshacer.set_defaults(func=_migrar_undo)

    absorber = acciones_migrar.add_parser("absorb", help="Copia y retira un lote ya migrado")
    absorber.add_argument("lote", help="Identificador del lote que devolvió apply")
    modo = absorber.add_mutually_exclusive_group()
    modo.add_argument(
        "--dry-run",
        action="store_true",
        help="Informe sin escribir (por defecto)",
    )
    modo.add_argument(
        "--confirmar",
        action="store_true",
        help="Copia el origen y lo elimina (o reescribe con --parcial)",
    )
    absorber.add_argument(
        "--parcial",
        action="store_true",
        help=(
            "Absorción parcial: exige rangos sin solapar, deja marcadores "
            "[eui:<uid>] y no es el comportamiento por defecto"
        ),
    )
    absorber.add_argument("--json", action="store_true")
    conexion(absorber)
    absorber.set_defaults(func=_migrar_absorb)

    exportar = acciones_migrar.add_parser(
        "export", help="Genera el Markdown actual de un documento desde SQLite"
    )
    exportar.add_argument("ruta", help="Ruta del documento tal como la guardó la migración")
    exportar.add_argument("--salida", help="Fichero de salida; por defecto, stdout")
    conexion(exportar)
    exportar.set_defaults(func=_migrar_export)

    guarda = acciones_migrar.add_parser(
        "guard", help="Lista los documentos creados fuera del flujo; no escribe"
    )
    guarda.add_argument("--json", action="store_true")
    conexion(guarda)
    guarda.set_defaults(func=_migrar_guard)

    web = comandos.add_parser("web", help="Enciende el core y abre la web")
    web.add_argument("--port", type=int, help="Puerto del core si no es el configurado")
    web.add_argument(
        "--idle-minutes",
        type=float,
        default=10.0,
        help="Minutos sin peticiones antes de que el core se apague (0 = no apagar)",
    )
    web.add_argument("--no-open", action="store_true", help="No abrir el navegador")
    web.set_defaults(func=_web)

    servir = comandos.add_parser("serve", help="Arranca el core en primer plano")
    servir.add_argument("--port", type=int, help="Puerto del core si no es el configurado")
    servir.add_argument(
        "--idle-minutes",
        type=float,
        help="Minutos sin peticiones antes de apagarse (0 = no apagar)",
    )
    servir.set_defaults(func=_serve)

    mcp = comandos.add_parser("mcp", help="Servidor MCP por stdio para agentes")
    mcp.add_argument(
        "--permitir-escritura",
        action="store_true",
        help="Anuncia y permite las herramientas que escriben",
    )
    mcp.set_defaults(func=_mcp)

    return parser
