"""Git del repo: cambios sin commit, historial y la proyección del panel."""

from __future__ import annotations

from pydantic import BaseModel, Field


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
    items: int
    events: int
    por_estado: dict[str, int]
    ultima_actividad: str | None = None
