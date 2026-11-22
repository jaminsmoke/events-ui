"""Configuración compartida de la app y sus clientes (CLI, MCP).

La raíz elegida vivía solo en `localStorage` (`eui.repo`) y el puerto, en una
constante por proceso; un proceso de fuera no podía encontrar ni una ni otro.
Aquí viven los dos en un fichero pequeño y con ruta estable, en los datos del
usuario y no en el repo (el estado operativo no viaja con el proyecto):

    %LOCALAPPDATA%/EventsUI/config.json      (Windows)
    $XDG_CONFIG_HOME/events-ui/config.json   (Linux/macOS)

`EVENTSUI_CONFIG` cambia la ruta (los tests y el e2e usan un temporal). La UI lo
escribe al abrir una carpeta (`PUT /config`), el core lo lee para decir en
`/health` con qué raíz se trabaja y el CLI lo lee para saber a quién preguntar.
JSON porque son dos claves y no hace falta un escritor TOML.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .ideas.base.comun import InvalidInput
from .ideas.base.rutas import resolve_repo
from .registro import raiz_datos_usuario

CONFIG_ENV_VAR = "EVENTSUI_CONFIG"
PUERTO_POR_DEFECTO = 18765
FICHERO = "config.json"


class ConfigInvalida(ValueError):
    """El fichero existe pero no se puede usar (JSON roto o valores raros)."""


@dataclass(frozen=True)
class Config:
    """Lo compartido: la raíz por defecto (absoluta) y el puerto del core."""

    repo: Path | None = None
    port: int = PUERTO_POR_DEFECTO

    def como_dict(self) -> dict[str, Any]:
        """La forma del contrato: `repo` en texto, que es lo que ve un agente."""
        return {"repo": str(self.repo) if self.repo else None, "port": self.port}


class _SinCambios:
    """Marca la clave que no se toca en `guardar`."""


SIN_CAMBIOS = _SinCambios()


def ruta() -> Path:
    """Dónde vive el fichero: el override o los datos del usuario."""
    env = os.environ.get(CONFIG_ENV_VAR)
    if env:
        return Path(env).expanduser().resolve()
    return raiz_datos_usuario() / FICHERO


def leer() -> Config:
    """Lee la configuración; sin fichero, los valores por defecto.

    Lanza `ConfigInvalida` si existe y no se puede interpretar: un fichero roto
    es un problema que `doctor` debe enseñar, no algo que se ignore en silencio.
    """
    destino = ruta()
    try:
        texto = destino.read_text(encoding="utf-8")
    except FileNotFoundError:
        return Config()
    except OSError as exc:
        raise ConfigInvalida(f"no se pudo leer {destino}: {exc}") from exc

    try:
        bruto = json.loads(texto)
    except json.JSONDecodeError as exc:
        raise ConfigInvalida(f"{destino} no es JSON válido: {exc}") from exc
    if not isinstance(bruto, dict):
        raise ConfigInvalida(f"{destino} no es un objeto JSON")

    repo = _repo_de(bruto.get("repo"), destino)
    puerto = bruto.get("port", PUERTO_POR_DEFECTO)
    if isinstance(puerto, bool) or not isinstance(puerto, int) or not 1 <= puerto <= 65535:
        raise ConfigInvalida(f"{destino}: `port` tiene que ser un puerto (1–65535)")
    return Config(repo=repo, port=puerto)


def _repo_de(valor: object, destino: Path) -> Path | None:
    """La raíz guardada, resuelta como la resolvería cualquier petición."""
    if valor is None:
        return None
    if not isinstance(valor, str) or not valor.strip():
        raise ConfigInvalida(f"{destino}: `repo` tiene que ser una ruta o null")
    try:
        return resolve_repo(valor)
    except InvalidInput as exc:
        raise ConfigInvalida(f"{destino}: {exc}") from exc


def leer_segura() -> Config:
    """La configuración que se puede usar: por defecto ante un fichero roto.

    `/health` no puede caerse porque alguien editara `config.json` a mano;
    `doctor` sí quiere ver el problema, así que usa `leer`.
    """
    try:
        return leer()
    except ConfigInvalida:
        return Config()


def guardar(
    *,
    repo: str | None | _SinCambios = SIN_CAMBIOS,
    port: int | _SinCambios = SIN_CAMBIOS,
) -> Config:
    """Cambia lo indicado y deja el resto como estaba.

    Escribe en un temporal y lo reemplaza: la UI y el CLI pueden guardar a la
    vez y ninguno deja un fichero a medias. `repo=None` lo limpia; un nombre de
    una sola carpeta del laboratorio se resuelve a ruta absoluta, como en la
    API, para que el valor guardado signifique lo mismo para todos.
    """
    actual = leer_segura()

    nuevo_repo = actual.repo
    if not isinstance(repo, _SinCambios):
        nuevo_repo = resolve_repo(repo) if repo else None

    nuevo_puerto = actual.port
    if not isinstance(port, _SinCambios):
        if isinstance(port, bool) or not isinstance(port, int) or not 1 <= port <= 65535:
            raise InvalidInput(f"puerto inválido: {port!r}")
        nuevo_puerto = port

    destino = ruta()
    destino.parent.mkdir(parents=True, exist_ok=True)
    temporal = destino.with_name(destino.name + ".tmp")
    datos = {"repo": str(nuevo_repo) if nuevo_repo else None, "port": nuevo_puerto}
    temporal.write_text(json.dumps(datos, indent=2) + "\n", encoding="utf-8")
    os.replace(temporal, destino)
    return Config(repo=nuevo_repo, port=nuevo_puerto)
