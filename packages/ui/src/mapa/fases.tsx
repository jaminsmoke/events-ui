/** Fases de una idea: la lista que se edita en la fila. */

import { useState } from "react";

import type { Status } from "./carriles";
import { ESTADOS_FASE, ETIQUETA_FASE, type Fase } from "./fase";
import {
  conEstado,
  conNota,
  conRequisito,
  nuevaFase,
  nuevoRequisito,
  progreso,
  requisitosDe,
  sinFase,
  sinRequisito,
} from "./fasesModelo";
import { useGuardarFases } from "./useGuardarFases";

/** Las fases de una idea: lista corta con su estado, sin salir de la fila.
 *  Cada cambio reenvía la lista entera: el PATCH la reemplaza en una
 *  transacción, así que marcar una casilla no pisa el carril. */
export function FasesIdea({
  fases,
  estado,
  alGuardar,
  soloLectura,
}: {
  fases: readonly Fase[];
  /** El carril de la idea: el estado de una fase solo se toca en roadmap. */
  estado: Status;
  /** La copia optimista vive en la fila: así la ficha y la fila no se pisan. */
  alGuardar: (siguientes: readonly Fase[]) => Promise<void>;
  /** En solo lectura no se pintan campos: los controles llegan con Editar. */
  soloLectura: boolean;
}) {
  const [nuevo, setNuevo] = useState("");
  const [primerRequisito, setPrimerRequisito] = useState("");
  const vista = fases;
  const { guardando, fallo, guardar } = useGuardarFases(alGuardar);
  const { hechas } = progreso(vista);
  // Al fallar sin motivo no se guarda: se pide aquí y se manda con el estado.
  const [motivoPendiente, setMotivoPendiente] = useState<number | null>(null);
  const [motivoNuevo, setMotivoNuevo] = useState("");
  // En roadmap y verificación los requisitos se abren solos, que es donde se
  // trabajan; en entrada, cola y descartadas se quedan plegados. El clic deja
  // una excepción por fase (abrir en cola, cerrar en roadmap) que dura hasta
  // que la fila cambie de carril y se vuelva a montar.
  const autoRequisitos = estado === "roadmap" || estado === "verificacion";
  const [excepciones, setExcepciones] = useState<ReadonlyMap<number, boolean>>(
    () => new Map(),
  );
  const [requisitoNuevo, setRequisitoNuevo] = useState("");

  const anadir = (e: React.FormEvent) => {
    e.preventDefault();
    const titulo = nuevo.trim();
    const primer = primerRequisito.trim();
    if (!titulo || !primer) return;
    guardar(nuevaFase(vista, titulo, primer));
    setNuevo("");
    setPrimerRequisito("");
  };

  return (
    <div className="fases">
      <p className="fases-cabecera">
        Fases {hechas}/{vista.length}
      </p>
      {vista.map((fase) => {
        const requisitos = fase.requisitos ?? [];
        const { hechos: hechosReq, total: totalReq } = requisitosDe(fase);
        const pendientesReq = totalReq - hechosReq;
        const abiertos = excepciones.get(fase.orden) ?? autoRequisitos;
        return (
        <div className="fase-grupo" key={fase.orden}>
        <div className="fase">
          <div className="fase-texto">
            <span className="fase-titulo">
              <span className="fase-indice">Fase {fase.orden}</span>
              {" · "}
              {fase.titulo}
            </span>
            {/* Lo que tocó la fase al cerrarse (0028): recuento, sin parche. */}
            {fase.archivos && fase.archivos.length > 0 && (
              <span
                className="fase-archivos"
                title={fase.archivos
                  .map((archivo) => `${archivo.estado}: ${archivo.ruta}`)
                  .join("\n")}
              >
                {fase.archivos.length}{" "}
                {fase.archivos.length === 1 ? "archivo" : "archivos"}
              </span>
            )}
            <button
              type="button"
              className="fase-check"
              title={`Requisitos: ${hechosReq} de ${requisitos.length}`}
              aria-label={`Requisitos de ${fase.titulo}: ${hechosReq} de ${requisitos.length}`}
              aria-expanded={abiertos}
              onClick={() => {
                const siguiente = new Map(excepciones);
                siguiente.set(fase.orden, !abiertos);
                setExcepciones(siguiente);
                setRequisitoNuevo("");
              }}
            >
              {hechosReq}/{requisitos.length}{" "}
              {requisitos.length === 1 ? "requisito" : "requisitos"}
            </button>
            {!soloLectura && motivoPendiente === fase.orden ? (
              <form
                className="fase-motivo-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const nota = motivoNuevo.trim();
                  if (!nota) return;
                  guardar(conEstado(vista, fase.orden, "fallida", nota));
                  setMotivoPendiente(null);
                  setMotivoNuevo("");
                }}
              >
                <input
                  autoFocus
                  className="fase-motivo"
                  value={motivoNuevo}
                  onChange={(e) => setMotivoNuevo(e.target.value)}
                  placeholder="Motivo del fallo…"
                  aria-label={`Motivo del fallo de ${fase.titulo}`}
                  disabled={guardando}
                />
                <div className="fase-motivo-acciones">
                  <button
                    className="btn ghost"
                    type="submit"
                    disabled={guardando || !motivoNuevo.trim()}
                  >
                    Fallar
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={guardando}
                    onClick={() => setMotivoPendiente(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            ) : !soloLectura && estado === "roadmap" && (fase.estado === "fallida" || fase.estado === "rechazada") ? (
              <input
                key={fase.nota}
                className="fase-motivo"
                defaultValue={fase.nota}
                placeholder="Motivo…"
                aria-label={`Motivo de ${fase.titulo}`}
                disabled={guardando}
                onBlur={(e) => {
                  const nota = e.target.value.trim();
                  if (nota === fase.nota) return;
                  guardar(conNota(vista, fase.orden, nota));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            ) : (
              fase.nota && <span className="fase-nota">Motivo: {fase.nota}</span>
            )}
          </div>
          {estado === "roadmap" && !soloLectura ? (
            <select
              className="fase-estado"
              value={fase.estado}
              disabled={guardando}
              aria-label={`Estado de ${fase.titulo}`}
              title={
                pendientesReq > 0
                  ? `Cierra ${pendientesReq} requisito(s) para completar`
                  : undefined
              }
              onChange={(e) => {
                const siguiente = e.target.value as Fase["estado"];
                if (siguiente === "fallida" && !fase.nota.trim()) {
                  setMotivoPendiente(fase.orden);
                  setMotivoNuevo("");
                  return;
                }
                guardar(conEstado(vista, fase.orden, siguiente));
              }}
            >
              {ESTADOS_FASE.map((otro) => (
                <option
                  key={otro}
                  value={otro}
                  disabled={otro === "completada" && pendientesReq > 0}
                >
                  {otro}
                </option>
              ))}
            </select>
          ) : (
            <span
              className="fase-estado-texto"
              title={
                soloLectura
                  ? "Pulsa Editar para cambiar el estado"
                  : "El estado de la fase se lleva en roadmap"
              }
            >
              {ETIQUETA_FASE[fase.estado] ?? fase.estado}
            </span>
          )}
          <button
            type="button"
            className="chip-quitar"
            title="Quitar fase"
            hidden={soloLectura}
            disabled={guardando}
            onClick={() => guardar(sinFase(vista, fase.orden))}
          >
            ×
          </button>
        </div>
        {abiertos && (
          <div className="fase-requisitos">
            {requisitos.map((requisito) => (
              <label
                key={requisito.orden}
                className={`requisito${requisito.hecho ? " hecho" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={requisito.hecho}
                  disabled={guardando || estado !== "roadmap" || soloLectura}
                  aria-label={`Requisito ${requisito.titulo}`}
                  onChange={() => guardar(conRequisito(vista, fase.orden, requisito.orden))}
                />
                <span className="requisito-titulo">{requisito.titulo}</span>
                <button
                  type="button"
                  className="chip-quitar"
                  title={
                    requisitos.length === 1
                      ? "Una fase necesita al menos un requisito"
                      : "Quitar requisito"
                  }
                  hidden={soloLectura}
                  disabled={guardando || requisitos.length === 1}
                  onClick={(e) => {
                    e.preventDefault();
                    guardar(sinRequisito(vista, fase.orden, requisito.orden));
                  }}
                >
                  ×
                </button>
              </label>
            ))}
            <form
              className="requisito-nuevo"
              hidden={soloLectura}
              onSubmit={(e) => {
                e.preventDefault();
                const titulo = requisitoNuevo.trim();
                if (!titulo) return;
                guardar(nuevoRequisito(vista, fase.orden, titulo));
                setRequisitoNuevo("");
              }}
            >
              <input
                value={requisitoNuevo}
                onChange={(e) => setRequisitoNuevo(e.target.value)}
                placeholder="Nuevo requisito…"
                aria-label={`Nuevo requisito de ${fase.titulo}`}
                disabled={guardando}
              />
              <button className="btn ghost" type="submit" disabled={guardando}>
                +
              </button>
            </form>
          </div>
        )}
        </div>
        );
      })}
      <form className="fase-nueva" hidden={soloLectura} onSubmit={anadir}>
        <input
          className="fase-nueva-titulo"
          value={nuevo}
          onChange={(e) => setNuevo(e.target.value)}
          placeholder="Nueva fase…"
          aria-label="Nueva fase"
        />
        <input
          className="fase-nueva-requisito"
          value={primerRequisito}
          onChange={(e) => setPrimerRequisito(e.target.value)}
          placeholder="Primer requisito…"
          aria-label="Primer requisito"
        />
        <button
          className="btn ghost"
          type="submit"
          disabled={guardando || !nuevo.trim() || !primerRequisito.trim()}
        >
          Añadir
        </button>
      </form>
      {fallo && <span className="hint error">{fallo}</span>}
    </div>
  );
}
