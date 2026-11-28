"""La web compilada: qué `dist` se sirve y cómo se cambia en caliente.

`main.py` la monta al arrancar; `eui web` añade el `dist` del paquete npm a un
core ya vivo con `POST /webapp`. El montaje se hace una sola vez y el
despachador lee `DIST_WEB` en cada petición, así que cambiar de dist no toca
atributos internos de `StaticFiles`.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.applications import Starlette
from starlette.types import Receive, Scope, Send

from . import registro

# La web compilada se sirve desde el mismo origen que la API. La UI llama a
# `/api/...` (en dev lo hace el proxy de Vite, que quita el prefijo): el
# middleware de `middleware.py` lo quita igual. El `dist` se busca en el
# entorno, en el checkout y en el paquete npm; el core congelado del desktop no
# tiene el checkout alrededor, así que sin esta última búsqueda su `/` sería un
# 404 aunque la web estuviera instalada.

router = APIRouter()

DIST_WEB: Path | None = None
WEB_MONTADA = False


def _dist_web_instalada() -> Path | None:
    """El `dist` del paquete npm de la web, si está instalado.

    Se miran las rutas habituales de npm sin lanzar Node: el core no debe
    depender de `npm` para arrancar. `eui web` puede añadir una ruta no habitual
    con `POST /webapp`.
    """
    candidatos: list[Path] = []
    if os.name == "nt":
        for base in (os.environ.get("APPDATA"), os.environ.get("LOCALAPPDATA")):
            if base:
                candidatos.append(
                    Path(base)
                    / "npm"
                    / "node_modules"
                    / "@jaminsmoke"
                    / "events-ui-webapp"
                    / "dist"
                )
    else:
        candidatos.extend(
            [
                Path.home()
                / ".npm-global"
                / "lib"
                / "node_modules"
                / "@jaminsmoke"
                / "events-ui-webapp"
                / "dist",
                Path("/usr/local/lib/node_modules/@jaminsmoke/events-ui-webapp/dist"),
                Path("/usr/lib/node_modules/@jaminsmoke/events-ui-webapp/dist"),
            ]
        )
    return next((ruta for ruta in candidatos if (ruta / "index.html").is_file()), None)


def _dist_web_del_checkout() -> Path | None:
    """El `dist` del checkout, si el core corre desde las fuentes.

    En el binario congelado de Linux la ruta es corta (`/tmp/_MEI…/events_core/
    main.py`) y no hay quinto padre: indexarlo revienta al importar y el core no
    llega a arrancar. Sin checkout, manda el paquete npm.
    """
    padres = Path(__file__).resolve().parents
    if len(padres) < 5:
        return None
    source = padres[4] / "apps" / "web" / "dist"
    return source if (source / "index.html").is_file() else None


def dist_inicial() -> Path | None:
    """El `dist` con el que arranca el core: entorno, checkout o paquete npm."""
    fijado = os.environ.get("EUI_WEB_DIST", "").strip()
    if fijado:
        return Path(fijado)
    return _dist_web_del_checkout() or _dist_web_instalada()


class _WebVigente:
    """Sirve en `/` el `dist` que haya en `DIST_WEB` al atender la petición.

    `StaticFiles` fija su carpeta al construirse y no ofrece API para cambiarla;
    mutar `directory`/`all_directories` para montar la web en caliente dependía
    de atributos no públicos de Starlette. Este despachador se monta una sola
    vez y delega en un `StaticFiles` por carpeta (cacheado), así que
    `POST /webapp` solo mueve `DIST_WEB`: la petición siguiente ya sirve el dist
    nuevo, sin tocar el estado interno de nadie.
    """

    def __init__(self) -> None:
        self._estaticos: dict[str, StaticFiles] = {}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        ruta = DIST_WEB
        if ruta is None:
            respuesta = JSONResponse({"detail": "La web no está montada"}, status_code=404)
            await respuesta(scope, receive, send)
            return
        clave = str(ruta)
        estatico = self._estaticos.get(clave)
        if estatico is None:
            estatico = StaticFiles(directory=clave, html=True)
            self._estaticos[clave] = estatico
        await estatico(scope, receive, send)


WEB = _WebVigente()


def _montar_web(app: Starlette, ruta: Path) -> None:
    """Apunta la web a `ruta` y la monta la primera vez.

    El montaje va al final: las rutas de la API van antes, y el middleware de
    `/api` reescribe el camino antes de enrutar.
    """
    global DIST_WEB, WEB_MONTADA
    DIST_WEB = ruta
    if not WEB_MONTADA:
        app.mount("/", WEB, name="web")
        WEB_MONTADA = True


def montar_al_arrancar(app: Starlette) -> None:
    """Sirve el `dist` que haya al arrancar, si es un dist de verdad."""
    ruta = dist_inicial()
    if ruta is not None and (ruta / "index.html").is_file():
        _montar_web(app, ruta)


class _WebappEntrada(BaseModel):
    dist: str


@router.post("/webapp", include_in_schema=False)
@router.post("/webapp/", include_in_schema=False)
def montar_en_caliente(entrada: _WebappEntrada, request: Request) -> dict[str, Any]:
    """Añade la web instalada a un core que ya está vivo.

    Lo llama `eui web` cuando el desktop encendió el core sin `EUI_WEB_DIST`.
    Solo acepta una carpeta que parezca un `dist` (con `index.html`): el core
    escucha en bucle local, pero tampoco sirve un directorio cualquiera.
    """
    ruta = Path(entrada.dist).expanduser()
    try:
        ruta = ruta.resolve()
    except OSError as exc:
        raise HTTPException(
            status_code=400, detail=f"no pude resolver {entrada.dist}: {exc}"
        ) from exc
    if not ruta.is_dir() or not (ruta / "index.html").is_file():
        raise HTTPException(
            status_code=400, detail=f"{ruta} no es un dist de la web (falta index.html)"
        )
    _montar_web(request.app, ruta)
    registro.escribir("info", f"Web montada desde {ruta}")
    return {"dist": str(ruta)}
