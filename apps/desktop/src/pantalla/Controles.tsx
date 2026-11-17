import { ZOOM_MAX, ZOOM_MIN, ZOOM_PASO } from "../mapa/camara";
import type { Vista } from "../mapa/camara";

/** Si el esquema no cabe, se dice y se ofrece encuadrarlo. */
export function AvisoRecorte({ onEncuadrar }: { onEncuadrar: () => void }) {
  return (
    <button type="button" className="aviso-recorte" onClick={onEncuadrar}>
      Hay esquema fuera de la vista · Encuadrar
    </button>
  );
}

/** Nivel de cámara y vuelta atrás: el lienzo se puede perder de vista. */
export function Controles({
  vista,
  onZoom,
  onReset,
}: {
  vista: Vista;
  onZoom: (factor: number) => void;
  onReset: () => void;
}) {
  return (
    <div className="vista">
      <button
        type="button"
        className="btn ghost vista-flecha"
        aria-label="Alejar"
        disabled={vista.k <= ZOOM_MIN}
        onClick={() => onZoom(1 / ZOOM_PASO)}
      >
        −
      </button>
      <span className="vista-nivel">{Math.round(vista.k * 100)}%</span>
      <button
        type="button"
        className="btn ghost vista-flecha"
        aria-label="Acercar"
        disabled={vista.k >= ZOOM_MAX}
        onClick={() => onZoom(ZOOM_PASO)}
      >
        +
      </button>
      <button type="button" className="btn ghost" title="Volver al 100% y centrar" onClick={onReset}>
        100%
      </button>
    </div>
  );
}
