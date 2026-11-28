"""Lo que rodea a las rutas: configuración, salud, diagnóstico y errores.

`RESPUESTAS_ERROR` y `RepoParam` se declaran aquí porque los comparten todas
las rutas que reciben una carpeta.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import Query
from pydantic import BaseModel, Field

from ..config import PUERTO_POR_DEFECTO


class ErrorDetail(BaseModel):
    """Lo que devuelven los exception handlers de abajo: `{"detail": ...}`.

    Declarado a propósito: sin esto, el OpenAPI solo publicaba el 200 y el
    422 de validación, y el cliente TS tenía que adivinar (con un cast) que
    el 400/404 trae `detail` como texto.
    """

    detail: str


# Errores que cualquier endpoint con `repo` puede devolver: nombre inválido
# (400, `InvalidInput`) o carpeta/item que no existe (404). Se declaran en
# cada decorador para que el cliente generado los tipé.
RESPUESTAS_ERROR = {
    400: {"model": ErrorDetail, "description": "Petición inválida"},
    404: {"model": ErrorDetail, "description": "No existe el repo o el ítem"},
}


class Config(BaseModel):
    """Configuración compartida con los clientes de fuera (CLI, MCP).

    `repo` es la raíz por defecto ya resuelta (absoluta) y `port`, dónde escucha
    el core: con esos dos datos un proceso de fuera sabe a quién preguntar y
    sobre qué carpeta, sin leer el `localStorage` del webview.
    """

    repo: str | None = None
    port: int = Field(default=PUERTO_POR_DEFECTO, ge=1, le=65535)


class ConfigEntrada(BaseModel):
    """Cambios de configuración: la clave ausente no se toca; `null` limpia."""

    repo: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)


class Health(BaseModel):
    """Respuesta de `/health`: `journal_mode`/`data_version` solo si hay BD."""

    status: Literal["ok", "degraded"]
    # La versión del core: el CLI compara la suya antes de fiarse del resto.
    version: str
    # La raíz por defecto que comparte la configuración; `None` si no hay.
    repo: str | None = None
    db_path: str
    db_exists: bool
    journal_mode: str | None = None
    data_version: int | None = None


class Comprobacion(BaseModel):
    """Una línea de `doctor`: qué se miró, cómo salió y el detalle."""

    nombre: str
    estado: Literal["ok", "aviso", "error"]
    detalle: str


class InformeDoctor(BaseModel):
    """`eui doctor --json`: el diagnóstico del core y de la configuración.

    Es un informe, no contrato de almacén: si una comprobación nueva no cabe en
    `Comprobacion`, se toca el modelo y el `outputSchema` del MCP le sigue. Eso
    es justo lo que se gana al dejar de armar el JSON a mano.
    """

    ok: bool
    url: str
    version: str
    comprobaciones: list[Comprobacion]


# El repo viaja como query param y no como segmento de la URL: el selector de
# carpetas devuelve rutas absolutas de Windows (`C:\...`), que no son un segmento
# válido de ruta. Aceptan ruta absoluta o nombre dentro del laboratorio.
RepoParam = Annotated[str, Query(description="Carpeta del repo: ruta absoluta o nombre en el lab")]
