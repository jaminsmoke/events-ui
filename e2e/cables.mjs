/** Los cables que dibuja el Mapa de Trabajo, por id.
 *
 *  La cuenta vivía copiada en siete escenarios y se quedó en diez cuando el
 *  mapa pasó a once (`etapa-eliminadas`, en `62e5934`): siete esperas viejas y
 *  siete escenarios que morían ahí sin comprobar nada de lo suyo. Esta es la
 *  única copia: si el mapa gana o pierde un cable, se toca aquí.
 */
export const CABLES = [
  "etapa-cola",
  "etapa-roadmap",
  "etapa-verificacion",
  "etapa-revision",
  "etapa-historial",
  "etapa-git",
  "descarte-entrada-cola",
  "etapa-eliminadas",
  "rechazo-roadmap",
  "rechazo-cola",
  "rechazo-descartadas",
];

const ORDEN = [...CABLES].sort();

/** Espera a que el mapa tenga exactamente sus cables: ni uno de menos ni uno de
 *  más. Se comparan los ids, no solo la cuenta, así que un cable nuevo falla
 *  aquí con un mensaje claro en vez de colarse desapercibido.
 *
 *  `esperar` es el del runner (`ctx.esperar`), que ya sabe de timeouts y de
 *  cómo contar el fallo. */
export async function esperarCables(page, esperar, descripcion = "los cables del mapa") {
  await esperar(
    () =>
      page.evaluate((esperados) => {
        const cables = Array.from(
          document.querySelectorAll(".wire-hit"),
          (nodo) => nodo.getAttribute("data-cable") ?? "",
        ).sort();
        const wires = document.querySelectorAll(".wire").length;
        return (
          wires === esperados.length &&
          cables.length === esperados.length &&
          cables.every((id, i) => id === esperados[i])
        );
      }, ORDEN),
    descripcion,
  );
}
