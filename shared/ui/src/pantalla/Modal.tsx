import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/** Los elementos que pueden recibir Tab dentro del diálogo. */
const ENFOCABLES = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** El marco común de los diálogos.
 *
 *  El foco entra al abrir —salvo que React ya haya enfocado un campo dentro—,
 *  Tab no sale del diálogo y Escape lo cierra aunque el foco se haya quedado
 *  fuera (por ejemplo, en el botón que lo abrió). Al cerrar, el foco vuelve a
 *  donde estaba. */
export function Modal({
  etiqueta,
  onCerrar,
  children,
}: {
  etiqueta: string;
  onCerrar: () => void;
  children: ReactNode;
}) {
  const marco = useRef<HTMLDivElement>(null);
  // Quién tenía el foco antes de abrir: se lee al renderizar, antes de que
  // React aplique `autoFocus`; en el efecto ya sería el campo del diálogo y al
  // cerrar no habría a quién devolvérselo.
  const anterior = useRef<HTMLElement | null | undefined>(undefined);
  if (anterior.current === undefined) {
    anterior.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  // El cierre puede cambiar en cada render; el oyente se instala una vez.
  const cerrar = useRef(onCerrar);
  useEffect(() => {
    cerrar.current = onCerrar;
  }, [onCerrar]);

  useEffect(() => {
    const dialogo = marco.current;
    if (!dialogo) return;

    const enfocables = () =>
      [...dialogo.querySelectorAll<HTMLElement>(ENFOCABLES)].filter(
        (elemento) => elemento.getClientRects().length > 0,
      );

    // React no pinta `autofocus` en el DOM: al montar, enfoca él el campo. Si
    // ese foco ya está dentro (EditorItem, DescartaItem), se respeta; pisarlo
    // devolvería el cursor al primer enfocable y perdería el título.
    const activo = document.activeElement;
    const yaDentro =
      activo instanceof HTMLElement && activo !== dialogo && dialogo.contains(activo);
    if (!yaDentro) (enfocables()[0] ?? dialogo).focus({ preventScroll: true });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        cerrar.current();
        return;
      }
      if (e.key !== "Tab") return;

      const lista = enfocables();
      if (lista.length === 0) {
        e.preventDefault();
        dialogo.focus({ preventScroll: true });
        return;
      }

      const primero = lista[0]!;
      const ultimo = lista[lista.length - 1]!;
      const activo = document.activeElement;
      const dentro = activo instanceof Node && dialogo.contains(activo);

      if (!dentro) {
        e.preventDefault();
        (e.shiftKey ? ultimo : primero).focus({ preventScroll: true });
        return;
      }
      if (e.shiftKey && (activo === primero || activo === dialogo)) {
        e.preventDefault();
        ultimo.focus({ preventScroll: true });
      } else if (!e.shiftKey && activo === ultimo) {
        e.preventDefault();
        primero.focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previo = anterior.current;
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previo?.isConnected) previo.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="modal-fondo"
      role="presentation"
      // El tablero captura el puntero al arrastrar: sin cortarlo aquí, el
      // `mouseup` se va al mapa y los botones del modal no reciben el clic.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={onCerrar}
    >
      <div
        ref={marco}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={etiqueta}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
