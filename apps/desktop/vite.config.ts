import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// El core Python escucha en 127.0.0.1:8000. En dev la UI lo alcanza por el proxy
// de Vite, así que no hay CORS ni puerto expuesto en el frontend.
// En producción (F3) Tauri arranca el sidecar y sirve la UI desde su propio origen.
const CORE = "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
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
