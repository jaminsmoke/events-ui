# Migración de Markdown

Pautas para el agente que convierte roadmaps, backlogs y notas en Markdown en
ideas de Events UI. La regla corta: **el agente propone, el importador decide y
aplica**. Nadie escribe el almacén a mano ni llama a la API cruda.

## Flujo

1. `eui migrate scan <ruta>` lee la carpeta (o un Markdown suelto) y devuelve
   cada fichero con su `sha256`, su frontmatter simple, sus títulos y sus
   tareas. Solo lee: ni el almacén ni el Markdown se tocan.
2. Lee los ficheros del scan y decide qué es una idea y qué es contexto.
3. Escribe `plan.json` con las ideas y su `origen` (fichero, rango de líneas y
   `sha256` del scan). No inventes uids: los pone el importador.
4. `eui migrate check plan.json` valida el esquema, los refs, las
   dependencias, los ciclos y el `sha256` de cada origen, y enseña lo que se
   crearía sin escribir nada. Sale con 0 si se aplicaría, 1 si hay problemas y
   2 si el plan no se puede leer.
5. `eui migrate apply plan.json` aplica el lote de una vez. Cada idea entra en
   el carril que declara el plan: `proposed` por defecto, `draft` para notas
   sin triar, `historial` para lo hecho y `rejected` con `motivo` para lo que
   no se hace. El core escribe el lote entero en una transacción: si una idea
   falla, no queda ninguna. La huella del plan identifica el lote, así que
   repetir el mismo `apply` devuelve el mismo lote y no duplica nada.
6. `eui migrate undo <lote>` deshace solo lo que creó ese lote. Si una idea
   cambió de carril, se editó después de crearse o una ficha ajena la usa como
   sustituta, no borra nada y enumera los conflictos (409). Las que el usuario
   ya borró a mano se cuentan como ausentes y el resto se deshace igual.
7. `eui migrate absorb <lote> --dry-run` prepara la retirada del origen, pero
   **no escribe**: comprueba la cobertura por fichero, los hashes y la copia que
   se generaría. `--confirmar` copia el origen, deja el manifiesto y **elimina**
   el Markdown; `undo` restaura la copia si el hash sigue.
8. `eui migrate export <ruta>` reconstruye el Markdown actual desde SQLite,
   agrupado por carril y ordenado por la procedencia. Es la vista del documento
   una vez retirado, sin duplicar el contenido en el repo.

El plan y el apply llegan con el importador; mientras tanto, `scan` y estas
pautas son la preparación. Guarda el plan donde diga el usuario; si no dice
nada, junto al Markdown de origen (p. ej. `ROADMAP.plan.json`). **No** lo
pongas dentro de `.EUI/`: esa carpeta solo admite el almacén, su `.gitignore`
y las copias de absorción en `migracion/<lote>/`.

## Qué es una idea

- **Un elemento accionable, una idea.** Una viñeta, una fila de tabla o una
  sección con un trabajo concreto. Un encabezado que solo agrupa (`## Backlog`)
  no es una idea: es contexto.
- `title`: el texto del elemento, sin numeración, sin `-` ni `[ ]`, sin
  prefijos de tipo. Si empieza por verbo, déjalo en imperativo.
- `description`: una o tres frases con lo que pide el elemento.
- `content`: el cuerpo completo del elemento en Markdown, desde su título hasta
  el siguiente del mismo nivel.
- `kind`: siempre `idea`. `adr` y `note` son históricos y no se crean.
- `tags`: las etiquetas que ya estén escritas (frontmatter, `labels`,
  `[tags]`), en minúsculas, sin repetir y sin inventar.
- `status`: decide el carril, sin adivinar. Pendiente explícito → `proposed`;
  nota cruda o sin triar → `draft`; «hecho», «completado» o una sección de
  historial → `historial`; «no se hace» o «descartado» → `rejected` con
  `motivo`. Si el documento no lo dice, no lo inventes: `proposed` o `draft`.
- `depende_de`: solo si el elemento lo dice de forma explícita («depende de»,
  «después de», «bloqueada por»). Resuelve el título contra otra idea del mismo
  plan con `ref`; si no hay referencia clara, se deja vacío.
- `fases`: solo con `status: proposed`, si el elemento lista pasos propios de
  ejecución. Todas entran en `pendiente`, sin fechas, y cada una con al menos
  un requisito. `historial` y `rejected` no llevan fases.
- `requisitos`: las viñetas hijas que sean criterios de hecho, con
  `hecho: false`. Marcarlas como hechas es una decisión del usuario.

## Origen e idempotencia

Cada idea del plan lleva:

```json
"origen": {
  "ruta": "docs/roadmap.md",
  "desde_linea": 12,
  "hasta_linea": 31,
  "sha256": "…"
}
```

Las líneas son 1-based e incluyen título y cuerpo del elemento; el `sha256` es
el del scan. Sin origen no hay forma de saber si el Markdown cambió entre el
plan y el apply, y el lote dejaría de ser repetible.

## El plan

`eui schema migrate --pretty` publica el JSON Schema (draft 2020-12) del plan;
sin `--pretty` sale en una línea. La forma es `{"version": 2, "ideas": [...]}`,
con una idea por elemento migrado. La v1 solo admitía `proposed`; la v2 añade
destinos, fechas y motivo, y sigue aceptando planes v1 que solo crean ideas:

- `ref` identifica la idea dentro del plan (`idea-1`, `backlog-login`…) y es lo
  que usa `depende_de`; no es un uid y no puede repetirse.
- `kind` siempre `idea`; `status` puede ser `proposed`, `draft`, `historial`
  o `rejected`; fases solo para `proposed`, en `pendiente` y con requisitos sin
  marcar. `rejected` exige `motivo`.
- `fecha` (ISO 8601) solo con `historial` o `rejected`; sin ella se usa la de
  importación. Lo demás se rechaza antes de mirar el repo.
- Cada idea exige `origen` con `ruta`, `desde_linea`, `hasta_linea` y `sha256`.
  Las líneas son 1-based e incluyen el título y el cuerpo del elemento.
- `check` añade lo que el esquema no puede comprobar: `ref` repetidos,
  dependencias que no existan o formen ciclo, `origen.ruta` fuera del repo y un
  `sha256` que ya no cuadre con el fichero actual.

## El lote

`apply` no crea ideas sueltas: crea un lote. `migracion_lote` guarda la huella
canónica del plan (`sha256`), la fecha y el número de ideas; `migracion_idea`
guarda de cada una su `ref`, el fichero de origen, el rango de líneas y el
`sha256`, más la fecha de creación. La huella es única: el mismo plan enviado
dos veces devuelve el mismo lote con `repetido: true` y no escribe nada.

Las ideas nacen en su carril (las de la cola, al final), con sus fases
pendientes y requisitos sin marcar si es `proposed`; `depende_de` se resuelve
de refs a uids dentro del lote. La procedencia guarda también ese carril, así
que `undo` sabe cuál esperar. Un fallo a mitad deshace la transacción entera,
igual al deshacer.

`undo` usa la procedencia: borra en una transacción solo las ideas del lote y
se niega entero (409, con la lista de conflictos) si alguna está en un carril
distinto del que guardó el lote, se editó después de crearse —`updated_at` ya
no coincide con `creada_at`— o una ficha de fuera del lote la usa como
sustituta. No se lleva por delante las
listas `depende_de` de las supervivientes: les retira los uids del lote. El
lote y su procedencia desaparecen con las ideas.

## Absorción en seco

`absorb` trabaja con el lote ya aplicado y con **toda la procedencia del mismo
fichero**, no solo con las ideas de ese lote: un ROADMAP puede haber entrado en
varias tandas y todas cuentan. Para cada fichero:

- agrupa los rangos de `migracion_idea` por `ruta` y los fusiona;
- considera bloques las viñetas accionables (hojas) fuera de frontmatter y de
  bloques de código: una cabecera con subitems no cuenta, pero sus hijos sí;
- marca como hueco cada bloque cuya línea no cae en ningún rango;
- compara el `sha256` actual con el de todas las filas de procedencia: si el
  fichero cambió, no propone absorber;
- calcula la copia en `.EUI/migracion/<lote>/<ruta>` y verifica que el
  documento se puede retirar.

El informe sale con `ok: false` y `retirar: []` si hay huecos, hashes viejos,
ficheros ausentes o un documento sin bloques. `--dry-run` no crea
`.EUI/migracion/` y no borra nada. `--confirmar` solo actúa si el informe está
en verde: copia el origen en `.EUI/migracion/<lote>/`, deja un manifiesto
`absorcion.json` con los hashes y elimina el Markdown. `undo` restaura la copia
antes de borrar las ideas del lote, y `migrate export` genera la vista Markdown
desde `migracion_idea` + `idea_data`.

## Lo que no se hace

- No editar, mover ni borrar el Markdown de origen durante `scan`, `check` o
  `apply`. `absorb --dry-run` solo informa; la retirada con copia exige
  `--confirmar` explícito. La migración es un alta, no una reescritura del
  repo.
- No inventar ideas, estados, fechas, responsables ni uids.
- No importar bloques de código, tablas de ejemplo ni citas como ideas: son
  contenido, no trabajo.
- No meter secretos. Si un bloque parece credenciales, se descarta y se avisa.
- No mover a roadmap ni verificación. A `historial` o `rejected` solo si el
  documento lo dice, con fecha y motivo cuando toque.
- No tocar `.EUI/` ni commitear. El commit lo decide el usuario después de
  revisar el lote.

## Antes de aplicar

- [ ] `check` sale sin errores ni avisos nuevos.
- [ ] Cada idea tiene `origen` con `sha256` y su rango de líneas.
- [ ] No hay dos ideas con la misma referencia ni con el mismo título y origen.
- [ ] Los totales del plan cuadran con el resumen del scan.
- [ ] Cada idea está en el carril que dice el documento; ninguna inventada.
- [ ] `historial` y `rejected` no llevan fases; los descartes tienen motivo.
- [ ] Cada fase tiene al menos un requisito y ningún requisito viene marcado.
