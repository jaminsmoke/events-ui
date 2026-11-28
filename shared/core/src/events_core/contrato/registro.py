"""El registro del repo y el de la app: eventos, log y sus purgas."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class Evento(BaseModel):
    """El sobre del evento (F1): lo estable; `payload` es JSON libre."""

    id: int
    ts: str
    type: str
    payload: dict | str
    # De dónde viene (0010): `item`, `externo` o la tabla futura que lo sea.
    origen: str = "externo"
    # Derivado del tipo (o del `payload.nivel`): colorear igual que el registro.
    nivel: Literal["info", "aviso", "error"] = "info"
    dedupe_key: str | None = None


class EventosCompactados(BaseModel):
    """Respuesta de `POST /eventos/compactar`: qué se recortó del log.

    `por_edad`/`por_conteo` son neutros a propósito: el mismo par de claves
    sirve para el registro y no hay que adivinar el género del sustantivo.
    """

    repo: str
    por_edad: int
    por_conteo: int
    vacuum: bool


class Reinicio(BaseModel):
    """Respuesta de `POST /reiniciar` (LAB): cuántas filas se vaciaron."""

    repo: str
    items_eliminadas: int
    eventos_eliminados: int


class EntradaLog(BaseModel):
    """Una línea del registro operativo (`GET /log`): de la app, no del repo."""

    id: int
    ts: str
    nivel: Literal["info", "aviso", "error"]
    origen: str
    mensaje: str


class RegistroPurgado(BaseModel):
    """Respuesta de `POST /log/purgar`: qué se llevó la retención.

    Mismas claves neutras que `EventosCompactados`: `por_edad`/`por_conteo`.
    """

    por_edad: int
    por_conteo: int
