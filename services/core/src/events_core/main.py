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
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import ideas
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
        "http://localhost:5173",
        "tauri://localhost",
        "http://tauri.localhost",
    ],
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
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


@app.exception_handler(FileNotFoundError)
def _sin_fichero(_request: Request, exc: FileNotFoundError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(KeyError)
def _sin_idea(_request: Request, exc: KeyError) -> JSONResponse:
    return JSONResponse(status_code=404, content={"detail": f"no existe la idea {exc.args[0]}"})


@app.get("/health")
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


@app.get("/repos", tags=["ideas"])
def get_repos() -> list[dict[str, Any]]:
    """Repos investigados que ya tienen `.EUI/EUI_DATABASE`."""
    return ideas.list_repos()


@app.get("/repos/{repo}/ideas", response_model=list[Idea], tags=["ideas"])
def get_ideas(
    repo: str,
    status: Status | None = None,
    kind: Kind | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[dict[str, Any]]:
    return ideas.list_ideas(repo, status=status, kind=kind, limit=limit, offset=offset)


@app.post("/repos/{repo}/ideas", response_model=Idea, status_code=201, tags=["ideas"])
def post_idea(repo: str, body: IdeaCreate) -> dict[str, Any]:
    return ideas.create_idea(repo, **body.model_dump())


@app.get("/repos/{repo}/ideas/{uid}", response_model=Idea, tags=["ideas"])
def get_idea(repo: str, uid: str) -> dict[str, Any]:
    return ideas.get_idea(repo, uid)


@app.patch("/repos/{repo}/ideas/{uid}", response_model=Idea, tags=["ideas"])
def patch_idea(repo: str, uid: str, body: IdeaUpdate) -> dict[str, Any]:
    return ideas.update_idea(repo, uid, body.model_dump(exclude_unset=True))


@app.delete("/repos/{repo}/ideas/{uid}", status_code=204, tags=["ideas"])
def remove_idea(repo: str, uid: str) -> None:
    if not ideas.delete_idea(repo, uid):
        raise KeyError(uid)
