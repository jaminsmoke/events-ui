"""El contrato de la API: modelos y tipos que comparten las rutas.

Los `Literal` repiten los CHECK del esquema a propósito: OpenAPI publica los
enums y la UI no tiene que adivinarlos.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import Query
from pydantic import BaseModel, Field

# Se repiten los CHECK de `schema/ideas.sql` a propÃ³sito: aquÃ­ sirven para que el
# contrato OpenAPI publique los enums y la UI no tenga que adivinarlos.
# Al crear y editar solo se admite la idea: nota/ADR no estÃ¡n pensados como
# tipos nuevos. Al leer sÃ­ se conservan los histÃ³ricos (`adr`, `note`): vienen
# de almacenes anteriores y no pueden tumbar el listado ni la ficha.
Kind = Literal["idea"]
KindLeido = Literal["idea", "adr", "note"]
Status = Literal[
    "draft",
    "proposed",
    "roadmap",
    "verificacion",
    "revision_aprobada",
    "historial",
    "rejected",
    "superseded",
]

# El estado de una fase (0021): su vida no es la del carril, pero se lee igual.
FaseEstado = Literal["pendiente", "completada", "fallida", "rechazada"]


class ArchivoFase(BaseModel):
    """Un archivo que cambió durante una fase o un requisito (0028, 0029).

    `estado` es el cambio entre las dos fotos del árbol; `renombrado` es un
    archivo que se movió, y `desde` dice de dónde. `contenido` es el parche de
    Git (o el texto del archivo nuevo); `None` cuando no hay Git, no hay
    commits o el contenido no cabe: la ruta y el estado ya informan.
    """

    ruta: str
    estado: Literal["nuevo", "modificado", "borrado", "renombrado"]
    desde: str | None = None
    contenido: str | None = None


class Requisito(BaseModel):
    """Un requisito de una fase (0025): su criterio de hecho, binario."""

    orden: int = Field(ge=1)
    titulo: str = Field(min_length=1)
    hecho: bool = False
    done_at: str | None = None
    # Los archivos que cambiaron mientras se hizo (0029); vacío si se marcó
    # junto a otros o si lo cerró la fase.
    archivos: list[ArchivoFase] = Field(default_factory=list)


class RequisitoEntrada(BaseModel):
    """Un requisito en el PATCH; sin `orden`, se añade al final.

    Si la fase no trae `requisitos`, se conservan los que tenía; una lista
    vacía los retira.
    """

    orden: int | None = Field(default=None, ge=1)
    titulo: str = Field(min_length=1)
    hecho: bool = False


class Fase(BaseModel):
    """Una fase de la idea (0021), con su propio estado y fecha de entrada."""

    orden: int = Field(ge=1)
    titulo: str = Field(min_length=1)
    estado: FaseEstado = "pendiente"
    nota: str = ""
    entered_at: str
    # Sus requisitos (0025), en orden.
    requisitos: list[Requisito] = Field(default_factory=list)
    # Los archivos que tocó al cerrarse (0028); vacío mientras está pendiente.
    archivos: list[ArchivoFase] = Field(default_factory=list)


class FaseEntrada(BaseModel):
    """Una fase en el PATCH: `entered_at` lo pone el core (y se conserva si el
    estado no cambia). Sin `orden`, se añade al final."""

    orden: int | None = Field(default=None, ge=1)
    titulo: str = Field(min_length=1)
    estado: FaseEstado = "pendiente"
    nota: str = ""
    requisitos: list[RequisitoEntrada] | None = None


class IdeaCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    content: str = ""
    kind: Kind = "idea"
    status: Status = "draft"
    tags: list[str] = Field(default_factory=list)
    # Uids de ideas que tienen que estar aprobadas para que esta avance.
    depende_de: list[str] = Field(default_factory=list)


class IdeaUpdate(BaseModel):
    """Campos ausentes no se tocan; `null` explícito tampoco los borra.

    Los del descarte viajan junto al `status: rejected`/`superseded`: el
    motivo y quién lo dictamina se guardan en `rejected_node` al entrar en
    `descartadas`. Los de roadmap, verificación y revisión aprobada viajan
    igual junto a su `status` y se guardan en su detalle.
    """

    title: str | None = Field(default=None, min_length=1)
    description: str | None = None
    content: str | None = None
    kind: Kind | None = None
    status: Status | None = None
    tags: list[str] | None = None
    depende_de: list[str] | None = None
    rejected_description: str | None = None
    rejected_by: Literal["usuario", "agente", "sistema"] | None = None
    superseded_by_uid: str | None = None
    roadmap_resultado: str | None = None
    roadmap_referencia: str | None = None
    verificacion_resultado: str | None = None
    verificacion_comentario: str | None = None
    approved_by: Literal["usuario", "agente", "sistema"] | None = None
    revision_nota: str | None = None
    # Reemplazo atómico de las fases: la lista que llega es la que queda.
    fases: list[FaseEntrada] | None = None


class Idea(IdeaCreate):
    uid: str
    # El tipo histórico se devuelve tal cual; el contrato no lo crea.
    kind: KindLeido = "idea"
    created_at: str
    updated_at: str
    # Las fichas de roadmap, verificación y revisión aprobada (0013): sin
    # ficha, sus campos quedan en su valor neutro.
    roadmap_started_at: str | None = None
    roadmap_completed_at: str | None = None
    roadmap_resultado: str = ""
    roadmap_referencia: str = ""
    verificacion_started_at: str | None = None
    verificacion_intentos: int = 0
    verificacion_ultimo_resultado: str = ""
    verificacion_comentario: str = ""
    revision_approved_at: str | None = None
    revision_approved_by: Literal["usuario", "agente", "sistema"] = "usuario"
    revision_nota: str = ""
    # La ficha del descarte (0007), o el estado sin ficha si no está descartada.
    rejected_at: str | None = None
    rejected_description: str = ""
    rejected_by: Literal["usuario", "agente", "sistema"] = "usuario"
    superseded_by_uid: str | None = None
    # Las fases de la idea (0021), en orden y con su propio estado.
    fases: list[Fase] = Field(default_factory=list)


class MapIdea(BaseModel):
    uid: str
    title: str
    description: str
    status: Status
    # Las dependencias viajan al mapa para que la fila enseñe a quién espera
    # (solo uids: los títulos los resuelve la UI con el resto del mapa).
    depende_de: list[str] = Field(default_factory=list)
    # La ficha del descarte en el mapa, para que la fila la enseñe.
    rejected_at: str | None = None
    rejected_description: str = ""
    # Las fases viajan al mapa para el contador de la fila (x/y).
    fases: list[Fase] = Field(default_factory=list)


class Protocolo(BaseModel):
    """Una unión permitida por el protocolo de flujo (`protocolo_flujo`).

    Los grupos son los carriles que se mueven (`superseded` comparte grupo con
    `rejected`: la ficha lo distingue, el carril no), así que no aparecen
    como origen ni destino propios.
    """

    origen: Literal[
        "draft",
        "proposed",
        "roadmap",
        "verificacion",
        "revision_aprobada",
        "rejected",
    ]
    destino: Literal[
        "draft",
        "proposed",
        "roadmap",
        "verificacion",
        "revision_aprobada",
        "rejected",
    ]
    # ¿Pide esta unión al menos una fase? (0021). La UI lo usa para no ofrecer
    # un traslado que el core va a rechazar. Desde la 0024 también al aprobar.
    exige_fases: bool = False
    # ¿Exige que no queden fases pendientes ni fallidas? (0022).
    exige_fases_listas: bool = False
    # ¿Exige que todas estén completadas? (0023): rechazada no vale.
    exige_fases_completas: bool = False


class MapSnapshot(BaseModel):
    ideas: list[MapIdea]


class Revision(BaseModel):
    """Firma del almacén para el refresco en vivo (`PRAGMA data_version`)."""

    instance: str
    data_version: int
    ideas: int


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
    # De dónde viene (0010): `idea`, `externo` o la tabla futura que lo sea.
    origen: str = "externo"
    # Derivado del tipo (o del `payload.nivel`): colorear igual que el registro.
    nivel: Literal["info", "aviso", "error"] = "info"
    dedupe_key: str | None = None


class CambioGit(BaseModel):
    """Un archivo con cambios sin commit, en el formato de `git status`.

    `origen` solo llega en renombrados y copias: dice de dónde salió el
    archivo, sin la flecha que Git mete en la ruta.
    """

    estado: str
    ruta: str
    origen: str | None = None


class ProyeccionRepo(BaseModel):
    """F2: el estado del repo en una lectura, con su identidad.

    No es SQL libre desde la UI: es una proyección
    fija y versionada. `repo` es la carpeta resuelta. `git` dice si esa carpeta
    pertenece a un work tree Git —también con un `git init` sin commits— y
    `git_root` es la raíz de ese work tree. `branch`/`commit` son `None` si no
    hay Git; el commit también falta mientras el repo no tenga ninguno.
    """

    repo: str
    laboratorio: bool
    git: bool
    git_root: str | None = None
    branch: str | None = None
    commit: str | None = None
    git_cambios: list[CambioGit] = []
    ideas: int
    events: int
    por_estado: dict[str, int]
    ultima_actividad: str | None = None


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
    ideas_eliminadas: int
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


# El repo viaja como query param y no como segmento de la URL: el selector de
# carpetas devuelve rutas absolutas de Windows (`C:\...`), que no son un segmento
# válido de ruta. Aceptan ruta absoluta o nombre dentro del laboratorio.
RepoParam = Annotated[str, Query(description="Carpeta del repo: ruta absoluta o nombre en el lab")]
