"""El contrato de la API: modelos y tipos que comparten las rutas.

Los `Literal` repiten los CHECK del esquema a propósito: OpenAPI publica los
enums y la UI no tiene que adivinarlos.
"""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import Query
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

# Se repiten los CHECK de `schema/items.sql` a propÃ³sito: aquÃ­ sirven para que el
# contrato OpenAPI publique los enums y la UI no tenga que adivinarlos.
# Al crear y editar solo se admite `work_item`: nota/ADR no están pensados
# como tipos nuevos. Al leer sí se conservan los históricos (`adr`, `note`) y el
# `idea` que la 0036 convirtió en el almacén: vienen de antes y no pueden tumbar
# el listado ni la ficha.
Kind = Literal["work_item"]
KindLeido = Literal["work_item", "idea", "adr", "note"]
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
    # Clave del plan y del mapa: dato histórico, se queda `ideas`.
    ideas: list[MapWorkItem]


class Revision(BaseModel):
    """Firma del almacén para el refresco en vivo.

    `data_version` es `PRAGMA data_version` y es por conexión: un vigilante
    nuevo vuelve a empezar su cuenta. `ultimo_evento` sale del propio almacén
    (`max(id)` del log), así que un evento nuevo mueve la firma aunque no se
    toque ningún ítem.
    """

    instance: str
    data_version: int
    ideas: int
    ultimo_evento: int


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
    # De dónde viene (0010): `item`, `externo` o la tabla futura que lo sea.
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


class CommitGit(BaseModel):
    """Un commit del historial de la rama, resumido para el Mapa de Git.

    `hash` es el abreviado que enseña Git: basta para identificar el commit y
    cabe en la fila. `fecha` es la de autoría en ISO 8601; la UI la acorta al
    pintarla.
    """

    hash: str
    asunto: str
    autor: str
    fecha: str


class CommitPeticion(BaseModel):
    """Lo que hace falta para commitear desde el panel: solo el mensaje.

    No hay `add` selectivo ni remoto: se commitea todo lo que `git status`
    ve, y push queda fuera hasta que exista la integración con remoto. El
    límite es el de un asunto de commit; un cuerpo largo no lo pide el mapa.
    """

    mensaje: str = Field(min_length=1, max_length=200)


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
    # `None` sin Git. `True` si el repo ya ignora `.EUI`; `False` si el binario
    # entraría en el próximo commit.
    eui_ignorado: bool | None = None
    ideas: int
    events: int
    por_estado: dict[str, int]
    ultima_actividad: str | None = None


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


class PlanIdea(BaseModel):
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
    ideas: list[PlanIdea] = Field(min_length=1)
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
    ideas: int
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


class ErrorDetail(BaseModel):
    """Lo que devuelven los exception handlers de abajo: `{"detail": ...}`.

    Declarado a propósito: sin esto, el OpenAPI solo publicaba el 200 y el
    422 de validación, y el cliente TS tenía que adivinar (con un cast) que
    el 400/404 trae `detail` como texto.
    """

    detail: str


# Errores que cualquier endpoint con `repo` puede devolver: nombre inválido
# (400, `InvalidInput`) o carpeta/item que no existe (404). Se declaran en
# cada decorador para que el cliente generado los tipé.
RESPUESTAS_ERROR = {
    400: {"model": ErrorDetail, "description": "Petición inválida"},
    404: {"model": ErrorDetail, "description": "No existe el repo o el ítem"},
}


class Config(BaseModel):
    """Configuración compartida con los clientes de fuera (CLI, MCP).

    `repo` es la raíz por defecto ya resuelta (absoluta) y `port`, dónde escucha
    el core: con esos dos datos un proceso de fuera sabe a quién preguntar y
    sobre qué carpeta, sin leer el `localStorage` del webview.
    """

    repo: str | None = None
    port: int = Field(default=18765, ge=1, le=65535)


class ConfigEntrada(BaseModel):
    """Cambios de configuración: la clave ausente no se toca; `null` limpia."""

    repo: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)


class Health(BaseModel):
    """Respuesta de `/health`: `journal_mode`/`data_version` solo si hay BD."""

    status: Literal["ok", "degraded"]
    # La versión del core: el CLI compara la suya antes de fiarse del resto.
    version: str
    # La raíz por defecto que comparte la configuración; `None` si no hay.
    repo: str | None = None
    db_path: str
    db_exists: bool
    journal_mode: str | None = None
    data_version: int | None = None


# El repo viaja como query param y no como segmento de la URL: el selector de
# carpetas devuelve rutas absolutas de Windows (`C:\...`), que no son un segmento
# válido de ruta. Aceptan ruta absoluta o nombre dentro del laboratorio.
RepoParam = Annotated[str, Query(description="Carpeta del repo: ruta absoluta o nombre en el lab")]
