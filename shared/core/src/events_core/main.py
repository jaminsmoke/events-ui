"""Servicio core: lectura del log de eventos y API de items.

La app no produce eventos: otros procesos escriben el log y este servicio lo
expone a la UI. `/health` además prueba el mecanismo de tiempo real
(`PRAGMA data_version`).

Lo de aquí abajo: CRUD de items sobre el `EUI_DATABASE` que vive en la raíz del
repo abierto. Sin ORM a propósito: el SQL está en `schema/items.sql` y el de las
consultas, a la vista. FastAPI publica el contrato en `/openapi.json` (Swagger
en `/docs`), de ahí saldrán los tipos TS del cliente.

Este módulo solo compone: la app, sus handlers, las rutas y el montaje inicial
de la web. Los middlewares (origen, `/api` e inactividad) viven en
`middleware.py`, y el `dist` de la web con su `POST /webapp` en `webapp.py`.
"""

from __future__ import annotations

from contextlib import closing
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from . import __version__, items, middleware, registro, webapp
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

app = FastAPI(title="Events UI Core", version=__version__)

middleware.instalar(app)


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

# La web instalada, antes del 404 comodín y del montaje: `POST /webapp` es una
# ruta más de la API (oculta del OpenAPI).
app.include_router(webapp.router)


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


# Última pieza: la web en `/`, solo si hay un `dist` al arrancar. El montaje va
# detrás de todo para no tapar la API.
webapp.montar_al_arrancar(app)
