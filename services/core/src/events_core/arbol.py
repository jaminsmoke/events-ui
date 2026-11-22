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

import mimetypes
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


# El visor no carga un repo entero: 512 KiB bastan para leer y resaltar sin
# congelar la UI, y es el mismo techo que ya usan los parches de fase.
LIMITE_ARCHIVO = 512 * 1024


# Las imágenes se sirven enteras, pero con tope: una foto de 40 MiB no debe
# llegar al webview ni bloquear el panel.
LIMITE_IMAGEN = 12 * 1024 * 1024


class ArchivoBinario(Exception):
    """El archivo no es texto legible: el router lo traduce a un 415."""


class ArchivoNoImagen(Exception):
    """El archivo no es una imagen: el router lo traduce a un 415."""


class ArchivoDemasiadoGrande(Exception):
    """La imagen supera el tope: el router lo traduce a un 413."""


def leer_archivo(carpeta: Path, ruta: str) -> dict[str, Any]:
    """El texto de un archivo del repo, acotado y sin salir de la raíz.

    La ruta pasa por la misma guarda que `/arbol` (`_relativa`), así que `..`
    no lee fuera del repo. Se lee de más para saber si hay truncamiento sin
    hacer un `stat` previo; un NUL en lo leído delata un binario y se responde
    415 en vez de devolver texto con basura. Los bytes UTF-8 inválidos se
    sustituyen: una nota mal codificada sigue siendo legible.
    """
    _, destino = _relativa(carpeta, ruta)
    if not destino.is_file():
        raise FileNotFoundError(f"no existe el archivo {ruta!r}")
    try:
        with destino.open("rb") as fichero:
            datos = fichero.read(LIMITE_ARCHIVO + 1)
        tamano = destino.stat().st_size
    except OSError as exc:
        raise FileNotFoundError(f"no se pudo leer {ruta!r}: {exc}") from exc
    if b"\x00" in datos:
        raise ArchivoBinario(ruta)
    truncado = len(datos) > LIMITE_ARCHIVO
    return {
        "ruta": destino.relative_to(carpeta.resolve()).as_posix(),
        "texto": datos[:LIMITE_ARCHIVO].decode("utf-8", errors="replace"),
        "bytes": tamano,
        "truncado": truncado,
    }


def leer_imagen(carpeta: Path, ruta: str) -> tuple[bytes, str]:
    """Los bytes de una imagen del repo, con su tipo MIME.

    Solo se sirven tipos `image/*`: el visor pinta un `<img>`, no un archivo
    cualquiera. La guarda de rutas es la misma que en `/archivo`, y el tope se
    comprueba por `stat` antes de leer para no cargar media docena de MiB de
    más. Un SVG llega como texto, pero se sirve igual: su tipo es de imagen.
    """
    _, destino = _relativa(carpeta, ruta)
    if not destino.is_file():
        raise FileNotFoundError(f"no existe el archivo {ruta!r}")
    tipo, _ = mimetypes.guess_type(destino.name)
    if tipo is None or not tipo.startswith("image/"):
        raise ArchivoNoImagen(ruta)
    try:
        if destino.stat().st_size > LIMITE_IMAGEN:
            raise ArchivoDemasiadoGrande(ruta)
        datos = destino.read_bytes()
    except OSError as exc:
        raise FileNotFoundError(f"no se pudo leer {ruta!r}: {exc}") from exc
    return datos, tipo
