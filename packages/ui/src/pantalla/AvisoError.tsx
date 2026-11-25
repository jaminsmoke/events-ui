/** El core no contestó o la carpeta no es un repo. El mensaje es suyo. */
export function AvisoError({ mensaje }: { mensaje: string }) {
  return (
    <section className="card bad">
      <h2>No se pudo leer el repo</h2>
      <p className="mono">{mensaje}</p>
      <p className="hint">
        ¿Está el core en marcha? En dev lo levanta solo <code>pnpm dev</code> /{" "}
        <code>pnpm dev:web</code>; suelto, <code>corepack pnpm core:dev</code>. En
        la web instalada, <code>eui web</code> lo enciende. Si lo arrancó el
        desktop y lo cerraste, vuelve a abrirlo. Lo que ya está en marcha puede
        ser anterior a los últimos cambios: reinícialo para que cargue el core
        nuevo.
      </p>
    </section>
  );
}
