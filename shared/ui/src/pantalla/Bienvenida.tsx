import type { ElegirCarpeta } from "../core/repo";
import { SelectorRepo } from "./SelectorRepo";

/** Sin repo: la única entrada al selector. La misma en web y en desktop; solo
 *  cambia si el envoltorio inyecta el diálogo nativo. */
export function Bienvenida({
  onAbrir,
  elegirNativo,
}: {
  onAbrir: (path: string) => void;
  elegirNativo?: ElegirCarpeta;
}) {
  return (
    <section className="card hero">
      <SelectorRepo actual={null} onElegir={onAbrir} elegirNativo={elegirNativo} />
    </section>
  );
}
