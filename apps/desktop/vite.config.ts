import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Este envoltorio solo aporta Tauri y el diálogo nativo; la UI vive en
// `@events-ui/ui` (compartida con la web, que escucha en 15174).
// El core Python escucha en 127.0.0.1:18765. En dev la UI lo alcanza por el proxy
// de Vite, así que no hay CORS ni puerto expuesto en el frontend.
// En producción (F3) Tauri arranca el sidecar y sirve la UI desde su propio origen.
// 18765 y no 8000: en esta máquina el 8000 lo tiene ocupado otro proceso.
const CORE = "http://127.0.0.1:18765";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 15175,
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
        target: CORE,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    target: "chrome105",
    emptyOutDir: true,
  },
});
