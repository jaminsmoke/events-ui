"""Servicio core: lectura del log de eventos y API de items.

La app no produce eventos: otros procesos
escriben el log y este servicio lo expone a la UI. `/health` además prueba el
mecanismo de tiempo real (`PRAGMA data_version`).

Lo de aquí abajo: CRUD de items sobre
el `EUI_DATABASE` que vive en la raíz del repo abierto. Sin ORM a
propósito: el SQL está en `schema/items.sql` y el de las consultas, a la vista.
FastAPI publica el contrato en `/openapi.json` (Swagger en `/docs`), de ahí
saldrán los tipos TS del cliente.
"""

from __future__ import annotations

import os
import time
from contextlib import closing
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import __version__, items, registro
from . import config as configuracion
from .contrato import Health
from .db import data_version, db_path, journal_mode, open_read_only
from .routers import arbol as rutas_arbol
from .routers import config as rutas_config
from .routers import eventos as rutas_eventos
from .routers import fs as rutas_fs
from .routers import git as rutas_git
from .routers import items as rutas_items
from .routers import log as rutas_log
from .routers import migracion as rutas_migracion

# Orígenes con derecho a llamar a la API: el webview de Tauri. CORS decide
# quién puede LEER la respuesta; las mutaciones comprueban además el origen,
# porque un POST simple de otra web se ejecuta igual aunque CORS esconda la
# respuesta. La UI en dev entra por `_origen_permitido`, que no fija puerto.
ORIGENES_PERMITIDOS = (
    "tauri://localhost",
    "http://tauri.localhost",
)


def _origen_permitido(origen: str) -> bool:
    """El webview, o cualquier bucle local que use la UI en dev.

    Vite salta al siguiente puerto si el 15175 está ocupado (la app abierta, el
    runner e2e), y el navegador manda `Origin` con el puerto real: fijarlo
    dejaba sin protestar solo a la UI del puerto por defecto, y un commit desde
    otro se rechazaba con «origen no permitido». Se compara el host y no el
    puerto; una web ajena no puede fingir ser localhost.
    """
    if origen in ORIGENES_PERMITIDOS:
        return True
    partes = urlsplit(origen)
    return partes.scheme == "http" and partes.hostname in {"localhost", "127.0.0.1", "::1"}


app = FastAPI(title="Events UI Core", version=__version__)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ORIGENES_PERMITIDOS),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    expose_headers=["Last-Event-ID"],
    allow_headers=["content-type"],
)


METODOS_QUE_ESCRIBEN = {"POST", "PUT", "PATCH", "DELETE"}


@app.middleware("http")
async def _origen_conocido(request: Request, call_next):
    """Rechaza mutaciones que vengan de una web ajena.

    Un navegador manda `Origin` en toda petición cross-origin; si falta (curl,
    CLI, el runner e2e o los tests) se deja pasar: no hay una web detrás que
    pueda falsificarlo. CORS no basta: impide leer la respuesta, pero el efecto
    del POST ya ocurrió.
    """
    origen = request.headers.get("origin")
    if (
        request.method in METODOS_QUE_ESCRIBEN
        and origen is not None
        and not _origen_permitido(origen)
    ):
        return JSONResponse(status_code=403, content={"detail": "origen no permitido"})
    return await call_next(request)


@app.exception_handler(FileNotFoundError)
def _sin_fichero(_request: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(items.InvalidInput)
def _peticion_invalida(_request: Request, exc: items.InvalidInput) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(items.AlmacenMasNuevo)
def _almacen_mas_nuevo(_request: Request, exc: items.AlmacenMasNuevo) -> JSONResponse:
    """409, no 400: no es un dato mal puesto, es un almacén de otra versión.

    Starlette busca el handler por la MRO de la excepción, así que este gana al
    de `InvalidInput` aunque esté después. El mensaje pide actualizar la app.
    """
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(KeyError)
def _sin_item(_request: Request, exc: KeyError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": f"no existe el ítem {exc.args[0]}"})


@app.exception_handler(Exception)
def _error_interno(_request: Request, exc: Exception) -> JSONResponse:
    """Nada que no tengan ya su handler: queda en el registro y 500.

    La búsqueda es por clase (MRO): los 400/404/422 de arriba tienen su
    propio handler y llegan antes que este, así que aquí solo cae lo
    inesperado (un `sqlite3.Error` que no fuera el pensado, un bug)."""
    registro.escribir("error", f"Error interno no capturado: {exc}")
    return JSONResponse(status_code=500, content={"detail": "error interno"})


@app.get("/health", response_model=Health)
def health() -> dict[str, Any]:
    """Estado del core y de la BD de eventos.

    `degraded` cuando el fichero no existe todavía: es normal la primera vez,
    porque la app no lo crea. Publica además la `version` (el CLI comprueba que
    habla con el binario que espera) y la `repo` por defecto de la
    configuración compartida, que es la que ven los clientes de fuera.

    Un almacén que migró un core posterior no se publica como `ok`: esta ruta
    abre en solo lectura, así que no migra, pero nombra el caso con un 409 y el
    mismo mensaje que `ensure_repo`.
    """
    path = db_path()
    ajustes = configuracion.leer_segura()
    report: dict[str, Any] = {
        "status": "degraded",
        "version": app.version,
        "repo": str(ajustes.repo) if ajustes.repo else None,
        "db_path": str(path),
        "db_exists": path.exists(),
    }
    if not path.exists():
        return report

    with closing(open_read_only(path)) as conn:
        items.comprobar_version(conn)
        report["status"] = "ok"
        report["journal_mode"] = journal_mode(conn)
        report["data_version"] = data_version(conn)

    return report


# Las rutas por dominio, en el mismo orden que tenían en este fichero: el
# OpenAPI publica los caminos en el orden en que se registran.
app.include_router(rutas_items.router)
app.include_router(rutas_eventos.router)
app.include_router(rutas_log.router)
app.include_router(rutas_git.router)
app.include_router(rutas_arbol.router)
app.include_router(rutas_fs.router)
app.include_router(rutas_config.router)
app.include_router(rutas_migracion.router)


# La web compilada se sirve desde el mismo origen que la API. La UI llama a
# `/api/...` (en dev lo hace el proxy de Vite, que quita el prefijo): aquí se
# quita igual. El `dist` se busca en el entorno, en el checkout y en el paquete
# npm; el core congelado del desktop no tiene el checkout alrededor, así que sin
# esta última búsqueda su `/` sería un 404 aunque la web estuviera instalada.
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


def _dist_web_inicial() -> Path | None:
    """El `dist` con el que arranca el core: entorno, checkout o paquete npm."""
    fijado = os.environ.get("EUI_WEB_DIST", "").strip()
    if fijado:
        return Path(fijado)
    return _dist_web_del_checkout() or _dist_web_instalada()


DIST_WEB: Path | None = _dist_web_inicial()
WEB_STATIC: StaticFiles | None = None


def _montar_web(ruta: Path) -> None:
    """Sirve `ruta` en `/`, o cambia el `dist` si ya estaba montado.

    Se llama al arrancar (si hay `dist`) y desde `POST /webapp` cuando `eui web`
    encuentra un core ya vivo. El montaje va al final: las rutas de la API van
    antes, y el middleware de `/api` reescribe el camino antes de enrutar.
    """
    global DIST_WEB, WEB_STATIC
    DIST_WEB = ruta
    if WEB_STATIC is None:
        WEB_STATIC = StaticFiles(directory=str(ruta), html=True)
        app.mount("/", WEB_STATIC, name="web")
        return
    WEB_STATIC.directory = str(ruta)
    WEB_STATIC.all_directories = [str(ruta)]


class _WebappEntrada(BaseModel):
    dist: str


@app.post("/webapp", include_in_schema=False)
@app.post("/webapp/", include_in_schema=False)
def _montar_web_en_caliente(entrada: _WebappEntrada) -> dict[str, Any]:
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
    _montar_web(ruta)
    registro.escribir("info", f"Web montada desde {ruta}")
    return {"dist": str(ruta)}


ULTIMA_ACTIVIDAD = [time.monotonic()]


@app.middleware("http")
async def _quitar_prefijo_api(request: Request, call_next):
    ruta = request.scope["path"]
    if ruta == "/api" or ruta.startswith("/api/"):
        request.scope["path"] = ruta[len("/api") :] or "/"
    # Lo que cuenta como uso para el apagado: todo menos el sondeo de `/health`.
    if request.scope["path"] != "/health":
        ULTIMA_ACTIVIDAD[0] = time.monotonic()
    return await call_next(request)


@app.api_route(
    "/{ruta:path}",
    methods=["POST", "PUT", "PATCH", "DELETE"],
    include_in_schema=False,
)
def _ruta_inexistente(ruta: str) -> None:
    """Una ruta desconocida es 404 también con la web montada.

    `StaticFiles` en `/` solo atiende GET/HEAD; sin esto, un POST a un alias
    viejo devolvía 405 y parecía una ruta existente con otro método.
    """
    raise HTTPException(status_code=404, detail=f"No existe /{ruta}")


if DIST_WEB is not None and (DIST_WEB / "index.html").is_file():
    _montar_web(DIST_WEB)
