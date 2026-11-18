/** El core no contestó o la carpeta no es un repo. El mensaje es suyo. */
export function AvisoError({ mensaje }: { mensaje: string }) {
  return (
    <section className="card bad">
      <h2>No se pudo leer el repo</h2>
      <p className="mono">{mensaje}</p>
      <p className="hint">
        ¿Está el core en marcha? Arráncalo con <code>corepack pnpm core:dev</code>.
      </p>
    </section>
  );
}
