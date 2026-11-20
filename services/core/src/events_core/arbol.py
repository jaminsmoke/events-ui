"""El árbol de archivos del repo, por niveles y a pedido.

No hay foto ni watcher: la UI pide la raíz y cada carpeta que tiene desplegada,
y vuelve a pedirlas en su latido. Un `scandir` por carpeta abierta cuesta
milisegundos, así que lo que se crea o se borra fuera de la app aparece solo y
no se guarda nada.

Se enseña todo lo que hay en disco, también lo que Git ignora (`.git`,
`node_modules`, `.EUI`) y los propios `.gitignore`: un árbol que esconde cosas
obliga a adivinar si el archivo está o no. Lo que deja algo fuera de la vista
es plegar su carpeta, no un filtro. Los ajustes de visibilidad, cuando
existan, mandarán aquí un patrón; mientras tanto, lo único que se aplica por
encima es el orden y el tope por nivel.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .ideas import InvalidInput

# Tope por nivel: una carpeta con miles de entradas no puede hinchar la
# respuesta ni congelar el pane. Lo que no cabe se avisa (`recortado`).
LIMITE_POR_NIVEL = 400
# Tope de niveles por petición: la UI manda lo desplegado y nada más.
LIMITE_NIVELES = 64


def _relativa(carpeta: Path, ruta: str) -> tuple[str, Path]:
    """La ruta normalizada del nivel y su carpeta en disco.

    Una ruta con `..` no se resuelve a ciegas: si al normalizarla se sale del
    repo, es una petición inválida (400) y no se lista media máquina.
    """
    limpia = (ruta or "").strip().replace("\\", "/").strip("/")
    if not limpia:
        return "", carpeta.resolve()
    destino = (carpeta / limpia).resolve()
    if not destino.is_relative_to(carpeta.resolve()):
        raise InvalidInput(f"ruta fuera del repo: {ruta!r}")
    return limpia, destino


def nivel(carpeta: Path, ruta: str) -> dict[str, Any]:
    """El contenido de una carpeta: sus hijos, ordenados y tal como están.

    Primero las carpetas y luego los archivos, cada grupo por nombre y sin
    distinguir mayúsculas (el orden de Windows), para que el pane no baile
    entre dos latidos. Un `scandir` que falla —la carpeta se borró mientras se
    pedía, o no es una carpeta— devuelve el nivel vacío: el árbol es un
    instante, no una garantía.
    """
    normalizada, destino = _relativa(carpeta, ruta)
    hijos: list[dict[str, Any]] = []
    try:
        with os.scandir(destino) as entradas:
            for entrada in entradas:
                try:
                    # Un enlace a una carpeta se enseña como archivo: seguir
                    # enlaces puede sacar el árbol del repo o ciclarse.
                    es_carpeta = entrada.is_dir(follow_symlinks=False)
                except OSError:
                    continue
                hijos.append(
                    {
                        "nombre": entrada.name,
                        "ruta": f"{normalizada}/{entrada.name}" if normalizada else entrada.name,
                        "tipo": "carpeta" if es_carpeta else "archivo",
                    }
                )
    except OSError:
        return {"ruta": normalizada, "hijos": [], "recortado": False}

    hijos.sort(key=lambda hijo: (hijo["tipo"] != "carpeta", str(hijo["nombre"]).casefold()))
    return {
        "ruta": normalizada,
        "hijos": hijos[:LIMITE_POR_NIVEL],
        "recortado": len(hijos) > LIMITE_POR_NIVEL,
    }


def niveles(carpeta: Path, rutas: list[str]) -> list[dict[str, Any]]:
    """Los niveles pedidos, sin repetir y en el orden en que llegan.

    La raíz (`""`) siempre va: es lo que el pane enseña cuando no hay nada
    desplegado, y así una petición sin `rutas` sigue teniendo sentido.
    """
    pedidas: list[str] = []
    for ruta in ["", *rutas]:
        normalizada, _ = _relativa(carpeta, ruta)
        if normalizada not in pedidas:
            pedidas.append(normalizada)
        if len(pedidas) >= LIMITE_NIVELES:
            break
    return [nivel(carpeta, ruta) for ruta in pedidas]
