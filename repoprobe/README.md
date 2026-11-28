# repoprobe

Laboratorio de pruebas. Aquí se deja el código que se va a analizar: una carpeta
vacía, un clon o una copia, da igual. Sirve para probar el sistema contra material
que no hemos inventado.

```
repoprobe/
  repos/            clones de repos investigados (ignorados por git)
    <repo>/
      .EUI/                  lo crea el seed, no se escribe a mano
        EUI_DATABASE.sqlite  SQLite con la tabla `ideas`
        .gitignore           ignora los auxiliares -wal / -shm
```

## Sembrar un repo

```bash
# si vas a analizar un repo, déjalo dentro (clon, copia, lo que sea)
git clone <url> repoprobe/repos/<repo>
corepack pnpm core:seed <repo>
```

Equivalente sin pnpm:

```bash
uv run --directory shared/core python -m events_core.seed <repo>
```

El seed es idempotente y aplica `shared/core/src/events_core/schema/ideas.sql`.
Crea `repoprobe/repos/<repo>/.EUI/EUI_DATABASE.sqlite` si no existe.

La carpeta que pasas es la raíz y la única que se siembra: el seed no recorre
subcarpetas ni crea `.EUI` en ellas. Desde la app pasa lo mismo, y elegir una
subcarpeta como raíz la convierte en un workspace propio, no en el del padre.

## Operar sin scripts

```bash
corepack pnpm core:dev
```

- `GET /docs` — Swagger, para probar a mano.
- `GET /openapi.json` — el contrato del que saldrán los tipos TS.
- `GET /repos` — carpetas del laboratorio ya sembradas.
- `GET|POST /ideas?repo=<ruta>` — listar y crear ideas.
- `GET|PATCH|DELETE /ideas/{uid}?repo=<ruta>` — una idea concreta.

Ejemplo:

```bash
curl -X POST 'http://127.0.0.1:18765/ideas?repo=C:\ruta\a\Lab1' \
  -H 'content-type: application/json' \
  -d '{"title":"Probar el parser con repos grandes","kind":"idea"}'
```

## Por qué `EUI_DATABASE.sqlite`

Porque el almacén viaja con el repo que se analiza y tiene que ser reconocible: un
binario sin extensión no lo abre ningún visor y en un diff no se sabe qué es.
`.sqlite` lo dice de un vistazo, y los auxiliares `-wal`/`-shm` quedan al lado,
ignorados por el `.gitignore` que escribe el seed en `.EUI/`. Un `EUI_DATABASE`
viejo (sin extensión) se renombra solo, con sus auxiliares, la primera vez que se
abre.

El contenido de `repos/` no se commitea: es el material que se analiza, no parte
del producto. El `.gitignore` de esa carpeta ignora todo salvo a sí mismo.
