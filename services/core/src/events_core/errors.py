"""Errores que comparten la app y el dominio.

`InvalidInput` nació en `items.base.comun`, pero lo necesitan capas que no deben
depender del dominio: la configuración y la resolución de rutas de un repo. Aquí
no importa nada, así que cualquiera puede usarlo sin arrastrar `items`.
"""

from __future__ import annotations


class InvalidInput(ValueError):
    """Petición inválida: no es un fallo del servidor, es un dato mal puesto."""
