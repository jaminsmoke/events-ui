/** El mapa de Documentos: el carril del Changelog, que es el archivo. */
import { nodoDeCarril } from "./nodoDeCarril";
import type { PropsVista } from "./vista";

export function VistaDocumentos(props: PropsVista) {
  const historial = props.tree.carriles.find((lane) => lane.tone === "historial");
  return (
    <div className="linea linea-documentos">
      <div className="git-cabecera">
        <div>
          <p className="git-kicker">Archivo</p>
          <p className="git-titulo">Mapa de Documentos</p>
        </div>
      </div>
      {historial && nodoDeCarril(props, historial)}
    </div>
  );
}
