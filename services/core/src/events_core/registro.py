"""Registro operativo de la app: qué pasó en las últimas ejecuciones.

No es el log de eventos del repo (`event`, que escribe otro proceso y aquí
solo se lee), ni el historial de items: es el registro de la aplicación —
arranques del core, errores no capturados y operaciones de laboratorio— para
verse en la UI y depurar.

Vive en su propio SQLite (`data/registro.sqlite` en la raíz del repo,
`EVENTSUI_REGISTRO_DB` para cambiarlo): el estado operativo no es estado del
repo y no viaja con él. La ruta no depende del directorio desde el que se
arranca el core, para que dos arranques vean el mismo historial. Los
escritores son solo el propio core; la UI lo lee por `/log`.

Purga: automática, dos barridos como `eventos.compactar` —antigüedad (90
días) y conteo (las 2000 entradas más recientes)—, pero no en cada línea: una
de cada `CADA_PURGA` escrituras o cada `PURGA_CADA_S` segundos. Si hace falta
forzarla, `POST /log/purgar`.
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from contextlib import closing
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .db import barridos_retencion

REGISTRO_ENV_VAR = "EVENTSUI_REGISTRO_DB"


def _raiz_del_repo() -> Path:
    """La raíz del repo aunque se arranque desde otro directorio.

    `src/events_core/registro.py` está a cuatro niveles de la raíz. El marcador
    `services/core` evita confundirla con el temporal donde PyInstaller
    descomprime el paquete: allí no se reconoce y el estado va al directorio de
    datos del usuario (`%LOCALAPPDATA%/EventsUI`), no al de trabajo.
    """
    padres = Path(__file__).resolve().parents
    if len(padres) > 4 and (padres[4] / "services" / "core").is_dir():
        return padres[4]
    return raiz_datos_usuario()


def raiz_datos_usuario() -> Path:
    """Dónde dejar el estado cuando no hay raíz de proyecto (sidecar congelado).

    El binario instalado no reconoce `services/core` y su directorio de trabajo
    es el que herede del lanzador (un acceso directo puede dejarlo en
    `System32`): no sirve para guardar el registro. Se usa el directorio de
    datos del usuario, que existe y es escribible en cualquier instalación.
    """
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("XDG_STATE_HOME")
    if base:
        return Path(base) / "EventsUI"
    return Path.home() / ".eventsui"


RAIZ_PROYECTO = _raiz_del_repo()
DEFAULT_REGISTRO_PATH = RAIZ_PROYECTO / "data" / "registro.sqlite"

BUSY_TIMEOUT_MS = 5_000
# La retención de este registro: tres meses y dos mil entradas.
DIAS_RETENCION = 90
MAX_ENTRADAS = 2_000
# La purga no se paga en cada línea: una de cada `CADA_PURGA` escrituras o
# cuando han pasado `PURGA_CADA_S` segundos desde la anterior. Con este tamaño
# de tabla, un barrido cada 100 líneas (o cada 10 minutos) es ruido.
CADA_PURGA = 100
PURGA_CADA_S = 600.0


def ruta() -> Path:
    """Ruta del SQLite de registro: el override o `data/` en la raíz del repo."""
    env = os.environ.get(REGISTRO_ENV_VAR)
    if env:
        return Path(env).expanduser().resolve()
    return DEFAULT_REGISTRO_PATH


# Ficheros cuyo esquema ya se preparó en este proceso. Antes, cada línea
# escrita pagaba su `CREATE TABLE/INDEX IF NOT EXISTS`; con la tabla hecha basta.
_PREPARADOS: set[Path] = set()
_PREPARADOS_LOCK = threading.Lock()

# Escrituras desde la última purga y cuándo fue, por fichero: la cuenta es de
# este proceso, no del disco, así que dos core con registros distintos no se
# pisan.
_PENDIENTES: dict[Path, tuple[int, float]] = {}
_PENDIENTES_LOCK = threading.Lock()


def _toca_purgar(destino: Path) -> bool:
    """¿Le toca ya a este fichero? Cuenta la escritura y decide.

    La primera línea no purga: un registro recién abierto no tiene nada que
    llevarse y el barrido de edad no tiene índice.
    """
    ahora = time.monotonic()
    with _PENDIENTES_LOCK:
        escrituras, ultima = _PENDIENTES.get(destino, (0, ahora))
        escrituras += 1
        if escrituras < CADA_PURGA and ahora - ultima < PURGA_CADA_S:
            _PENDIENTES[destino] = (escrituras, ultima)
            return False
        _PENDIENTES[destino] = (0, ahora)
        return True


def _olvidar_purga(destino: Path) -> None:
    """Reinicia la cuenta: purga forzada o fichero recreado."""
    with _PENDIENTES_LOCK:
        _PENDIENTES[destino] = (0, time.monotonic())


def _preparar(conn: sqlite3.Connection) -> None:
    """Crea la tabla del registro y su índice; idempotente."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS registro ("
        " id INTEGER PRIMARY KEY,"
        " ts TEXT NOT NULL,"
        # ISO-8601 UTC con segundos, como `items.now_iso`.
        " nivel TEXT NOT NULL CHECK (nivel IN ('info', 'aviso', 'error')),"
        " origen TEXT NOT NULL DEFAULT 'core',"
        " mensaje TEXT NOT NULL"
        ")"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_registro_id ON registro (id)")
    # Si esta conexión solo iba a leer, el DDL no puede quedar en el aire: sin
    # commit, cerrar desharía la creación y la marca diría que ya estaba.
    conn.commit()


def _preparado(conn: sqlite3.Connection, destino: Path) -> None:
    """Prepara el fichero una vez por proceso (dos hilos no se pisan)."""
    with _PREPARADOS_LOCK:
        if destino in _PREPARADOS:
            return
        _preparar(conn)
        _PREPARADOS.add(destino)


def _olvidar(destino: Path) -> None:
    """Deja de dar por preparado un fichero (p. ej. si lo recrearon)."""
    with _PREPARADOS_LOCK:
        _PREPARADOS.discard(destino)
    _olvidar_purga(destino)


def conectar() -> sqlite3.Connection:
    """Abre (creándolo si falta) el SQLite del registro, ya con la tabla."""
    destino = ruta()
    destino.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(destino, timeout=BUSY_TIMEOUT_MS / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    _preparado(conn, destino)
    return conn


def _ahora() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def _anotar(conn: sqlite3.Connection, destino: Path, nivel: str, mensaje: str, origen: str) -> None:
    conn.execute(
        "INSERT INTO registro (ts, nivel, origen, mensaje) VALUES (?, ?, ?, ?)",
        (_ahora(), nivel, origen, mensaje),
    )
    if _toca_purgar(destino):
        barridos_retencion(conn, tabla="registro", dias=DIAS_RETENCION, maximo=MAX_ENTRADAS)
    conn.commit()


def escribir(nivel: str, mensaje: str, origen: str = "core") -> None:
    """Añade una entrada al registro (y purga lo que sobre).

    Semilla blanda, a propósito: escribir un log no debe tumbar la app. Si el
    disco está lleno o el fichero no se puede abrir, se pierde la línea de
    registro y nada más —como `_emitir` con la tabla `event` ausente. La tabla
    se prepara una vez por proceso; si el fichero se recreó por debajo, se
    olvida la marca y se reintenta una vez.
    """
    destino = ruta()
    try:
        with closing(conectar()) as conn:
            _anotar(conn, destino, nivel, mensaje, origen)
    except sqlite3.Error as exc:
        if "no such table" not in str(exc):
            return
        _olvidar(destino)
        try:
            with closing(conectar()) as conn:
                _anotar(conn, destino, nivel, mensaje, origen)
        except sqlite3.Error:
            pass


def purgar(dias: int = DIAS_RETENCION, max_entradas: int = MAX_ENTRADAS) -> dict[str, Any]:
    """Aplica la retención ahora y dice qué se fue.

    `dias` y `max_entradas` tienen que ser al menos 1, igual que en
    `eventos.compactar` (lo guarda `db.barridos_retencion` y lanza
    `ValueError`): con 0 o negativo el primer barrido se llevaría el
    registro entero.
    """
    try:
        with closing(conectar()) as conn:
            por_edad, por_conteo = barridos_retencion(
                conn, tabla="registro", dias=dias, maximo=max_entradas
            )
            conn.commit()
    except sqlite3.Error:
        por_edad, por_conteo = 0, 0
    # Una purga forzada también reinicia la cuenta: la siguiente escritura no
    # vuelve a barrer por haber llegado justo al umbral.
    _olvidar_purga(ruta())
    return {
        "por_edad": por_edad,
        "por_conteo": por_conteo,
    }


def listar(
    limite: int = 200,
    nivel: str | None = None,
    origen: str | None = None,
) -> list[dict[str, Any]]:
    """Las últimas entradas (la más nueva primero), opcionalmente por nivel y
    por etiqueta (`origen`: `core`, `seed`, `reiniciar`, `compactar`…)."""
    try:
        with closing(conectar()) as conn:
            filas = conn.execute(
                "SELECT id, ts, nivel, origen, mensaje FROM registro"
                " WHERE (:nivel IS NULL OR nivel = :nivel)"
                " AND (:origen IS NULL OR origen = :origen)"
                " ORDER BY id DESC LIMIT :limite",
                {"nivel": nivel, "origen": origen, "limite": limite},
            ).fetchall()
    except sqlite3.Error:
        return []
    return [dict(fila) for fila in filas]
