"""Ideas: la primera tabla del sistema, y no la de eventos.

Cada repositorio investigado es su propio almacén: lleva dentro una carpeta
`.EUI` con un SQLite llamado `EUI_DATABASE`. El fichero viaja con el repo.

El esquema no se escribe aquí: vive en `schema/ideas.sql`, que es el fichero que
se edita a mano. Este módulo solo lo aplica y hace CRUD sobre él.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import uuid
from collections.abc import Iterable, Iterator
from contextlib import closing, suppress
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from . import registro
from .db import data_version, open_read_only, vigilante

EUI_DIR = ".EUI"
# Con extensión: un SQLite sin extensión no lo reconoce ningún editor ni visor, y
# en un repo commiteado no hay forma de saber qué es. El nombre viejo, sin
# extensión, se migra solo la primera vez que se abre.
DB_FILENAME = "EUI_DATABASE.sqlite"
LEGACY_DB_FILENAME = "EUI_DATABASE"
SCHEMA_DIR = Path(__file__).with_name("schema")
# Los pasos que llevan un almacén viejo hasta aquí. `schema/` es el estado final:
# un almacén que nace hoy se crea con él y no ejecuta ninguna migración.
MIGRATIONS_DIR = Path(__file__).with_name("migraciones")
# Se aplican los `schema/*.sql` de ideas y conexiones en orden: un fichero nuevo
# no obliga a tocar este módulo. `PRAGMA user_version` dice cuál hay aplicado en
# cada almacén. La tabla `event` de `schema/eventos.sql` no entra aquí: el log
# lo escribe otro proceso y a un almacén existente llega por migración (ver
# `migraciones/0005_eventos.sql`). La tabla `ideas` pasó a `idea_entry` +
# `idea_lane_log` en la 0006, la ficha del descarte a `idea_rejected` en la
# 0007, `connections` se igualó con el esquema fresco en la 0008, la cola
# pasó a estado real y ordenable (`idea_cola`) en la 0009, el `origen` del
# evento se hizo explícito en la 0010, los protocolos de flujo llegaron
# en la 0011 (`protocolo_flujo`) y las completadas salieron del flujo en
# la 0012 (la tabla `idea_completada` queda como cimiento).
SCHEMA_VERSION = 12

REPOS_ROOT_ENV_VAR = "EVENTSUI_REPOS_ROOT"
BUSY_TIMEOUT_MS = 5_000

# La base se versiona con el repo; los auxiliares de WAL, nunca.
EUI_GITIGNORE = f"{DB_FILENAME}-wal\n{DB_FILENAME}-shm\n"
# Lo que el `.gitignore` de un almacén viejo ignora y ya no existe: se retira.
_GITIGNORE_VIEJO = {f"{LEGACY_DB_FILENAME}-wal", f"{LEGACY_DB_FILENAME}-shm"}

# Columnas que la API puede modificar. Lista blanca: los nombres de columna de un
# UPDATE no pueden venir del cliente. `status` no está: un cambio de estado no
# es un UPDATE de la entrada, es añadir o quitar filas de `idea_cola`,
# `idea_rejected` o `idea_completada`. Los campos del descarte tampoco: los
# gestiona la transición del propio `status`.
UPDATABLE = ("title", "description", "content", "kind", "tags")

# Campos del descarte que el PATCH acepta junto al `status` (ver `update_idea`).
REJECT_FIELDS = ("rejected_description", "rejected_by", "superseded_by_uid")

# El estado que enseña la fila (`status` en el contrato) se calcula a partir
# de en cuál de las tres fichas vive la idea: descarte, completada o cola, y
# en ese orden. Si no vive en ninguna, está en el cajón (`draft`, recién
# creada). La traducción vive aquí, no en la UI, porque es el significado del
# dato: la ficha del descarte puede ser `rejected` o `superseded` y la UI no
# tiene cómo saber cuál.


class InvalidInput(ValueError):
    """Petición inválida: no es un fallo del servidor, es un dato mal puesto."""


def repos_root() -> Path:
    """Raíz de los repos investigados: `EVENTSUI_REPOS_ROOT` o `repoprobe/repos`."""
    env = os.environ.get(REPOS_ROOT_ENV_VAR)
    if env:
        return Path(env).expanduser().resolve()
    # src/events_core/ideas.py -> raíz del proyecto
    return Path(__file__).resolve().parents[4] / "repoprobe" / "repos"


def resolve_repo(repo: str) -> Path:
    """Carpeta del repo a partir de lo que manda la UI.

    Dos formas, y solo dos:
    - **ruta absoluta**: la que devuelve el selector de carpetas; se usa tal cual.
    - **nombre**: un solo segmento dentro del laboratorio (`repoprobe/repos`).
      Se rechazan `..` y separadores, para que un nombre no escape de la raíz.
    """
    candidate = Path(repo).expanduser()
    if candidate.is_absolute():
        return candidate.resolve()

    name = repo.strip()
    if not name or name in {".", ".."} or "/" in name or "\\" in name:
        raise InvalidInput(f"nombre de repo inválido: {repo!r}")
    return (repos_root() / name).resolve()


def db_file_for(repo: str) -> Path:
    return resolve_repo(repo) / EUI_DIR / DB_FILENAME


def now_iso() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def connect(db_file: Path, *, create: bool = False) -> sqlite3.Connection:
    """Abre el `EUI_DATABASE` en RW.

    Aquí sí se escribe, al contrario que en el log de eventos: este fichero es
    nuestro. Si `create` es False y no existe, falla en vez de crearlo vacío.
    """
    if create:
        db_file.parent.mkdir(parents=True, exist_ok=True)
    elif not db_file.exists():
        raise FileNotFoundError(f"no existe {DB_FILENAME} en {db_file.parent}")

    conn = sqlite3.connect(db_file, timeout=BUSY_TIMEOUT_MS / 1000)
    conn.row_factory = sqlite3.Row
    conn.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_repo(repo: str) -> Path:
    """Crea `.EUI/EUI_DATABASE.sqlite` con el esquema aplicado. Idempotente.

    No crea el repo: exige que ya exista. Un nombre mal escrito no debe dejar un
    almacén vacío suelto, igual que la app no crea la BD de eventos.
    """
    directory = resolve_repo(repo)
    if not directory.is_dir():
        raise FileNotFoundError(f"no existe el repo {directory} (deja ahí su código primero)")

    db_file = directory / EUI_DIR / DB_FILENAME
    with closing(connect(db_file, create=True)) as conn:
        aplicar_esquema(conn)
        conn.commit()

    registro.escribir("info", f"Almacén sembrado en {directory}", origen="seed")
    _ignorar_auxiliares(db_file)
    return db_file


def _ignorar_auxiliares(db_file: Path) -> None:
    """Pone al día el `.gitignore` de `.EUI`.

    Escribirlo solo al crear el almacén dejaba a los repos anteriores al cambio
    de nombre con la lista vieja: su WAL —que crece a megas— aparecía como
    fichero nuevo en `git status`. Aquí se añade lo que falte y se retiran las
    líneas del nombre antiguo, sin tocar nada más que haya escrito el repo.
    """
    destino = db_file.parent / ".gitignore"
    try:
        actual = destino.read_text(encoding="utf-8")
    except OSError:
        actual = ""

    lineas = [line for line in actual.splitlines() if line.strip() not in _GITIGNORE_VIEJO]
    for nombre in EUI_GITIGNORE.split():
        if nombre not in lineas:
            lineas.append(nombre)

    nuevo = "\n".join(lineas).strip("\n") + "\n"
    if nuevo != actual:
        destino.write_text(nuevo, encoding="utf-8")


def aplicar_esquema(conn: sqlite3.Connection) -> None:
    """Aplica los `schema/*.sql` de ideas/conexiones y marca la versión.

    `schema/eventos.sql` no entra: el log lo escribe otro proceso y a un
    almacén existente llega por `migraciones/0005_eventos.sql`. Idempotente:
    todo es IF NOT EXISTS.
    """
    for script in sorted(SCHEMA_DIR.glob("*.sql")):
        if script.name == "eventos.sql":
            continue
        conn.executescript(script.read_text(encoding="utf-8"))
    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


def ensure_repo(repo: str) -> Path:
    """Devuelve el `EUI_DATABASE` del repo, sembrándolo si aún no está.

    La primera vez que se analiza una carpeta no hay `.EUI`: se crea ahí mismo en
    vez de mandar al usuario a un comando aparte. Si la carpeta no existe no se
    inventa nada: `init_repo` falla y la API responde 404.
    """
    db_file = db_file_for(repo)
    _migrar_nombre_viejo(db_file)
    if not db_file.is_file():
        return init_repo(repo)
    _migrar_esquema(db_file)
    _ignorar_auxiliares(db_file)
    return db_file


# Marca en la cabecera de una migración que reconstruye una tabla con claves
# foráneas apuntándole (ver `_aplicar_paso`).
SIN_FOREIGN_KEYS = "-- sin-foreign-keys"

# Dos peticiones a la vez no deben migrar el mismo almacén: la segunda vería la
# versión vieja y repetiría pasos que la primera está aplicando.
_ESQUEMA_LOCK = threading.RLock()


def _migrar_esquema(db_file: Path) -> None:
    """Sube al día un almacén que ya existía, paso a paso.

    Un repo viejo no vuelve a pasar por `init_repo`, así que ni una tabla nueva ni
    un `CHECK` cambiado le llegarían nunca: reaplicar `schema/*.sql` solo sirve
    para lo que es `IF NOT EXISTS`. Por eso cada cambio de esquema es un fichero
    numerado en `migraciones/`, y `user_version` dice por cuál va el almacén.

    Si ya está al día no se ejecuta ni un paso (esto corre en cada lectura).
    """
    with _ESQUEMA_LOCK, closing(connect(db_file)) as conn:
        version = int(conn.execute("PRAGMA user_version").fetchone()[0])
        if version >= SCHEMA_VERSION:
            return

        if version == 0:
            # Almacén de antes de que existiera la versión: no se sabe de dónde
            # parte, así que se le pone el esquema base de ideas/conexiones
            # (idempotente) y se marca como al día. Los pasos 3-5 ya están
            # reflejados en él, pero la tabla `event` no: el log lo escribe
            # otro proceso y no se crea desde la app. Se marca al día sin ella.
            aplicar_esquema(conn)
            conn.commit()
            return

        conn.isolation_level = None  # las transacciones las llevamos nosotros
        for numero, script in _pasos(version):
            _aplicar_paso(conn, numero, script)


def _pasos(version: int) -> list[tuple[int, Path]]:
    """Migraciones que faltan, en orden, comprobando que no hay huecos.

    El número va en el nombre (`0003_algo.sql`) y manda sobre el alfabético: así el
    orden no depende de cómo se llame el resto del fichero.
    """
    pasos: list[tuple[int, Path]] = []
    for script in MIGRATIONS_DIR.glob("*.sql"):
        cabecera = script.name.split("_", 1)[0]
        if not cabecera.isdigit():
            raise RuntimeError(f"migración sin número en el nombre: {script.name}")
        numero = int(cabecera)
        if numero <= version:
            continue
        if numero > SCHEMA_VERSION:
            raise RuntimeError(
                f"{script.name} apunta a la versión {numero} y SCHEMA_VERSION es {SCHEMA_VERSION}"
            )
        pasos.append((numero, script))

    numeros = sorted(numero for numero, _ in pasos)
    if numeros != list(range(version + 1, SCHEMA_VERSION + 1)):
        raise RuntimeError(
            f"migraciones incompletas desde la versión {version}:"
            f" hay {numeros}, se esperan {list(range(version + 1, SCHEMA_VERSION + 1))}"
        )
    return pasos


def _sentencias(sql: str) -> Iterator[str]:
    """Trocea un script por `;` sin romperse con comentarios ni literales.

    `executescript` no vale aquí: hace COMMIT de lo que hubiera abierto antes de
    empezar, y la migración entera —con su `user_version`— tiene que ser una sola
    transacción. Ojo al escribir migraciones: sin `;` dentro de los comentarios.
    """
    pendiente = ""
    for linea in sql.splitlines(keepends=True):
        pendiente += linea
        if sqlite3.complete_statement(pendiente):
            yield pendiente
            pendiente = ""


def _aplicar_paso(conn: sqlite3.Connection, numero: int, script: Path) -> None:
    """Ejecuta una migración y sube la versión en la misma transacción.

    Un paso a medias es peor que un paso sin empezar: si algo falla se deshace
    todo, incluido el `user_version`, y el almacén sigue en la versión anterior.
    Además se comprueba que no queden conexiones huérfanas.

    Un paso que reconstruye una tabla con claves foráneas apuntándole lleva
    `-- sin-foreign-keys` en la cabecera: `PRAGMA foreign_keys` se ignora dentro
    de una transacción, así que hay que apagarlo antes de abrirla o el `DROP` de
    la tabla vieja arrastra las hijas por `ON DELETE CASCADE`.
    """
    sql = script.read_text(encoding="utf-8")
    suelta_fks = SIN_FOREIGN_KEYS in sql
    if suelta_fks:
        conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            for sentencia in _sentencias(sql):
                conn.execute(sentencia)
            conn.execute(f"PRAGMA user_version = {numero}")
            huerfanas = conn.execute("PRAGMA foreign_key_check").fetchall()
            if huerfanas:
                raise RuntimeError(
                    f"la migración {numero:04d} deja {len(huerfanas)} filas huérfanas"
                )
            conn.execute("COMMIT")
        except (sqlite3.Error, RuntimeError):
            conn.execute("ROLLBACK")
            raise
    finally:
        if suelta_fks:
            conn.execute("PRAGMA foreign_keys = ON")


def _contar_ideas(db_file: Path) -> int | None:
    """Filas de la entrada en un fichero, o `None` si no se puede leer.

    La tabla se llama `idea_entry` desde la 0006; un almacén de la 0004 aún
    lleva `ideas`, así que se mira en los dos sitios (lo viejo se migra solo).
    """
    for tabla in ("idea_entry", "ideas"):
        try:
            with closing(sqlite3.connect(f"file:{db_file.as_posix()}?mode=ro", uri=True)) as conn:
                fila = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tabla,)
                ).fetchone()
                if fila:
                    return conn.execute(f"SELECT count(*) FROM {tabla}").fetchone()[0]
        except (sqlite3.Error, OSError):
            return None
    return None


def _migrar_nombre_viejo(db_file: Path) -> None:
    """Deja un solo fichero en `.EUI`: `EUI_DATABASE.sqlite`.

    - Solo el viejo (`EUI_DATABASE`, sin extensión): se renombra con sus auxiliares,
      que si se quedaran con el nombre viejo SQLite no vería (adiós al WAL).
    - Los dos: manda el canónico, y el viejo se retira **solo si está vacío**. Con
      ideas dentro no se borra nada: perder datos no es tarea de una migración.
    """
    legacy = db_file.with_name(LEGACY_DB_FILENAME)
    if not legacy.is_file():
        return

    sufijos = ("", "-wal", "-shm")
    if not db_file.is_file():
        for suffix in sufijos:
            origen = legacy.with_name(LEGACY_DB_FILENAME + suffix)
            if origen.is_file():
                origen.replace(db_file.with_name(DB_FILENAME + suffix))
        return

    if _contar_ideas(legacy) == 0:
        for suffix in sufijos:
            # Un auxiliar bloqueado por otro proceso no debe romper la lectura.
            with suppress(OSError):
                legacy.with_name(LEGACY_DB_FILENAME + suffix).unlink(missing_ok=True)


def list_repos() -> list[dict[str, Any]]:
    """Repos investigados que ya tienen un `EUI_DATABASE`."""
    root = repos_root()
    if not root.is_dir():
        return []

    found = []
    for entry in sorted(root.iterdir()):
        db_file = entry / EUI_DIR / DB_FILENAME
        if db_file.is_file():
            found.append({"repo": entry.name, "db_path": str(db_file)})
    return found


def _estado_de(rechazada: bool, completada: bool, en_cola: bool) -> str:
    """El estado de una idea a partir de en qué ficha vive (ver el comentario
    de arriba). `superseded` se lee como `rejected`, igual que antes: la
    diferencia sigue viviendo en `idea_rejected.superseded_by_uid`."""
    if rechazada:
        return "rejected"
    if completada:
        return "accepted"
    if en_cola:
        return "proposed"
    return "draft"


def _en_cola(conn: sqlite3.Connection, uid: str) -> bool:
    return conn.execute("SELECT 1 FROM idea_cola WHERE uid = ?", (uid,)).fetchone() is not None


def _completada(conn: sqlite3.Connection, uid: str) -> bool:
    return (
        conn.execute("SELECT 1 FROM idea_completada WHERE uid = ?", (uid,)).fetchone() is not None
    )


def _estado(conn: sqlite3.Connection, uid: str) -> str:
    return _estado_de(
        _rechazo(conn, uid) is not None,
        _completada(conn, uid),
        _en_cola(conn, uid),
    )


def _rechazo(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """La ficha del descarte (0007) de una idea, si la tiene."""
    return conn.execute(
        "SELECT rejected_at, rejected_description, rejected_by, superseded_by_uid"
        " FROM idea_rejected WHERE uid = ?",
        (uid,),
    ).fetchone()


def _fila(
    row: sqlite3.Row,
    en_cola: bool,
    completada: bool,
    rechazo: sqlite3.Row | None,
) -> dict[str, Any]:
    """Arma el dict de una idea con su cola, su completada y su ficha ya
    resueltas.

    Quien lista muchas ideas no llama a `_en_cola`/`_completada`/`_rechazo`
    por fila (eso era un N+1: 3 queries por idea), sino que trae los tres en
    lote con `_en_lote` y ensambla aquí.
    """
    idea = dict(row)
    idea["tags"] = json.loads(idea["tags"] or "[]")
    idea["status"] = _estado_de(rechazo is not None, completada, en_cola)
    idea["rejected_at"] = rechazo["rejected_at"] if rechazo else None
    idea["rejected_description"] = rechazo["rejected_description"] if rechazo else ""
    idea["rejected_by"] = rechazo["rejected_by"] if rechazo else "usuario"
    idea["superseded_by_uid"] = rechazo["superseded_by_uid"] if rechazo else None
    return idea


def _row(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    """Una idea suelta (get/update): tres lecturas por idea, no merece lote."""
    uid = str(row["uid"])
    return _fila(row, _en_cola(conn, uid), _completada(conn, uid), _rechazo(conn, uid))


def _en_lote(
    conn: sqlite3.Connection, uids: list[str]
) -> tuple[set[str], set[str], dict[str, sqlite3.Row]]:
    """Cola, completada y ficha de rechazo de varias ideas en tres queries."""
    if not uids:
        return set(), set(), {}
    marcas = ",".join("?" for _ in uids)
    colas = {
        str(row[0])
        for row in conn.execute(f"SELECT uid FROM idea_cola WHERE uid IN ({marcas})", uids)
    }
    completadas = {
        str(row[0])
        for row in conn.execute(f"SELECT uid FROM idea_completada WHERE uid IN ({marcas})", uids)
    }
    rechazos = {
        str(row["uid"]): row
        for row in conn.execute(
            "SELECT uid, rejected_at, rejected_description, rejected_by, superseded_by_uid"
            f" FROM idea_rejected WHERE uid IN ({marcas})",
            uids,
        )
    }
    return colas, completadas, rechazos


def _grupo(estado: str) -> str:
    """A qué grupo pertenece un estado: `superseded` y `rejected` son el mismo
    para mover (la diferencia vive en la ficha, no en el destino)."""
    return "rejected" if estado == "superseded" else estado


def _escribir_estado(
    conn: sqlite3.Connection, uid: str, estado: str, detalle: dict[str, Any]
) -> None:
    """Escribe el estado nuevo de una idea en las tablas que lo guardan.

    Un cambio de estado no es un UPDATE de la entrada: es añadir o quitar
    filas de `idea_cola` (con su posición, al final de la cola), `idea_rejected`
    o `idea_completada`. Mover a donde ya está no escribe nada; re-descartar
    con detalle nuevo sí: la ficha se actualiza (upsert de `_escribir_rechazo`).
    """
    anterior = _estado(conn, uid)
    if _grupo(estado) == _grupo(anterior) and not (
        estado in ("rejected", "superseded") and detalle
    ):
        return
    conn.execute("DELETE FROM idea_cola WHERE uid = ?", (uid,))
    conn.execute("DELETE FROM idea_completada WHERE uid = ?", (uid,))
    if estado not in ("rejected", "superseded"):
        conn.execute("DELETE FROM idea_rejected WHERE uid = ?", (uid,))
    if estado == "proposed":
        posicion = conn.execute("SELECT coalesce(max(posicion), 0) + 1 FROM idea_cola").fetchone()[
            0
        ]
        conn.execute(
            "INSERT INTO idea_cola (uid, posicion, entered_at) VALUES (?, ?, ?)",
            (uid, posicion, now_iso()),
        )
    elif estado == "accepted":
        conn.execute(
            "INSERT INTO idea_completada (uid, completed_at) VALUES (?, ?)",
            (uid, now_iso()),
        )
    elif estado in ("rejected", "superseded"):
        _escribir_rechazo(conn, uid, detalle)
    # Con `draft` basta el borrado de arriba: la idea queda en el cajón.


def _emitir(conn: sqlite3.Connection, tipo: str, payload: dict[str, Any]) -> None:
    """Añade un evento `idea.*` al log del propio almacén, en su transacción.

    El core es quien escribe ideas, así que es también quien emite sus eventos
    de ciclo de vida —esos sí los produce la app; el resto del log viene del
    productor externo. La fila viaja en la misma transacción que la idea: si
    el cambio se deshace, el evento no queda suelto. La `dedupe_key` no aplica.
    """
    # Almacén viejo sin tabla `event`: la idea sí se escribe; el evento no.
    # Solo se traga esa ausencia: otro error (disco lleno, payload roto) debe
    # notarse, no desaparecer en silencio.
    try:
        conn.execute(
            "INSERT INTO event (ts, type, payload, origen) VALUES (?, ?, ?, 'idea')",
            (now_iso(), tipo, json.dumps(payload)),
        )
    except sqlite3.OperationalError as exc:
        if "no such table" not in str(exc):
            raise


def list_ideas(
    repo: str,
    *,
    status: str | None = None,
    kind: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    with closing(connect(ensure_repo(repo))) as conn:
        filtro = ""
        if status == "draft":
            filtro = (
                " AND NOT EXISTS (SELECT 1 FROM idea_cola WHERE idea_cola.uid = idea_entry.uid)"
                " AND NOT EXISTS (SELECT 1 FROM idea_completada"
                " WHERE idea_completada.uid = idea_entry.uid)"
                " AND NOT EXISTS (SELECT 1 FROM idea_rejected"
                " WHERE idea_rejected.uid = idea_entry.uid)"
            )
        elif status == "proposed":
            filtro = " AND EXISTS (SELECT 1 FROM idea_cola WHERE idea_cola.uid = idea_entry.uid)"
        elif status == "accepted":
            filtro = (
                " AND EXISTS (SELECT 1 FROM idea_completada"
                " WHERE idea_completada.uid = idea_entry.uid)"
            )
        elif status in ("rejected", "superseded"):
            filtro = (
                " AND EXISTS (SELECT 1 FROM idea_rejected WHERE idea_rejected.uid = idea_entry.uid)"
            )
        # En cola, el orden es el de la cola; el resto, por fecha de creación.
        orden = (
            "idea_cola.posicion ASC, idea_entry.created_at ASC"
            if status == "proposed"
            else "idea_entry.created_at DESC, idea_entry.id DESC"
        )
        rows = conn.execute(
            "SELECT idea_entry.* FROM idea_entry"
            " LEFT JOIN idea_cola ON idea_cola.uid = idea_entry.uid"
            f" WHERE (:kind IS NULL OR kind = :kind){filtro}"
            f" ORDER BY {orden}"
            " LIMIT :limit OFFSET :offset",
            {"kind": kind, "limit": limit, "offset": offset},
        ).fetchall()
        colas, completadas, rechazos = _en_lote(conn, [str(r["uid"]) for r in rows])
        return [
            _fila(
                r, str(r["uid"]) in colas, str(r["uid"]) in completadas, rechazos.get(str(r["uid"]))
            )
            for r in rows
        ]


def get_idea(repo: str, uid: str) -> dict[str, Any]:
    with closing(connect(ensure_repo(repo))) as conn:
        row = conn.execute("SELECT * FROM idea_entry WHERE uid = ?", (uid,)).fetchone()
        if row is None:
            raise KeyError(uid)
        return _row(conn, row)


def create_idea(
    repo: str,
    *,
    title: str,
    description: str = "",
    content: str = "",
    kind: str = "idea",
    status: str = "draft",
    tags: Iterable[str] = (),
) -> dict[str, Any]:
    uid = uuid.uuid4().hex
    ts = now_iso()
    with closing(connect(ensure_repo(repo))) as conn:
        conn.execute(
            "INSERT INTO idea_entry"
            " (uid, title, description, content, kind, tags, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (uid, title, description, content, kind, json.dumps(list(tags)), ts, ts),
        )
        # El estado de la entrada nace con ella, en la misma transacción: con
        # `draft` no escribe nada (es el cajón); con otro, su fila de cola o
        # su ficha directamente.
        _escribir_estado(conn, uid, status, {})
        _emitir(conn, "idea.created", {"uid": uid, "title": title})
        conn.commit()
    return get_idea(repo, uid)


def _escribir_rechazo(conn: sqlite3.Connection, uid: str, detalle: dict[str, Any]) -> None:
    """La ficha del descarte, con upsert: re-descartar la misma idea no duplica."""
    conn.execute(
        "INSERT INTO idea_rejected"
        " (uid, rejected_at, rejected_description, rejected_by, superseded_by_uid)"
        " VALUES (?, ?, ?, ?, ?)"
        " ON CONFLICT(uid) DO UPDATE SET"
        "   rejected_description = excluded.rejected_description,"
        "   rejected_by = excluded.rejected_by,"
        "   superseded_by_uid = excluded.superseded_by_uid",
        (
            uid,
            now_iso(),
            detalle.get("rejected_description") or "",
            detalle.get("rejected_by") or "usuario",
            detalle.get("superseded_by_uid"),
        ),
    )


def update_idea(repo: str, uid: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Actualiza solo los campos presentes. Los `None` no se escriben."""
    clean = {k: v for k, v in changes.items() if v is not None and k in UPDATABLE}
    rechazo = {k: v for k, v in changes.items() if v is not None and k in REJECT_FIELDS}
    if not clean and not rechazo and "status" not in changes:
        raise InvalidInput("nada que actualizar")

    if "tags" in clean:
        clean["tags"] = json.dumps(list(clean["tags"]))
    clean["updated_at"] = now_iso()

    assignments = ", ".join(f"{column} = :{column}" for column in clean)
    with closing(connect(ensure_repo(repo))) as conn:
        cursor = conn.execute(
            f"UPDATE idea_entry SET {assignments} WHERE uid = :uid",
            {**clean, "uid": uid},
        )
        if cursor.rowcount == 0:
            raise KeyError(uid)
        # Un cambio de estado no es un UPDATE de la entrada: crea o retira la
        # fila de cola, de descartada o de completada. La ficha del descarte
        # entra y sale con los estados `rejected`/`superseded`.
        try:
            cambiado_estado = False
            if "status" in changes and changes["status"] is not None:
                # Reafirmar el mismo estado no es un traslado: la cola no se
                # reordena (su posición se conserva) y el evento que se emite
                # es de edición, no de cambio de estado.
                actual = _estado(conn, uid)
                cambiado_estado = actual != changes["status"]
                # Los protocolos mandan sobre el flujo: una unión no listada
                # se rechaza (400) y no escribe nada.
                if cambiado_estado and not _protocolo_ok(conn, actual, changes["status"]):
                    raise InvalidInput(
                        f"el protocolo no permite el flujo {actual} → "
                        f"{changes['status']}: esa unión no está en `protocolo_flujo`"
                    )
                _escribir_estado(conn, uid, changes["status"], rechazo)
            idea = _row(
                conn,
                conn.execute("SELECT * FROM idea_entry WHERE uid = ?", (uid,)).fetchone(),
            )
            _emitir(
                conn,
                "idea.status" if cambiado_estado else "idea.updated",
                {"uid": uid, "title": idea["title"], "status": idea["status"]},
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            # `superseded_by_uid` apunta a una idea que no existe: es un dato
            # mal puesto (400), no un fallo del servidor (500).
            raise InvalidInput("superseded_by_uid apunta a una idea que no existe") from exc
    return idea


def delete_idea(repo: str, uid: str) -> bool:
    """Borra la idea; sus conexiones se van con ella (ON DELETE CASCADE).

    El título se lee antes de borrar para que el evento `idea.deleted` tenga
    qué mostrar: después no hay fila de la que sacar nada.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        titulo_row = conn.execute("SELECT title FROM idea_entry WHERE uid = ?", (uid,)).fetchone()
        # La cola, las fichas y las conexiones se borran con la entrada (ON DELETE CASCADE).
        cursor = conn.execute("DELETE FROM idea_entry WHERE uid = ?", (uid,))
        if cursor.rowcount > 0:
            _emitir(conn, "idea.deleted", {"uid": uid, "title": titulo_row[0]})
        conn.commit()
    return cursor.rowcount > 0


def _protocolo_ok(conn: sqlite3.Connection, actual: str, nuevo: str) -> bool:
    """¿Permite el protocolo ir de `actual` a `nuevo`?

    Mismo grupo no es un traslado (la ficha de descartada se afina con
    `superseded`, el carril no cambia): pasa siempre. Entre grupos manda la
    allowlist `protocolo_flujo`: lo que no está listado se prohíbe.
    """
    if _grupo(actual) == _grupo(nuevo):
        return True
    fila = conn.execute(
        "SELECT 1 FROM protocolo_flujo WHERE origen = ? AND destino = ?",
        (_grupo(actual), _grupo(nuevo)),
    ).fetchone()
    return fila is not None


def listar_protocolos(repo: str) -> list[dict[str, Any]]:
    """Las uniones permitidas entre carriles (`protocolo_flujo`).

    La UI las lee para no ofrecer flujos prohibidos; la que impone de verdad
    es `update_idea`. Son configuración del almacén, no estado: el reinicio
    de laboratorio no las toca.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        filas = conn.execute(
            "SELECT origen, destino FROM protocolo_flujo ORDER BY origen, destino"
        ).fetchall()
    return [{"origen": fila[0], "destino": fila[1]} for fila in filas]


def list_connections(repo: str, *, parent_uid: str | None = None) -> list[dict[str, Any]]:
    """Conexiones del mapa, opcionalmente solo las que cuelgan de un padre."""
    with closing(connect(ensure_repo(repo))) as conn:
        return _list_connections(conn, parent_uid)


def _list_connections(
    conn: sqlite3.Connection, parent_uid: str | None = None
) -> list[dict[str, Any]]:
    rows = conn.execute(
        "SELECT * FROM connections"
        " WHERE (:parent IS NULL OR parent_uid = :parent)"
        " ORDER BY created_at, id",
        {"parent": parent_uid},
    )
    return [dict(row) for row in rows]


def map_snapshot(repo: str) -> dict[str, Any]:
    """Lee el mapa entero en una sola transacción de lectura."""
    with closing(open_read_only(ensure_repo(repo))) as conn:
        conn.execute("BEGIN")
        rows = conn.execute(
            "SELECT idea_entry.uid, idea_entry.title, idea_entry.description,"
            " idea_rejected.rejected_at, idea_rejected.rejected_description"
            " FROM idea_entry LEFT JOIN idea_rejected ON idea_rejected.uid = idea_entry.uid"
            " ORDER BY idea_entry.created_at DESC, idea_entry.id DESC"
        ).fetchall()
        colas, completadas, _ = _en_lote(conn, [str(row["uid"]) for row in rows])
        ideas = [
            {
                **dict(row),
                "status": _estado_de(
                    row["rejected_at"] is not None,
                    str(row["uid"]) in completadas,
                    str(row["uid"]) in colas,
                ),
                # El JOIN da `NULL` sin ficha; el contrato dice texto.
                "rejected_description": row["rejected_description"] or "",
            }
            for row in rows
        ]
        return {"ideas": ideas, "connections": _list_connections(conn)}


# Una conexión de solo lectura por almacén, no una por petición: `PRAGMA
# La conexión vigilante vive en `db.vigilante` (es la misma que usa el
# stream de eventos): `data_version` solo sube en una conexión que **ya
# existía** cuando otra escribe. La de ideas se comparte entre hilos del
# pool de uvicorn, y se serializa aquí para no mezclar lecturas.
_VIGILANTES_LOCK = threading.RLock()
# Un vigilante nuevo puede empezar por la misma versión aunque cambió el mapa.
_REVISION_INSTANCE = uuid.uuid4().hex


def _existe(conn: sqlite3.Connection, tabla: str) -> bool:
    return bool(
        conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (tabla,)
        ).fetchone()
    )


def revision(repo: str) -> dict[str, Any]:
    """Firma barata del almacén para saber si hay que releer.

    `PRAGMA data_version` cambia cuando **otra** conexión hace commit, así que la
    UI puede sondear esto cada par de segundos en vez de traerse todas las ideas.
    Los conteos van de propina: cubren el caso de un commit que no cambia la firma.
    """
    db_file = ensure_repo(repo)
    with _VIGILANTES_LOCK:
        conn = vigilante(db_file, compartida=True)
        # La tabla de entradas se llama `idea_entry` desde la 0006; antes, `ideas`.
        tabla_idea = "idea_entry" if _existe(conn, "idea_entry") else "ideas"
        return {
            "instance": _REVISION_INSTANCE,
            "data_version": data_version(conn),
            "ideas": conn.execute(f"SELECT count(*) FROM {tabla_idea}").fetchone()[0],
            "connections": conn.execute("SELECT count(*) FROM connections").fetchone()[0],
        }


def reiniciar(repo: str) -> dict[str, Any]:
    """Vacía el almacén de ideas, cola, fichas, conexiones y eventos (LAB).

    Solo lo usa el lanzador de pruebas (`puedeProbar`) para volver a un estado
    de proyecto limpio tras una prueba: no es parte del CRUD de producto. La
    estructura (tablas, `user_version`) no cambia: la misma BD, vacía.
    """
    db_file = ensure_repo(repo)

    def contar(conn: sqlite3.Connection, tabla: str) -> int:
        if not _existe(conn, tabla):
            return 0
        return conn.execute(f"SELECT count(*) FROM {tabla}").fetchone()[0]

    with closing(connect(db_file)) as conn:
        n_ideas = contar(conn, "idea_entry")
        n_conexiones = contar(conn, "connections")
        n_eventos = contar(conn, "event")
        # Borrar las entradas arrastra cola, fichas y conexiones por CASCADE;
        # los eventos no cuelgan de nada, se borran aparte.
        if n_eventos:
            conn.execute("DELETE FROM event")
        conn.execute("DELETE FROM idea_entry")
        conn.commit()
    return {
        "repo": repo,
        "ideas_eliminadas": n_ideas,
        "conexiones_eliminadas": n_conexiones,
        "eventos_eliminados": n_eventos,
    }


# Las conexiones se leen (`list_connections`) pero no se escriben por aquí:
# son arquitectura, inmutables desde la API. Las escribe el
# tooling con SQL directo.
