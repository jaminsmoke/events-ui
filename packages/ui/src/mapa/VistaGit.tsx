/** El mapa de Git: el nodo del repo, los cambios sin commit y el historial. */
import { NodoCambios, NodoCommits, NodoGit, VueloCambio } from "./nodos";
import type { PropsVista } from "./vista";

export function VistaGit({
  commits,
  refs,
  proyeccion,
  gitActivo,
  seleccion,
  onSeleccionar,
  vuelosGit,
  onAterrizadoGit,
}: PropsVista) {
  return (
    <>
      {vuelosGit.length > 0 && (
        <div className="vuelos vuelos-git">
          {vuelosGit.map((fila) => (
            <VueloCambio key={fila.id} fila={fila} onDone={onAterrizadoGit} />
          ))}
        </div>
      )}
      <div className="linea linea-git">
        <div className="git-cabecera">
          <div>
            <p className="git-kicker">Control de versiones</p>
            <p className="git-titulo">Mapa de Git</p>
          </div>
        </div>
        <NodoGit
          activo={gitActivo}
          branch={proyeccion?.branch}
          commit={proyeccion?.commit}
          gitRoot={proyeccion?.git_root}
          seleccion={seleccion}
          onSeleccionar={onSeleccionar}
          boxRef={refs.git}
        />
        <NodoCambios
          activo={gitActivo}
          cambios={proyeccion?.git_cambios ?? []}
          seleccion={seleccion}
          onSeleccionar={onSeleccionar}
          boxRef={refs.cambios}
        />
        <NodoCommits
          activo={gitActivo}
          commits={commits}
          branch={proyeccion?.branch}
          seleccion={seleccion}
          onSeleccionar={onSeleccionar}
          boxRef={refs.commits}
        />
      </div>
    </>
  );
}
