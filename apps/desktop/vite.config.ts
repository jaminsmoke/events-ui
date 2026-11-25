import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import puertoCore from "../../services/core/src/events_core/puerto.json";

// Este envoltorio solo aporta Tauri y el diálogo nativo; la UI vive en
// `@events-ui/ui` (compartida con la web, que escucha en 15174).
// El core Python escucha en el puerto de `puerto.json` (la única copia del
// número). En dev la UI lo alcanza por el proxy de Vite, así que no hay CORS ni
// puerto expuesto en el frontend. En producción Tauri arranca el sidecar y
// sirve la UI desde su propio origen. Ese puerto y no el 8000: en esta máquina
// el 8000 lo tiene ocupado otro proceso.
//
// Puerto y destino se pueden pisar por entorno (`EVENTSUI_UI_PORT` y
// `EVENTSUI_CORE_URL`): el runner de e2e levanta su Vite y su core en otros
// puertos para poder correr mientras la sesión de escritorio sigue abierta.
// `loadEnv` con prefijo vacío también recoge las variables del proceso.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const core = env.EVENTSUI_CORE_URL ?? `http://127.0.0.1:${puertoCore.core}`;
  const puerto = Number(env.EVENTSUI_UI_PORT ?? 15175);

  return {
    plugins: [react()],
    clearScreen: false,
    server: {
      port: puerto,
      strictPort: true,
      // La recompilación de Rust escribe binarios en src-tauri/target mientras
      // Vite los vigila: en Windows el watcher los abre en mitad de la escritura
      // y revienta con EBUSY (la página no necesita recargarse por cambios en
      // Rust: eso lo reinicia la propia CLI de Tauri).
      watch: {
        ignored: ["**/src-tauri/target/**"],
      },
      proxy: {
        "/api": {
          target: core,
          changeOrigin: true,
          rewrite: (path: string) => path.replace(/^\/api/, ""),
        },
      },
    },
    build: {
      outDir: "dist",
      target: "chrome105",
      emptyOutDir: true,
    },
  };
});
