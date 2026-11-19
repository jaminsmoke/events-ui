"""Los archivos que toca cada fase, anotados por evento y sin watcher.

La app va por eventos y esto también: no hay vigilancia permanente. Se toma una
foto del árbol cuando la idea entra en roadmap (ahí empieza el trabajo) y cada
vez que una fase se cierra; lo que cambió entre una foto y la siguiente es lo
que tocó esa fase.

Sin Git la foto es la lista de rutas con su tamaño y su `mtime`: basta para
saber qué se movió y no se guarda ningún contenido. Con Git, además, cada
archivo cambiado se lleva su parche (`git diff HEAD`), que es lo que deja el
cambio a la vista. En los dos casos la lista respeta lo que el repo ignora
(DOS) y se acota: un árbol enorme no puede hinchar el almacén ni frenar un
PATCH.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from typing import Any

# Tope de archivos por foto. Por encima se anota lo que quepa en orden
# alfabético: el árbol de una idea no suele acercarse, pero un `vendor/` suelto
# no puede convertir cada cierre de fase en media base de datos.
LIMITE_ARCHIVOS = 5000
# Espacio para el contenido: por archivo y por fase. Lo que no cabe se queda sin
# contenido (`None`), nunca con medio parche.
LIMITE_CONTENIDO = 64 * 1024
LIMITE_TOTAL = 512 * 1024
# Carpetas que nunca cuentan como trabajo de la idea: dependencias, cachés y la
# propia base. Con Git lo resuelve `ls-files`; esto es para cuando no lo hay.
PODA = {
    ".git",
    ".EUI",
    ".venv",
    "venv",
    "__pycache__",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".logs",
    ".pytest_cache",
    ".ruff_cache",
    "coverage",
}


def _git(carpeta: Path, *args: str) -> subprocess.CompletedProcess[str] | None:
    """Un comando de Git en la carpeta, o `None` si no hay repo o falla."""
    try:
        salida = subprocess.run(
            ["git", "-C", str(carpeta), *args],
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    return salida if salida.returncode == 0 else None


def hay_git(carpeta: Path) -> bool:
    """¿La carpeta es la raíz de su propio work tree?

    Es el mismo criterio que la proyección: una subcarpeta de otro repo no
    cuenta (sus archivos son del contenedor) y una carpeta ignorada por él
    tampoco. Solo con un repo propio se pide el parche: sin él no se guarda
    contenido, como decidió el producto.
    """
    salida = _git(carpeta, "rev-parse", "--show-toplevel")
    if salida is None:
        return False
    try:
        return Path(salida.stdout.strip()).resolve() == carpeta.resolve()
    except (OSError, RuntimeError):
        return False


def _nombres(carpeta: Path) -> list[str]:
    """Las rutas del árbol, relativas a `carpeta`, sin lo ignorado.

    Con Git manda `ls-files`: respeta el `.gitignore` del repo (que es justo lo
    que deja fuera la base y sus auxiliares). Sin Git se recorre a mano, podando
    las carpetas que nunca son trabajo. La lista sale ordenada para que dos
    fotos del mismo árbol se comparen sin ruido.
    """
    salida = (
        _git(carpeta, "ls-files", "-z", "--cached", "--others", "--exclude-standard")
        if hay_git(carpeta)
        else None
    )
    if salida is not None:
        # `.EUI` viaja con el repo, pero la base se escribe sola en cada idea:
        # contarla haría que toda fase tocara «un archivo».
        nombres = [
            ruta
            for ruta in salida.stdout.split("\0")
            if ruta and ruta != ".EUI" and not ruta.startswith(".EUI/")
        ]
        return sorted(nombres)[:LIMITE_ARCHIVOS]

    nombres = []
    for raiz, carpetas, ficheros in os.walk(carpeta):
        carpetas[:] = sorted(nombre for nombre in carpetas if nombre not in PODA)
        relativa = Path(raiz).relative_to(carpeta).as_posix()
        for fichero in sorted(ficheros):
            nombres.append(fichero if relativa == "." else f"{relativa}/{fichero}")
            if len(nombres) >= LIMITE_ARCHIVOS:
                return nombres
    return nombres


def foto(carpeta: Path) -> dict[str, tuple[int, int]]:
    """El árbol como `ruta → (tamaño, mtime_ns)`; la huella de una foto.

    El tamaño y la fecha de modificación son la identidad barata de un archivo:
    cambia el contenido y cambian ellos. No se lee nada del disco, así que la
    foto cuesta lo que cuesta enumerar.
    """
    estado: dict[str, tuple[int, int]] = {}
    for ruta in _nombres(carpeta):
        try:
            info = (carpeta / ruta).stat()
        except OSError:
            # Un archivo que desaparece mientras se enumera no es un fallo: la
            # foto es un instante, no una garantía.
            continue
        if not info.st_mode & 0o170000:  # pragma: no cover - stat siempre trae tipo
            continue
        estado[ruta] = (int(info.st_size), int(info.st_mtime_ns))
    return estado


def cambios(
    antes: dict[str, tuple[int, int]], ahora: dict[str, tuple[int, int]]
) -> list[dict[str, Any]]:
    """Qué archivos cambiaron entre dos fotos, en orden de ruta.

    `nuevo` es lo que no estaba, `borrado` lo que ya no está y `modificado` lo
    que cambió de tamaño o de fecha. Una idea que no tocó nada da lista vacía:
    no se inventa un cambio por el simple paso del tiempo.

    Mover un archivo sin Git deja un borrado y un nuevo con la misma huella
    (tamaño y fecha se conservan): se juntan en una fila `renombrado` con su
    `desde`, para no contar dos veces el mismo trabajo.
    """
    resultado: list[dict[str, Any]] = []
    for ruta, huella in ahora.items():
        previa = antes.get(ruta)
        if previa is None:
            resultado.append({"ruta": ruta, "estado": "nuevo", "contenido": None, "desde": None})
        elif previa != huella:
            resultado.append(
                {"ruta": ruta, "estado": "modificado", "contenido": None, "desde": None}
            )
    for ruta in antes:
        if ruta not in ahora:
            resultado.append({"ruta": ruta, "estado": "borrado", "contenido": None, "desde": None})
    return sorted(_juntar_renombrados(resultado, antes, ahora), key=lambda c: str(c["ruta"]))


def _juntar_renombrados(
    cambios: list[dict[str, Any]],
    antes: dict[str, tuple[int, int]],
    ahora: dict[str, tuple[int, int]],
) -> list[dict[str, Any]]:
    """Empareja cada nuevo con el borrado que tiene su misma huella.

    Se indexa por huella para no comparar todos con todos: un árbol grande no
    puede convertir esto en un cuadrado. Un archivo copiado y borrado encaja
    igual que un `mv`, y en los dos casos es el mismo cambio visto desde fuera.
    """
    borrados: dict[tuple[int, int], list[str]] = {}
    for cambio in cambios:
        if cambio["estado"] == "borrado":
            borrados.setdefault(antes[str(cambio["ruta"])], []).append(str(cambio["ruta"]))
    juntados: list[dict[str, Any]] = []
    anulados: set[str] = set()
    for cambio in cambios:
        if cambio["estado"] == "nuevo":
            candidatos = borrados.get(ahora[str(cambio["ruta"])])
            if candidatos:
                viejo = candidatos.pop(0)
                anulados.add(viejo)
                juntados.append({**cambio, "estado": "renombrado", "desde": viejo})
                continue
        juntados.append(cambio)
    return [cambio for cambio in juntados if str(cambio["ruta"]) not in anulados]


def _partir_diff(texto: str, rutas: set[str]) -> dict[str, str]:
    """Reparte la salida de un `git diff` de varias rutas en un parche por ruta.

    Cada bloque empieza por `diff --git a/… b/…`; el nombre del final es el que
    identifica el archivo, así que se busca cuál de las rutas pedidas encaja.
    """
    parches: dict[str, str] = {}
    actual: str | None = None
    bloque: list[str] = []
    for linea in texto.splitlines(keepends=True):
        if linea.startswith("diff --git "):
            if actual is not None:
                parches[actual] = "".join(bloque)
            cabeza = linea.rstrip("\n")
            actual = next((ruta for ruta in rutas if cabeza.endswith(f" b/{ruta}")), None)
            bloque = [linea] if actual is not None else []
        elif actual is not None:
            bloque.append(linea)
    if actual is not None:
        parches[actual] = "".join(bloque)
    return parches


def _leer_texto(fichero: Path) -> str | None:
    """El texto de un archivo nuevo, si es texto y cabe en el tope.

    Un binario no se guarda (no se lee) y uno demasiado grande tampoco: un
    contenido a medias no documenta nada. En ambos casos queda `None`.
    """
    try:
        with open(fichero, "rb") as abierto:
            datos = abierto.read(LIMITE_CONTENIDO + 1)
    except OSError:
        return None
    if len(datos) > LIMITE_CONTENIDO or b"\0" in datos:
        return None
    return datos.decode("utf-8", errors="replace")


def contenidos(carpeta: Path, cambios: list[dict[str, Any]]) -> None:
    """Rellena `contenido` en cada cambio: parche de Git o texto del nuevo.

    Los modificados, los borrados y los renombrados salen de un solo
    `git diff HEAD` —incluye lo preparado y lo que no—, que es justo lo que
    añade Git a la foto. Los nuevos no aparecen en un diff, así que se leen
    enteros (con su tope). Sin Git, o sin commits todavía, se quedan sin
    contenido: la ruta y el estado bastan.
    """
    if not cambios or not hay_git(carpeta):
        return
    con_diff = {str(cambio["ruta"]) for cambio in cambios if cambio["estado"] != "nuevo"}
    parches: dict[str, str] = {}
    if con_diff:
        salida = _git(
            carpeta,
            "-c",
            "core.quotepath=false",
            "diff",
            "--no-color",
            "--no-ext-diff",
            "HEAD",
            "--",
            *sorted(con_diff),
        )
        if salida is not None:
            parches = _partir_diff(salida.stdout, con_diff)

    total = 0
    for cambio in cambios:
        if cambio["estado"] == "nuevo":
            texto = _leer_texto(carpeta / str(cambio["ruta"]))
        else:
            texto = parches.get(str(cambio["ruta"]))
        if texto is None:
            continue
        if total + len(texto) > LIMITE_TOTAL:
            break
        cambio["contenido"] = texto
        total += len(texto)


def serializar(estado: dict[str, tuple[int, int]]) -> str:
    """La foto en texto plano, una ruta por línea: `ruta\\ttamaño\\tmtime`.

    JSON sería más legible pero pesa el triple con miles de rutas, y esto solo
    lo lee el propio core.
    """
    return "\n".join(
        f"{ruta}\t{tamano}\t{mtime}" for ruta, (tamano, mtime) in sorted(estado.items())
    )


def deserializar(texto: str | None) -> dict[str, tuple[int, int]]:
    """Deshace `serializar`; una línea rota se ignora, no tumba la lectura."""
    estado: dict[str, tuple[int, int]] = {}
    for linea in (texto or "").splitlines():
        partes = linea.rsplit("\t", 2)
        if len(partes) != 3:
            continue
        try:
            estado[partes[0]] = (int(partes[1]), int(partes[2]))
        except ValueError:
            continue
    return estado
