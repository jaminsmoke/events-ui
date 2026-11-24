# Migración de Markdown

Pautas para el agente que convierte roadmaps, backlogs y notas en Markdown en
ítems de Events UI. La regla corta: **el agente propone, el importador decide y
aplica**. Nadie escribe el almacén a mano ni llama a la API cruda.

## Quién crea un documento

Un documento es un Markdown que la migración leyó, clasificó e importó: sus
ítems viven en el almacén y su vista se genera con `eui migrate export`. No hay
otra forma de crear uno.

- **Solo la CLI o el MCP.** `eui migrate absorb <lote> --confirmar` copia el
  origen a `.EUI/migracion/<lote>/` y lo retira; la herramienta `migrate_absorb`
  del MCP hace lo mismo. Nada más escribe un documento.
- **Nunca a mano en el repo.** Un Markdown escrito a mano no entra en
  `/documentos` ni en `export`: no tiene lote, ni procedencia, ni copia. Si
  tiene que contar, se pasa por `scan` → `plan` → `apply` → `absorb`.
- **Nunca directamente dentro de `.EUI`.** Esa carpeta solo admite el almacén,
  su `.gitignore` y las copias `migracion/<lote>/…`. Un Markdown suelto ahí no
  es un documento: se rechaza al escribirlo y se purga al abrir el almacén.

`eui migrate guard` revisa las tres señales de suplantación: un Markdown suelto
dentro de `.EUI`, una ruta que la absorción retiró y ha vuelto, y un marcador
`[eui:<uid>]` cuyo uid no está en el almacén. Lista lo que encuentra y sale con
1 si hay algo; no escribe ni borra. Un README o una guía a mano no salen: no
pretenden ser documentos de Events UI.

## Flujo

1. `eui migrate scan <ruta>` lee la carpeta (o un Markdown suelto) y devuelve
   cada fichero con su `sha256`, su frontmatter simple, sus títulos y sus
   tareas. Solo lee: ni el almacén ni el Markdown se tocan.
2. `eui migrate classify <ruta>` (alias `migrate plan`) propone el manifiesto
   `documentos`: cada Markdown con `ruta`, `clase` (`mapa` / `referencia` /
   `parcial`), `motivo` y `destino`. La allowlist del mapa son `mapa` y
   `parcial`; el resto queda como referencia y no crea ítems. Revisa el
   resultado antes de pegarlo en el plan.
3. Lee los ficheros del scan y decide qué es un ítem y qué es contexto. Solo
   saca ítems de documentos en la allowlist.
4. Escribe `plan.json` v3 con `documentos`, los ítems y su `origen` (fichero,
   rango de líneas y `sha256` del scan). No inventes uids: los pone el
   importador. Un `parcial` declara `rangos`; los ítems de ese fichero tienen
   que caer dentro.
5. `eui migrate check plan.json` valida el esquema, los refs, las
   dependencias, los ciclos, el `sha256` de cada origen, la clasificación y
   que no queden bloques accionables sin cubrir en los documentos `mapa` /
   `parcial`. Sale con 0 si se aplicaría, 1 si hay problemas y 2 si el plan
   no se puede leer.
6. `eui migrate apply plan.json` aplica el lote de una vez. Cada ítem entra en
   el carril que declara el plan: `proposed` por defecto, `draft` para notas
   sin triar, `historial` para lo hecho y `rejected` con `motivo` para lo que
   no se hace. El core escribe el lote entero en una transacción: si un ítem
   falla, no queda ninguno. La huella del plan identifica el lote, así que
   repetir el mismo `apply` devuelve el mismo lote y no duplica nada.
7. `eui migrate undo <lote>` deshace solo lo que creó ese lote. Si un ítem
   cambió de carril, se editó después de crearse o una ficha ajena la usa como
   sustituto, no borra nada y enumera los conflictos (409). Las que el usuario
   ya borró a mano se cuentan como ausentes y el resto se deshace igual.
8. `eui migrate absorb <lote> --dry-run` prepara la retirada del origen, pero
   **no escribe**: comprueba la cobertura por fichero, los hashes y la copia que
   se generaría. `--confirmar` copia el origen, deja el manifiesto y **elimina**
   el Markdown; `undo` restaura la copia si el hash sigue. Con `--parcial`
   (nunca por defecto) se permiten huecos: exige rangos sin solapar, retira
   solo los bloques del lote y deja un marcador visible `- [eui:<uid>] …` en
   el origen.
9. `eui migrate export <ruta>` reconstruye el Markdown actual desde SQLite,
   agrupado por carril y ordenado por la procedencia. Es la vista del documento
   una vez retirado, sin duplicar el contenido en el repo.

Guarda el plan donde diga el usuario; si no dice nada, junto al Markdown de
origen (p. ej. `ROADMAP.plan.json`). **No** lo pongas dentro de `.EUI/`: esa
carpeta solo admite el almacén, su `.gitignore` y las copias de absorción en
`migracion/<lote>/`.

## Qué es un ítem

- **Un elemento accionable, un ítem.** Una viñeta, una fila de tabla o una
  sección con un trabajo concreto. Un encabezado que solo agrupa (`## Backlog`)
  no es un ítem: es contexto.
- `title`: el texto del elemento, sin numeración, sin `-` ni `[ ]`, sin
  prefijos de tipo. Si empieza por verbo, déjalo en imperativo.
- `description`: una o tres frases con lo que pide el elemento.
- `content`: el cuerpo completo del elemento en Markdown, desde su título hasta
  el siguiente del mismo nivel.
- `kind`: siempre `work_item`. `adr` y `note` son históricos y no se crean;
  un plan v1-v3 con `idea` se guarda como `work_item`.
- `tags`: las etiquetas que ya estén escritas (frontmatter, `labels`,
  `[tags]`), en minúsculas, sin repetir y sin inventar.
- `status`: decide el carril, sin adivinar. Pendiente explícito → `proposed`;
  nota cruda o sin triar → `draft`; «hecho», «completado» o una sección de
  historial → `historial`; «no se hace» o «descartado» → `rejected` con
  `motivo`. Si el documento no lo dice, no lo inventes: `proposed` o `draft`.
- `depende_de`: solo si el elemento lo dice de forma explícita («depende de»,
  «después de», «bloqueada por»). Resuelve el título contra otro ítem del mismo
  plan con `ref`; si no hay referencia clara, se deja vacío.
- `fases`: solo con `status: proposed`, si el elemento lista pasos propios de
  ejecución. Todas entran en `pendiente`, sin fechas, y cada una con al menos
  un requisito. `historial` y `rejected` no llevan fases.
- `requisitos`: las viñetas hijas que sean criterios de hecho, con
  `hecho: false`. Marcarlas como hechas es una decisión del usuario.

## Origen e idempotencia

Cada ítem del plan lleva:

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
sin `--pretty` sale en una línea. La forma v3 es
`{"version": 3, "documentos": [...], "items": [...]}` (cada elemento es un
`PlanWorkItem`; un plan guardado con `ideas` se sigue aceptando). La v1 solo admitía
`proposed`; la v2 añade destinos, fechas y motivo; la v3 añade el manifiesto
de documentos. Las v1/v2 siguen válidas sin `documentos`.

- `documentos[]` (v3): `ruta`, `clase` (`mapa` / `referencia` / `parcial`),
  `motivo` y `destino` (`mapa` / `referencia`). `parcial` exige `rangos`
  `[{desde, hasta}]`. Solo `mapa` y `parcial` alimentan el mapa.
- `ref` identifica el ítem dentro del plan (`item-1`, `backlog-login`…) y es lo
  que usa `depende_de`; no es un uid y no puede repetirse.
- `kind` siempre `work_item` (el `idea` de un plan v1-v3 se normaliza);
  `status` puede ser `proposed`, `draft`, `historial`
  o `rejected`; fases solo para `proposed`, en `pendiente` y con requisitos sin
  marcar. `rejected` exige `motivo`.
- `fecha` (ISO 8601) solo con `historial` o `rejected`; sin ella se usa la de
  importación. Lo demás se rechaza antes de mirar el repo.
- Cada ítem exige `origen` con `ruta`, `desde_linea`, `hasta_linea` y `sha256`.
  Las líneas son 1-based e incluyen el título y el cuerpo del elemento. La
  `ruta` tiene que estar clasificada en la allowlist.
- `check` añade lo que el esquema no puede comprobar: `ref` repetidos,
  dependencias que no existan o formen ciclo, `origen.ruta` fuera del repo, un
  `sha256` que ya no cuadre, documentos sin clasificar, ítems saliendo de
  `referencia`, bloques accionables sin cubrir y rangos de `parcial`.

## El lote

`apply` no crea ítems sueltos: crea un lote. `migracion_lote` guarda la huella
canónica del plan (`sha256`), la fecha y el número de ítems; `migracion_item`
guarda de cada uno su `ref`, el fichero de origen, el rango de líneas y el
`sha256`, más la fecha de creación. La huella es única: el mismo plan enviado
dos veces devuelve el mismo lote con `repetido: true` y no escribe nada.

Los ítems nacen en su carril (las de la cola, al final), con sus fases
pendientes y requisitos sin marcar si es `proposed`; `depende_de` se resuelve
de refs a uids dentro del lote. La procedencia guarda también ese carril, así
que `undo` sabe cuál esperar. Un fallo a mitad deshace la transacción entera,
igual al deshacer.

`undo` usa la procedencia: borra en una transacción solo los ítems del lote y
se niega entero (409, con la lista de conflictos) si alguna está en un carril
distinto del que guardó el lote, se editó después de crearse —`updated_at` ya
no coincide con `creada_at`— o una ficha de fuera del lote la usa como
sustituta. No se lleva por delante las
listas `depende_de` de las supervivientes: les retira los uids del lote. El
lote y su procedencia desaparecen con los ítems.

## Absorción en seco

`absorb` trabaja con el lote ya aplicado y con **toda la procedencia del mismo
fichero**, no solo con los ítems de ese lote: un ROADMAP puede haber entrado en
varias tandas y todas cuentan. Para cada fichero:

- agrupa los rangos de `migracion_item` por `ruta` y los fusiona;
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
antes de borrar los ítems del lote, y `migrate export` genera la vista Markdown
desde `migracion_item` + `work_item_data`.

`--parcial` es opt-in. Sirve cuando aún quedan bloques sin migrar: el informe
exige rangos de procedencia sin solapar, planea un marcador `- [eui:<uid>]`
por cada ítem del lote y deja el resto del fichero. `--confirmar --parcial`
copia el original, reescribe el origen con esos marcadores y guarda
`sha256_stub` en el manifiesto para que `undo` pueda restaurar si el fichero
no cambió después. Si la cobertura ya es total, hay que usar absorb sin
`--parcial`.

## Lo que no se hace

- No editar, mover ni borrar el Markdown de origen durante `scan`, `check` o
  `apply`. `absorb --dry-run` solo informa; la retirada con copia exige
  `--confirmar` explícito. La absorción parcial tampoco es automática: hace
  falta `--parcial`. La migración es un alta, no una reescritura del repo.
- No inventar ítems, estados, fechas, responsables ni uids.
- No importar bloques de código, tablas de ejemplo ni citas como ítems: son
  contenido, no trabajo.
- No meter secretos. Si un bloque parece credenciales, se descarta y se avisa.
- No mover a roadmap ni verificación. A `historial` o `rejected` solo si el
  documento lo dice, con fecha y motivo cuando toque.
- No tocar `.EUI/` ni commitear. El commit lo decide el usuario después de
  revisar el lote.

## Histórico `idea`

El plan ya escribe `items` y su elemento se llama `PlanWorkItem`. `kind` sigue
aceptando el `idea` de un plan v1-v3 y lo guarda como `work_item`, y la clave
`ideas` de un plan guardado se acepta como alias de `items` al leer. La API ya
solo publica `/items` y el lote vive en `migracion_item` (0035).

## Antes de aplicar

- [ ] `check` sale sin errores ni avisos nuevos.
- [ ] El plan v3 trae `documentos` y cada origen cae en la allowlist.
- [ ] Los `mapa`/`parcial` no dejan bloques accionables sin ítem.
- [ ] Cada ítem tiene `origen` con `sha256` y su rango de líneas.
- [ ] No hay dos ítems con la misma referencia ni con el mismo título y origen.
- [ ] Los totales del plan cuadran con el resumen del scan.
- [ ] Cada ítem está en el carril que dice el documento; ninguno inventado.
- [ ] `historial` y `rejected` no llevan fases; los descartes tienen motivo.
- [ ] Cada fase tiene al menos un requisito y ningún requisito viene marcado.
