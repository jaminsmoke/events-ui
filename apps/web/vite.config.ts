import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import puertoCore from "../../services/core/src/events_core/puerto.json";

// La web es la misma UI que desktop (`@events-ui/ui`) sin el envoltorio Tauri.
// Igual que allí, en dev (y en `vite preview`) el core se alcanza por el
// proxy de Vite, así que no hay CORS ni puerto expuesto en el frontend.
// Puerto distinto del de desktop (15175) para poder abrir las dos a la vez.
// El del core sale de `puerto.json` (y no el 8000: en esta máquina lo tiene
// ocupado otro proceso).
//
// Puerto y destino se pueden pisar por entorno (`EVENTSUI_UI_PORT` y
// `EVENTSUI_CORE_URL`), igual que en desktop: el runner de e2e levanta las dos
// UIs y su core en otros puertos para correr con la sesión abierta.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const core = env.EVENTSUI_CORE_URL ?? `http://127.0.0.1:${puertoCore.core}`;
  const puerto = Number(env.EVENTSUI_UI_PORT ?? 15174);

  const proxy = {
    "/api": {
      target: core,
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ""),
    },
  };

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: puerto,
      strictPort: true,
      proxy,
    },
    preview: {
      port: puerto,
      strictPort: true,
      proxy,
    },
    build: {
      outDir: "dist",
      target: "chrome105",
      emptyOutDir: true,
    },
  };
});
