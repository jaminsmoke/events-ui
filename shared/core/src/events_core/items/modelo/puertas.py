"""Las puertas del flujo: la política que el MCP y la guarda aplican.

Una puerta es un dato, no un `if` escondido: un identificador, la condición que
la abre, las herramientas que cierra y el motivo que se enseña a quien intenta
cruzarla. Las condiciones viven aquí, en código, porque un archivo no puede
decir «no hay ninguna ficha en roadmap»; `.EUI/protocolos.json` elige cuáles
están puestas, puede apagarlas y puede cambiarles el motivo.

Sin archivo valen los presets: el repo que no dice nada hereda la política.

Una puerta nunca cierra la herramienta que abre su condición (`abren`): si no
hay ficha en roadmap, `item_move` tiene que seguir disponible o la puerta deja
el flujo en punto muerto. `_comprobar` lo impone al leer, no al escribir.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, ValidationError

from ..base.comun import InvalidInput
from ..base.rutas import EUI_DIR, PROTOCOLOS_FILENAME

ARCHIVO_PROTOCOLOS = PROTOCOLOS_FILENAME


class PuertaArchivo(BaseModel):
    """Una puerta en `.EUI/protocolos.json`: se apaga o se le cambia el motivo.

    `motivo` ausente o vacío deja el del preset: el archivo no tiene que repetir
    el texto del core para decir que la puerta está puesta.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1)
    activa: bool = True
    motivo: str | None = None


class ProtocolosArchivo(BaseModel):
    """El archivo entero. La versión 1 es la única que este core entiende."""

    model_config = ConfigDict(extra="forbid")

    version: Literal[1]
    puertas: list[PuertaArchivo] = Field(default_factory=list)


# El esquema del archivo, para el paquete y para `eui schema puertas`. Sale del
# modelo, así que no puede quedarse atrás al añadir un campo.
ESQUEMA_PUERTAS: dict[str, Any] = TypeAdapter(ProtocolosArchivo).json_schema()


@dataclass(frozen=True)
class Estado:
    """Lo que el mapa dice ahora mismo; las puertas solo miran esto."""

    roadmap: tuple[str, ...] = ()
    verificacion: tuple[str, ...] = ()
    # Los uids en roadmap que no tienen ninguna fase escrita.
    sin_fases: tuple[str, ...] = ()
    # Documentos ajenos al flujo que encontró la guarda.
    documentos: int = 0


@dataclass(frozen=True)
class Preset:
    """Una puerta del core: su condición y lo que cierra.

    `abren` son las herramientas que abren la condición y no se cierran nunca;
    `_comprobar` rechaza un preset que las pise.
    """

    id: str
    motivo: str
    cierra: tuple[str, ...]
    abren: tuple[str, ...]
    evalua: Callable[[Estado], bool]


@dataclass(frozen=True)
class Definicion:
    """Una puerta con lo que el repo haya decidido sobre ella."""

    preset: Preset
    activa: bool
    motivo: str
    desde: Literal["preset", "repo"]


PRESETS: tuple[Preset, ...] = (
    Preset(
        id="sin-ficha-activa",
        motivo="no hay ninguna ficha en roadmap: mueve una antes de trabajar",
        cierra=("item_fases", "item_requisito"),
        abren=("item_create", "item_move"),
        evalua=lambda estado: not estado.roadmap,
    ),
    Preset(
        id="ficha-sin-fases",
        motivo="la ficha activa no tiene fases: escribe su desglose antes de marcarlo",
        cierra=("item_requisito",),
        abren=("item_fases", "item_move"),
        evalua=lambda estado: bool(estado.sin_fases),
    ),
    Preset(
        id="verificando-no-se-toca",
        motivo="hay una ficha en verificación: se comprueba, no se construye",
        cierra=("item_fases", "item_requisito"),
        abren=("item_move",),
        evalua=lambda estado: bool(estado.verificacion),
    ),
    Preset(
        id="documentos-fuera-del-flujo",
        motivo="hay documentos fuera del flujo: resuélvelos antes de aplicar un plan",
        cierra=("migrate_apply",),
        abren=("migrate_check", "migrate_scan", "migrate_undo"),
        evalua=lambda estado: estado.documentos > 0,
    ),
    Preset(
        id="una-ficha-a-la-vez",
        motivo="roadmap está ocupado: solo una ficha puede estar en curso",
        cierra=(),
        abren=(),
        evalua=lambda estado: bool(estado.roadmap),
    ),
)


def _comprobar(presets: tuple[Preset, ...]) -> None:
    """Una puerta no puede cerrar la herramienta que abre su condición."""
    vistos: set[str] = set()
    for preset in presets:
        if preset.id in vistos:
            raise InvalidInput(f"puerta repetida: {preset.id}")
        vistos.add(preset.id)
        salida = set(preset.cierra) & set(preset.abren)
        if salida:
            raise InvalidInput(
                f"la puerta {preset.id} cierra lo que la abre: {', '.join(sorted(salida))}"
            )


def ruta(raiz: Path) -> Path:
    """Dónde vive la política del repo: `.EUI/protocolos.json`."""
    return Path(raiz) / EUI_DIR / ARCHIVO_PROTOCOLOS


def _leer_json(archivo: Path) -> Any:
    try:
        texto = archivo.read_text(encoding="utf-8")
    except OSError as exc:
        raise InvalidInput(f"no se pudo leer {ARCHIVO_PROTOCOLOS}: {exc}") from exc
    try:
        return json.loads(texto)
    except ValueError as exc:
        raise InvalidInput(f"{ARCHIVO_PROTOCOLOS} no es JSON válido: {exc}") from exc


def definiciones(raiz: Path, presets: tuple[Preset, ...] = PRESETS) -> list[Definicion]:
    """Las puertas con lo que el repo decida, en el orden de los presets.

    Sin archivo, todas puestas con su motivo del core. Con archivo, el repo
    manda: apaga, enciende y cambia motivos, pero no inventa puertas —una que el
    core no sabe evaluar es un error, no un aviso—.
    """
    _comprobar(presets)
    archivo = ruta(raiz)
    if not archivo.exists():
        return [Definicion(preset, True, preset.motivo, "preset") for preset in presets]

    try:
        protocolos = ProtocolosArchivo.model_validate(_leer_json(archivo))
    except ValidationError as exc:
        primero = exc.errors()[0]
        campo = ".".join(str(parte) for parte in primero["loc"]) or "raíz"
        raise InvalidInput(f"{ARCHIVO_PROTOCOLOS}: {campo}: {primero['msg']}") from exc

    por_id = {preset.id: preset for preset in presets}
    ajustes: dict[str, PuertaArchivo] = {}
    for entrada in protocolos.puertas:
        if entrada.id not in por_id:
            raise InvalidInput(
                f"{ARCHIVO_PROTOCOLOS}: puerta desconocida: {entrada.id}"
                f" (las que hay: {', '.join(sorted(por_id))})"
            )
        if entrada.id in ajustes:
            raise InvalidInput(f"{ARCHIVO_PROTOCOLOS}: puerta repetida: {entrada.id}")
        ajustes[entrada.id] = entrada

    definidas: list[Definicion] = []
    for preset in presets:
        ajuste = ajustes.get(preset.id)
        if ajuste is None:
            definidas.append(Definicion(preset, True, preset.motivo, "preset"))
        else:
            definidas.append(
                Definicion(preset, ajuste.activa, ajuste.motivo or preset.motivo, "repo")
            )
    return definidas


def estado(conn: sqlite3.Connection, *, documentos: int = 0) -> Estado:
    """Lo que hace falta saber del mapa para evaluar las puertas, en dos consultas."""
    filas = conn.execute(
        "SELECT estado, uid FROM work_item_node WHERE estado IN ('roadmap', 'verificacion')"
    ).fetchall()
    roadmap = tuple(str(fila[1]) for fila in filas if fila[0] == "roadmap")
    verificacion = tuple(str(fila[1]) for fila in filas if fila[0] == "verificacion")

    con_fases: set[str] = set()
    if roadmap:
        marcas = ",".join("?" for _ in roadmap)
        con_fases = {
            str(fila[0])
            for fila in conn.execute(
                "SELECT DISTINCT work_item_uid FROM work_item_fase"
                f" WHERE work_item_uid IN ({marcas})",
                roadmap,
            )
        }

    return Estado(
        roadmap=roadmap,
        verificacion=verificacion,
        sin_fases=tuple(uid for uid in roadmap if uid not in con_fases),
        documentos=documentos,
    )


def activas(raiz: Path, conn: sqlite3.Connection, *, documentos: int = 0) -> list[dict[str, Any]]:
    """Las puertas que están cerradas ahora, con su motivo y lo que cierran."""
    situacion = estado(conn, documentos=documentos)
    return [
        {
            "id": definicion.preset.id,
            "motivo": definicion.motivo,
            "desde": definicion.desde,
            "cierra": list(definicion.preset.cierra),
        }
        for definicion in definiciones(raiz)
        if definicion.activa and definicion.preset.evalua(situacion)
    ]
