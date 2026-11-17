import { useState } from "react";

import { isTauri } from "../core/repo";

/** Sin repo: la única entrada al selector. En Tauri es el diálogo nativo; en el
 *  navegador (`dev:ui`) no existe, así que se pega la ruta. */
export function Bienvenida({
  onElegir,
  onAbrir,
}: {
  onElegir: () => void;
  onAbrir: (path: string) => void;
}) {
  const [manual, setManual] = useState("");

  return (
    <section className="card hero">
      {isTauri ? (
        <button className="btn" onClick={onElegir}>
          Elegir carpeta…
        </button>
      ) : (
        <form
          className="manual"
          onSubmit={(e) => {
            e.preventDefault();
            const path = manual.trim();
            if (path) onAbrir(path);
          }}
        >
          <input
            className="mono"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="C:\ruta\al\repo"
            spellCheck={false}
          />
          <button className="btn" type="submit">
            Abrir
          </button>
        </form>
      )}
      <p className="hint">
        {isTauri
          ? "Se abre la última carpeta al arrancar. La primera vez sembramos dentro .EUI/EUI_DATABASE.sqlite."
          : "En el navegador no hay diálogo nativo: pega la ruta. La ventana de Tauri sí lo tiene."}
      </p>
    </section>
  );
}
