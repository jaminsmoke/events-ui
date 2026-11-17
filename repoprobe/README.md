# repoprobe

Laboratorio de pruebas. Aquí se deja el código que se va a analizar: una carpeta
vacía, un clon o una copia, da igual. Sirve para probar el sistema contra material
que no hemos inventado.

```
repoprobe/
  repos/            clones de repos investigados (ignorados por git)
    <repo>/
      .EUI/         lo crea el seed, no se escribe a mano
        EUI_DATABASE      SQLite con la tabla `ideas`
        .gitignore        ignora los auxiliares -wal / -shm
```

## Sembrar un repo

```bash
# si vas a analizar un repo, déjalo dentro (clon, copia, lo que sea)
git clone <url> repoprobe/repos/<repo>
corepack pnpm core:seed <repo>
```

Equivalente sin pnpm:

```bash
uv run --directory services/core python -m events_core.seed <repo>
```

El seed es idempotente y aplica `services/core/src/events_core/schema/ideas.sql`.
Crea `repoprobe/repos/<repo>/.EUI/EUI_DATABASE` si no existe.

## Operar sin scripts

```bash
corepack pnpm core:dev
```

- `GET /docs` — Swagger, para probar a mano.
- `GET /openapi.json` — el contrato del que saldrán los tipos TS.
- `GET /repos` — repos ya sembrados.
- `GET|POST/PATCH|DELETE /repos/{repo}/ideas` — CRUD de ideas y ADRs.

Ejemplo:

```bash
curl -X POST http://127.0.0.1:8000/repos/<repo>/ideas \
  -H 'content-type: application/json' \
  -d '{"title":"Probar el parser con repos grandes","kind":"idea"}'
```

## Por qué `EUI_DATABASE` sin extensión

Porque el fichero es un artefacto del repo, no un temporal: el nombre fijo hace
que se encuentre siempre en el mismo sitio y evita que `*.db` lo barra de un
`.gitignore`. SQLite no necesita extensión.

El contenido de `repos/` no se commitea: es el material que se analiza, no parte
del producto. El `.gitignore` de esa carpeta ignora todo salvo a sí mismo.
