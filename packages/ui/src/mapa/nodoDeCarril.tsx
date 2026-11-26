import type { TreeNode } from "./arbol";
import { NodeBox } from "./nodos";
import type { PropsVista } from "./vista";

/** Cada carril es un nodo de la línea. Changelog vive en el mapa Documentos;
 *  en el de trabajo su sitio lo ocupa el puente Documentos, para que el cable
 *  de archivo lo mida igual. */
export function nodoDeCarril(
  { cerrados, onToggle, refs, seleccion, onSeleccionar, animacion, acciones, items }: PropsVista,
  lane: TreeNode,
) {
  return (
    <NodeBox
      key={lane.key}
      node={lane}
      cerrados={cerrados}
      onToggle={onToggle}
      boxRef={(el) => {
        const id = lane.tone === "root" ? null : lane.tone;
        if (id) refs.carriles.current[id] = el;
      }}
      volando={animacion.volando}
      pulso={animacion.pulsos.find((p) => p.lane === lane.tone)?.tono}
      destello={animacion.destelloDe(lane.tone)}
      onMover={acciones.onMover}
      onPideEditar={acciones.onPideEditar}
      onEditar={acciones.onEditar}
      onBorrar={acciones.onBorrar}
      onCargarItem={acciones.onCargar}
      puedeIr={acciones.puedeIr}
      exigeFases={acciones.exigeFases}
      exigeFasesListas={acciones.exigeFasesListas}
      exigeFasesCompletas={acciones.exigeFasesCompletas}
      catalogo={items}
      seleccion={seleccion}
      onSeleccionar={onSeleccionar}
    />
  );
}
