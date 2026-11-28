"""Los pasos que suben un almacén viejo hasta el esquema de hoy, de uno en uno.

`schema/` es el estado final: un almacén que nace hoy se crea con él y no
ejecuta ninguno de estos pasos. Un repo viejo, en cambio, no vuelve a pasar por
`init_repo`, y reaplicar `schema/*.sql` solo cubre lo que es `IF NOT EXISTS`;
por eso cada cambio de esquema es un fichero numerado en `migraciones/`.
"""

from __future__ import annotations

import sqlite3
import threading
from collections.abc import Iterator
from contextlib import closing, suppress
from pathlib import Path

from ...db import uri_lectura
from .comun import AlmacenMasNuevo, _columna, _existe
from .esquema import SCHEMA_VERSION, aplicar_esquema, connect
from .rutas import DB_FILENAME, LEGACY_DB_FILENAME

# `items/base/migraciones.py` -> `events_core/migraciones`.
MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migraciones"
# Las migraciones de items y log se aplican en orden: un fichero nuevo no
# obliga a tocar este módulo. `PRAGMA user_version` dice cuál hay aplicado en
# cada almacén. La tabla `event` del repo se siembra con el esquema fresco
# porque el core emite ahí sus `item.*`; a los almacenes anteriores les llegó
# por la 0005 y la 0015. La tabla `items` pasó a `idea_entry` +
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
# `tags` a lista JSON de cadenas, la 0018 añadió `depende_de` (los ítems que
# tienen que estar aprobadas para que esta avance de carril) y la 0019 retiró
# `connections`: la dependencia vive en la entrada y la jerarquía del mapa es
# el propio flujo. La 0020 separa el ítem (`work_item_data`) de su sitio
# (`work_item_node`, una fila por item): el estado y la posición dejan de deducirse
# de las fichas y las fichas pasan a ser detalle de la estancia. La 0021
# descompone el ítem en fases (`work_item_fase`) y hace que el protocolo pueda
# exigirlas para cruzar una unión (`exige_fases`). La 0022 añade el otro
# requisito del protocolo: no salir de un carril con fases abiertas
# (`exige_fases_listas`) y la 0023 exige todas completadas para aprobar
# (`exige_fases_completas`); la 0024 reutiliza `exige_fases` para que aprobar
# exija al menos una; la 0025 añade los requisitos de cada fase (`work_item_requisito`);
# la 0026 añade el historial: aprobar archiva y deja la firma en `revision_node`;
# la 0027 permite que una revisión rechazada vuelva a roadmap o se descarte
# desde verificación, sin un carril nuevo; la 0028 anota en cada fase los
# archivos que cambiaron entre dos fotos del árbol, sin watcher: se fotografía
# al entrar en roadmap y al cerrar una fase; la 0029 añade los archivos de cada
# requisito de la fase; la 0030 añade los lotes de la migración de Markdown
# (`migracion_lote`, `migracion_item`), para aplicar un plan entero en una
# transacción, no repetirlo y saber de dónde salió cada item; la 0031 guarda
# en esa procedencia el carril con el que nació cada item, para deshacer un plan
# que archiva o descarta; la 0032 pone índice en `work_item_node (estado, posicion)`,
# que es el filtro del mapa y el orden de la cola; la 0033 copia `created_at` al
# nodo e indexa `(estado, created_at, uid)` para que el listado por estado no
# tenga que ordenar en un B-tree temporal; la 0037 abre la vuelta del historial
# a verificación, para reverificar una ficha archivada sin desarchivarla a mano.

# Marca en la cabecera de una migración que reconstruye una tabla con claves
# foráneas apuntándole (ver `_aplicar_paso`).

SIN_FOREIGN_KEYS = "-- sin-foreign-keys"

# Dos peticiones a la vez no deben migrar el mismo almacén: la segunda vería la
# versión vieja y repetiría pasos que la primera está aplicando.

_ESQUEMA_LOCK = threading.RLock()

# Almacenes que este proceso ya comprobó: `Ruta -> (mtime_ns, tamaño)`. La
# versión del esquema solo cambia si alguien escribe en el fichero (una
# migración, una copia restaurada), así que con su huella basta para ahorrarse
# abrir la conexión de cada lectura. Se anota solo tras comprobarlo de verdad.

_AL_DIA: dict[Path, tuple[int, int]] = {}


def _huella(db_file: Path) -> tuple[int, int] | None:
    """`(mtime_ns, tamaño)` del almacén; `None` si aún no está."""
    try:
        info = db_file.stat()
    except OSError:
        return None
    return info.st_mtime_ns, info.st_size


def _migrar_esquema(db_file: Path) -> None:
    """Sube al día un almacén que ya existía, paso a paso.

    Un repo viejo no vuelve a pasar por `init_repo`, así que ni una tabla nueva ni
    un `CHECK` cambiado le llegarían nunca: reaplicar `schema/*.sql` solo sirve
    para lo que es `IF NOT EXISTS`. Por eso cada cambio de esquema es un fichero
    numerado en `migraciones/`, y `user_version` dice por cuál va el almacén.

    Si ya está al día no se ejecuta ni un paso (esto corre en cada lectura) y,
    si este proceso ya lo comprobó con esta misma huella, ni se abre.
    """
    huella = _huella(db_file)
    with _ESQUEMA_LOCK:
        if huella is not None and _AL_DIA.get(db_file) == huella:
            return
        try:
            with closing(connect(db_file)) as conn:
                _llevar_al_dia(conn)
        except BaseException:
            # Un intento fallido no deja el almacén al día: que se reintente.
            _AL_DIA.pop(db_file, None)
            raise
        if (nueva := _huella(db_file)) is not None:
            _AL_DIA[db_file] = nueva


def comprobar_version(conn: sqlite3.Connection) -> int:
    """`user_version` del almacén abierto, o el error si es posterior.

    Dos casos distintos que antes caían en el mismo `return` en silencio:
    «está al día» y «lo migró un core más nuevo». El segundo no se puede poner
    al día hacia atrás: se nombra y no se escribe ni una fila.

    Vive aquí y no dentro de `_llevar_al_dia` porque `/health` abre en solo
    lectura y no pasa por `ensure_repo`, pero tampoco debe decir «ok» de un
    almacén que este core no entiende.
    """
    version = int(conn.execute("PRAGMA user_version").fetchone()[0])
    if version > SCHEMA_VERSION:
        raise AlmacenMasNuevo(
            f"el almacén está en la versión de esquema {version} y este core entiende"
            f" hasta la {SCHEMA_VERSION}: lo migró una versión más nueva de Events UI."
            " Actualiza la aplicación; el almacén no se ha tocado."
        )
    return version


def _llevar_al_dia(conn: sqlite3.Connection) -> None:
    """Aplica los pasos que le falten al almacén ya abierto."""
    # Va antes que las comprobaciones de la 0013/0018, que asumen un almacén
    # viejo y aplicarían pasos sobre uno posterior.
    version = comprobar_version(conn)
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
            _copiar_items_historicos(conn)
        return

    if version == 0:
        # Almacén de antes de que existiera la versión: no se sabe de dónde
        # parte, así que se le pone el esquema base de items/conexiones
        # (idempotente) y se marca como al día. Los pasos 3-5 ya están
        # reflejados en él, pero la tabla `event` no: el log lo escribe
        # otro proceso y no se crea desde la app.
        #
        # Si además trae la tabla histórica `items`, su contenido no está
        # en el esquema fresco: hay que copiarlo antes de marcar al día.
        aplicar_esquema(conn)
        conn.commit()
        if _existe(conn, "ideas"):
            _copiar_items_historicos(conn)
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


def _copiar_items_historicos(conn: sqlite3.Connection) -> None:
    """Pasa la tabla antigua `items` al esquema actual, si sigue viva.

    Es el caso del almacén anterior a `user_version`: el esquema fresco crea
    `idea_entry` pero no mueve las filas que ya había en `items`. Aquí se
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
                INSERT OR IGNORE INTO work_item_data
                    (id, uid, title, description, content, kind, tags, created_at, updated_at)
                SELECT id, uid, title, description, content,
                       CASE kind WHEN 'idea' THEN 'work_item' ELSE kind END,
                       CASE WHEN json_valid(tags) AND json_type(tags) = 'array'
                            THEN tags ELSE '[]' END,
                       created_at, updated_at
                FROM ideas
                """
            )
            # Una fila histórica que no entra (p. ej. un `kind` que el
            # esquema actual ya no admite) no puede perderse en silencio.
            faltan = conn.execute(
                "SELECT uid FROM ideas WHERE uid NOT IN (SELECT uid FROM work_item_data)"
            ).fetchall()
            if faltan:
                raise RuntimeError(
                    "no se pudieron migrar los ítems históricos "
                    f"{', '.join(str(f[0]) for f in faltan)}"
                )

            # El nodo de cada ítem viejo: la cola conserva su orden y el resto
            # entra donde su estado decía. `entered_at` es su `updated_at`, que
            # es la fecha de entrada más cercana que hay en la tabla histórica;
            # `created_at` e `id` se copian tal cual (0033), que son el orden
            # del listado.
            conn.execute(
                """
                INSERT OR IGNORE INTO work_item_node
                    (uid, estado, posicion, created_at, id, entered_at)
                SELECT uid,
                       CASE
                           -- En los almacenes anteriores «accepted» era el
                           -- final: se archiva, conservando su firma abajo.
                           WHEN status = 'accepted' THEN 'historial'
                           WHEN status IN ('rejected', 'superseded') THEN 'rejected'
                           WHEN status = 'proposed' THEN 'proposed'
                           ELSE 'draft'
                       END,
                       CASE WHEN status = 'proposed'
                            THEN (SELECT COALESCE(MAX(posicion), 0) FROM work_item_node)
                                 + ROW_NUMBER() OVER (ORDER BY created_at, id)
                            ELSE NULL END,
                       created_at,
                       id,
                       updated_at
                FROM ideas
                WHERE uid IN (SELECT uid FROM work_item_data)
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


def _contar_items(db_file: Path) -> int | None:
    """Filas de la entrada en un fichero, o `None` si no se puede leer.

    La tabla se llama `work_item_data` desde la 0020 (`idea_entry` antes); un
    almacén de la 0004 aún lleva `items`, así que se mira en los dos sitios
    (lo viejo se migra solo).
    """
    for tabla in ("work_item_data", "ideas"):
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
      items dentro no se borra nada: perder datos no es tarea de una migración.
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

    if _contar_items(legacy) == 0:
        for suffix in sufijos:
            # Un auxiliar bloqueado por otro proceso no debe romper la lectura.
            with suppress(OSError):
                legacy.with_name(LEGACY_DB_FILENAME + suffix).unlink(missing_ok=True)
