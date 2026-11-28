"""La migración de Markdown: plan, lote aplicado y los informes del scan."""

from __future__ import annotations

from typing import Literal

from pydantic import AliasChoices, BaseModel, Field, field_validator, model_validator


class PlanOrigen(BaseModel):
    """De dónde sale un ítem del plan: el Markdown del scan."""

    ruta: str = Field(min_length=1, pattern=r"^[^\\]+$")
    desde_linea: int = Field(ge=1)
    hasta_linea: int = Field(ge=1)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


class PlanRequisito(BaseModel):
    """Un requisito de una fase migrada: nace sin marcar."""

    titulo: str = Field(min_length=1)
    hecho: Literal[False] = False


class PlanFase(BaseModel):
    """Una fase del plan: entra pendiente y con al menos un requisito."""

    titulo: str = Field(min_length=1)
    nota: str = ""
    estado: Literal["pendiente"] = "pendiente"
    requisitos: list[PlanRequisito] = Field(min_length=1)


class PlanWorkItem(BaseModel):
    """Un ítem propuesto: `ref` es local al plan, no un uid del almacén."""

    ref: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
    title: str = Field(min_length=1)
    description: str = ""
    content: str = ""
    kind: Literal["work_item", "idea"] = "work_item"
    status: Literal["proposed", "draft", "historial", "rejected"] = "proposed"
    # Solo para historial/rejected; sin ella se usa la fecha de importación.
    fecha: str | None = None
    # Solo para rejected: el porqué del descarte.
    motivo: str | None = None
    tags: list[str] = Field(default_factory=list)
    depende_de: list[str] = Field(default_factory=list)
    fases: list[PlanFase] = Field(default_factory=list)
    origen: PlanOrigen

    @field_validator("kind", mode="after")
    @classmethod
    def _tipo_del_almacen(cls, valor: str) -> str:
        """Los planes v1-v3 escriben `idea`; el almacén guarda `work_item`."""
        return "work_item"


class PlanRango(BaseModel):
    """Un tramo 1-based de un documento parcial."""

    desde: int = Field(ge=1)
    hasta: int = Field(ge=1)


class PlanDocumento(BaseModel):
    """Clasificación de un Markdown del plan: allowlist o referencia."""

    ruta: str = Field(min_length=1, pattern=r"^[^\\]+$")
    clase: Literal["mapa", "referencia", "parcial"]
    motivo: str = Field(min_length=1)
    destino: Literal["mapa", "referencia"]
    rangos: list[PlanRango] | None = None


class PlanMigracion(BaseModel):
    """El plan completo que se aplica como un lote.

    La versión 2 añade destinos, fechas y motivo; la 3 el manifiesto
    `documentos` (allowlist del mapa). La 1 se conserva para los planes que
    solo crean items en `proposed`.
    """

    version: Literal[1, 2, 3]
    # Los planes v1-v3 guardados escriben `ideas`; el plan nuevo escribe `items`.
    items: list[PlanWorkItem] = Field(min_length=1, validation_alias=AliasChoices("items", "ideas"))
    documentos: list[PlanDocumento] | None = None

    @model_validator(mode="after")
    def _documentos_segun_version(self) -> PlanMigracion:
        if self.version == 3:
            if not self.documentos:
                raise ValueError("la versión 3 exige el manifiesto documentos")
        elif self.documentos is not None:
            raise ValueError("documentos solo vale con version 3")
        return self


class MigracionCreada(BaseModel):
    """Una item creada por el lote: su `ref` del plan y el `uid` que recibió."""

    ref: str
    uid: str


class MigracionAplicada(BaseModel):
    """Respuesta de `POST /migracion/aplicar`.

    `repetido` avisa de que la misma huella ya tenía lote: no se creó nada y
    `creadas` repite lo del primer apply.
    """

    repo: str
    lote: str
    plan_sha256: str
    repetido: bool
    items: int
    creadas: list[MigracionCreada] = Field(default_factory=list)


class MigracionDeshecha(BaseModel):
    """Respuesta de `DELETE /migracion/lotes/{lote}`.

    `ausentes` son los ítems que ya no estaban (el usuario las borró a mano);
    el resto se borró y el lote desaparece.
    """

    repo: str
    lote: str
    plan_sha256: str
    borradas: int
    ausentes: int


class DocumentoAbsorbido(BaseModel):
    """Un documento cuyo Markdown ya solo vive en Events UI.

    `copia` es la copia de seguridad dentro de `.EUI/migracion/<lote>/`; el
    visor no la lee, pero sirve para saber dónde está el original restaurable.
    """

    ruta: str
    lote: str
    absorbido_at: str
    items: int
    copia: str | None = None


class DocumentoMarkdown(BaseModel):
    """La vista Markdown generada desde los ítems de un documento absorbido."""

    ruta: str
    texto: str


class Tareas(BaseModel):
    """Lo que el scan cuenta de las casillas de un Markdown."""

    total: int
    hechas: int


class Titulo(BaseModel):
    """Un título ATX, con su nivel y su línea (1-based)."""

    nivel: int
    texto: str
    linea: int


class FichaLegible(BaseModel):
    """Un Markdown que el scan pudo leer."""

    ruta: str
    bytes: int
    # El plan lo guarda como origen: es lo que hace idempotente el apply.
    sha256: str
    lineas: int
    frontmatter: dict[str, str] | None
    titulos: list[Titulo]
    secciones: int
    tareas: Tareas


class FichaError(BaseModel):
    """Un Markdown que no se pudo leer: se anota y el scan sigue."""

    ruta: str
    error: str


# Las dos formas de una ficha del scan: legible o con su error.
FichaScan = FichaLegible | FichaError


class ResumenScan(BaseModel):
    archivos: int
    secciones: int
    tareas: int


class InformeScan(BaseModel):
    """`eui migrate scan --json`: qué Markdown hay bajo la ruta y qué se reconoce."""

    repo: str
    ruta: str
    archivos: list[FichaScan]
    resumen: ResumenScan
    recortado: bool


class DocumentoPropuesto(BaseModel):
    """Una entrada del manifiesto que propone `classify`, sin escribir nada."""

    ruta: str
    clase: str
    motivo: str
    destino: str


class ResumenClasificacion(BaseModel):
    documentos: int
    mapa: int
    referencia: int


class InformeClasificacion(BaseModel):
    """`eui migrate classify --json`: el manifiesto propuesto a partir del scan."""

    repo: str
    ruta: str
    documentos: list[DocumentoPropuesto]
    resumen: ResumenClasificacion
    recortado: bool


class CreacionPlan(BaseModel):
    """Lo que `migrate check` dice que crearía de un ítem del plan."""

    ref: str
    title: str
    status: str
    origen: PlanOrigen


class DocumentoPlan(BaseModel):
    ruta: str
    clase: str
    destino: str


class ResumenRevision(BaseModel):
    items: int
    archivos: int
    refs: int


class InformeRevision(BaseModel):
    """`eui migrate check --json`: si el plan entra y qué haría."""

    ok: bool
    repo: str
    plan: str
    crear: list[CreacionPlan]
    documentos: list[DocumentoPlan]
    errores: list[str]
    resumen: ResumenRevision
