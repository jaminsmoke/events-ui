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
4. `eui migrate check plan.json` valida esquema, referencias y duplicados y
   enseña el diff sin aplicar nada.
5. `eui migrate apply plan.json` aplica el lote de una vez. Todas las ideas
   entran en `proposed`; ninguna en otro carril.
6. `eui migrate undo <lote>` deshace solo lo que creó ese lote, y se niega si
   alguien movió o editó una idea después.

El plan y el apply llegan con el importador; mientras tanto, `scan` y estas
pautas son la preparación. Guarda el plan donde diga el usuario; si no dice
nada, en `.EUI/migracion/plan.json` (no se versiona).

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
- `status`: **siempre `proposed`**. Un Markdown que diga «hecho», «en curso» o
  «aprobado» no cambia el carril: el estado se decide en la app, no se adivina.
- `depende_de`: solo si el elemento lo dice de forma explícita («depende de»,
  «después de», «bloqueada por»). Resuelve el título contra otra idea del mismo
  plan con `ref`; si no hay referencia clara, se deja vacío.
- `fases`: solo si el elemento lista pasos propios de ejecución. Todas entran
  en `pendiente`, sin fechas.
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

## Lo que no se hace

- No editar, mover ni borrar el Markdown de origen. La migración es un alta,
  no una reescritura del repo.
- No inventar ideas, estados, fechas, responsables ni uids.
- No importar bloques de código, tablas de ejemplo ni citas como ideas: son
  contenido, no trabajo.
- No meter secretos. Si un bloque parece credenciales, se descarta y se avisa.
- No tocar `.EUI/`, no commitear y no mover nada a roadmap, verificación o
  historial. El commit lo decide el usuario después de revisar el lote.

## Antes de aplicar

- [ ] `check` sale sin errores ni avisos nuevos.
- [ ] Cada idea tiene `origen` con `sha256` y su rango de líneas.
- [ ] No hay dos ideas con la misma referencia ni con el mismo título y origen.
- [ ] Los totales del plan cuadran con el resumen del scan.
- [ ] Todo está en `proposed`; ni una idea en otro carril.
