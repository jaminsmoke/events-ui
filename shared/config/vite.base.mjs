import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import { PUERTO_CORE } from "../../scripts/puerto.mjs";

// El puerto del core se importa de `scripts/puerto.mjs`, que lo lee de
// `puerto.json` (la única copia del número). Aquí no se compone la ruta: el
// import funciona igual al cargar el preset desde Node en una prueba que al
// empaquetarlo Vite.

/** La configuración común de los dos envoltorios.
 *
 *  Solo cambia el puerto de la UI y, en desktop, el watcher que ignora los
 *  binarios de Rust. El proxy `/api` quita el prefijo y apunta al core; en
 *  `preview` se repite para que la build servida también hable con él.
 *
 *  `EVENTSUI_UI_PORT` y `EVENTSUI_CORE_URL` pisan puerto y destino: el runner
 *  de e2e levanta las dos UIs y su core en otros puertos.
 */
export function presetVite({ puerto, ignorar = [] }) {
  return defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "");
    const core = env.EVENTSUI_CORE_URL ?? `http://127.0.0.1:${PUERTO_CORE}`;
    const puertoUi = Number(env.EVENTSUI_UI_PORT ?? puerto);

    const proxy = {
      "/api": {
        target: core,
        changeOrigin: true,
        rewrite: (ruta) => ruta.replace(/^\/api/, ""),
      },
    };

    return {
      plugins: [react()],
      clearScreen: false,
      server: {
        port: puertoUi,
        strictPort: true,
        proxy,
        // La recompilación de Rust escribe binarios en src-tauri/target
        // mientras Vite los vigila: en Windows el watcher los abre en mitad de
        // la escritura y revienta con EBUSY. La página no necesita recargarse
        // por cambios en Rust: eso lo reinicia la CLI de Tauri.
        ...(ignorar.length > 0 ? { watch: { ignored: ignorar } } : {}),
      },
      preview: {
        port: puertoUi,
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
}
