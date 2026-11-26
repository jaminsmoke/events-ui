# El core compartido (`core/vX.Y.Z`)

El core es de la máquina, no del cliente: un solo binario por versión, en una
carpeta compartida por el desktop y el envoltorio web. Lo publica el primero
que llega (el desktop copia el suyo del instalador; el paquete web lo descarga
del release) y los demás lo reutilizan.

Este documento es la regla única. Las dos implementaciones que la aplican:

- desktop: `apps/desktop/src-tauri/src/versiones.rs`
- envoltorio web: `apps/web/bin/compartido.mjs`

## Carpeta

`<datos del usuario>/core/vX.Y.Z`, con `X.Y.Z` la versión de la app:

| Sistema | Base |
| --- | --- |
| Windows | `%LOCALAPPDATA%\EventsUI` |
| macOS | `~/Library/Application Support/EventsUI` |
| Linux | `$XDG_DATA_HOME/eventsui` o `~/.local/share/eventsui` |

`EUI_CORE_DIR` (solo en la web) sustituye la carpeta entera: es la vía de
pruebas y de instalaciones portables.

## Publicación

- La copia va a `<nombre>.<pid>.parcial` y se renombra al final. Un corte a
  mitad no deja un binario ejecutable con su nombre definitivo.
- Si el destino ya existe con el mismo tamaño que el origen, no se toca. Si
  está truncado, se borra y se vuelve a copiar.
- Si no se puede publicar, el desktop arranca el core de junto al ejecutable:
  mejor duplicado que sin core.

## Retención

Al publicar una versión se limpian las carpetas antiguas: se conservan

1. la versión en uso,
2. la inmediatamente anterior, y
3. cualquier versión posterior (puede ser la de otro cliente más nuevo).

Lo que no tenga la forma `vX.Y.Z` no se toca. Es best-effort: un binario en
ejecución no se puede borrar y se queda, que es justo lo que conviene.

Ejemplo, con `v0.5.7` en uso:

| Carpetas | Se borran | Se quedan |
| --- | --- | --- |
| `v0.5.4`, `v0.5.5`, `v0.5.6`, `v0.5.7`, `v0.6.0` | `v0.5.4`, `v0.5.5` | `v0.5.6`, `v0.5.7`, `v0.6.0` |
