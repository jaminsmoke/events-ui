"""Servicio core: lectura del log de eventos y API de ideas/ADR.

La app no produce eventos (ver `docs/0001-arquitectura.md`): otros procesos
escriben el log y este servicio lo expone a la UI. `/health` además prueba el
mecanismo de tiempo real (`PRAGMA data_version`).

Lo de aquí abajo es lo de `docs/0002-ideas-y-repoprobe.md`: CRUD de ideas sobre
el `EUI_DATABASE` que vive dentro de cada repositorio investigado. Sin ORM a
propósito: el SQL está en `schema/ideas.sql` y el de las consultas, a la vista.
FastAPI publica el contrato en `/openapi.json` (Swagger en `/docs`), de ahí
saldrán los tipos TS del cliente.
"""

from __future__ import annotations

from contextlib import closing
from typing import Annotated, Any, Literal

from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from . import eventos, ideas, proyeccion
from .db import data_version, db_path, journal_mode, open_read_only

# Se repiten los CHECK de `schema/ideas.sql` a propósito: aquí sirven para que el
# contrato OpenAPI publique los enums y la UI no tenga que adivinarlos.
Kind = Literal["idea", "adr", "note"]
Status = Literal["draft", "proposed", "accepted", "rejected", "superseded"]

app = FastAPI(title="Events UI Core", version="0.0.0")

# En dev la UI llega por el proxy de Vite. En producción Tauri sirve la UI desde
# su propio origen, que varía según plataforma.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # desktop (Vite)
        "http://localhost:5174",  # web (Vite)
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    expose_headers=["Last-Event-ID"],
    allow_headers=["content-type"],
)


class IdeaCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    content: str = ""
    kind: Kind = "idea"
    status: Status = "draft"
    tags: list[str] = Field(default_factory=list)


class IdeaUpdate(BaseModel):
    """Campos ausentes no se tocan; `null` explícito tampoco los borra."""

    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    content: str | None = None
    kind: Kind | None = None
    status: Status | None = None
    tags: list[str] | None = None


class Idea(IdeaCreate):
    uid: str
    created_at: str
    updated_at: str


class ConnectionCreate(BaseModel):
    parent_uid: str = Field(min_length=1)
    child_uid: str = Field(min_length=1)
    kind: Literal["child", "related", "supersedes"] = "child"


class Connection(ConnectionCreate):
    id: int
    created_at: str


class MapIdea(BaseModel):
    uid: str
    title: str
    description: str
    status: Status


class MapSnapshot(BaseModel):
    ideas: list[MapIdea]
    connections: list[Connection]


class Revision(BaseModel):
    """Firma del almacén para el refresco en vivo (`PRAGMA data_version`)."""

    instance: str
    data_version: int
    ideas: int
    connections: int


class Repo(BaseModel):
    """Una carpeta del laboratorio ya sembrada, tal como la ofrece `GET /repos`."""

    repo: str
    db_path: str


class Evento(BaseModel):
    """El sobre del evento (F1): lo estable; `payload` es JSON libre."""

    id: int
    ts: str
    type: str
    payload: dict | str
    dedupe_key: str | None = None


class ProyeccionRepo(BaseModel):
    """F2: el estado del repo en una lectura, con su identidad.

    No es SQL libre desde la UI (ADR 0001, decisión 8): es una proyección
    fija y versionada. `repo` es la carpeta resuelta; `branch`/`commit` vienen
    de git cuando hay repo git y son `None` si no.
    """

    repo: str
    branch: str | None = None
    commit: str | None = None
    ideas: int
    connections: int
    events: int
    por_estado: dict[str, int]
    ultima_actividad: str | None = None


class ErrorDetail(BaseModel):
    """Lo que devuelven los exception handlers de abajo: `{"detail": ...}`.

    Declarado a propósito: sin esto, el OpenAPI solo publicaba el 200 y el
    422 de validación, y el cliente TS tenía que adivinar (con un cast) que
    el 400/404 trae `detail` como texto.
    """

    detail: str


# Errores que cualquier endpoint con `repo` puede devolver: nombre inválido
# (400, `InvalidInput`) o carpeta/idea que no existe (404). Se declaran en
# cada decorador para que el cliente generado los tipé.
RESPUESTAS_ERROR = {
    400: {"model": ErrorDetail, "description": "Petición inválida"},
    404: {"model": ErrorDetail, "description": "No existe el repo o la idea"},
}


class Health(BaseModel):
    """Respuesta de `/health`: `journal_mode`/`data_version` solo si hay BD."""

    status: Literal["ok", "degraded"]
    db_path: str
    db_exists: bool
    journal_mode: str | None = None
    data_version: int | None = None


@app.exception_handler(FileNotFoundError)
def _sin_fichero(_request: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(ideas.InvalidInput)
def _peticion_invalida(_request: Request, exc: ideas.InvalidInput) -> JSONResponse:
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(KeyError)
def _sin_idea(_request: Request, exc: KeyError) -> JSONResponse:
    que = "conexión" if isinstance(exc.args[0], int) else "idea"
    return JSONResponse(status_code=404, content={"detail": f"no existe la {que} {exc.args[0]}"})


@app.get("/health", response_model=Health)
def health() -> dict[str, Any]:
    """Estado del core y de la BD de eventos.

    `degraded` cuando el fichero no existe todavía: es normal la primera vez,
    porque la app no lo crea.
    """
    path = db_path()
    report: dict[str, Any] = {
        "status": "degraded",
        "db_path": str(path),
        "db_exists": path.exists(),
    }
    if not path.exists():
        return report

    with closing(open_read_only(path)) as conn:
        report["status"] = "ok"
        report["journal_mode"] = journal_mode(conn)
        report["data_version"] = data_version(conn)

    return report


@app.get("/repos", response_model=list[Repo], tags=["ideas"])
def get_repos() -> list[dict[str, Any]]:
    """Repos investigados que ya tienen `.EUI/EUI_DATABASE.sqlite`."""
    return ideas.list_repos()


# El repo viaja como query param y no como segmento de la URL: el selector de
# carpetas devuelve rutas absolutas de Windows (`C:\...`), que no son un segmento
# válido de ruta. Aceptan ruta absoluta o nombre dentro del laboratorio.
RepoParam = Annotated[str, Query(description="Carpeta del repo: ruta absoluta o nombre en el lab")]


@app.get("/ideas", response_model=list[Idea], tags=["ideas"], responses=RESPUESTAS_ERROR)
def get_ideas(
    repo: RepoParam,
    status: Status | None = None,
    kind: Kind | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    return ideas.list_ideas(repo, status=status, kind=kind, limit=limit, offset=offset)


@app.post(
    "/ideas", response_model=Idea, status_code=201, tags=["ideas"], responses=RESPUESTAS_ERROR
)
def post_idea(body: IdeaCreate, repo: RepoParam) -> dict[str, Any]:
    return ideas.create_idea(repo, **body.model_dump())


@app.get("/ideas/{uid}", response_model=Idea, tags=["ideas"], responses=RESPUESTAS_ERROR)
def get_idea(uid: str, repo: RepoParam) -> dict[str, Any]:
    return ideas.get_idea(repo, uid)


@app.patch("/ideas/{uid}", response_model=Idea, tags=["ideas"], responses=RESPUESTAS_ERROR)
def patch_idea(uid: str, body: IdeaUpdate, repo: RepoParam) -> dict[str, Any]:
    return ideas.update_idea(repo, uid, body.model_dump(exclude_unset=True))


@app.delete("/ideas/{uid}", status_code=204, tags=["ideas"], responses=RESPUESTAS_ERROR)
def remove_idea(uid: str, repo: RepoParam) -> None:
    if not ideas.delete_idea(repo, uid):
        raise KeyError(uid)


@app.get(
    "/connections",
    response_model=list[Connection],
    tags=["connections"],
    responses=RESPUESTAS_ERROR,
)
def get_connections(
    repo: RepoParam,
    parent_uid: Annotated[
        str | None, Query(description="Solo las que cuelgan de esta idea")
    ] = None,
) -> list[dict[str, Any]]:
    return ideas.list_connections(repo, parent_uid=parent_uid)


@app.post(
    "/connections",
    response_model=Connection,
    status_code=201,
    tags=["connections"],
    responses=RESPUESTAS_ERROR,
)
def post_connection(body: ConnectionCreate, repo: RepoParam) -> dict[str, Any]:
    return ideas.create_connection(repo, **body.model_dump())


@app.delete(
    "/connections/{connection_id}",
    status_code=204,
    tags=["connections"],
    responses={
        **RESPUESTAS_ERROR,
        404: {"model": ErrorDetail, "description": "No existe la conexión"},
    },
)
def remove_connection(connection_id: int, repo: RepoParam) -> None:
    if not ideas.delete_connection(repo, connection_id):
        raise KeyError(connection_id)


@app.get("/mapa", response_model=MapSnapshot, tags=["connections"], responses=RESPUESTAS_ERROR)
def get_map(repo: RepoParam) -> dict[str, Any]:
    """Ideas y conexiones tal como estaban en la misma lectura de SQLite."""
    return ideas.map_snapshot(repo)


@app.get("/revision", response_model=Revision, tags=["connections"], responses=RESPUESTAS_ERROR)
def get_revision(repo: RepoParam) -> dict[str, Any]:
    """Sondeo de cambio: la UI lo pide cada par de segundos, sin traerse el mapa."""
    return ideas.revision(repo)


# --- Eventos del log externo (F1) ---
#
# Sobre abierto: `type` libre y `payload` JSON libre. La UI usa renderers por
# tipo con fallback genérico. Sin fichero no hay eventos: no se crea el log.


@app.get("/eventos", response_model=list[Evento], tags=["eventos"], responses=RESPUESTAS_ERROR)
def get_eventos(
    repo: RepoParam,
    desde: Annotated[int, Query(ge=0, description="Cursor: solo eventos con id mayor")] = 0,
    limite: Annotated[int, Query(ge=1, le=1000)] = eventos.LIMITE_POR_DEFECTO,
) -> list[dict[str, Any]]:
    """Tail por cursor: backfill histórico con `id > desde`."""
    return eventos.tail(repo, desde, limite)


@app.get("/eventos/stream", tags=["eventos"], responses=RESPUESTAS_ERROR)
def stream_eventos(request: Request, repo: RepoParam) -> StreamingResponse:
    """SSE en vivo: primero el backfill hasta el último y luego lo que llegue.

    Sin `Last-Event-ID` se empieza desde el principio (backfill histórico);
    con él, se reanuda tras ese id —el mismo cursor del tail, sin huecos.
    """
    ultimo = request.headers.get("last-event-id")
    desde = int(ultimo) if ultimo and ultimo.isdigit() else 0
    return StreamingResponse(
        eventos.generar_streamo(repo, desde),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# --- F2: proyecciones con nombre, sin SQL libre ---


@app.get("/proyecciones/repo", response_model=ProyeccionRepo, tags=["f2"], responses=RESPUESTAS_ERROR)
def get_proyeccion_repo(repo: RepoParam) -> dict[str, Any]:
    """Primera proyección: estado del repo con su identidad (rama/commit)."""
    return proyeccion.repo_estado_actual(repo)
