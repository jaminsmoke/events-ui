/** El mapa de trabajo: los cables, los nudos y la línea de carriles. */
import { duracionChispa } from "./cables";
import { Compuerta } from "./compuertas";
import { NodeBox, NodoPuenteDocumentos, NodoPuenteGit, VueloFila } from "./nodos";
import { nodoDeCarril } from "./nodoDeCarril";
import type { PropsVista } from "./vista";

export function VistaItems(props: PropsVista) {
  const {
    tree,
    ideas,
    cerrados,
    onToggle,
    refs,
    cables,
    nudos,
    rama,
    chispas,
    cableDeChispa,
    seleccion,
    onSeleccionar,
    paso,
    animacion,
    acciones,
    proyeccion,
    gitActivo,
    vuelos,
    onAterrizado,
    onAbrirGit,
    onAbrirDocumentos,
    onDialogoGit,
  } = props;

  /* El cable engorda con lo que espera en su origen: la presión se acumula
   *  antes de la compuerta, no después. */
  const maximo = Math.max(1, ...cables.map((cable) => cable.presion));

  return (
    <>
      <div className="vuelos">
        {vuelos.map((vuelo) => (
          <VueloFila key={vuelo.id} vuelo={vuelo} onDone={onAterrizado} />
        ))}
      </div>
      <svg className="cables" aria-hidden="true">
        {cables.map((cable) => {
          const t = cable.presion / maximo;
          const entrada = cable.origenLane === "root" && cable.lane === "cola";
          // Solo se abre en guiones el cable que una chispa recorre.
          const enMarcha = chispas.some(
            (chispa) => chispa.lane === cable.lane && cableDeChispa(chispa)?.id === cable.id,
          );
          const apagadoGit = cable.lane === "git" && proyeccion?.git !== true;
          const elegido = seleccion?.tipo === "cable" && seleccion.id === cable.id;
          return (
            <g key={cable.id}>
              {/* Zona de golpe ancha: el trazo real es fino y sin
               *  ella el cable no se podría pulsar. El puntero no
               *  arranca el arrastre de la cámara. */}
              <path
                data-cable={cable.id}
                d={cable.d}
                className="wire-hit"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSeleccionar({ tipo: "cable", id: cable.id })}
              />
              <path
                d={cable.d}
                className={`wire ${cable.lane}${cable.rama ? " rama" : ""}${
                  apagadoGit ? " apagado" : ""
                }${enMarcha ? " marcha" : ""}${elegido ? " seleccionado" : ""}`}
                style={{
                  // El grosor cuenta lo que espera en el origen; la luz
                  // no: un cable no se enciende porque el carril del
                  // que sale reciba ideas, solo cuando algo lo cruza.
                  strokeWidth: entrada ? 1.3 + 1.5 * t : 1.8 + 2.2 * t,
                  opacity: enMarcha ? 1 : apagadoGit ? 0.25 : entrada ? 0.46 : 0.56,
                  strokeDasharray: apagadoGit ? "4 5" : undefined,
                }}
              />
            </g>
          );
        })}
        {/* Dirección sin depender del movimiento: un chevrón en el
         *  punto medio. La rama de Descartadas no lo lleva. */}
        {cables.map((cable) => {
          // Git no es un tránsito de ideas: su cable no lleva flecha.
          if (cable.lane === "git") return null;
          // El chevrón cae sobre un tramo recto de la ruta ortogonal.
          const { x: mx, y: my, angulo } = cable.chevron;
          return (
            <path
              key={`chevron-${cable.id}`}
              className={`chevron ${cable.lane}`}
              d="M -5 -4 L 0 0 L -5 4"
              transform={`translate(${mx} ${my}) rotate(${angulo})`}
            />
          );
        })}
        {/* La bifurcación va antes que las compuertas: el rombo se
         *  pinta debajo y la compuerta del protocolo queda dentro. */}
        {rama && (
          <g className="rama-rechazo">
            <path className="rama-tronco" d={rama.tronco} />
            {rama.bus && <path className="rama-bus" d={rama.bus} />}
            <rect
              className="rama-caja"
              x={rama.caja.x}
              y={rama.caja.y}
              width={rama.caja.w}
              height={rama.caja.h}
              rx={6}
            />
            <circle
              className="rama-punto"
              cx={rama.caja.x + 12}
              cy={rama.caja.y + 17}
              r={3.2}
            />
            <text
              className="rama-titulo"
              x={rama.caja.x + 23}
              y={rama.caja.y + 21}
              textAnchor="start"
            >
              Revisión rechazada
            </text>
            <text
              className="rama-sub"
              x={rama.caja.x + 23}
              y={rama.caja.y + 35}
              textAnchor="start"
            >
              vuelve a cola · roadmap · descartadas
            </text>
          </g>
        )}
        {/* Los nudos van debajo de las compuertas: cada rombo
         *  envuelve la celda de protocolo de su cable. */}
        {nudos.map((nudo) => {
          const elegido = seleccion?.tipo === "nudo" && seleccion.id === nudo.id;
          return (
            <g key={nudo.id}>
              <rect
                className={`nudo${nudo.rechazo ? " rechazo" : ""}${
                  elegido ? " seleccionado" : ""
                }`}
                x={nudo.x - nudo.lado / 2}
                y={nudo.y - nudo.lado / 2}
                width={nudo.lado}
                height={nudo.lado}
                transform={`rotate(45 ${nudo.x} ${nudo.y})`}
              />
              {/* Zona de golpe redonda: el rombo es pequeño y gira,
               *  así que el clic no depende de su filo. Va antes que
               *  las celdas para que estas ganen donde se solapan. */}
              <circle
                data-nudo={nudo.id}
                className="nudo-hit"
                cx={nudo.x}
                cy={nudo.y}
                r={nudo.lado / 2 + 8}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => onSeleccionar({ tipo: "nudo", id: nudo.id })}
              />
            </g>
          );
        })}
        {cables.map((cable) => (
          <Compuerta
            key={`compuerta-${cable.id}`}
            lane={cable.lane}
            uniones={cable.uniones}
            abierta={cable.abierta}
            protocolo={paso}
            {...cable.compuerta}
            onSeleccionar={() =>
              cable.nudo
                ? onSeleccionar({ tipo: "nudo", id: cable.nudo })
                : onSeleccionar({ tipo: "cable", id: cable.id })
            }
          />
        ))}
        {cables[0] && (
          <circle className="junction" cx={cables[0].x1} cy={cables[0].y1} r={4} />
        )}
        {chispas.map((chispa) => {
          const cable = cableDeChispa(chispa);
          return cable ? (
            <circle key={chispa.id} r={3.5} className={`spark ${chispa.lane}`}>
              <animateMotion
                dur={`${duracionChispa(cable.longitud)}s`}
                path={cable.d}
                fill="freeze"
              />
            </circle>
          ) : null;
        })}
      </svg>
      <div className="linea">
        <NodeBox
          node={tree.cajon}
          cerrados={cerrados}
          onToggle={onToggle}
          boxRef={refs.cajon}
          volando={animacion.volando}
          pulso={animacion.pulsoCajon}
          onMover={acciones.onMover}
          onPideEditar={acciones.onPideEditar}
          onEditar={acciones.onEditar}
          onBorrar={acciones.onBorrar}
          onCargarIdea={acciones.onCargar}
          puedeIr={acciones.puedeIr}
          exigeFases={acciones.exigeFases}
          exigeFasesListas={acciones.exigeFasesListas}
          exigeFasesCompletas={acciones.exigeFasesCompletas}
          catalogo={ideas}
          seleccion={seleccion}
          onSeleccionar={onSeleccionar}
        />
        {tree.carriles.map((lane) => (lane.tone === "historial" ? null : nodoDeCarril(props, lane)))}
        <div className="estacion-git">
          <NodoPuenteGit
            activo={gitActivo}
            branch={proyeccion?.branch}
            commit={proyeccion?.commit}
            gitRoot={proyeccion?.git_root}
            seleccion={seleccion}
            onSeleccionar={onSeleccionar}
            boxRef={refs.git}
            onAbrir={onAbrirGit}
            onCrear={() => onDialogoGit("crear")}
            onEliminar={() => onDialogoGit("eliminar")}
          />
          {tree.carriles.map((lane) =>
            lane.tone === "historial" ? (
              <NodoPuenteDocumentos
                key="puente-documentos"
                seleccion={seleccion}
                onSeleccionar={onSeleccionar}
                boxRef={(el) => {
                  // El puente de Documentos ocupa el sitio del carril
                  // Changelog: el cable de archivo lo mide.
                  refs.carriles.current["historial"] = el;
                }}
                onAbrir={onAbrirDocumentos}
              />
            ) : null,
          )}
        </div>
      </div>
    </>
  );
}
