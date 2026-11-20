/** El motor de las pruebas del laboratorio: pasos, latido, limpieza y diálogo.
 *
 *  Los escenarios viven en `guiones.ts`; aquí solo se ejecutan.
 */

import { useEffect, useRef, useState } from "react";

import { ESPERA_ENTRE_PASOS_MS, PRUEBAS, type Acciones, type Paso } from "./guiones";
import { latir, pruebaVigente, soltar, tomar } from "./pruebaEnCurso";

/** Mientras la prueba corre se deja constancia de que sigue viva. */
const LATIDO_MS = 3000;

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
  abrirMapa,
  commit,
  cambios,
  abierta,
  onActividad,
  reiniciar,
  onCerrar,
}: {
  repo: string;
  crear: Acciones["crear"];
  mover: Acciones["mover"];
  editar: Acciones["editar"];
  abrirMapa: Acciones["abrirMapa"];
  commit: Acciones["commit"];
  cambios: number;
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
  const pasos = prueba?.construir({ crear, mover, editar, abrirMapa, commit, cambios }) ?? [];
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
