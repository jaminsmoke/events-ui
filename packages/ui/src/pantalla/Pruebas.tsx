import { useRef, useState } from "react";

import type { IdeaCreate, IdeaUpdate } from "../core/api";

/** Lanzador de pruebas del laboratorio (solo desktop: `puedeProbar` lo abre,
 *  la web no lo pasa).
 *
 *  Cada prueba es una lista de pasos que se ejecutan en orden contra la API
 *  del core, con pausa entre ellos para que el tablero se vea repartirse en
 *  vivo. La 1 es el ciclo mínimo: 10 ideas creadas, de las que 3 se descartan
 *  con motivo y 7 quedan en cola. */

type Acciones = {
  crear: (body: IdeaCreate) => Promise<{ uid: string } | null>;
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

const PRUEBAS: Prueba[] = [
  {
    id: "prueba-1",
    nombre: "Prueba 1",
    descripcion:
      "Crea 10 ideas en el repo abierto, poco a poco, y luego descarta 3 de " +
      "ellas con motivo. Estado final: 7 en cola y 3 descartadas. Sirve para " +
      "ver el flujo en vivo sin tocar nada a mano.",
    construir: ({ crear, editar }) => {
      const creadas: string[] = [];
      const pasos: Paso[] = [];
      for (let i = 1; i <= 10; i++) {
        const titulo = `Prueba 1 · ${i}`;
        pasos.push({
          texto: `Crear «${titulo}»`,
          ejecutar: async () => {
            const idea = await crear({
              title: titulo,
              description: `Elemento ${i} de la prueba 1.`,
              content: `Elemento ${i} de la prueba 1.`,
              kind: "idea",
              status: "draft",
            });
            if (!idea) throw new Error("El core no devolvió la idea creada.");
            creadas.push(idea.uid);
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
          texto: `Descartar «Prueba 1 · ${indice + 1}» (${motivo})`,
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

type Estado = "parada" | "corriendo" | "terminada" | "cancelada" | "error";

export function Pruebas({
  repo,
  crear,
  editar,
  onCerrar,
}: {
  repo: string;
  crear: Acciones["crear"];
  editar: Acciones["editar"];
  onCerrar: () => void;
}) {
  const [seleccionada, setSeleccionada] = useState(PRUEBAS[0]?.id ?? "");
  const [estado, setEstado] = useState<Estado>("parada");
  const [hechos, setHechos] = useState<boolean[]>([]);
  const [fallo, setFallo] = useState<string | null>(null);
  const [duracion, setDuracion] = useState<string | null>(null);
  const cancelar = useRef(false);

  const prueba = PRUEBAS.find((p) => p.id === seleccionada) ?? PRUEBAS[0];
  const pasos = prueba ? prueba.construir({ crear, editar }) : [];
  const corriendo = estado === "corriendo";
  const totales = `${hechos.filter(Boolean).length}/${pasos.length}`;

  const lanzar = () => {
    if (!prueba || corriendo) return;
    const lista = prueba.construir({ crear, editar });
    cancelar.current = false;
    setEstado("corriendo");
    setHechos(Array.from({ length: lista.length }, () => false));
    setFallo(null);
    setDuracion(null);
    void ejecutar(
      lista,
      () => cancelar.current,
      (i) =>
        setHechos((prev) => {
          const next = [...prev];
          next[i] = true;
          return next;
        }),
    ).then((r) => {
      setEstado(r.resultado);
      setDuracion(r.duracion.toFixed(1));
      if (r.fallo) setFallo(r.fallo);
    });
  };

  return (
    <div className="modal-fondo" role="presentation" onClick={onCerrar}>
      <dialog
        className="modal"
        open
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
              setFallo(null);
              setDuracion(null);
              setEstado("parada");
            }}
            disabled={corriendo}
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

        {fallo && <p className="hint error">Error: {fallo}</p>}
        {duracion && estado !== "corriendo" && (
          <p className="hint">
            {estado === "terminada" && "Completada"}
            {estado === "cancelada" && "Detenida"}
            {estado === "error" && "Con error"}{" "}
            en {duracion} s · pasos {totales}
          </p>
        )}

        <div className="modal-acciones">
          <button
            type="button"
            className="btn"
            onClick={lanzar}
            disabled={corriendo}
          >
            Lanzar
          </button>
          {corriendo && (
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                cancelar.current = true;
              }}
            >
              Detener
            </button>
          )}
          <button type="button" className="btn ghost" onClick={onCerrar}>
            Cerrar
          </button>
        </div>
      </dialog>
    </div>
  );
}
