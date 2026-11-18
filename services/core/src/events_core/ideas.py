"""Ideas y ADRs: la primera tabla del sistema, y no la de eventos.

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

from .db import data_version, open_read_only

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
# 0007, y `connections` se igualó con el esquema fresco en la 0008.
SCHEMA_VERSION = 8

REPOS_ROOT_ENV_VAR = "EVENTSUI_REPOS_ROOT"
BUSY_TIMEOUT_MS = 5_000

# La base se versiona con el repo; los auxiliares de WAL, nunca.
EUI_GITIGNORE = f"{DB_FILENAME}-wal\n{DB_FILENAME}-shm\n"
# Lo que el `.gitignore` de un almacén viejo ignora y ya no existe: se retira.
_GITIGNORE_VIEJO = {f"{LEGACY_DB_FILENAME}-wal", f"{LEGACY_DB_FILENAME}-shm"}

# Columnas que la API puede modificar. Lista blanca: los nombres de columna de un
# UPDATE no pueden venir del cliente. `status` no está: un cambio de estado es
# una fila nueva en `idea_lane_log`, no un UPDATE de la entrada. Los campos del
# descarte tampoco: los gestiona la transición del propio `status`.
UPDATABLE = ("title", "description", "content", "kind", "tags")

# Campos del descarte que el PATCH acepta junto al `status` (ver `update_idea`).
REJECT_FIELDS = ("rejected_description", "rejected_by", "superseded_by_uid")

# El estado que enseña la fila (`status` en el contrato) es el último carril
# del log traducido a la palabra que la UI conoce. La traducción vive aquí, no
# en la UI, porque es el significado del dato: `descartadas` en el mapa puede
# ser `rejected` o `superseded` y la UI no tiene cómo saber cuál.
ESTADO_DE_CARRIL = {
    "cola": "draft",
    "descartadas": "rejected",
    "completada": "accepted",
}
# Lo inverso: qué carril de la UI escribe cada `status` de la API.
CARRIL_DE_ESTADO = {
    "draft": "cola",
    "proposed": "cola",
    "rejected": "descartadas",
    "superseded": "descartadas",
    "accepted": "completada",
}


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


def _carril_actual(conn: sqlite3.Connection, uid: str) -> str | None:
    fila = conn.execute(
        "SELECT lane FROM idea_lane_log WHERE uid = ? ORDER BY id DESC LIMIT 1", (uid,)
    ).fetchone()
    return str(fila[0]) if fila else None


def _rechazo(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """La ficha del descarte (0007) de una idea, si la tiene."""
    return conn.execute(
        "SELECT rejected_at, rejected_description, rejected_by, superseded_by_uid"
        " FROM idea_rejected WHERE uid = ?",
        (uid,),
    ).fetchone()


def _fila(row: sqlite3.Row, carril: str | None, rechazo: sqlite3.Row | None) -> dict[str, Any]:
    """Arma el dict de una idea con su carril y su ficha ya resueltos.

    Quien lista muchas ideas no llama a `_carril_actual`/`_rechazo` por fila
    (eso era un N+1: 2 queries por idea), sino que trae los dos dics en lote
    con `_carriles_actuales`/`_rechazos` y ensambla aquí.
    """
    idea = dict(row)
    idea["tags"] = json.loads(idea["tags"] or "[]")
    idea["status"] = ESTADO_DE_CARRIL.get(carril or "cola", "draft")
    idea["rejected_at"] = rechazo["rejected_at"] if rechazo else None
    idea["rejected_description"] = rechazo["rejected_description"] if rechazo else ""
    idea["rejected_by"] = rechazo["rejected_by"] if rechazo else "usuario"
    idea["superseded_by_uid"] = rechazo["superseded_by_uid"] if rechazo else None
    return idea


def _row(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    """Una idea suelta (get/update): dos lecturas por idea, no merece lote."""
    uid = str(row["uid"])
    return _fila(row, _carril_actual(conn, uid), _rechazo(conn, uid))


def _en_lote(
    conn: sqlite3.Connection, uids: list[str]
) -> tuple[dict[str, str], dict[str, sqlite3.Row]]:
    """Carril actual y ficha de rechazo de varias ideas en dos queries."""
    if not uids:
        return {}, {}
    marcas = ",".join("?" for _ in uids)
    carriles = {
        str(uid): str(lane)
        for uid, lane in conn.execute(
            "SELECT uid, lane FROM idea_lane_log WHERE id IN ("
            f"SELECT max(id) FROM idea_lane_log WHERE uid IN ({marcas}) GROUP BY uid)",
            uids,
        )
    }
    rechazos = {
        str(row["uid"]): row
        for row in conn.execute(
            "SELECT uid, rejected_at, rejected_description, rejected_by, superseded_by_uid"
            f" FROM idea_rejected WHERE uid IN ({marcas})",
            uids,
        )
    }
    return carriles, rechazos


def _escribir_carril(conn: sqlite3.Connection, uid: str, lane: str) -> None:
    """Añade un paso al log, solo si cambia: mover a donde ya está no escribe."""
    if _carril_actual(conn, uid) == lane:
        return
    conn.execute(
        "INSERT INTO idea_lane_log (uid, lane, entered_at) VALUES (?, ?, ?)",
        (uid, lane, now_iso()),
    )


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
            "INSERT INTO event (ts, type, payload) VALUES (?, ?, ?)",
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
        rows = conn.execute(
            "SELECT idea_entry.* FROM idea_entry"
            " WHERE (:status IS NULL OR ("
            "   SELECT lane FROM idea_lane_log WHERE uid = idea_entry.uid ORDER BY id DESC LIMIT 1"
            " ) = :carril)"
            "   AND (:kind IS NULL OR kind = :kind)"
            " ORDER BY created_at DESC, id DESC"
            " LIMIT :limit OFFSET :offset",
            {
                "status": status,
                "carril": CARRIL_DE_ESTADO.get(status or "", ""),
                "kind": kind,
                "limit": limit,
                "offset": offset,
            },
        ).fetchall()
        carriles, rechazos = _en_lote(conn, [str(r["uid"]) for r in rows])
        return [_fila(r, carriles.get(str(r["uid"])), rechazos.get(str(r["uid"]))) for r in rows]


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
        # La primera fila del log nace con la entrada, en su transacción.
        _escribir_carril(conn, uid, CARRIL_DE_ESTADO.get(status, "cola"))
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
        # Un cambio de estado es una fila nueva del log, no un UPDATE. La ficha
        # del descarte entra y sale con el carril `descartadas`.
        if "status" in changes and changes["status"] is not None:
            antes = _carril_actual(conn, uid)
            lane = CARRIL_DE_ESTADO[changes["status"]]
            _escribir_carril(conn, uid, lane)
            if lane == "descartadas" and (antes != "descartadas" or rechazo):
                # Entrar en descartadas crea la ficha; re-PATCHear el rechazo de
                # una idea ya descartada (con motivo nuevo) la actualiza: el
                # upsert ya vive para eso. Sin motivo nuevo también se upserta
                # al entrar, así la ficha nunca falta en `descartadas`.
                _escribir_rechazo(conn, uid, rechazo)
            elif lane != "descartadas" and antes == "descartadas":
                conn.execute("DELETE FROM idea_rejected WHERE uid = ?", (uid,))
        idea = _row(
            conn,
            conn.execute("SELECT * FROM idea_entry WHERE uid = ?", (uid,)).fetchone(),
        )
        _emitir(
            conn,
            "idea.status"
            if "status" in changes and changes["status"] is not None
            else "idea.updated",
            {"uid": uid, "title": idea["title"], "status": idea["status"]},
        )
        conn.commit()
    return idea


def delete_idea(repo: str, uid: str) -> bool:
    """Borra la idea; sus conexiones se van con ella (ON DELETE CASCADE).

    El título se lee antes de borrar para que el evento `idea.deleted` tenga
    qué mostrar: después no hay fila de la que sacar nada.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        titulo_row = conn.execute("SELECT title FROM idea_entry WHERE uid = ?", (uid,)).fetchone()
        # El log se borra por CASCADE junto con la entrada.
        cursor = conn.execute("DELETE FROM idea_entry WHERE uid = ?", (uid,))
        if cursor.rowcount > 0:
            _emitir(conn, "idea.deleted", {"uid": uid, "title": titulo_row[0]})
        conn.commit()
    return cursor.rowcount > 0


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


def delete_connection(repo: str, connection_id: int) -> bool:
    """Quita una conexión por su `id` (el que devuelve el POST).

    No borra ideas: descolgar una hija no la borra, solo deja de anidarse.
    El id viaja en la ruta (`/connections/{id}`), igual que el `uid` en
    `/ideas/{uid}`, porque dos ideas pueden estar unidas de varios modos.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        cursor = conn.execute("DELETE FROM connections WHERE id = ?", (connection_id,))
        conn.commit()
    return cursor.rowcount > 0


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
        carriles, _ = _en_lote(conn, [str(row["uid"]) for row in rows])
        ideas = [
            {
                **dict(row),
                "status": ESTADO_DE_CARRIL.get(carriles.get(str(row["uid"])) or "cola", "draft"),
                # El JOIN da `NULL` sin ficha; el contrato dice texto.
                "rejected_description": row["rejected_description"] or "",
            }
            for row in rows
        ]
        return {"ideas": ideas, "connections": _list_connections(conn)}


def create_connection(
    repo: str,
    *,
    parent_uid: str,
    child_uid: str,
    kind: str = "child",
) -> dict[str, Any]:
    """Cuelga una idea de otra.

    La FK avisa si alguna de las dos no existe y el `UNIQUE` si ya estaban
    unidas. Antes de insertar se comprueba el ciclo: `A -> B -> A` colgaría el
    mapa para siempre en cuanto se recorra.
    """
    if parent_uid == child_uid:
        raise InvalidInput("una idea no se conecta consigo misma")

    with closing(connect(ensure_repo(repo))) as conn:
        # Cierra ciclo si el hijo ya está por encima del padre: al colgar
        # `parent -> child`, el hijo se convertiría en su propio antepasado.
        if _alcanza(conn, objetivo=child_uid, desde=parent_uid):
            raise InvalidInput("esa conexión crearía un ciclo")
        try:
            cursor = conn.execute(
                "INSERT INTO connections (parent_uid, child_uid, kind, created_at)"
                " VALUES (?, ?, ?, ?)",
                (parent_uid, child_uid, kind, now_iso()),
            )
            conn.commit()
        except sqlite3.IntegrityError as exc:
            raise InvalidInput(str(exc)) from exc
        row = conn.execute("SELECT * FROM connections WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return dict(row)


# Una conexión de solo lectura por almacén, no una por petición: `PRAGMA
# data_version` solo sube en una conexión que **ya existía** cuando otra escribe.
# Abierta al vuelo devuelve siempre el valor de partida, y los UPDATE —mover una
# idea de carril— se quedaban sin despertar a la UI.
_VIGILANTES: dict[Path, sqlite3.Connection] = {}
_VIGILANTES_LOCK = threading.RLock()
# Un vigilante nuevo puede empezar por la misma versión aunque cambió el mapa.
_REVISION_INSTANCE = uuid.uuid4().hex


def _vigilante(db_file: Path) -> sqlite3.Connection:
    """Conexión reutilizada que solo lee `data_version` y los conteos."""
    with _VIGILANTES_LOCK:
        conn = _VIGILANTES.get(db_file)
        if conn is None:
            conn = sqlite3.connect(
                f"file:{db_file.as_posix()}?mode=ro",
                uri=True,
                timeout=BUSY_TIMEOUT_MS / 1000,
                check_same_thread=False,
            )
            conn.row_factory = sqlite3.Row
            _VIGILANTES[db_file] = conn
        return conn


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
        conn = _vigilante(db_file)
        # La tabla de entradas se llama `idea_entry` desde la 0006; antes, `ideas`.
        tabla_idea = "idea_entry" if _existe(conn, "idea_entry") else "ideas"
        return {
            "instance": _REVISION_INSTANCE,
            "data_version": data_version(conn),
            "ideas": conn.execute(f"SELECT count(*) FROM {tabla_idea}").fetchone()[0],
            "connections": conn.execute("SELECT count(*) FROM connections").fetchone()[0],
        }


def _alcanza(conn: sqlite3.Connection, objetivo: str, desde: str) -> bool:
    """¿`objetivo` está por encima de `desde`? Entonces la arista cierra un ciclo."""
    vistos: set[str] = set()
    pila = [desde]
    while pila:
        actual = pila.pop()
        if actual in vistos:
            continue
        vistos.add(actual)
        for (padre,) in conn.execute(
            "SELECT parent_uid FROM connections WHERE child_uid = ?", (actual,)
        ):
            if padre == objetivo:
                return True
            pila.append(padre)
    return False
