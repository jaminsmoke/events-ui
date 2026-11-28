"""El flujo entre carriles: grupos, uniones permitidas y puertas activas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# Los grupos de la allowlist, una sola vez: `origen` y `destino` los comparten
# (antes estaban escritos dos veces) y `test_listas.py` los compara con
# `estados.GRUPOS` y con el `GRUPOS` de la UI.
Grupo = Literal[
    "draft",
    "proposed",
    "roadmap",
    "verificacion",
    "revision_aprobada",
    "historial",
    "rejected",
]


class Protocolo(BaseModel):
    """Una unión permitida por el protocolo de flujo (`protocolo_flujo`).

    Los grupos son los carriles que se mueven (`superseded` comparte grupo con
    `rejected`: la ficha lo distingue, el carril no), así que no aparecen
    como origen ni destino propios.
    """

    origen: Grupo
    destino: Grupo
    # ¿Pide esta unión al menos una fase? (0021). La UI lo usa para no ofrecer
    # un traslado que el core va a rechazar. Desde la 0024 también al aprobar.
    exige_fases: bool = False
    # ¿Exige que no queden fases pendientes ni fallidas? (0022).
    exige_fases_listas: bool = False
    # ¿Exige que todas estén completadas? (0023): rechazada no vale.
    exige_fases_completas: bool = False


class Puerta(BaseModel):
    """Una puerta activa del flujo (`GET /puertas`).

    `desde` dice de dónde sale la definición: el preset del core o el
    `.EUI/protocolos.json` del repo. `cierra` son las herramientas del MCP que
    la puerta deja fuera; va vacía en las informativas, que solo avisan de un
    estado (roadmap ocupado).
    """

    id: str
    motivo: str
    desde: Literal["preset", "repo"]
    cierra: list[str] = Field(default_factory=list)
