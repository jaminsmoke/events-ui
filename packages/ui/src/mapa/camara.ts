import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";

/** Zoom del lienzo, acotado a lo útil.
 *
 *  El esquema es pequeño: no hay nada que leer al 25% ni un nodo que necesite el
 *  300%. Por debajo del 50% los títulos se vuelven ilegibles y por encima del
 *  150% el mapa ocupa mucho más que su ventana y se pierde de vista. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
export const ZOOM_PASO = 1.08;

export type Vista = { x: number; y: number; k: number };

const acotar = (valor: number, min: number, max: number) => Math.min(max, Math.max(min, valor));

/** Cámara del lienzo: solo mueve la vista. Los nodos no se tocan.
 *
 *  Los dos nodos del DOM los presta quien pinta: el hook mide y mueve, no posee
 *  el árbol. */
export function useCamara({
  repo,
  listo,
  boardRef,
  mapRef,
}: {
  repo: string | null;
  listo: boolean;
  boardRef: RefObject<HTMLElement | null>;
  mapRef: RefObject<HTMLDivElement | null>;
}) {
  const [vista, setVista] = useState<Vista>({ x: 0, y: 0, k: 1 });
  const [arrastrando, setArrastrando] = useState(false);
  const agarre = useRef<{ x: number; y: number } | null>(null);
  const encuadrado = useRef<string | null>(null);
  // ¿La cámara la movió el usuario? Entonces al redimensionar no se toca.
  const movida = useRef(false);

  const reset = useCallback(() => {
    movida.current = true;
    setVista({ x: 0, y: 0, k: 1 });
  }, []);

  // Zoom de botones y teclado: se ancla en el centro del mapa, no en el cursor.
  const zoom = useCallback((factor: number) => {
    movida.current = true;
    setVista((v) => {
      const k = acotar(v.k * factor, ZOOM_MIN, ZOOM_MAX);
      if (k === v.k) return v;
      const caja = mapRef.current?.getBoundingClientRect();
      if (!caja) return { ...v, k };
      const lx = caja.width / v.k / 2;
      const ly = caja.height / v.k / 2;
      return {
        x: Math.round(v.x + lx * (v.k - k)),
        y: Math.round(v.y + ly * (v.k - k)),
        k,
      };
    });
  }, [mapRef]);

  /* Encuadrar: que el esquema quepa entero y centrado. Se mide con `offsetWidth`
   * y `clientWidth`, que no llevan el transform encima, así el cálculo vale con
   * cualquier zoom y no depende de la vista actual.
   *
   *  El tope es 1: encuadrar nunca agranda el mapa por encima de su tamaño real,
   *  solo lo encoge si no cabe. El suelo es el mismo de la cámara. */
  const encuadrar = useCallback(() => {
    movida.current = false;
    const board = boardRef.current;
    const map = mapRef.current;
    if (!board || !map) return;

    const ancho = map.offsetWidth;
    const alto = map.offsetHeight;
    if (!ancho || !alto) return;

    const k = acotar(
      Math.min((board.clientWidth - 64) / ancho, (board.clientHeight - 120) / alto),
      ZOOM_MIN,
      1,
    );
    setVista({
      x: (board.clientWidth - ancho * k) / 2 - map.offsetLeft,
      y: 0,
      k,
    });
  }, [boardRef, mapRef]);

  /** Repo nuevo: encuadre nuevo y cámara sin tocar. */
  const olvidar = useCallback(() => {
    encuadrado.current = null;
    movida.current = false;
  }, []);

  /* Bienvenida: al abrir un repo se encuadra una vez. Después manda el ratón. */
  useLayoutEffect(() => {
    if (!listo || !repo || encuadrado.current === repo) return;
    if (!boardRef.current || !mapRef.current) return;
    encuadrado.current = repo;
    const raf = requestAnimationFrame(encuadrar);
    return () => cancelAnimationFrame(raf);
  }, [repo, listo, encuadrar, boardRef, mapRef]);

  // Rueda: acerca y aleja sobre el punto donde está el cursor, no sobre el
  // centro. Escucha nativa porque React registra `wheel` como pasivo y no deja
  // cancelar el desplazamiento de la página.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;

    const rueda = (e: WheelEvent) => {
      const caja = mapRef.current?.getBoundingClientRect();
      const lista = e.target instanceof Element ? e.target.closest(".lane-cola > .node-body") : null;
      if (lista && lista.scrollHeight > lista.clientHeight && !e.ctrlKey) return;
      if (!caja || !e.deltaY) return;
      e.preventDefault();

      movida.current = true;
      setVista((v) => {
        const k = acotar(v.k * (e.deltaY < 0 ? ZOOM_PASO : 1 / ZOOM_PASO), ZOOM_MIN, ZOOM_MAX);
        if (k === v.k) return v;
        // El punto local bajo el cursor se queda bajo el cursor.
        const lx = (e.clientX - caja.left) / v.k;
        const ly = (e.clientY - caja.top) / v.k;
        return { x: v.x + lx * (v.k - k), y: v.y + ly * (v.k - k), k };
      });
    };

    board.addEventListener("wheel", rueda, { passive: false });
    return () => board.removeEventListener("wheel", rueda);
  }, [boardRef, mapRef]);

  /* Si cambia el tamaño de la ventana se vuelve a encuadrar, salvo que el usuario
   * haya movido la cámara: entonces su vista manda y solo se recoloca el layout. */
  useEffect(() => {
    const alRedimensionar = () => {
      if (!movida.current) encuadrar();
    };
    window.addEventListener("resize", alRedimensionar);
    return () => window.removeEventListener("resize", alRedimensionar);
  }, [encuadrar]);

  /* Teclado: + y − acercan y alejan, 0 vuelve al 100% y F reencuadra. Nada de
   * atajos sobre un campo de formulario (input, select o textarea): a "f" en
   * el diálogo de descartar no le sigue un encuadre de regalo. */
  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoom(ZOOM_PASO);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoom(1 / ZOOM_PASO);
      } else if (e.key === "0") {
        e.preventDefault();
        reset();
      } else if (e.key.toLowerCase() === "f") {
        encuadrar();
      }
    };

    window.addEventListener("keydown", teclas);
    return () => window.removeEventListener("keydown", teclas);
  }, [zoom, reset, encuadrar]);

  const mano = {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      // Arrastrar solo desde el fondo: sobre un nodo o un mando no se mueve nada.
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest(".node, .vista, .aviso-recorte")) return;
      agarre.current = { x: e.clientX, y: e.clientY };
      movida.current = true;
      setArrastrando(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Puntero sintético (pruebas): seguimos sin capturar.
      }
    },
    onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
      const desde = agarre.current;
      if (!desde) return;
      const dx = e.clientX - desde.x;
      const dy = e.clientY - desde.y;
      agarre.current = { x: e.clientX, y: e.clientY };
      // Enteros: medio píxel de translate ya suaviza todo el texto.
      setVista((v) => ({ ...v, x: Math.round(v.x + dx), y: Math.round(v.y + dy) }));
    },
    onPointerUp: () => {
      agarre.current = null;
      setArrastrando(false);
    },
    onPointerCancel: () => {
      agarre.current = null;
      setArrastrando(false);
    },
    onDoubleClick: reset,
  };

  return { vista, arrastrando, encuadrar, zoom, reset, olvidar, mano };
}
