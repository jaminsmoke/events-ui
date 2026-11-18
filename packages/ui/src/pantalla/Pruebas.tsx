import { useRef, useState } from "react";

import type { IdeaCreate, IdeaUpdate } from "../core/api";

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

const PRUEBAS: Prueba[] = [
  {
    id: "prueba-1",
    nombre: "Prueba 1",
    descripcion:
      "Crea 10 ideas, mueve 7 a En cola y descarta 3. El reparto queda visible seis segundos. " +
      "Al terminar, detenerse o fallar, se vacían todas las ideas, fichas, conexiones y eventos del laboratorio, incluidos los datos anteriores.",
    construir: ({ crear, mover, editar }) => {
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
      for (let i = 0; i < 7; i++) {
        pasos.push({
          texto: `En cola: «Prueba 1 · ${i + 1}»`,
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

  const prueba = PRUEBAS.find((p) => p.id === seleccionada) ?? PRUEBAS[0];
  const pasos = prueba?.construir({ crear, mover, editar }) ?? [];
  const totales = `${hechos.filter(Boolean).length}/${pasos.length}`;

  const limpiar = async () => {
    onActividad(true);
    setFase("limpiando");
    setErrorLimpieza(null);
    try {
      await reiniciar();
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
