import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "@events-ui/ui";
import "@events-ui/ui/styles.css";

/** La web no tiene diálogo nativo de carpetas: el selector de la UI
 *  compartida ofrece el explorador servido por `GET /fs`, la lista de
 *  `GET /repos` y pegar la ruta. Desktop añade el diálogo nativo encima. */
const container = document.getElementById("root");
if (!container) throw new Error("#root no existe en index.html");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
