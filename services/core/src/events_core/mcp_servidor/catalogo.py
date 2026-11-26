"""Qué herramientas ofrece el MCP: sus campos y su esquema."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from pydantic import TypeAdapter

from .. import cli
from ..contrato import (
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
