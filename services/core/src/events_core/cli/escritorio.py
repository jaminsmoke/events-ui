"""La descarga e instalación de la web app y el desktop.

(Parte del paquete `cli`; la fachada está en `events_core.cli`.)

`_dist_de_la_webapp` busca la dist que dejó npm, `_instalar_desktop`
baja el instalador del release y comprueba su sha256 y `_abrir`
lanza lo instalado. `_confirmar` y `_ejecutar` son los ayudantes de
consola que usan los lanzadores."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .. import config as configuracion

_SIN_CONSOLA = 0x08000000 if os.name == "nt" else 0

# Los dos clientes de Events UI. El core llega con cualquiera de ellos: si hay
# CLI es que hay core, y el cliente que falte se ofrece instalar.
PAQUETE_WEBAPP = "@jaminsmoke/events-ui-webapp"
RELEASES = "https://github.com/jaminsmoke/events-ui/releases"


def _confirmar(pregunta: str) -> bool:
    """Sí o no por consola. Sin terminal —un agente, una tubería— es que no."""
    if not sys.stdin.isatty():
        print(f"{pregunta} (sin terminal: no)", file=sys.stderr)
        return False
    try:
        return input(pregunta).strip().lower() in {"s", "si", "sí", "y", "yes"}
    except EOFError:
        return False


def _ejecutar(orden: list[str]) -> int:
    """Un proceso externo que usa nuestra consola (npm tiene que verse)."""
    import subprocess  # noqa: PLC0415

    try:
        return subprocess.call(orden, shell=os.name == "nt", creationflags=_SIN_CONSOLA)
    except OSError as error:
        print(f"No pude ejecutar {orden[0]}: {error}", file=sys.stderr)
        return 1


def _raiz_npm_global() -> Path | None:
    """`npm root -g`, o None si no hay npm instalado."""
    import subprocess  # noqa: PLC0415

    if shutil.which("npm") is None:
        return None
    try:
        salida = subprocess.run(
            ["npm", "root", "-g"],
            capture_output=True,
            text=True,
            timeout=30,
            shell=os.name == "nt",
            creationflags=_SIN_CONSOLA,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if salida.returncode != 0:
        return None
    ruta = Path(salida.stdout.strip())
    return ruta if ruta.is_dir() else None


def _dist_de_la_webapp() -> Path | None:
    """El `dist` del paquete npm de la web, si está instalado.

    Es lo único que el core no trae: el desktop publica el core, pero la web es
    su propio paquete npm. `EUI_WEBAPP_DIST` lo fija para pruebas.
    """
    fijado = os.environ.get("EUI_WEBAPP_DIST", "").strip()
    if fijado:
        return Path(fijado) if Path(fijado).is_dir() else None
    raiz = _raiz_npm_global()
    if raiz is None:
        return None
    dist = raiz / "@jaminsmoke" / "events-ui-webapp" / "dist"
    return dist if dist.is_dir() else None


def _desktop_instalado() -> Path | None:
    """El ejecutable del desktop, si está instalado en esta máquina."""
    fijado = os.environ.get("EUI_DESKTOP_EXE", "").strip()
    if fijado:
        return Path(fijado) if Path(fijado).exists() else None
    if os.name == "nt":
        candidatos = [
            Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Events UI" / "Events UI.exe",
            Path(os.environ.get("PROGRAMFILES", "")) / "Events UI" / "Events UI.exe",
        ]
    elif sys.platform == "darwin":
        candidatos = [Path("/Applications/Events UI.app")]
    else:
        candidatos = [
            Path.home() / ".local" / "bin" / "events-ui",
            Path("/usr/bin/events-ui"),
        ]
    return next((ruta for ruta in candidatos if ruta.exists()), None)


def _abrir(ruta: Path) -> None:
    """Abre un ejecutable o un documento con lo que tenga el sistema."""
    import subprocess  # noqa: PLC0415

    if os.name == "nt":
        os.startfile(str(ruta))  # type: ignore[attr-defined]  # noqa: S606
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(ruta)])  # noqa: S603
    else:
        subprocess.Popen([str(ruta)])  # noqa: S603


def _sha256_de(ruta: Path) -> str:
    """sha256 de un fichero, por bloques (los instaladores pesan)."""
    import hashlib  # noqa: PLC0415

    resumen = hashlib.sha256()
    with ruta.open("rb") as fichero:
        for bloque in iter(lambda: fichero.read(1 << 20), b""):
            resumen.update(bloque)
    return resumen.hexdigest()


def _es_sha256(texto: str) -> bool:
    return len(texto) == 64 and all(caracter in "0123456789abcdefABCDEF" for caracter in texto)


def _sha256_del_release(nombre: str, adjuntos: list[dict]) -> str | None:
    """El sha256 que publica el release para `nombre`: su `.sha256`, o el digest.

    El `.sha256` viaja como adjunto del release (lo genera el CI con
    `sha256sum`). `digest` es el que calcula GitHub al subir el activo, y vale
    como respaldo si el adjunto no está.
    """
    for adjunto in adjuntos:
        if str(adjunto.get("name", "")) != f"{nombre}.sha256":
            continue
        url = str(adjunto.get("browser_download_url", ""))
        if not url:
            break
        try:
            with urlopen(url, timeout=30) as respuesta:  # noqa: S310
                texto = respuesta.read().decode("utf-8", "replace")
        except (URLError, HTTPError, OSError) as error:
            print(f"No pude leer {nombre}.sha256: {error}", file=sys.stderr)
            break
        partes = texto.split()
        primero = partes[0] if partes else ""
        return primero.lower() if _es_sha256(primero) else None
    for adjunto in adjuntos:
        if str(adjunto.get("name", "")) != nombre:
            continue
        digest = str(adjunto.get("digest") or "")
        if digest.lower().startswith("sha256:"):
            valor = digest.split(":", 1)[1].lower()
            return valor if _es_sha256(valor) else None
    return None


def _verificar_instalador(destino: Path, nombre: str, adjuntos: list[dict]) -> bool:
    """Comprueba el sha256 del instalador antes de ejecutarlo.

    Sin hash publicado no se ejecuta: el core se baja con su `.sha256` y el
    instalador no puede ir con menos garantía que el core.
    """
    esperado = _sha256_del_release(nombre, adjuntos)
    if esperado is None:
        print(f"El release no publica el sha256 de {nombre}: no lo ejecuto.", file=sys.stderr)
        return False
    obtenido = _sha256_de(destino)
    if obtenido != esperado:
        print(
            f"El sha256 de {nombre} no coincide.\n  esperado: {esperado}\n  obtenido: {obtenido}",
            file=sys.stderr,
        )
        return False
    print(f"sha256 verificado: {obtenido}")
    return True


def _instalador_del_release() -> tuple[str, str, list[dict]] | None:
    """(nombre, url, adjuntos) del instalador de este sistema en el último release."""
    peticion = Request(
        "https://api.github.com/repos/jaminsmoke/events-ui/releases/latest",
        headers={"Accept": "application/vnd.github+json"},
    )
    try:
        with urlopen(peticion, timeout=20) as respuesta:  # noqa: S310
            datos = json.loads(respuesta.read())
    except (URLError, HTTPError, ValueError) as error:
        print(f"No pude consultar el último release: {error}", file=sys.stderr)
        return None
    if os.name == "nt":
        sufijos = ("-setup.exe", ".msi")
    elif sys.platform == "darwin":
        sufijos = (".dmg",)
    else:
        sufijos = (".appimage", ".deb")
    adjuntos = list(datos.get("assets", []))
    for adjunto in adjuntos:
        nombre = str(adjunto.get("name", ""))
        url = str(adjunto.get("browser_download_url", ""))
        if url and nombre.lower().endswith(sufijos):
            return nombre, url, adjuntos
    return None


def _instalar_desktop() -> int:
    """Baja el instalador del último release y lo lanza."""
    elegido = _instalador_del_release()
    if elegido is None:
        print(
            f"No encontré instalador para este sistema: {RELEASES}/latest",
            file=sys.stderr,
        )
        return 1
    nombre, url, adjuntos = elegido
    destino = Path(tempfile.gettempdir()) / nombre
    print(f"Descargando {nombre}…")
    try:
        with urlopen(url, timeout=300) as origen, destino.open("wb") as salida:  # noqa: S310
            shutil.copyfileobj(origen, salida)
    except (URLError, HTTPError, OSError) as error:
        print(f"No pude descargar el instalador: {error}", file=sys.stderr)
        return 1
    if not _verificar_instalador(destino, nombre, adjuntos):
        destino.unlink(missing_ok=True)
        return 1
    print(f"Instalador en {destino}")
    _abrir(destino)
    return 0


def _webapp(args: argparse.Namespace) -> int:
    """`eui --webapp`: la web en el navegador, instalándola si falta.

    El CLI viene con el core (lo trae la web app o el desktop), pero el `dist`
    de la web es su propio paquete npm: sin él no hay nada que abrir, así que
    se ofrece instalarlo y no se abre nada más.
    """
    dist = _dist_de_la_webapp()
    if dist is None:
        print(f"No tienes instalada la web app de Events UI ({PAQUETE_WEBAPP}).")
        if not _confirmar(f"¿Instalarla ahora con `npm install -g {PAQUETE_WEBAPP}`? [s/N] "):
            print(f"Cuando quieras: npm install -g {PAQUETE_WEBAPP}", file=sys.stderr)
            return 1
        if _ejecutar(["npm", "install", "-g", PAQUETE_WEBAPP]) != 0:
            print("La instalación de la web app falló.", file=sys.stderr)
            return 1
        dist = _dist_de_la_webapp()
        if dist is None:
            print(
                "Se instaló, pero no encuentro su `dist` (revisa `npm root -g`).",
                file=sys.stderr,
            )
            return 1
    # Import local: `web` usa estos helpers para el lanzador y sería un ciclo.
    from .web import _estado, _web

    os.environ["EUI_WEB_DIST"] = str(dist)
    resultado = _web(
        argparse.Namespace(port=args.port, idle_minutes=args.idle_minutes, no_open=True)
    )
    if resultado != 0:
        return resultado
    puerto = args.port or configuracion.leer_segura().port
    url = f"http://127.0.0.1:{puerto}"
    if _estado(f"{url}/") != 200:
        print(
            f"El core que ya estaba en marcha en {url} no sirve la web app\n"
            "(puede ser una versión anterior). Ciérralo y vuelve a lanzar `eui --webapp`.",
            file=sys.stderr,
        )
        return 1
    import webbrowser  # noqa: PLC0415

    webbrowser.open(url)
    return 0
