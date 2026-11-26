/** Los guiones de las pruebas del laboratorio: datos, no pantalla.
 *
 *  Cada prueba es una lista de pasos que llaman a la API del repo abierto;
 *  el componente `Pruebas` solo los ejecuta y pinta el progreso.
 */

import type { WorkItemCreate, WorkItemUpdate } from "@events-ui/ui";

export type Acciones = {
  crear: (body: WorkItemCreate) => Promise<{ uid: string } | null>;
  mover: (uid: string, status: WorkItemCreate["status"]) => Promise<void>;
  editar: (uid: string, cambios: WorkItemUpdate) => Promise<void>;
  /** Commit local escrito desde el panel, como lo haría una persona. */
  commit: (mensaje: string) => Promise<unknown>;
  /** Archivos sin commit ahora mismo, para avisar antes de commitear. */
  cambios: number;
  /** Cambiar de mapa: la prueba se ve donde ocurre, no donde se lanzó. */
  abrirMapa: (mapa: "items" | "git" | "documentos") => void;
};

export type Paso = { texto: string; ejecutar: () => Promise<void> };

type Prueba = {
  id: string;
  nombre: string;
  descripcion: string;
  construir: (c: Acciones) => Paso[];
};

export const ESPERA_ENTRE_PASOS_MS = 1100;

/** Respiro para mirar un estado antes de seguir (solo en las pruebas). */
const mirar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Una fase del taller, en el formato del PATCH. */
export type Fase = NonNullable<WorkItemUpdate["fases"]>[number];
export type EstadoFase = Fase["estado"];

/** Una fase con su checklist; cada requisito toma el orden de su posición. */
export function fase(
  orden: number,
  titulo: string,
  estado: EstadoFase,
  requisitos: [titulo: string, hecho: boolean][],
  nota = "",
): Fase {
  return {
    orden,
    titulo,
    estado,
    nota,
    requisitos: requisitos.map(([nombre, hecho], i) => ({ orden: i + 1, titulo: nombre, hecho })),
  };
}

/** El uid de un ítem que la prueba crea: sin creación previa, el paso avisa. */
export function exigirUid(uid: () => string | null): () => string {
  return () => {
    const creado = uid();
    if (!creado) throw new Error("Falta el uid del ítem creado.");
    return creado;
  };
}

/** El ítem de una prueba: se crea una vez y su uid queda a mano. */
export function item(crear: Acciones["crear"]) {
  let uid: string | null = null;
  return {
    async crear(body: WorkItemCreate): Promise<void> {
      const idea = await crear(body);
      if (!idea) throw new Error("El core no devolvió el ítem creado.");
      uid = idea.uid;
    },
    uid: exigirUid(() => uid),
  };
}

/** La fase «Diseño» de una comprobación que comparten dos pruebas. */
const diseno = (estado: "pendiente" | "completada"): Fase[] => [
  fase(1, "Diseño", estado, [["Comprobar", estado === "completada"]]),
];

export const PRUEBAS: Prueba[] = [
  {
    id: "prueba-1",
    nombre: "Reparto y limpieza",
    descripcion:
      "Crea 10 ítems, mueve 7 a Backlog y descarta 3. Deja seis segundos para ver el reparto. " +
      "Al terminar, detenerse o fallar, se vacían todos los ítems, fichas y eventos del laboratorio, incluidos los datos anteriores.",
    construir: ({ crear, mover, editar }) => {
      const creadas: string[] = [];
      const pasos: Paso[] = [];
      for (let i = 1; i <= 10; i++) {
        const titulo = `Reparto · ${i}`;
        pasos.push({
          texto: `Crear «${titulo}»`,
          ejecutar: async () => {
            const idea = await crear({
              title: titulo,
              description: `Elemento ${i} del reparto.`,
              content: `Elemento ${i} del reparto.`,
              kind: "work_item",
              status: "draft",
            });
            if (!idea) throw new Error("El core no devolvió el ítem creado.");
            creadas.push(idea.uid);
          },
        });
      }
      for (let i = 0; i < 7; i++) {
        pasos.push({
          texto: `Backlog: «Reparto · ${i + 1}»`,
          ejecutar: async () => {
            const uid = creadas[i];
            if (!uid) throw new Error("Falta el uid de un ítem creado.");
            await mover(uid, "proposed");
          },
        });
      }
      const motivos = [
        "No aporta a este ciclo",
        "Duplica a otra del lote",
        "Fuera del alcance de la prueba",
      ];
      motivos.forEach((motivo, i) => {
        const indice = 7 + i;
        pasos.push({
          texto: `Descartar «Reparto · ${indice + 1}» (${motivo})`,
          ejecutar: async () => {
            const uid = creadas[indice];
            if (!uid) throw new Error("Falta el uid de un ítem creado.");
            await editar(uid, { status: "rejected", rejected_description: motivo });
          },
        });
      });
      return pasos;
    },
  },
  {
    id: "mapa-completo",
    nombre: "Mapa completo por carriles",
    descripcion:
      "Siembra ítems en todos los carriles con fases en varios estados, requisitos, motivos y dependencias, " +
      "para ver los seis cables, sus compuertas, los contadores y las fichas. Después vacía el laboratorio.",
    construir: ({ crear, editar }) => {
      const pasos: Paso[] = [];
      const uids: Record<string, string> = {};
      const sembrar = (
        clave: string,
        body: WorkItemCreate,
        donde: string,
        completar?: (uid: string) => Promise<void>,
      ) => {
        pasos.push({
          texto: `Crear «${body.title}» en ${donde}`,
          ejecutar: async () => {
            const idea = await crear(body);
            if (!idea) throw new Error("El core no devolvió el ítem creado.");
            uids[clave] = idea.uid;
            if (completar) await completar(idea.uid);
          },
        });
      };

      for (let i = 1; i <= 4; i++) {
        sembrar(
          `entrada-${i}`,
          {
            title: `Entrada · ${i}`,
            description: `Ítem ${i} recién capturado, todavía sin carril.`,
            content: "",
            kind: "work_item",
            status: "draft",
          },
          "la entrada",
        );
      }
      for (let i = 1; i <= 3; i++) {
        sembrar(
          `cola-${i}`,
          {
            title: `Cola · ${i}`,
            description: `Ítem ${i} esperando su turno en la cola.`,
            content: "",
            kind: "work_item",
            status: "proposed",
          },
          "Backlog",
        );
      }
      sembrar(
        "roadmap",
        {
          title: "Roadmap · en curso con fases",
          description: "Una fase completada, otra fallida con motivo y una pendiente.",
          content: "",
          kind: "work_item",
          status: "roadmap",
        },
        "roadmap",
        async (uid) => {
          await editar(uid, {
            fases: [
              fase(1, "Diseño", "completada", [
                ["Cerrar el alcance", true],
                ["Validar con el equipo", true],
              ]),
              fase(
                2,
                "Implementación",
                "fallida",
                [["Repetir la integración", false]],
                "La API cambió a mitad del trabajo.",
              ),
              fase(3, "Revisión", "pendiente", [["Revisar el resultado", false]]),
            ],
          });
        },
      );
      sembrar(
        "verificacion-1",
        {
          title: "Verificación · lista para aprobar",
          description: "Dos fases completadas con todos sus requisitos.",
          content: "",
          kind: "work_item",
          status: "verificacion",
        },
        "verificación",
        async (uid) => {
          await editar(uid, {
            fases: [
              fase(1, "Implementación", "completada", [
                ["Código integrado", true],
                ["Pruebas en verde", true],
              ]),
              fase(2, "Documentación", "completada", [["Guía actualizada", true]]),
            ],
          });
        },
      );
      sembrar(
        "verificacion-2",
        {
          title: "Verificación · con una fase rechazada y un título que ocupa más de una línea",
          description:
            "Una fase completada y otra rechazada, que no cuenta para aprobar; el título largo enseña cómo envuelve la ficha.",
          content: "",
          kind: "work_item",
          status: "verificacion",
        },
        "verificación",
        async (uid) => {
          await editar(uid, {
            fases: [
              fase(1, "Implementación", "completada", [["Código integrado", true]]),
              fase(2, "Migración", "rechazada", [["Migrar los datos", false]]),
            ],
          });
        },
      );
      sembrar(
        "aprobada-1",
        {
          title: "Aprobada · firmada",
          description: "Un ítem que ya pasó la aprobación; el historial conserva sus fases.",
          content: "",
          kind: "work_item",
          status: "revision_aprobada",
        },
        "revisión aprobada",
        async (uid) => {
          await editar(uid, {
            fases: [fase(1, "Entrega", "completada", [["Entregado", true]])],
          });
        },
      );
      sembrar(
        "aprobada-2",
        {
          title: "Aprobada · con dos fases",
          description: "Otra aprobada para ver el carril con más de una ficha.",
          content: "",
          kind: "work_item",
          status: "revision_aprobada",
        },
        "revisión aprobada",
        async (uid) => {
          await editar(uid, {
            fases: [
              fase(1, "Diseño", "completada", [["Diseño cerrado", true]]),
              fase(2, "Entrega", "completada", [["Entrega revisada", true]]),
            ],
          });
        },
      );
      sembrar(
        "historial-1",
        {
          title: "Changelog · cerrada",
          description: "Un ítem terminado que conserva su fase y su requisito.",
          content: "",
          kind: "work_item",
          status: "historial",
        },
        "el historial",
        async (uid) => {
          await editar(uid, {
            fases: [fase(1, "Cierre", "completada", [["Comprobado", true]])],
          });
        },
      );
      sembrar(
        "historial-2",
        {
          title: "Changelog · con dos fases",
          description: "El Changelog también conserva varias fases completadas.",
          content: "",
          kind: "work_item",
          status: "historial",
        },
        "el historial",
        async (uid) => {
          await editar(uid, {
            fases: [
              fase(1, "Diseño", "completada", [["Diseño cerrado", true]]),
              fase(2, "Entrega", "completada", [["Entrega comprobada", true]]),
            ],
          });
        },
      );
      sembrar(
        "historial-3",
        {
          title: "Changelog · otra cerrada",
          description: "Una tercera ficha para ver el carril con varios ítems.",
          content: "",
          kind: "work_item",
          status: "historial",
        },
        "el historial",
        async (uid) => {
          await editar(uid, {
            fases: [fase(1, "Cierre", "completada", [["Comprobado", true]])],
          });
        },
      );
      const descartes = [
        {
          clave: "descartada-1",
          titulo: "Descartado · no aporta",
          motivo: "No aporta a este ciclo.",
        },
        {
          clave: "descartada-2",
          titulo: "Descartado · duplicada",
          motivo: "Duplica otro ítem del mismo lote.",
        },
        {
          clave: "descartada-3",
          titulo: "Reemplazado · por otro ítem",
          motivo: "Lo releva un ítem más reciente.",
          estado: "superseded" as const,
        },
      ];
      for (const descarte of descartes) {
        sembrar(
          descarte.clave,
          {
            title: descarte.titulo,
            description: "Descarte con motivo para ver la ficha del carril.",
            content: "",
            kind: "work_item",
            status: descarte.estado ?? "rejected",
          },
          "Descartadas",
          async (uid) => {
            await editar(uid, {
              status: descarte.estado ?? "rejected",
              rejected_description: descarte.motivo,
            });
          },
        );
      }
      // Las dependencias van al final: así el mapa enseña un chip verde
      // (aprobada/historial) y otro ámbar (cola) en la misma ficha.
      pasos.push({
        texto: "Encadenar dependencias: una aprobada, una pendiente y un historial",
        ejecutar: async () => {
          const roadmap = uids["roadmap"];
          const verificacion = uids["verificacion-1"];
          const aprobada = uids["aprobada-1"];
          const cola = uids["cola-1"];
          const historial = uids["historial-1"];
          if (!roadmap || !verificacion || !aprobada || !cola || !historial) {
            throw new Error("Faltan uids para las dependencias.");
          }
          await editar(roadmap, { depende_de: [aprobada, cola] });
          await editar(verificacion, { depende_de: [historial] });
        },
      });
      return pasos;
    },
  },
  {
    id: "cable-en-marcha",
    nombre: "Cable en marcha",
    descripcion:
      "Un ítem con la fase «Diseño» completada salta de carril en carril: cada salto abre en guiones el " +
      "cable de llegada y lo hace correr con la chispa. Encadena cinco saltos para poder mirarlo sin prisa. " +
      "Después vacía el laboratorio.",
    construir: ({ crear, mover, editar }) => {
      const nuevo = item(crear);
      // Con la fase completada pasan las compuertas de roadmap y verificación.
      // Volver a la cola es la única forma de repetir un cable ya visto, pero
      // allí la fase se reinicia: hay que volver a cerrarla para el segundo
      // salto a verificación.
      return [
        {
          texto: "Crear el ítem en Backlog",
          ejecutar: async () => {
            await nuevo.crear({
              title: "Marcha · cable",
              description: "Un ítem que salta de carril para ver el cable en marcha.",
              content: "Un ítem que salta de carril para ver el cable en marcha.",
              kind: "work_item",
              status: "proposed",
            });
          },
        },
        {
          texto: "Añadir la fase «Diseño» (pendiente)",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: diseno("pendiente") });
          },
        },
        {
          texto: "Mover a roadmap",
          ejecutar: async () => {
            await mover(nuevo.uid(), "roadmap");
          },
        },
        {
          texto: "Completar la fase «Diseño»",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: diseno("completada") });
          },
        },
        {
          texto: "Mover a verificación",
          ejecutar: async () => {
            await mover(nuevo.uid(), "verificacion");
          },
        },
        {
          texto: "Volver a Backlog",
          ejecutar: async () => {
            await mover(nuevo.uid(), "proposed");
          },
        },
        {
          texto: "Mover otra vez a roadmap",
          ejecutar: async () => {
            await mover(nuevo.uid(), "roadmap");
          },
        },
        {
          texto: "Completar «Diseño» otra vez",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: diseno("completada") });
          },
        },
        {
          texto: "Mover otra vez a verificación",
          ejecutar: async () => {
            await mover(nuevo.uid(), "verificacion");
          },
        },
      ];
    },
  },
  {
    id: "fases-aprobacion",
    nombre: "Fases hasta aprobar",
    descripcion:
      "Un ítem con la fase «Diseño» recorre cola, roadmap, verificación, aprobación y archivo: " +
      "se ve la compuerta pedir una fase, después exigirla completada y el pulso verde al llegar al historial.",
    construir: ({ crear, mover, editar }) => {
      const nuevo = item(crear);
      return [
        {
          texto: "Crear el ítem en Backlog",
          ejecutar: async () => {
            await nuevo.crear({
              title: "Fases · aprobación",
              description: "Un ítem que recorre el flujo con una fase.",
              content: "Un ítem que recorre el flujo con una fase.",
              kind: "work_item",
              status: "proposed",
            });
          },
        },
        {
          texto: "Añadir la fase «Diseño» (pendiente)",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: diseno("pendiente") });
          },
        },
        {
          texto: "Mover a roadmap (pide al menos una fase)",
          ejecutar: async () => {
            await mover(nuevo.uid(), "roadmap");
          },
        },
        {
          texto: "Completar la fase «Diseño»",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: diseno("completada") });
          },
        },
        {
          texto: "Mover a verificación (sin fases abiertas)",
          ejecutar: async () => {
            await mover(nuevo.uid(), "verificacion");
          },
        },
        {
          texto: "Aprobar y archivar en historial (todo completado)",
          ejecutar: async () => {
            await mover(nuevo.uid(), "revision_aprobada");
          },
        },
      ];
    },
  },
  {
    id: "fases-estados",
    nombre: "Fases: crear, completar y fallar",
    descripcion:
      "Cuatro fases esperan pendientes en la cola (ahí no se tocan) y, al entrar en roadmap, " +
      "recorren todos sus estados —completada, fallida, rechazada y pendiente— con pausas para " +
      "mirarlo. Después cierra las abiertas para pasar a verificación. Abre la fila «Fases · taller».",
    construir: ({ crear, mover, editar }) => {
      const nuevo = item(crear);
      // Se reenvía la lista entera en cada paso: el PATCH la reemplaza. Cada
      // fase nace con un requisito; al completarla se marca hecho.
      let fases: Fase[] = [];
      const anotar = (fase: Fase) => {
        fases = [...fases, fase];
      };
      const cambiar = (orden: number, estado: EstadoFase) => {
        fases = fases.map((fase) =>
          fase.orden === orden
            ? {
                ...fase,
                estado,
                requisitos: (fase.requisitos ?? []).map((requisito) => ({
                  ...requisito,
                  hecho: estado === "completada" ? true : requisito.hecho,
                })),
              }
            : fase,
        );
      };
      const guardar = () => editar(nuevo.uid(), { fases });
      return [
        {
          texto: "Crear «Fases · taller» en Backlog",
          ejecutar: async () => {
            await nuevo.crear({
              title: "Fases · taller",
              description: "Cuatro fases para ver todos sus estados.",
              content: "Cuatro fases para ver todos sus estados.",
              kind: "work_item",
              status: "proposed",
            });
          },
        },
        {
          texto: "Añadir «Diseño» (pendiente)",
          ejecutar: async () => {
            anotar(fase(1, "Diseño", "pendiente", [["Listo", false]]));
            await guardar();
          },
        },
        {
          texto: "Añadir «Pruebas» (pendiente)",
          ejecutar: async () => {
            anotar(fase(2, "Pruebas", "pendiente", [["Listo", false]]));
            await guardar();
          },
        },
        {
          texto: "Añadir «Revisión» (pendiente)",
          ejecutar: async () => {
            anotar(fase(3, "Revisión", "pendiente", [["Listo", false]]));
            await guardar();
          },
        },
        {
          texto: "Añadir «Publicar» (pendiente)",
          ejecutar: async () => {
            anotar(fase(4, "Publicar", "pendiente", [["Listo", false]]));
            await guardar();
          },
        },
        {
          texto: "Mirar las fases pendientes en la cola",
          ejecutar: () => mirar(3500),
        },
        {
          texto: "Mover a roadmap (todavía con fases abiertas)",
          ejecutar: async () => {
            await mover(nuevo.uid(), "roadmap");
          },
        },
        {
          texto: "Completar «Diseño»",
          ejecutar: async () => {
            cambiar(1, "completada");
            await guardar();
          },
        },
        {
          texto: "Fallar «Pruebas» (no pasa la carga)",
          ejecutar: async () => {
            fases = fases.map((fase) =>
              fase.orden === 2
                ? { ...fase, estado: "fallida", nota: "No pasa la carga" }
                : fase,
            );
            await guardar();
          },
        },
        {
          texto: "Rechazar «Revisión»",
          ejecutar: async () => {
            cambiar(3, "rechazada");
            await guardar();
          },
        },
        {
          texto: "Mirar los cuatro estados",
          ejecutar: () => mirar(3000),
        },
        {
          texto: "Mirar la compuerta cerrada de verificación",
          ejecutar: () => mirar(2000),
        },
        {
          texto: "Reabrir «Pruebas» (pendiente)",
          ejecutar: async () => {
            cambiar(2, "pendiente");
            await guardar();
          },
        },
        {
          texto: "Completar «Pruebas»",
          ejecutar: async () => {
            cambiar(2, "completada");
            await guardar();
          },
        },
        {
          texto: "Completar «Publicar»",
          ejecutar: async () => {
            cambiar(4, "completada");
            await guardar();
          },
        },
        {
          texto: "Mover a verificación",
          ejecutar: async () => {
            await mover(nuevo.uid(), "verificacion");
          },
        },
      ];
    },
  },
  {
    id: "fases-motivo",
    nombre: "Fases: el motivo sobrevive",
    descripcion:
      "Una fase rechazada con motivo vuelve con el ítem a la cola: se queda pendiente, pero no " +
      "pierde el motivo. Abre la fila «Motivo · fases» para verlo antes y después.",
    construir: ({ crear, mover, editar }) => {
      const nuevo = item(crear);
      const motivo = "No cubre el caso borde";
      const revisar = fase(1, "Revisar", "pendiente", [["Comprobar", false]]);
      return [
        {
          texto: "Crear «Motivo · fases» en Backlog",
          ejecutar: async () => {
            await nuevo.crear({
              title: "Motivo · fases",
              description: "Una fase fallida que vuelve con su motivo.",
              content: "Una fase fallida que vuelve con su motivo.",
              kind: "work_item",
              status: "proposed",
            });
          },
        },
        {
          texto: "Añadir la fase «Revisar»",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: [revisar] });
          },
        },
        {
          texto: "Mover a roadmap",
          ejecutar: async () => {
            await mover(nuevo.uid(), "roadmap");
          },
        },
        {
          texto: `Rechazar «Revisar» con el motivo «${motivo}»`,
          ejecutar: async () => {
            await editar(nuevo.uid(), {
              fases: [{ ...revisar, estado: "rechazada", nota: motivo }],
            });
          },
        },
        {
          texto: "Mirar el motivo en roadmap",
          ejecutar: () => mirar(2500),
        },
        {
          texto: "Mover a verificación",
          ejecutar: async () => {
            await mover(nuevo.uid(), "verificacion");
          },
        },
        {
          texto: "Volver a Backlog",
          ejecutar: async () => {
            await mover(nuevo.uid(), "proposed");
          },
        },
        {
          texto: "Mirar el motivo conservado",
          ejecutar: () => mirar(4000),
        },
      ];
    },
  },
  {
    id: "fases-requisitos",
    nombre: "Fases con requisitos",
    descripcion:
      "Una fase con dos requisitos: nacen pendientes en la cola, se marcan en roadmap y la fase " +
      "solo se completa cuando están los dos. Abre la fila «Requisitos · fases» y su checklist.",
    construir: ({ crear, mover, editar }) => {
      const nuevo = item(crear);
      const revisar = (estado: EstadoFase, hechos: boolean[]): Fase[] => [
        fase(1, "Revisar", estado, [
          ["Cubre el borde", hechos[0] ?? false],
          ["Pasa lint", hechos[1] ?? false],
        ]),
      ];
      return [
        {
          texto: "Crear «Requisitos · fases» en Backlog",
          ejecutar: async () => {
            await nuevo.crear({
              title: "Requisitos · fases",
              description: "Una fase que solo se cierra con sus requisitos.",
              content: "Una fase que solo se cierra con sus requisitos.",
              kind: "work_item",
              status: "proposed",
            });
          },
        },
        {
          texto: "Añadir «Revisar» con dos requisitos",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: revisar("pendiente", [false, false]) });
          },
        },
        {
          texto: "Mover a roadmap",
          ejecutar: async () => {
            await mover(nuevo.uid(), "roadmap");
          },
        },
        {
          texto: "Marcar «Cubre el borde»",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: revisar("pendiente", [true, false]) });
          },
        },
        {
          texto: "Mirar el checklist a medias",
          ejecutar: () => mirar(2500),
        },
        {
          texto: "Marcar «Pasa lint»",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: revisar("pendiente", [true, true]) });
          },
        },
        {
          texto: "Completar «Revisar»",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: revisar("completada", [true, true]) });
          },
        },
        {
          texto: "Mirar la fase cerrada",
          ejecutar: () => mirar(2000),
        },
        {
          texto: "Mover a verificación",
          ejecutar: async () => {
            await mover(nuevo.uid(), "verificacion");
          },
        },
      ];
    },
  },
  {
    id: "vuelta-descarte",
    nombre: "Ida y vuelta y descarte",
    descripcion:
      "Una idea llega a verificación, vuelve a la cola y se descarta con motivo: " +
      "se ven la vuelta de carril y la rama punteada de Descartadas.",
    construir: ({ crear, mover, editar }) => {
      const nuevo = item(crear);
      const verificar = (estado: "pendiente" | "completada") => [
        fase(1, "Verificar", estado, [["Comprobar", estado === "completada"]]),
      ];
      return [
        {
          texto: "Crear el ítem en Backlog",
          ejecutar: async () => {
            await nuevo.crear({
              title: "Vuelta · descarte",
              description: "Un ítem que vuelve y se descarta.",
              content: "Un ítem que vuelve y se descarta.",
              kind: "work_item",
              status: "proposed",
            });
          },
        },
        {
          texto: "Añadir la fase «Verificar» (pendiente)",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: verificar("pendiente") });
          },
        },
        {
          texto: "Mover a roadmap",
          ejecutar: async () => {
            await mover(nuevo.uid(), "roadmap");
          },
        },
        {
          texto: "Completar la fase «Verificar»",
          ejecutar: async () => {
            await editar(nuevo.uid(), { fases: verificar("completada") });
          },
        },
        {
          texto: "Mover a verificación",
          ejecutar: async () => {
            await mover(nuevo.uid(), "verificacion");
          },
        },
        {
          texto: "Volver a Backlog",
          ejecutar: async () => {
            await mover(nuevo.uid(), "proposed");
          },
        },
        {
          texto: "Descartar con motivo «Ya no hace falta»",
          ejecutar: async () => {
            await editar(nuevo.uid(), {
              status: "rejected",
              rejected_description: "Ya no hace falta",
            });
          },
        },
      ];
    },
  },
  {
    id: "commit-panel",
    nombre: "Commit desde el panel",
    descripcion:
      "El tramo nuevo del mapa: los cambios sin commit, el commit escrito desde el panel y la rama " +
      "con un commit más en el historial. Necesita un cambio sin commitear en el laboratorio.",
    construir: ({ abrirMapa, commit, cambios }) => [
      {
        texto: "Abrir el mapa de Git, que es donde se ve todo esto",
        ejecutar: async () => {
          abrirMapa("git");
          await mirar(1500);
        },
      },
      {
        texto:
          cambios === 0
            ? "Mirar el nodo de cambios (ahora mismo está vacío)"
            : `Mirar los ${cambios} archivo(s) sin commit`,
        ejecutar: () => mirar(2500),
      },
      {
        texto: "Escribir el mensaje en el panel y commitear",
        ejecutar: async () => {
          if (cambios === 0) {
            throw new Error(
              "El laboratorio no tiene cambios que commitear: toca o añade un archivo del repo y vuelve a lanzar.",
            );
          }
          await commit("Prueba: commit desde el panel");
        },
      },
      {
        texto: "Mirar el historial: el commit nuevo ya está arriba y los cambios vacíos",
        ejecutar: () => mirar(4000),
      },
    ],
  },
];
