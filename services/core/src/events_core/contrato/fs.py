"""Carpetas y archivos: explorador, árbol del repo y visor de texto."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Repo(BaseModel):
    """Una carpeta del laboratorio ya sembrada, tal como la ofrece `GET /repos`."""

    repo: str
    db_path: str


class RepoActual(BaseModel):
    """La raíz con la que trabajaría el CLI; `None` si no hay ninguna elegida."""

    repo: str | None
    url: str


class FsEntrada(BaseModel):
    """Una entrada del explorador de carpetas (`GET /fs`).

    `es_repo` solo tiene sentido en una carpeta: dice si ya tiene `.EUI`, que
    es lo que la UI marca para no abrir una carpeta cualquiera por error.
    """

    nombre: str
    tipo: Literal["carpeta", "archivo"]
    es_repo: bool = False


class FsListado(BaseModel):
    """Un nivel del explorador: la carpeta actual, su padre y sus entradas.

    `ruta` y `padre` son absolutas; `padre` es `None` en la raíz, que es el
    único sitio desde el que no se puede subir. `recortado` avisa de que el
    nivel tiene más entradas de las que caben en la respuesta.
    """

    ruta: str
    padre: str | None = None
    entradas: list[FsEntrada] = Field(default_factory=list)
    recortado: bool = False


class NodoArbol(BaseModel):
    """Una entrada del árbol de archivos: carpeta o archivo, con su ruta.

    `ruta` es relativa a la raíz del repo y con barras normales, que es lo que
    el pane usa para pedir el nivel siguiente.
    """

    nombre: str
    ruta: str
    tipo: Literal["carpeta", "archivo"]


class NivelArbol(BaseModel):
    """Una carpeta del árbol ya listada; la raíz del repo es `ruta` vacía.

    `recortado` avisa de que la carpeta tiene más entradas de las que caben en
    la respuesta: se enseña el principio en vez de callar el resto.
    """

    ruta: str
    hijos: list[NodoArbol] = Field(default_factory=list)
    recortado: bool = False


class Archivo(BaseModel):
    """Un archivo de texto del repo, acotado para el visor.

    `texto` viene en UTF-8 tolerante (los bytes inválidos se sustituyen) y
    nunca supera los 512 KiB; `bytes` es el tamaño real en disco y `truncado`
    avisa de que solo se leyó el principio. `ruta` sale canónica, relativa a
    la raíz y con barras normales.
    """

    ruta: str
    texto: str
    bytes: int
    truncado: bool = False
