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
from .db import data_version, open_read_only, uri_lectura, vigilante

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
# Se aplican los `schema/*.sql` de ideas y log en orden: un fichero
# nuevo no obliga a tocar este módulo. `PRAGMA user_version` dice cuál hay
# aplicado en cada almacén. La tabla `event` del repo se siembra con él porque
# el core emite ahí sus `idea.*`; a los almacenes anteriores les llegó por la
# 0005 y la 0015. La tabla `ideas` pasó a `idea_entry` +
# `idea_lane_log` en la 0006, la ficha del descarte a `idea_rejected` en la
# 0007, `connections` se igualó con el esquema fresco en la 0008, la cola
# pasó a estado real y ordenable (`idea_cola`) en la 0009, el `origen` del
# evento se hizo explícito en la 0010, los protocolos de flujo llegaron
# en la 0011 (`protocolo_flujo`), las completadas salieron del flujo en
# la 0012, el flujo completo (roadmap, verificación y revisión aprobada)
# llegó en la 0013, la 0014 llevó los intentos de verificación a la entrada
# para que sobrevivan a la ficha, la 0015 sembró la tabla `event` en los
# almacenes que nacieron sin log, la 0016 puso en triggers la exclusividad de
# fichas y el roadmap único, para todos los escritores, y la 0017 endureció
# `tags` a lista JSON de cadenas, la 0018 añadió `depende_de` (las ideas que
# tienen que estar aprobadas para que esta avance de carril) y la 0019 retiró
# `connections`: la dependencia vive en la entrada y la jerarquía del mapa es
# el propio flujo. La 0020 separa la idea (`idea_data`) de su sitio
# (`idea_node`, una fila por idea): el estado y la posición dejan de deducirse
# de las fichas y las fichas pasan a ser detalle de la estancia. La 0021
# descompone la idea en fases (`idea_fase`) y hace que el protocolo pueda
# exigirlas para cruzar una unión (`exige_fases`). La 0022 añade el otro
# requisito del protocolo: no salir de un carril con fases abiertas
# (`exige_fases_listas`).
SCHEMA_VERSION = 22

REPOS_ROOT_ENV_VAR = "EVENTSUI_REPOS_ROOT"
BUSY_TIMEOUT_MS = 5_000

# La base se versiona con el repo; los auxiliares de WAL, nunca.
EUI_GITIGNORE = f"{DB_FILENAME}-wal\n{DB_FILENAME}-shm\n"
# Lo que el `.gitignore` de un almacén viejo ignora y ya no existe: se retira.
_GITIGNORE_VIEJO = {f"{LEGACY_DB_FILENAME}-wal", f"{LEGACY_DB_FILENAME}-shm"}

# Columnas que la API puede modificar. Lista blanca: los nombres de columna de un
# UPDATE no pueden venir del cliente. `status` no está: un cambio de estado no
# es un UPDATE de la idea, es mover la fila de `idea_node` y escribir el detalle
# del nodo (`roadmap_node`, `verificacion_node`, `revision_node` o
# `rejected_node`). Los campos del descarte tampoco: los gestiona la transición
# del propio `status`.
UPDATABLE = ("title", "description", "content", "kind", "tags", "depende_de")

# Campos del descarte que el PATCH acepta junto al `status` (ver `update_idea`).
REJECT_FIELDS = ("rejected_description", "rejected_by", "superseded_by_uid")

# Campos propios de cada estado nuevo que el PATCH acepta junto al `status`:
# el resultado de roadmap, los datos de la verificación y la firma final.
STATE_FIELDS = (
    "roadmap_resultado",
    "roadmap_referencia",
    "verificacion_resultado",
    "verificacion_comentario",
    "approved_by",
    "revision_nota",
)

# Qué campos de ficha valen en cada estado (sin `status`, se aplican a la
# ficha activa; con `status`, a la ficha destino). Fuera de ahí, un campo de
# ficha es incompatible y se rechaza en vez de perderse en silencio.
CAMPOS_FICHA = {
    "roadmap": {"roadmap_resultado", "roadmap_referencia"},
    "verificacion": {"verificacion_resultado", "verificacion_comentario"},
    "revision_aprobada": {"approved_by", "revision_nota"},
}

# Estados de una fase (0021). La fase pertenece a la idea, no a la estancia:
# sobrevive al paso por verificación y a la vuelta a la cola.
FASE_ESTADOS = ("pendiente", "completada", "fallida", "rechazada")


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
    """Crea o pone al día `.EUI/EUI_DATABASE.sqlite`. Idempotente.

    Si el almacén ya existe no basta con aplicar `schema/*.sql`: eso solo
    crea lo que falta (`IF NOT EXISTS`) y deja las filas de una versión vieja
    en la tabla antigua. Un almacén existente se migra por número, igual que
    al abrirlo desde la app. Un nombre mal escrito no crea un repo: exige que
    ya exista, como la app no crea la BD de eventos.
    """
    directory = resolve_repo(repo)
    if not directory.is_dir():
        raise FileNotFoundError(f"no existe el repo {directory} (deja ahí su código primero)")

    db_file = directory / EUI_DIR / DB_FILENAME
    if db_file.is_file():
        _migrar_esquema(db_file)
    else:
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
    """Aplica los `schema/*.sql` de ideas y log, y marca la versión.

    El log entra aquí porque el core emite sus `idea.*` en él: un almacén
    recién sembrado que naciera sin `event` perdería justo los primeros.
    Idempotente: todo es IF NOT EXISTS.
    """
    for script in sorted(SCHEMA_DIR.glob("*.sql")):
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
        # Un almacén firmado por el `core:seed` anterior no pasó por la
        # migración 0013: `aplicar_esquema` marcó la versión sin copiar
        # `idea_completada` ni ampliar los protocolos. Si ese esquema
        # incompleto sigue ahí, hay que terminar la 0013 antes de seguir, no
        # fiarse del número. Un almacén migrado de verdad no tiene
        # `idea_completada` y su `protocolo_flujo` ya acepta los carriles
        # nuevos.
        #
        # `_aplicar_paso` firma el paso que aplica: si el almacén ya estaba
        # por encima (un esquema fresco marcado sin terminar la 0013), se
        # devuelve su versión para no repetir los pasos que ya tiene.
        if version >= 13 and _esquema_0013_incompleto(conn):
            conn.isolation_level = None
            _aplicar_paso(conn, 13, MIGRATIONS_DIR / "0013_estado_completo.sql")
            conn.execute(f"PRAGMA user_version = {version}")

        # Un «v18» firmado por `aplicar_esquema` sobre un almacén viejo no
        # tiene `depende_de`: la columna la añade la 0018, que se salta por ir
        # ya en esa versión. Se aplica aquí, como la 0013, en vez de fiarse
        # del número.
        if (
            version >= 18
            and _existe(conn, "idea_entry")
            and not _columna(conn, "idea_entry", "depende_de")
        ):
            conn.isolation_level = None
            _aplicar_paso(conn, 18, MIGRATIONS_DIR / "0018_dependencias.sql")
            conn.execute(f"PRAGMA user_version = {version}")

        if version >= SCHEMA_VERSION:
            if _existe(conn, "ideas"):
                _copiar_ideas_historicas(conn)
            return

        if version == 0:
            # Almacén de antes de que existiera la versión: no se sabe de dónde
            # parte, así que se le pone el esquema base de ideas/conexiones
            # (idempotente) y se marca como al día. Los pasos 3-5 ya están
            # reflejados en él, pero la tabla `event` no: el log lo escribe
            # otro proceso y no se crea desde la app.
            #
            # Si además trae la tabla histórica `ideas`, su contenido no está
            # en el esquema fresco: hay que copiarlo antes de marcar al día.
            aplicar_esquema(conn)
            conn.commit()
            if _existe(conn, "ideas"):
                _copiar_ideas_historicas(conn)
            return

        conn.isolation_level = None  # las transacciones las llevamos nosotros
        for numero, script in _pasos(version):
            _aplicar_paso(conn, numero, script)


def _esquema_0013_incompleto(conn: sqlite3.Connection) -> bool:
    """¿El almacén quedó sin terminar la migración 0013?

    La prueba no es «faltan filas»: un repo puede haber retirado un protocolo
    a propósito. Es el esquema: la migración 0013 retira `idea_completada`
    y reconstruye `protocolo_flujo` para aceptar los carriles nuevos. Si la
    tabla vieja sigue viva o el CHECK aún no contiene esos carriles, el
    número 13 se firmó sin migrar (típicamente, con el `core:seed` anterior).
    """
    if _existe(conn, "idea_completada"):
        return True
    fila = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'protocolo_flujo'"
    ).fetchone()
    if fila is None:
        return True
    definicion = fila[0] or ""
    carriles = ("roadmap", "verificacion", "revision_aprobada")
    return any(carril not in definicion for carril in carriles)


def _copiar_ideas_historicas(conn: sqlite3.Connection) -> None:
    """Pasa la tabla antigua `ideas` al esquema actual, si sigue viva.

    Es el caso del almacén anterior a `user_version`: el esquema fresco crea
    `idea_entry` pero no mueve las filas que ya había en `ideas`. Aquí se
    copia la identidad (`uid` incluido), el estado viejo va a su ficha
    actual (`proposed` -> cola, `accepted` -> revisión aprobada,
    `rejected`/`superseded` -> descartada) y `connections` se retira (0019). Si el fichero
    ya quedó marcado como v13 por abrirlo sin esto, la misma copia lo
    recupera al siguiente `ensure_repo`.
    """
    if not _existe(conn, "ideas"):
        return

    conn.isolation_level = None
    conn.execute("PRAGMA foreign_keys = OFF")
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            conn.execute(
                """
                INSERT OR IGNORE INTO idea_data
                    (id, uid, title, description, content, kind, tags, created_at, updated_at)
                SELECT id, uid, title, description, content, kind,
                       CASE WHEN json_valid(tags) AND json_type(tags) = 'array'
                            THEN tags ELSE '[]' END,
                       created_at, updated_at
                FROM ideas
                """
            )
            # Una fila histórica que no entra (p. ej. un `kind` que el
            # esquema actual ya no admite) no puede perderse en silencio.
            faltan = conn.execute(
                "SELECT uid FROM ideas WHERE uid NOT IN (SELECT uid FROM idea_data)"
            ).fetchall()
            if faltan:
                raise RuntimeError(
                    "no se pudieron migrar las ideas históricas "
                    f"{', '.join(str(f[0]) for f in faltan)}"
                )

            # El nodo de cada idea vieja: la cola conserva su orden y el resto
            # entra donde su estado decía. `entered_at` es su `updated_at`, que
            # es la fecha de entrada más cercana que hay en la tabla histórica.
            conn.execute(
                """
                INSERT OR IGNORE INTO idea_node (uid, estado, posicion, entered_at)
                SELECT uid,
                       CASE
                           WHEN status = 'accepted' THEN 'revision_aprobada'
                           WHEN status IN ('rejected', 'superseded') THEN 'rejected'
                           WHEN status = 'proposed' THEN 'proposed'
                           ELSE 'draft'
                       END,
                       CASE WHEN status = 'proposed'
                            THEN (SELECT COALESCE(MAX(posicion), 0) FROM idea_node)
                                 + ROW_NUMBER() OVER (ORDER BY created_at, id)
                            ELSE NULL END,
                       updated_at
                FROM ideas
                WHERE uid IN (SELECT uid FROM idea_data)
                """
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO revision_node (uid)
                SELECT uid FROM ideas WHERE status = 'accepted'
                """
            )
            conn.execute(
                """
                INSERT OR IGNORE INTO rejected_node (uid)
                SELECT uid FROM ideas
                WHERE status IN ('rejected', 'superseded')
                """
            )

            # La tabla de conexiones se retiró en la 0019. Este camino firma
            # el almacén como al día, así que se borra aquí: si quedara,
            # apuntaría a la `ideas` que se tira justo después.
            conn.execute("DROP TABLE IF EXISTS connections")

            conn.execute("DROP TABLE ideas")
            conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
            huerfanas = conn.execute("PRAGMA foreign_key_check").fetchall()
            if huerfanas:
                raise RuntimeError(f"la copia histórica deja {len(huerfanas)} filas huérfanas")
            conn.execute("COMMIT")
        except (sqlite3.Error, RuntimeError):
            conn.execute("ROLLBACK")
            raise
    finally:
        conn.execute("PRAGMA foreign_keys = ON")


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
    # El orden manda: `glob` devuelve lo que el FS quiera, y aplicar los pasos
    # desordenados deja `user_version` en el último que corra (no en el mayor).
    return sorted(pasos, key=lambda paso: paso[0])


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
    Además se comprueba que no queden filas huérfanas.

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

    La tabla se llama `idea_data` desde la 0020 (`idea_entry` antes); un
    almacén de la 0004 aún lleva `ideas`, así que se mira en los dos sitios
    (lo viejo se migra solo).
    """
    for tabla in ("idea_data", "ideas"):
        try:
            with closing(sqlite3.connect(uri_lectura(db_file), uri=True)) as conn:
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


def _roadmap(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """El detalle de la estancia en roadmap, si la idea está ahí."""
    return conn.execute(
        "SELECT resultado, referencia FROM roadmap_node WHERE uid = ?", (uid,)
    ).fetchone()


def _verificacion(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """El detalle de la estancia en verificación, si la idea está ahí."""
    return conn.execute(
        "SELECT intentos, ultimo_resultado, comentario, roadmap_completed_at"
        " FROM verificacion_node WHERE uid = ?",
        (uid,),
    ).fetchone()


def _revision(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """El detalle de la revisión aprobada, si la idea está ahí."""
    return conn.execute(
        "SELECT approved_by, nota FROM revision_node WHERE uid = ?", (uid,)
    ).fetchone()


def _rechazo(conn: sqlite3.Connection, uid: str) -> sqlite3.Row | None:
    """El detalle del descarte, si la idea está ahí."""
    return conn.execute(
        "SELECT rejected_description, rejected_by, superseded_by_uid"
        " FROM rejected_node WHERE uid = ?",
        (uid,),
    ).fetchone()


def _fases(conn: sqlite3.Connection, uid: str) -> list[dict[str, Any]]:
    """Las fases de una idea, en orden (`idea_fase`, 0021)."""
    filas = conn.execute(
        "SELECT orden, titulo, estado, nota, entered_at"
        " FROM idea_fase WHERE idea_uid = ? ORDER BY orden",
        (uid,),
    ).fetchall()
    return [dict(fila) for fila in filas]


def _fases_en_lote(conn: sqlite3.Connection, uids: list[str]) -> dict[str, list[dict[str, Any]]]:
    """Las fases de muchas ideas, en una consulta (listado y mapa)."""
    por_uid: dict[str, list[dict[str, Any]]] = {uid: [] for uid in uids}
    if not uids:
        return por_uid
    marcas = ",".join("?" for _ in uids)
    for fila in conn.execute(
        "SELECT idea_uid, orden, titulo, estado, nota, entered_at"
        f" FROM idea_fase WHERE idea_uid IN ({marcas}) ORDER BY idea_uid, orden",
        uids,
    ):
        por_uid[str(fila["idea_uid"])].append(
            {
                "orden": fila["orden"],
                "titulo": fila["titulo"],
                "estado": fila["estado"],
                "nota": fila["nota"],
                "entered_at": fila["entered_at"],
            }
        )
    return por_uid


def _estado(conn: sqlite3.Connection, uid: str) -> str:
    """El estado que manda: el de la fila de nodo de la idea."""
    fila = conn.execute("SELECT estado FROM idea_node WHERE uid = ?", (uid,)).fetchone()
    return str(fila[0]) if fila else "draft"


def _tags_json(texto: str | None) -> list[str]:
    """Lee `tags` sin fiarse del fichero: una fila vieja puede no ser una lista.

    El CHECK exige lista desde la 0017, pero un almacén a medio migrar o una
    escritura con los CHECK relajados no puede tumbar el listado: lo que no
    sea una lista de cadenas se lee como lista vacía.
    """
    try:
        valor = json.loads(texto or "[]")
    except (TypeError, ValueError):
        return []
    if not isinstance(valor, list):
        return []
    return [elemento for elemento in valor if isinstance(elemento, str)]


# Estados a los que un ítem no puede entrar con una dependencia sin aprobar.
# Volver a cola, quedarse en la entrada o descartarse sí se permite: si no,
# una idea bloqueada no tendría salida.
AVANCE = ("roadmap", "verificacion", "revision_aprobada")

# Columnas con las que se lee una idea: su composición y su nodo. Listar, leer
# una ficha y devolver el resultado de un PATCH usan siempre esta forma.
_COLUMNAS = "idea_data.*, idea_node.estado, idea_node.entered_at"


def _depende_de(conn: sqlite3.Connection, uid: str) -> list[str]:
    """Los uids que bloquean a esta idea (`depende_de`, 0018)."""
    fila = conn.execute("SELECT depende_de FROM idea_data WHERE uid = ?", (uid,)).fetchone()
    return _tags_json(fila[0]) if fila else []


def _validar_dependencias(conn: sqlite3.Connection, uid: str, deps: list[str]) -> list[str]:
    """Comprueba que las dependencias existen y que el grafo no tiene ciclos.

    SQLite no puede poner una FK dentro de una lista JSON, así que la regla
    vive aquí: se deduplica, se rechaza la auto-dependencia, se comprueba que
    cada uid esté en el repo y se sigue el grafo para que A→B→A no cuele.
    """
    limpias: list[str] = []
    for dep in deps:
        if dep not in limpias:
            limpias.append(dep)
    if uid in limpias:
        raise InvalidInput("una idea no puede depender de sí misma")
    if limpias:
        marcas = ",".join("?" for _ in limpias)
        existentes = {
            str(fila[0])
            for fila in conn.execute(f"SELECT uid FROM idea_data WHERE uid IN ({marcas})", limpias)
        }
        faltan = [dep for dep in limpias if dep not in existentes]
        if faltan:
            raise InvalidInput(f"depende_de apunta a ideas que no existen: {', '.join(faltan)}")

    pila = list(limpias)
    visto: set[str] = set()
    while pila:
        actual = pila.pop()
        if actual == uid:
            raise InvalidInput("depende_de forma un ciclo: una idea no puede bloquearse a sí misma")
        if actual in visto:
            continue
        visto.add(actual)
        pila.extend(_depende_de(conn, actual))
    return limpias


def _sin_aprobar(conn: sqlite3.Connection, deps: list[str]) -> list[str]:
    """Títulos de las dependencias que aún no están en `revision_aprobada`."""
    pendientes: list[str] = []
    for dep in deps:
        fila = conn.execute("SELECT title FROM idea_data WHERE uid = ?", (dep,)).fetchone()
        if _estado(conn, dep) != "revision_aprobada":
            pendientes.append(str(fila[0]) if fila else dep)
    return pendientes


def _comprobar_dependencias(
    conn: sqlite3.Connection, uid: str, destino: str, deps: list[str] | None = None
) -> None:
    """Frena el avance mientras alguna dependencia no esté aprobada.

    Una dependencia descartada no libera: el ítem queda bloqueado y el
    mensaje lo dice, en vez de dejar el movimiento a medias.
    """
    if destino not in AVANCE:
        return
    pendientes = _sin_aprobar(conn, _depende_de(conn, uid) if deps is None else deps)
    if pendientes:
        raise InvalidInput(
            f"no puede pasar a {destino}: depende de {', '.join(pendientes)}, sin revisión aprobada"
        )


def _fila(
    row: sqlite3.Row,
    roadmap: sqlite3.Row | None,
    verificacion: sqlite3.Row | None,
    revision: sqlite3.Row | None,
    rechazo: sqlite3.Row | None,
    fases: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Arma el dict de una idea con su nodo y el detalle ya resueltos.

    `row` trae la idea y su nodo (`idea_data.*` + `estado`, `entered_at`).
    Quien lista muchas ideas no lee cada detalle por fila (eso era un N+1),
    sino que los trae en lote con `_en_lote` y ensambla aquí.
    """
    idea = dict(row)
    estado = str(idea.pop("estado"))
    entrada = idea.pop("entered_at")
    idea.pop("posicion", None)
    idea["status"] = estado
    idea["tags"] = _tags_json(idea["tags"])
    idea["depende_de"] = _tags_json(idea["depende_de"])
    # `entered_at` es la fecha de la estancia actual, con el nombre que el
    # contrato le daba a cada carril: roadmap, verificación, aprobación o descarte.
    idea["roadmap_started_at"] = entrada if estado == "roadmap" else None
    idea["roadmap_completed_at"] = verificacion["roadmap_completed_at"] if verificacion else None
    idea["roadmap_resultado"] = roadmap["resultado"] if roadmap else ""
    idea["roadmap_referencia"] = roadmap["referencia"] if roadmap else ""
    idea["verificacion_started_at"] = entrada if estado == "verificacion" else None
    # Los intentos acumulados viven en la idea (0014): el detalle solo existe
    # mientras dura la estancia.
    idea["verificacion_intentos"] = int(row["verificacion_intentos"]) if verificacion else 0
    idea["verificacion_ultimo_resultado"] = verificacion["ultimo_resultado"] if verificacion else ""
    idea["verificacion_comentario"] = verificacion["comentario"] if verificacion else ""
    idea["revision_approved_at"] = entrada if estado == "revision_aprobada" else None
    idea["revision_approved_by"] = revision["approved_by"] if revision else "usuario"
    idea["revision_nota"] = revision["nota"] if revision else ""
    idea["rejected_at"] = entrada if estado == "rejected" else None
    idea["rejected_description"] = rechazo["rejected_description"] if rechazo else ""
    idea["rejected_by"] = rechazo["rejected_by"] if rechazo else "usuario"
    idea["superseded_by_uid"] = rechazo["superseded_by_uid"] if rechazo else None
    idea["fases"] = list(fases or [])
    return idea


def _row(conn: sqlite3.Connection, row: sqlite3.Row) -> dict[str, Any]:
    """Una idea suelta (get/update): lecturas por idea, no merece lote completo."""
    uid = str(row["uid"])
    return _fila(
        row,
        _roadmap(conn, uid),
        _verificacion(conn, uid),
        _revision(conn, uid),
        _rechazo(conn, uid),
        _fases(conn, uid),
    )


def _en_lote(
    conn: sqlite3.Connection, uids: list[str]
) -> tuple[
    dict[str, sqlite3.Row],
    dict[str, sqlite3.Row],
    dict[str, sqlite3.Row],
    dict[str, sqlite3.Row],
    dict[str, list[dict[str, Any]]],
]:
    """Detalle de roadmap, verificación, revisión y descarte, en lote."""
    if not uids:
        return {}, {}, {}, {}
    marcas = ",".join("?" for _ in uids)
    roadmaps = {
        str(row["uid"]): row
        for row in conn.execute(
            f"SELECT uid, resultado, referencia FROM roadmap_node WHERE uid IN ({marcas})",
            uids,
        )
    }
    verificaciones = {
        str(row["uid"]): row
        for row in conn.execute(
            "SELECT uid, intentos, ultimo_resultado, comentario,"
            f" roadmap_completed_at FROM verificacion_node WHERE uid IN ({marcas})",
            uids,
        )
    }
    revisiones = {
        str(row["uid"]): row
        for row in conn.execute(
            f"SELECT uid, approved_by, nota FROM revision_node WHERE uid IN ({marcas})",
            uids,
        )
    }
    rechazos = {
        str(row["uid"]): row
        for row in conn.execute(
            "SELECT uid, rejected_description, rejected_by, superseded_by_uid"
            f" FROM rejected_node WHERE uid IN ({marcas})",
            uids,
        )
    }
    return roadmaps, verificaciones, revisiones, rechazos, _fases_en_lote(conn, uids)


def _grupo(estado: str) -> str:
    """A qué grupo pertenece un estado: `superseded` y `rejected` son el mismo
    para mover (la diferencia vive en la ficha, no en el destino)."""
    return "rejected" if estado == "superseded" else estado


def _escribir_estado(
    conn: sqlite3.Connection, uid: str, estado: str, detalle: dict[str, Any]
) -> None:
    """Mueve el nodo de una idea y escribe el detalle de la estancia.

    Un cambio de estado es un UPDATE de `idea_node` (estado, posición y
    `entered_at`) más la fila de detalle que toque. La entrada (`draft`) es un
    nodo más: llegar a ella también deja fila, no es una ausencia. Mover a
    donde ya está no escribe nada; re-descartar con detalle nuevo sí actualiza
    el descarte (upsert de `_escribir_rechazo`).
    """
    anterior = _estado(conn, uid)
    if _grupo(estado) == _grupo(anterior) and not (
        estado in ("rejected", "superseded") and detalle
    ):
        return
    if estado == "roadmap":
        activo = conn.execute(
            "SELECT count(*) FROM idea_node WHERE estado = 'roadmap' AND uid <> ?", (uid,)
        ).fetchone()[0]
        if activo:
            raise InvalidInput("roadmap solo admite un item activo: ya hay uno en curso")
    roadmap_previo = _roadmap(conn, uid)
    ts = now_iso()
    posicion = None
    if estado == "proposed":
        posicion = conn.execute(
            "SELECT coalesce(max(posicion), 0) + 1 FROM idea_node WHERE estado = 'proposed'"
        ).fetchone()[0]
    conn.execute(
        "UPDATE idea_node SET estado = ?, posicion = ?, entered_at = ? WHERE uid = ?",
        (_grupo(estado), posicion, ts, uid),
    )
    conn.execute("DELETE FROM roadmap_node WHERE uid = ?", (uid,))
    conn.execute("DELETE FROM verificacion_node WHERE uid = ?", (uid,))
    conn.execute("DELETE FROM revision_node WHERE uid = ?", (uid,))
    if estado not in ("rejected", "superseded"):
        conn.execute("DELETE FROM rejected_node WHERE uid = ?", (uid,))
    if estado == "roadmap":
        conn.execute(
            "INSERT INTO roadmap_node (uid, resultado, referencia) VALUES (?, ?, ?)",
            (
                uid,
                detalle.get("roadmap_resultado") or "",
                detalle.get("roadmap_referencia") or "",
            ),
        )
    elif estado == "verificacion":
        # Los intentos son del ítem, no de la estancia: el detalle se retira al
        # volver a la cola, así que el contador vive en `idea_data` (0014) y
        # cada entrada en verificación suma una vuelta.
        intentos = (
            int(
                conn.execute(
                    "SELECT verificacion_intentos FROM idea_data WHERE uid = ?", (uid,)
                ).fetchone()[0]
            )
            + 1
        )
        conn.execute(
            "UPDATE idea_data SET verificacion_intentos = ? WHERE uid = ?", (intentos, uid)
        )
        conn.execute(
            "INSERT INTO verificacion_node"
            " (uid, intentos, ultimo_resultado, comentario, roadmap_completed_at)"
            " VALUES (?, ?, ?, ?, ?)",
            (
                uid,
                intentos,
                detalle.get("verificacion_resultado") or "",
                detalle.get("verificacion_comentario") or "",
                ts if roadmap_previo is not None else None,
            ),
        )
    elif estado == "revision_aprobada":
        conn.execute(
            "INSERT INTO revision_node (uid, approved_by, nota) VALUES (?, ?, ?)",
            (uid, detalle.get("approved_by") or "usuario", detalle.get("revision_nota") or ""),
        )
    elif estado in ("rejected", "superseded"):
        _escribir_rechazo(conn, uid, detalle)


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
        # El estado es una columna del nodo, no la presencia en una ficha: el
        # filtro es el mismo para los seis carriles y `superseded` sigue
        # leyéndose como el descarte que es.
        filtro = _grupo(status) if status else None
        # En cola, el orden es la posición; roadmap y verificación, la entrada
        # en el nodo; el resto, por fecha de creación.
        if filtro == "proposed":
            orden = "idea_node.posicion ASC, idea_data.created_at ASC"
        elif filtro in ("roadmap", "verificacion"):
            orden = "idea_node.entered_at ASC, idea_data.created_at ASC"
        else:
            orden = "idea_data.created_at DESC, idea_data.id DESC"
        rows = conn.execute(
            f"SELECT {_COLUMNAS} FROM idea_data"
            " JOIN idea_node ON idea_node.uid = idea_data.uid"
            " WHERE (:kind IS NULL OR kind = :kind)"
            " AND (:estado IS NULL OR idea_node.estado = :estado)"
            f" ORDER BY {orden}"
            " LIMIT :limit OFFSET :offset",
            {"kind": kind, "estado": filtro, "limit": limit, "offset": offset},
        ).fetchall()
        roadmaps, verificaciones, revisiones, rechazos, fases = _en_lote(
            conn, [str(r["uid"]) for r in rows]
        )
        return [
            _fila(
                r,
                roadmaps.get(str(r["uid"])),
                verificaciones.get(str(r["uid"])),
                revisiones.get(str(r["uid"])),
                rechazos.get(str(r["uid"])),
                fases.get(str(r["uid"])),
            )
            for r in rows
        ]


def get_idea(repo: str, uid: str) -> dict[str, Any]:
    with closing(connect(ensure_repo(repo))) as conn:
        row = conn.execute(
            f"SELECT {_COLUMNAS} FROM idea_data"
            " JOIN idea_node ON idea_node.uid = idea_data.uid"
            " WHERE idea_data.uid = ?",
            (uid,),
        ).fetchone()
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
    depende_de: Iterable[str] = (),
) -> dict[str, Any]:
    uid = uuid.uuid4().hex
    ts = now_iso()
    with closing(connect(ensure_repo(repo))) as conn:
        deps = _validar_dependencias(conn, uid, list(depende_de))
        _comprobar_dependencias(conn, uid, status, deps)
        conn.execute(
            "INSERT INTO idea_data"
            " (uid, title, description, content, kind, tags, depende_de,"
            " created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                uid,
                title,
                description,
                content,
                kind,
                json.dumps(list(tags)),
                json.dumps(deps),
                ts,
                ts,
            ),
        )
        # El nodo nace en la entrada y `_escribir_estado` lo mueve si la idea
        # se creó ya en otro carril, en la misma transacción.
        conn.execute(
            "INSERT INTO idea_node (uid, estado, posicion, entered_at)"
            " VALUES (?, 'draft', NULL, ?)",
            (uid, ts),
        )
        _escribir_estado(conn, uid, status, {})
        _emitir(conn, "idea.created", {"uid": uid, "title": title})
        conn.commit()
    return get_idea(repo, uid)


def _escribir_rechazo(conn: sqlite3.Connection, uid: str, detalle: dict[str, Any]) -> None:
    """El detalle del descarte, con upsert: re-descartar la misma idea no duplica."""
    conn.execute(
        "INSERT INTO rejected_node"
        " (uid, rejected_description, rejected_by, superseded_by_uid)"
        " VALUES (?, ?, ?, ?)"
        " ON CONFLICT(uid) DO UPDATE SET"
        "   rejected_description = excluded.rejected_description,"
        "   rejected_by = excluded.rejected_by,"
        "   superseded_by_uid = excluded.superseded_by_uid",
        (
            uid,
            detalle.get("rejected_description") or "",
            detalle.get("rejected_by") or "usuario",
            detalle.get("superseded_by_uid"),
        ),
    )


def _validar_campos_ficha(detalle: dict[str, Any], estado: str) -> None:
    """Un campo de ficha solo vale en su estado.

    Sin esta comprobación, enviar `verificacion_resultado` estando en
    roadmap dejaba el PATCH en 200 sin tocar nada: el caller creía editar
    y no pasaba nada. Mejor un 400 que diga qué campo y en qué ficha vale.
    """
    for campo in detalle:
        if campo in REJECT_FIELDS:
            if estado not in ("rejected", "superseded"):
                raise InvalidInput(
                    f"El campo {campo} solo vale para la ficha de descartadas, no para {estado}."
                )
        elif campo not in CAMPOS_FICHA.get(estado, set()):
            raise InvalidInput(f"El campo {campo} no pertenece a la ficha de {estado}.")


def _actualizar_ficha_activa(
    conn: sqlite3.Connection, uid: str, estado: str, detalle: dict[str, Any]
) -> None:
    """Edita solo los campos dados de la ficha en la que ya vive la idea.

    Es el PATCH sin `status` (o reafirmándolo): antes esos campos se
    descartaban y el 200 devolvía el valor viejo.
    """
    if not detalle:
        return
    if estado == "roadmap":
        asignaciones = []
        params: dict[str, Any] = {"uid": uid}
        if "roadmap_resultado" in detalle:
            asignaciones.append("resultado = :roadmap_resultado")
            params["roadmap_resultado"] = detalle["roadmap_resultado"]
        if "roadmap_referencia" in detalle:
            asignaciones.append("referencia = :roadmap_referencia")
            params["roadmap_referencia"] = detalle["roadmap_referencia"]
        if asignaciones:
            conn.execute(
                f"UPDATE roadmap_node SET {', '.join(asignaciones)} WHERE uid = :uid", params
            )
    elif estado == "verificacion":
        asignaciones = []
        params = {"uid": uid}
        if "verificacion_resultado" in detalle:
            asignaciones.append("ultimo_resultado = :verificacion_resultado")
            params["verificacion_resultado"] = detalle["verificacion_resultado"]
        if "verificacion_comentario" in detalle:
            asignaciones.append("comentario = :verificacion_comentario")
            params["verificacion_comentario"] = detalle["verificacion_comentario"]
        if asignaciones:
            conn.execute(
                f"UPDATE verificacion_node SET {', '.join(asignaciones)} WHERE uid = :uid", params
            )
    elif estado == "revision_aprobada":
        asignaciones = []
        params = {"uid": uid}
        if "approved_by" in detalle:
            asignaciones.append("approved_by = :approved_by")
            params["approved_by"] = detalle["approved_by"]
        if "revision_nota" in detalle:
            asignaciones.append("nota = :revision_nota")
            params["revision_nota"] = detalle["revision_nota"]
        if asignaciones:
            conn.execute(
                f"UPDATE revision_node SET {', '.join(asignaciones)} WHERE uid = :uid", params
            )
    elif estado in ("rejected", "superseded"):
        asignaciones = []
        params = {"uid": uid}
        if "rejected_description" in detalle:
            asignaciones.append("rejected_description = :rejected_description")
            params["rejected_description"] = detalle["rejected_description"]
        if "rejected_by" in detalle:
            asignaciones.append("rejected_by = :rejected_by")
            params["rejected_by"] = detalle["rejected_by"]
        if "superseded_by_uid" in detalle:
            asignaciones.append("superseded_by_uid = :superseded_by_uid")
            params["superseded_by_uid"] = detalle["superseded_by_uid"]
        if asignaciones:
            conn.execute(
                f"UPDATE rejected_node SET {', '.join(asignaciones)} WHERE uid = :uid", params
            )


def _normalizar_fases(fases: Any, existentes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Valida la lista de fases y decide la fecha de entrada de cada una.

    El PATCH reemplaza la lista entera: lo que llega es lo que queda. Una fase
    que conserva su `orden` y su estado conserva `entered_at`; si cambia de
    estado o es nueva, entra ahora. Sin `orden`, se añade al final.
    """
    if not isinstance(fases, list):
        raise InvalidInput("fases tiene que ser una lista")
    previas = {int(fase["orden"]): fase for fase in existentes}
    siguiente = max(previas, default=0)
    normalizadas: list[dict[str, Any]] = []
    vistas: set[int] = set()
    for item in fases:
        if not isinstance(item, dict):
            raise InvalidInput("cada fase tiene que ser un objeto")
        titulo = str(item.get("titulo") or "").strip()
        if not titulo:
            raise InvalidInput("una fase sin título no vale")
        estado = str(item.get("estado") or "pendiente")
        if estado not in FASE_ESTADOS:
            raise InvalidInput(f"estado de fase desconocido: {estado}")
        orden = item.get("orden")
        if orden is None:
            siguiente += 1
            orden = siguiente
        try:
            orden = int(orden)
        except (TypeError, ValueError) as exc:
            raise InvalidInput("el orden de una fase tiene que ser un entero") from exc
        if orden < 1:
            raise InvalidInput("el orden de una fase empieza en 1")
        if orden in vistas:
            raise InvalidInput(f"el orden de fase {orden} está repetido")
        vistas.add(orden)
        previa = previas.get(orden)
        normalizadas.append(
            {
                "orden": orden,
                "titulo": titulo,
                "estado": estado,
                "nota": str(item.get("nota") or ""),
                "entered_at": (
                    previa["entered_at"]
                    if previa is not None and previa["estado"] == estado
                    else now_iso()
                ),
            }
        )
    return sorted(normalizadas, key=lambda fase: fase["orden"])


def _escribir_fases(conn: sqlite3.Connection, uid: str, fases: list[dict[str, Any]]) -> None:
    """Reemplaza las fases de la idea (borra e inserta, en su transacción)."""
    conn.execute("DELETE FROM idea_fase WHERE idea_uid = ?", (uid,))
    conn.executemany(
        "INSERT INTO idea_fase (idea_uid, orden, titulo, estado, nota, entered_at)"
        " VALUES (?, ?, ?, ?, ?, ?)",
        [
            (uid, fase["orden"], fase["titulo"], fase["estado"], fase["nota"], fase["entered_at"])
            for fase in fases
        ],
    )


def update_idea(repo: str, uid: str, changes: dict[str, Any]) -> dict[str, Any]:
    """Actualiza solo los campos presentes. Los `None` no se escriben."""
    clean = {k: v for k, v in changes.items() if v is not None and k in UPDATABLE}
    rechazo = {k: v for k, v in changes.items() if v is not None and k in REJECT_FIELDS}
    estado_detalle = {k: v for k, v in changes.items() if v is not None and k in STATE_FIELDS}
    fases_pedidas = changes.get("fases")
    if (
        not clean
        and not rechazo
        and not estado_detalle
        and "status" not in changes
        and fases_pedidas is None
    ):
        raise InvalidInput("nada que actualizar")

    if "tags" in clean:
        clean["tags"] = json.dumps(list(clean["tags"]))
    clean["updated_at"] = now_iso()

    nuevo_estado = changes["status"] if changes.get("status") is not None else None
    detalle_ficha = {**rechazo, **estado_detalle}
    assignments = ", ".join(f"{column} = :{column}" for column in clean)
    with closing(connect(ensure_repo(repo))) as conn:
        # La ficha activa (y el destino, si cambia el estado) decide qué
        # campos de ficha tienen sentido; se comprueba antes de escribir.
        if conn.execute("SELECT 1 FROM idea_data WHERE uid = ?", (uid,)).fetchone() is None:
            raise KeyError(uid)
        actual = _estado(conn, uid)
        destino = nuevo_estado or actual
        _validar_campos_ficha(detalle_ficha, destino)
        # Las dependencias se validan antes del UPDATE: se deduplican, tienen
        # que existir y no pueden cerrar un ciclo. La lista se guarda en JSON.
        deps_nuevas: list[str] | None = None
        if "depende_de" in clean:
            deps_nuevas = _validar_dependencias(conn, uid, list(clean["depende_de"]))
            clean["depende_de"] = json.dumps(deps_nuevas)
        # Un cambio de estado no es un UPDATE de la entrada: crea o retira la
        # fila de cola, de roadmap, de verificación, de revisión aprobada o
        # de descartada. Sin cambio (o reafirmando el mismo), se edita la
        # ficha activa.
        try:
            cambiado_estado = nuevo_estado is not None and nuevo_estado != actual
            # Los protocolos mandan sobre el flujo: una unión no listada
            # se rechaza (400) y no escribe nada.
            if cambiado_estado and not _protocolo_ok(conn, actual, nuevo_estado):
                raise InvalidInput(
                    f"el protocolo no permite el flujo {actual} → "
                    f"{nuevo_estado}: esa unión no está en `protocolo_flujo`"
                )
            if cambiado_estado:
                _comprobar_dependencias(conn, uid, nuevo_estado, deps_nuevas)
            # Las fases se reemplazan enteras y se validan antes de escribir
            # nada: el gate mira lo que quedará, no lo que había.
            fases_finales = (
                _normalizar_fases(fases_pedidas, _fases(conn, uid))
                if fases_pedidas is not None
                else None
            )
            # El gate mira la lista que quedará: la que llega en este PATCH o,
            # si no hay, la que ya tiene la idea.
            fases_quedan = (
                (fases_finales if fases_finales is not None else _fases(conn, uid))
                if cambiado_estado
                else []
            )
            if cambiado_estado and _exige_fases(conn, actual, nuevo_estado) and not fases_quedan:
                raise InvalidInput(
                    f"el protocolo exige al menos una fase para pasar a {nuevo_estado}"
                )
            if cambiado_estado and _exige_fases_listas(conn, actual, nuevo_estado):
                abiertas = [
                    fase["titulo"]
                    for fase in fases_quedan
                    if fase["estado"] in ("pendiente", "fallida")
                ]
                if abiertas:
                    raise InvalidInput(
                        f"no puede pasar a {nuevo_estado}: quedan fases sin cerrar: "
                        + ", ".join(abiertas)
                    )
            cursor = conn.execute(
                f"UPDATE idea_data SET {assignments} WHERE uid = :uid",
                {**clean, "uid": uid},
            )
            if cursor.rowcount == 0:
                raise KeyError(uid)
            if cambiado_estado:
                _escribir_estado(conn, uid, nuevo_estado, detalle_ficha)
            else:
                _actualizar_ficha_activa(conn, uid, actual, detalle_ficha)
            if fases_finales is not None:
                _escribir_fases(conn, uid, fases_finales)
            idea = _row(
                conn,
                conn.execute(
                    f"SELECT {_COLUMNAS} FROM idea_data"
                    " JOIN idea_node ON idea_node.uid = idea_data.uid"
                    " WHERE idea_data.uid = ?",
                    (uid,),
                ).fetchone(),
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
    """Borra la idea; su nodo y el detalle se van con ella (ON DELETE CASCADE).

    El título se lee antes de borrar para que el evento `idea.deleted` tenga
    qué mostrar: después no hay fila de la que sacar nada. Si otra ficha la
    usa como sustituta (`superseded_by_uid`), no se borra: el vínculo es
    información y se avisa del conflicto en vez de romperlo en silencio.
    """
    with closing(connect(ensure_repo(repo))) as conn:
        titulo_row = conn.execute("SELECT title FROM idea_data WHERE uid = ?", (uid,)).fetchone()
        sustitutas = [
            str(fila[0])
            for fila in conn.execute(
                "SELECT uid FROM rejected_node WHERE superseded_by_uid = ? ORDER BY uid",
                (uid,),
            )
        ]
        if sustitutas:
            raise InvalidInput(
                f"no se puede borrar {uid}: es la sustituta de {', '.join(sustitutas)};"
                " retira ese vínculo antes"
            )
        # El nodo y el detalle se borran con la idea (ON DELETE CASCADE).
        try:
            cursor = conn.execute("DELETE FROM idea_data WHERE uid = ?", (uid,))
        except sqlite3.IntegrityError as exc:
            # Otra ficha pudo enlazarla entre la comprobación y el borrado.
            raise InvalidInput(
                f"no se puede borrar {uid}: otra ficha la referencia en `superseded_by_uid`"
            ) from exc
        if cursor.rowcount > 0:
            # `depende_de` es una lista JSON, sin FK que la limpie: se retira
            # el uid de las listas ajenas para que nadie quede bloqueado por
            # una idea que ya no existe.
            for fila in conn.execute("SELECT uid, depende_de FROM idea_data").fetchall():
                deps = _tags_json(fila[1])
                if uid in deps:
                    conn.execute(
                        "UPDATE idea_data SET depende_de = ? WHERE uid = ?",
                        (json.dumps([otra for otra in deps if otra != uid]), fila[0]),
                    )
            _emitir(conn, "idea.deleted", {"uid": uid, "title": titulo_row[0]})
        conn.commit()
    return cursor.rowcount > 0


def _exige_fases(conn: sqlite3.Connection, actual: str, nuevo: str) -> bool:
    """¿Pide el protocolo al menos una fase para cruzar esta unión? (0021)."""
    if _grupo(actual) == _grupo(nuevo):
        return False
    fila = conn.execute(
        "SELECT exige_fases FROM protocolo_flujo WHERE origen = ? AND destino = ?",
        (_grupo(actual), _grupo(nuevo)),
    ).fetchone()
    return bool(fila and fila[0])


def _exige_fases_listas(conn: sqlite3.Connection, actual: str, nuevo: str) -> bool:
    """¿Exige el protocolo que no queden fases pendientes ni fallidas? (0022)."""
    if _grupo(actual) == _grupo(nuevo):
        return False
    fila = conn.execute(
        "SELECT exige_fases_listas FROM protocolo_flujo WHERE origen = ? AND destino = ?",
        (_grupo(actual), _grupo(nuevo)),
    ).fetchone()
    return bool(fila and fila[0])


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
            "SELECT origen, destino, exige_fases, exige_fases_listas"
            " FROM protocolo_flujo ORDER BY origen, destino"
        ).fetchall()
    return [
        {
            "origen": fila[0],
            "destino": fila[1],
            "exige_fases": bool(fila[2]),
            "exige_fases_listas": bool(fila[3]),
        }
        for fila in filas
    ]


def map_snapshot(repo: str) -> dict[str, Any]:
    """Lee el mapa entero en una sola transacción de lectura."""
    with closing(open_read_only(ensure_repo(repo))) as conn:
        conn.execute("BEGIN")
        rows = conn.execute(
            "SELECT idea_data.uid, idea_data.title, idea_data.description,"
            " idea_data.depende_de, idea_data.created_at, idea_data.id,"
            " idea_node.estado, idea_node.entered_at,"
            " rejected_node.rejected_description"
            " FROM idea_data"
            " JOIN idea_node ON idea_node.uid = idea_data.uid"
            " LEFT JOIN rejected_node ON rejected_node.uid = idea_data.uid"
            # El mapa se pinta en el orden en que llega, así que cada carril
            # tiene que salir como lo lista `/ideas`: la cola por posición
            # (volver de verificación estrena posición, al final) y roadmap y
            # verificación por entrada en el nodo. El resto, por creación.
            " ORDER BY"
            " CASE idea_node.estado"
            " WHEN 'proposed' THEN 0"
            " WHEN 'roadmap' THEN 1"
            " WHEN 'verificacion' THEN 2"
            " WHEN 'revision_aprobada' THEN 3"
            " WHEN 'rejected' THEN 4"
            " ELSE 5 END,"
            " idea_node.posicion ASC,"
            " idea_node.entered_at ASC,"
            " idea_data.created_at DESC, idea_data.id DESC"
        ).fetchall()
        fases = _fases_en_lote(conn, [str(row[0]) for row in rows])
        ideas = [
            {
                **dict(row),
                "status": str(row["estado"]),
                "rejected_at": (row["entered_at"] if str(row["estado"]) == "rejected" else None),
                "depende_de": _tags_json(row["depende_de"]),
                # El JOIN da `NULL` sin descarte; el contrato dice texto.
                "rejected_description": row["rejected_description"] or "",
                "fases": fases.get(str(row["uid"]), []),
            }
            for row in rows
        ]
        return {"ideas": ideas}


# Una conexión de solo lectura por almacén, no una por petición: `PRAGMA
# La conexión vigilante vive en `db.vigilante` (es la misma que usa el
# stream de eventos): `data_version` solo sube en una conexión que **ya
# existía** cuando otra escribe. La de ideas se comparte entre hilos del
# pool de uvicorn, y se serializa aquí para no mezclar lecturas.
_VIGILANTES_LOCK = threading.RLock()
# Un vigilante nuevo puede empezar por la misma versión aunque cambió el mapa.
_REVISION_INSTANCE = uuid.uuid4().hex


def _columna(conn: sqlite3.Connection, tabla: str, columna: str) -> bool:
    """¿Tiene la tabla esa columna? Sirve para reparar un esquema mal firmado."""
    return any(fila[1] == columna for fila in conn.execute(f"PRAGMA table_info({tabla})"))


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
        # La tabla vive como `idea_data` desde la 0020; antes, `idea_entry`.
        tabla_idea = "idea_data" if _existe(conn, "idea_data") else "ideas"
        return {
            "instance": _REVISION_INSTANCE,
            "data_version": data_version(conn),
            "ideas": conn.execute(f"SELECT count(*) FROM {tabla_idea}").fetchone()[0],
        }


def reiniciar(repo: str) -> dict[str, Any]:
    """Vacía el almacén de ideas, cola, fichas y eventos (LAB).

    Solo lo usa el lanzador de pruebas (`puedeProbar`) para volver a un estado
    de proyecto limpio tras una prueba: no es parte del CRUD de producto. La
    estructura (tablas, `user_version`) no cambia: la misma BD, vacía.
    """
    if resolve_repo(repo).parent != repos_root():
        raise InvalidInput("el reinicio solo está disponible en repositorios del laboratorio")
    db_file = ensure_repo(repo)

    def contar(conn: sqlite3.Connection, tabla: str) -> int:
        if not _existe(conn, tabla):
            return 0
        return conn.execute(f"SELECT count(*) FROM {tabla}").fetchone()[0]

    with closing(connect(db_file)) as conn:
        conn.execute("BEGIN IMMEDIATE")
        n_ideas = contar(conn, "idea_data")
        n_eventos = contar(conn, "event")
        # Borrar las ideas arrastra nodo y detalle por CASCADE; los eventos no
        # cuelgan de nada, se borran aparte.
        if n_eventos:
            conn.execute("DELETE FROM event")
        conn.execute("DELETE FROM idea_data")
        conn.commit()
    return {
        "repo": repo,
        "ideas_eliminadas": n_ideas,
        "eventos_eliminados": n_eventos,
    }
