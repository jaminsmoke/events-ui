"""El ítem y sus fases: alta, edición, lectura y el resumen del mapa.

`Kind` y `Status` repiten los CHECK de `schema/items.sql` a propósito: aquí
sirven para que el contrato OpenAPI publique los enums y la UI no tenga que
adivinarlos.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Se repiten los CHECK de `schema/items.sql` a propósito: aquí sirven para que el
# contrato OpenAPI publique los enums y la UI no tenga que adivinarlos.
# Al crear y editar solo se admite `work_item`: nota/ADR no están pensados
# como tipos nuevos. Al leer sí se conservan los históricos (`adr`, `note`) y el
# `idea` que la 0036 convirtió en el almacén: vienen de antes y no pueden tumbar
# el listado ni la ficha.
Kind = Literal["work_item"]

KindLeido = Literal["work_item", "idea", "adr", "note"]

# El filtro del listado no ofrece `idea`: la 0036 ya lo convirtió en el almacén,
# así que no hay filas que consultar con ese valor. `KindLeido` lo sigue
# admitiendo para leer un almacén que aún no ha pasado por la migración.
KindFiltro = Literal["work_item", "adr", "note"]

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
    """Una fase del ítem (0021), con su propio estado y fecha de entrada."""

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


class WorkItemCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    content: str = ""
    kind: Kind = "work_item"
    status: Status = "draft"
    tags: list[str] = Field(default_factory=list)
    # Uids de ítems que tienen que estar aprobados para que este avance.
    depende_de: list[str] = Field(default_factory=list)
    # El desglose en el alta: sin él, crear con fases exige un segundo PATCH y
    # deja la ficha a medias entre las dos llamadas.
    fases: list[FaseEntrada] | None = None


class WorkItemUpdate(BaseModel):
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


class WorkItem(WorkItemCreate):
    uid: str
    # El tipo histórico se devuelve tal cual; el contrato no lo crea.
    kind: KindLeido = "work_item"
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
    # Las fases del ítem (0021), en orden y con su propio estado.
    fases: list[Fase] = Field(default_factory=list)


class WorkItemResumen(BaseModel):
    """Una fila del listado: el ítem sin su Markdown ni el desglose de fases.

    `/items` es la pantalla de una lista, no la ficha: con 500 ítems y Markdown
    absorbido cada fila arrastraba su cuerpo entero. El detalle sigue en
    `/items/{uid}` y `?incluir=contenido` devuelve el listado de antes.
    """

    uid: str
    title: str
    description: str = ""
    # El tipo histórico se lee tal cual; el contrato no lo crea.
    kind: KindLeido = "work_item"
    status: Status
    tags: list[str] = Field(default_factory=list)
    depende_de: list[str] = Field(default_factory=list)
    created_at: str
    updated_at: str
    # Contadores de la ficha: una fila sabe cuánto lleva sin traerse fases,
    # requisitos ni archivos.
    fases_hechas: int = 0
    fases_total: int = 0
    requisitos_hechos: int = 0
    requisitos_total: int = 0
    # El listado completo se valida contra `WorkItem`: que un resumen rechace los
    # campos de más es lo que distingue a los dos modelos en la unión de la
    # ruta, en vez de que uno se coma los campos del otro.
    model_config = ConfigDict(extra="forbid")


class MapWorkItem(BaseModel):
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


class MapSnapshot(BaseModel):
    # Clave del plan y del mapa. El plan viejo seguía llamándola `ideas`.
    items: list[MapWorkItem]


class Revision(BaseModel):
    """Firma del almacén para el refresco en vivo.

    `data_version` es `PRAGMA data_version` y es por conexión: un vigilante
    nuevo vuelve a empezar su cuenta. `ultimo_evento` sale del propio almacén
    (`max(id)` del log), así que un evento nuevo mueve la firma aunque no se
    toque ningún ítem.
    """

    instance: str
    data_version: int
    items: int
    ultimo_evento: int
