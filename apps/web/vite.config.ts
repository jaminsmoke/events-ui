import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// La web es la misma UI que desktop (`@events-ui/ui`) sin el envoltorio Tauri.
// Igual que allí, en dev (y en `vite preview`) el core se alcanza por el
// proxy de Vite, así que no hay CORS ni puerto expuesto en el frontend.
// Puerto distinto del de desktop (15175) para poder abrir las dos a la vez.
// 18765 y no 8000: en esta máquina el 8000 lo tiene ocupado otro proceso.
const CORE = "http://127.0.0.1:18765";

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
