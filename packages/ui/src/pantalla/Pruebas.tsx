import { useEffect, useRef, useState } from "react";

import type { IdeaCreate, IdeaUpdate } from "../core/api";
import { latir, pruebaVigente, soltar, tomar } from "./pruebaEnCurso";

type Acciones = {
  crear: (body: IdeaCreate) => Promise<{ uid: string } | null>;
  mover: (uid: string, status: IdeaCreate["status"]) => Promise<void>;
  editar: (uid: string, cambios: IdeaUpdate) => Promise<void>;
};

type Paso = { texto: string; ejecutar: () => Promise<void> };

type Prueba = {
  id: string;
  nombre: string;
  descripcion: string;
  construir: (c: Acciones) => Paso[];
};

const ESPERA_ENTRE_PASOS_MS = 1100;
/** Mientras la prueba corre se deja constancia de que sigue viva. */
const LATIDO_MS = 3000;

/** Respiro para mirar un estado antes de seguir (solo en las pruebas). */
const mirar = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Una fase del taller de la prueba, en el formato del PATCH. */
type FaseTaller = {
  orden: number;
  titulo: string;
  estado: "pendiente" | "completada" | "fallida" | "rechazada";
  nota: string;
};

/** Una fase del taller con su checklist de requisitos. */
type FaseTallerConRequisitos = {
  orden: number;
  titulo: string;
  estado: FaseTaller["estado"];
  nota: string;
  requisitos: { orden: number; titulo: string; hecho: boolean }[];
};

const PRUEBAS: Prueba[] = [
  {
    id: "prueba-1",
    nombre: "Reparto y limpieza",
    descripcion:
      "Crea 10 ideas, mueve 7 a En cola y descarta 3. Deja seis segundos para ver el reparto. " +
      "Al terminar, detenerse o fallar, se vacían todas las ideas, fichas y eventos del laboratorio, incluidos los datos anteriores.",
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
              kind: "idea",
              status: "draft",
            });
            if (!idea) throw new Error("El core no devolvió la idea creada.");
            creadas.push(idea.uid);
          },
        });
      }
      for (let i = 0; i < 7; i++) {
        pasos.push({
          texto: `En cola: «Reparto · ${i + 1}»`,
          ejecutar: async () => {
            const uid = creadas[i];
            if (!uid) throw new Error("Falta el uid de una idea creada.");
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
            if (!uid) throw new Error("Falta el uid de una idea creada.");
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
      "Siembra ideas en todos los carriles —entrada, cola, roadmap, verificación, aprobadas y descartadas— " +
      "para ver los cinco cables, sus compuertas y el grosor según la presión. Después vacía el laboratorio.",
    construir: ({ crear }) => {
      const lotes: {
        prefijo: string;
        cuantos: number;
        status: IdeaCreate["status"];
        donde: string;
      }[] = [
        { prefijo: "Entrada", cuantos: 4, status: "draft", donde: "la entrada" },
        { prefijo: "Cola", cuantos: 3, status: "proposed", donde: "En cola" },
        { prefijo: "Roadmap", cuantos: 1, status: "roadmap", donde: "roadmap" },
        { prefijo: "Verificación", cuantos: 2, status: "verificacion", donde: "verificación" },
        { prefijo: "Aprobada", cuantos: 3, status: "revision_aprobada", donde: "revisión aprobada" },
        { prefijo: "Descartada", cuantos: 3, status: "rejected", donde: "Descartadas" },
      ];
      return lotes.flatMap(({ prefijo, cuantos, status, donde }) =>
        Array.from({ length: cuantos }, (_, i) => {
          const titulo = `${prefijo} ${i + 1}`;
          return {
            texto: `Crear «${titulo}» en ${donde}`,
            ejecutar: async () => {
              const idea = await crear({
                title: titulo,
                description: `Elemento ${i + 1} de ${prefijo.toLowerCase()}.`,
                content: `Elemento ${i + 1} de ${prefijo.toLowerCase()}.`,
                kind: "idea",
                status,
              });
              if (!idea) throw new Error("El core no devolvió la idea creada.");
            },
          };
        }),
      );
    },
  },
  {
    id: "cable-en-marcha",
    nombre: "Cable en marcha",
    descripcion:
      "Una idea con la fase «Diseño» completada salta de carril en carril: cada salto abre en guiones el " +
      "cable de llegada y lo hace correr con la chispa. Encadena cinco saltos para poder mirarlo sin prisa. " +
      "Después vacía el laboratorio.",
    construir: ({ crear, mover, editar }) => {
      let uid: string | null = null;
      const conUid = () => {
        if (!uid) throw new Error("Falta el uid de la idea creada.");
        return uid;
      };
      // Con la fase completada pasan las compuertas de roadmap y verificación.
      // Volver a la cola es la única forma de repetir un cable ya visto.
      const saltos: { destino: IdeaCreate["status"]; texto: string }[] = [
        { destino: "roadmap", texto: "Mover a roadmap" },
        { destino: "verificacion", texto: "Mover a verificación" },
        { destino: "proposed", texto: "Volver a En cola" },
        { destino: "roadmap", texto: "Mover otra vez a roadmap" },
        { destino: "verificacion", texto: "Mover otra vez a verificación" },
      ];
      return [
        {
          texto: "Crear la idea en En cola",
          ejecutar: async () => {
            const idea = await crear({
              title: "Marcha · cable",
              description: "Una idea que salta de carril para ver el cable en marcha.",
              content: "Una idea que salta de carril para ver el cable en marcha.",
              kind: "idea",
              status: "proposed",
            });
            if (!idea) throw new Error("El core no devolvió la idea creada.");
            uid = idea.uid;
          },
        },
        {
          texto: "Añadir la fase «Diseño» completada",
          ejecutar: async () => {
            await editar(conUid(), {
              fases: [{ orden: 1, titulo: "Diseño", estado: "completada", nota: "" }],
            });
          },
        },
        ...saltos.map(({ destino, texto }) => ({
          texto,
          ejecutar: async () => {
            await mover(conUid(), destino);
          },
        })),
      ];
    },
  },
  {
    id: "fases-aprobacion",
    nombre: "Fases hasta aprobar",
    descripcion:
      "Una idea con la fase «Diseño» recorre cola, roadmap, verificación y aprobación: " +
      "se ve la compuerta pedir una fase, después exigirla completada y el pulso verde al aprobar.",
    construir: ({ crear, mover, editar }) => {
      let uid: string | null = null;
      const conUid = () => {
        if (!uid) throw new Error("Falta el uid de la idea creada.");
        return uid;
      };
      const fases = (estado: "pendiente" | "completada") => [
        { orden: 1, titulo: "Diseño", estado, nota: "" },
      ];
      return [
        {
          texto: "Crear la idea en En cola",
          ejecutar: async () => {
            const idea = await crear({
              title: "Fases · aprobación",
              description: "Una idea que recorre el flujo con una fase.",
              content: "Una idea que recorre el flujo con una fase.",
              kind: "idea",
              status: "proposed",
            });
            if (!idea) throw new Error("El core no devolvió la idea creada.");
            uid = idea.uid;
          },
        },
        {
          texto: "Añadir la fase «Diseño» (pendiente)",
          ejecutar: async () => {
            await editar(conUid(), { fases: fases("pendiente") });
          },
        },
        {
          texto: "Mover a roadmap (pide al menos una fase)",
          ejecutar: async () => {
            await mover(conUid(), "roadmap");
          },
        },
        {
          texto: "Completar la fase «Diseño»",
          ejecutar: async () => {
            await editar(conUid(), { fases: fases("completada") });
          },
        },
        {
          texto: "Mover a verificación (sin fases abiertas)",
          ejecutar: async () => {
            await mover(conUid(), "verificacion");
          },
        },
        {
          texto: "Aprobar la revisión (todas completadas)",
          ejecutar: async () => {
            await mover(conUid(), "revision_aprobada");
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
      let uid: string | null = null;
      const conUid = () => {
        if (!uid) throw new Error("Falta el uid de la idea creada.");
        return uid;
      };
      // Se reenvía la lista entera en cada paso: el PATCH la reemplaza.
      let fases: FaseTaller[] = [];
      const anotar = (fase: FaseTaller) => {
        fases = [...fases, fase];
      };
      const cambiar = (orden: number, estado: FaseTaller["estado"]) => {
        fases = fases.map((fase) => (fase.orden === orden ? { ...fase, estado } : fase));
      };
      const guardar = () => editar(conUid(), { fases });
      return [
        {
          texto: "Crear «Fases · taller» en En cola",
          ejecutar: async () => {
            const idea = await crear({
              title: "Fases · taller",
              description: "Cuatro fases para ver todos sus estados.",
              content: "Cuatro fases para ver todos sus estados.",
              kind: "idea",
              status: "proposed",
            });
            if (!idea) throw new Error("El core no devolvió la idea creada.");
            uid = idea.uid;
          },
        },
        {
          texto: "Añadir «Diseño» (pendiente)",
          ejecutar: async () => {
            anotar({ orden: 1, titulo: "Diseño", estado: "pendiente", nota: "" });
            await guardar();
          },
        },
        {
          texto: "Añadir «Pruebas» (pendiente)",
          ejecutar: async () => {
            anotar({ orden: 2, titulo: "Pruebas", estado: "pendiente", nota: "" });
            await guardar();
          },
        },
        {
          texto: "Añadir «Revisión» (pendiente)",
          ejecutar: async () => {
            anotar({ orden: 3, titulo: "Revisión", estado: "pendiente", nota: "" });
            await guardar();
          },
        },
        {
          texto: "Añadir «Publicar» (pendiente)",
          ejecutar: async () => {
            anotar({ orden: 4, titulo: "Publicar", estado: "pendiente", nota: "" });
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
            await mover(conUid(), "roadmap");
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
          texto: "Fallar «Pruebas»",
          ejecutar: async () => {
            cambiar(2, "fallida");
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
            await mover(conUid(), "verificacion");
          },
        },
      ];
    },
  },
  {
    id: "fases-motivo",
    nombre: "Fases: el motivo sobrevive",
    descripcion:
      "Una fase rechazada con motivo vuelve con la idea a la cola: se queda pendiente, pero no " +
      "pierde el motivo. Abre la fila «Motivo · fases» para verlo antes y después.",
    construir: ({ crear, mover, editar }) => {
      let uid: string | null = null;
      const conUid = () => {
        if (!uid) throw new Error("Falta el uid de la idea creada.");
        return uid;
      };
      const motivo = "No cubre el caso borde";
      const fase: FaseTaller = { orden: 1, titulo: "Revisar", estado: "pendiente", nota: "" };
      return [
        {
          texto: "Crear «Motivo · fases» en En cola",
          ejecutar: async () => {
            const idea = await crear({
              title: "Motivo · fases",
              description: "Una fase fallida que vuelve con su motivo.",
              content: "Una fase fallida que vuelve con su motivo.",
              kind: "idea",
              status: "proposed",
            });
            if (!idea) throw new Error("El core no devolvió la idea creada.");
            uid = idea.uid;
          },
        },
        {
          texto: "Añadir la fase «Revisar»",
          ejecutar: async () => {
            await editar(conUid(), { fases: [fase] });
          },
        },
        {
          texto: "Mover a roadmap",
          ejecutar: async () => {
            await mover(conUid(), "roadmap");
          },
        },
        {
          texto: `Rechazar «Revisar» con el motivo «${motivo}»`,
          ejecutar: async () => {
            await editar(conUid(), {
              fases: [{ ...fase, estado: "rechazada", nota: motivo }],
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
            await mover(conUid(), "verificacion");
          },
        },
        {
          texto: "Volver a En cola",
          ejecutar: async () => {
            await mover(conUid(), "proposed");
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
      let uid: string | null = null;
      const conUid = () => {
        if (!uid) throw new Error("Falta el uid de la idea creada.");
        return uid;
      };
      const fase = (
        estado: FaseTaller["estado"],
        hechos: boolean[],
      ): FaseTallerConRequisitos[] => [
        {
          orden: 1,
          titulo: "Revisar",
          estado,
          nota: "",
          requisitos: [
            { orden: 1, titulo: "Cubre el borde", hecho: hechos[0] ?? false },
            { orden: 2, titulo: "Pasa lint", hecho: hechos[1] ?? false },
          ],
        },
      ];
      return [
        {
          texto: "Crear «Requisitos · fases» en En cola",
          ejecutar: async () => {
            const idea = await crear({
              title: "Requisitos · fases",
              description: "Una fase que solo se cierra con sus requisitos.",
              content: "Una fase que solo se cierra con sus requisitos.",
              kind: "idea",
              status: "proposed",
            });
            if (!idea) throw new Error("El core no devolvió la idea creada.");
            uid = idea.uid;
          },
        },
        {
          texto: "Añadir «Revisar» con dos requisitos",
          ejecutar: async () => {
            await editar(conUid(), { fases: fase("pendiente", [false, false]) });
          },
        },
        {
          texto: "Mover a roadmap",
          ejecutar: async () => {
            await mover(conUid(), "roadmap");
          },
        },
        {
          texto: "Marcar «Cubre el borde»",
          ejecutar: async () => {
            await editar(conUid(), { fases: fase("pendiente", [true, false]) });
          },
        },
        {
          texto: "Mirar el checklist a medias",
          ejecutar: () => mirar(2500),
        },
        {
          texto: "Marcar «Pasa lint»",
          ejecutar: async () => {
            await editar(conUid(), { fases: fase("pendiente", [true, true]) });
          },
        },
        {
          texto: "Completar «Revisar»",
          ejecutar: async () => {
            await editar(conUid(), { fases: fase("completada", [true, true]) });
          },
        },
        {
          texto: "Mirar la fase cerrada",
          ejecutar: () => mirar(2000),
        },
        {
          texto: "Mover a verificación",
          ejecutar: async () => {
            await mover(conUid(), "verificacion");
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
      let uid: string | null = null;
      const conUid = () => {
        if (!uid) throw new Error("Falta el uid de la idea creada.");
        return uid;
      };
      const fase = [{ orden: 1, titulo: "Verificar", estado: "pendiente" as const, nota: "" }];
      return [
        {
          texto: "Crear la idea en En cola",
          ejecutar: async () => {
            const idea = await crear({
              title: "Vuelta · descarte",
              description: "Una idea que vuelve y se descarta.",
              content: "Una idea que vuelve y se descarta.",
              kind: "idea",
              status: "proposed",
            });
            if (!idea) throw new Error("El core no devolvió la idea creada.");
            uid = idea.uid;
          },
        },
        {
          texto: "Añadir la fase «Verificar» (pendiente)",
          ejecutar: async () => {
            await editar(conUid(), { fases: fase });
          },
        },
        {
          texto: "Mover a roadmap",
          ejecutar: async () => {
            await mover(conUid(), "roadmap");
          },
        },
        {
          texto: "Completar la fase «Verificar»",
          ejecutar: async () => {
            await editar(conUid(), {
              fases: [{ orden: 1, titulo: "Verificar", estado: "completada", nota: "" }],
            });
          },
        },
        {
          texto: "Mover a verificación",
          ejecutar: async () => {
            await mover(conUid(), "verificacion");
          },
        },
        {
          texto: "Volver a En cola",
          ejecutar: async () => {
            await mover(conUid(), "proposed");
          },
        },
        {
          texto: "Descartar con motivo «Ya no hace falta»",
          ejecutar: async () => {
            await editar(conUid(), {
              status: "rejected",
              rejected_description: "Ya no hace falta",
            });
          },
        },
      ];
    },
  },
];

type Resultado = {
  resultado: "terminada" | "cancelada" | "error";
  duracion: number;
  fallo?: string;
};

/** Fuera del componente: `Date.now` y la espera son impuros y el linter de
 *  pureza de React no los admite en el cuerpo del componente (`lanzar`
 *  solo orquesta el estado). */
async function ejecutar(
  lista: Paso[],
  cancelada: () => boolean,
  onHecho: (indice: number) => void,
): Promise<Resultado> {
  const inicio = Date.now();
  const duracion = () => (Date.now() - inicio) / 1000;
  for (let i = 0; i < lista.length; i++) {
    if (cancelada()) return { resultado: "cancelada", duracion: duracion() };
    if (i > 0) await new Promise<void>((r) => setTimeout(r, ESPERA_ENTRE_PASOS_MS));
    if (cancelada()) return { resultado: "cancelada", duracion: duracion() };
    try {
      await lista[i]?.ejecutar();
    } catch (err) {
      return {
        resultado: "error",
        duracion: duracion(),
        fallo: err instanceof Error ? err.message : String(err),
      };
    }
    onHecho(i);
  }
  return { resultado: "terminada", duracion: duracion() };
}

const ROTULO_RESULTADO = { terminada: "Completada", cancelada: "Detenida", error: "Con error" };

type Fase = "parada" | "corriendo" | "mostrando" | "limpiando" | "limpiezaPendiente";

export function Pruebas({
  repo,
  crear,
  mover,
  editar,
  abierta,
  onActividad,
  reiniciar,
  onCerrar,
}: {
  repo: string;
  crear: Acciones["crear"];
  mover: Acciones["mover"];
  editar: Acciones["editar"];
  abierta: boolean;
  onActividad: (enCurso: boolean) => void;
  reiniciar: () => Promise<unknown>;
  onCerrar: () => void;
}) {
  const [seleccionada, setSeleccionada] = useState(PRUEBAS[0]?.id ?? "");
  const [fase, setFase] = useState<Fase>("parada");
  const [hechos, setHechos] = useState<boolean[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [errorLimpieza, setErrorLimpieza] = useState<string | null>(null);
  const cancelar = useRef(false);
  const ejecucion = useRef<string | null>(null);
  const latido = useRef<ReturnType<typeof setInterval> | null>(null);
  const [avisoArranque, setAvisoArranque] = useState<string | null>(null);

  const pararLatido = () => {
    if (latido.current !== null) {
      clearInterval(latido.current);
      latido.current = null;
    }
  };

  // Cerrar el diálogo no libera la marca: la ejecución sigue. Al desmontar
  // (cambio de repo) tampoco: si murió a mitad, el próximo arranque la cobra.
  useEffect(() => () => {
    if (latido.current !== null) clearInterval(latido.current);
  }, []);

  const prueba = PRUEBAS.find((p) => p.id === seleccionada) ?? PRUEBAS[0];
  const pasos = prueba?.construir({ crear, mover, editar }) ?? [];
  const totales = `${hechos.filter(Boolean).length}/${pasos.length}`;

  const limpiar = async () => {
    onActividad(true);
    setFase("limpiando");
    setErrorLimpieza(null);
    try {
      await reiniciar();
      if (ejecucion.current) {
        soltar(repo, ejecucion.current);
        ejecucion.current = null;
      }
      setFase("parada");
    } catch (err) {
      setErrorLimpieza(err instanceof Error ? err.message : String(err));
      setFase("limpiezaPendiente");
    } finally {
      onActividad(false);
    }
  };

  const lanzar = async () => {
    if (!prueba || fase !== "parada") return;
    // Otra ventana con la prueba viva manda: su latido es reciente.
    const otra = ejecucion.current ? null : pruebaVigente(repo);
    if (otra) {
      const nombreOtra = PRUEBAS.find((p) => p.id === otra.prueba)?.nombre ?? otra.prueba;
      setAvisoArranque(`Otra ejecución de «${nombreOtra}» está en curso en este laboratorio.`);
      return;
    }
    setAvisoArranque(null);
    const marca = tomar(repo, prueba.id);
    ejecucion.current = marca.ejecucion;
    pararLatido();
    latido.current = setInterval(() => latir(repo, marca.ejecucion), LATIDO_MS);
    onActividad(true);
    cancelar.current = false;
    setFase("corriendo");
    setHechos(Array.from({ length: pasos.length }, () => false));
    setResultado(null);
    const r = await ejecutar(pasos, () => cancelar.current, (i) =>
      setHechos((prev) => prev.map((hecho, indice) => hecho || indice === i)),
    );
    setResultado(r);
    if (r.resultado === "terminada") {
      setFase("mostrando");
      await new Promise<void>((resolve) => setTimeout(resolve, 6000));
    }
    await limpiar();
    pararLatido();
  };

  // Ocultar el diálogo permite mirar el tablero y volver a abrir el progreso.
  if (!abierta) return null;
  return (
    <div className="modal-fondo" role="presentation" onClick={onCerrar}>
      <div
        className="modal"
        role="dialog"
        aria-label="Pruebas del laboratorio"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === "Escape" && onCerrar()}
      >
        <h2>Pruebas del laboratorio</h2>
        <p className="hint">
          Los pasos se ejecutan contra el repo abierto (<strong>{repo}</strong>)
          y se ven en el tablero en vivo.
        </p>
        <label>
          Prueba
          <select
            value={seleccionada}
            onChange={(e) => {
              setSeleccionada(e.target.value);
              setHechos([]);
              setResultado(null);
            }}
            disabled={fase !== "parada"}
            aria-label="Prueba"
          >
            {PRUEBAS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">{prueba?.descripcion}</p>

        <ol className="prueba-pasos">
          {pasos.map((paso, i) => (
            <li key={i} className={hechos[i] ? "hecho" : undefined}>
              {hechos[i] ? "✓ " : `${i + 1}. `}
              {paso.texto}
            </li>
          ))}
        </ol>

        {resultado?.fallo && <p className="hint error">{resultado.fallo}</p>}
        {avisoArranque && <p className="hint error">{avisoArranque}</p>}
        {errorLimpieza && <p className="hint error">Limpieza pendiente. {errorLimpieza}</p>}
        <div role="status" className="hint">
          {fase === "mostrando" && "Reparto listo. El laboratorio se vaciará en seis segundos."}
          {fase === "limpiando" && "Limpiando el laboratorio…"}
          {fase === "parada" && resultado && (
            <>{ROTULO_RESULTADO[resultado.resultado]} en {resultado.duracion.toFixed(1)} s
              · pasos {totales} · Laboratorio limpio.</>
          )}
        </div>

        <div className="modal-acciones">
          <button type="button" className="btn" onClick={() => void lanzar()} disabled={fase !== "parada"}>
            Lanzar
          </button>
          {fase === "corriendo" && (
            <button type="button" className="btn ghost" onClick={() => { cancelar.current = true; }}>
              Detener
            </button>
          )}
          {fase === "limpiezaPendiente" && (
            <button type="button" className="btn ghost" onClick={() => void limpiar()}>
              Reintentar limpieza
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
