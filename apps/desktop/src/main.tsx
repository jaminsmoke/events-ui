import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@events-ui/ui/styles.css";

import { Escritorio } from "./Escritorio";

const container = document.getElementById("root");
if (!container) throw new Error("#root no existe en index.html");

createRoot(container).render(
  <StrictMode>
    <Escritorio />
  </StrictMode>,
);
