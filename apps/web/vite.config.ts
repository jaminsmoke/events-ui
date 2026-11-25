import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import puertoCore from "../../services/core/src/events_core/puerto.json";

// La web es la misma UI que desktop (`@events-ui/ui`) sin el envoltorio Tauri.
// Igual que allí, en dev (y en `vite preview`) el core se alcanza por el
// proxy de Vite, así que no hay CORS ni puerto expuesto en el frontend.
// Puerto distinto del de desktop (15175) para poder abrir las dos a la vez.
// El del core sale de `puerto.json` (y no el 8000: en esta máquina lo tiene
// ocupado otro proceso).
const CORE = `http://127.0.0.1:${puertoCore.core}`;

const proxy = {
  "/api": {
    target: CORE,
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api/, ""),
  },
};

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 15174,
    strictPort: true,
    proxy,
  },
  preview: {
    port: 15174,
    strictPort: true,
    proxy,
  },
  build: {
    outDir: "dist",
    target: "chrome105",
    emptyOutDir: true,
  },
});
