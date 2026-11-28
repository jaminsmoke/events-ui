"""Rutas de la configuración compartida: raíz por defecto y puerto del core."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import config as configuracion
from ..contrato import RESPUESTAS_ERROR, Config, ConfigEntrada

router = APIRouter()


@router.get("/config", response_model=Config, tags=["config"])
def get_config() -> dict[str, Any]:
    """La configuración que ve el core.

    Tolera un fichero roto (valores por defecto): quien quiera el detalle del
    problema lo mira con `eui doctor`, que sí lo reporta.
    """
    return configuracion.leer_segura().como_dict()


@router.put("/config", response_model=Config, tags=["config"], responses=RESPUESTAS_ERROR)
def put_config(body: ConfigEntrada) -> dict[str, Any]:
    """Cambia la raíz y/o el puerto; la clave ausente no se toca.

    La UI lo llama al abrir una carpeta para que el CLI y el MCP sepan cuál es
    la raíz por defecto; `repo: null` la limpia.
    """
    return configuracion.guardar(**body.model_dump(exclude_unset=True)).como_dict()
