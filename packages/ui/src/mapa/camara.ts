import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

/** Zoom del lienzo, acotado a lo útil.
 *
 *  El esquema es pequeño: no hay nada que leer al 25% ni un nodo que necesite el
 *  300%. Por debajo del 50% los títulos se vuelven ilegibles y por encima del
 *  150% el mapa ocupa mucho más que su ventana y se pierde de vista. */
export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 1.5;
export const ZOOM_PASO = 1.08;

/** Suelo de «encuadrar», más bajo que el del zoom a mano.
 *
 *  Por debajo del 50 % el texto del esquema ya no se lee, pero con el pane
 *  abierto o en una ventana estrecha el mapa no cabe de otra forma: recortarlo
 *  y avisar de que está fuera de la vista es peor que verlo entero y pequeño.
 *  Encuadrar llega hasta aquí; el zoom a mano conserva su suelo (`ZOOM_MIN`),
 *  salvo que la cámara ya esté por debajo —entonces no se le impone un
 *  salto—. */
export const ZOOM_ENCUADRE_MIN = 0.2;

export type Vista = { x: number; y: number; k: number };

const acotar = (valor: number, min: number, max: number) => Math.min(max, Math.max(min, valor));

/** Cámara del lienzo: solo mueve la vista. Los nodos no se tocan.
 *
 *  Los dos nodos del DOM los presta quien pinta: el hook mide y mueve, no posee
 *  el árbol. */
export function useCamara({
  repo,
  mapa,
  listo,
  boardRef,
  mapRef,
  insetDerecha = 0,
}: {
  repo: string | null;
  mapa: string;
  listo: boolean;
  boardRef: RefObject<HTMLElement | null>;
  mapRef: RefObject<HTMLDivElement | null>;
  /** Píxeles del canto derecho que tapa el panel de Resumen. El panel va
   *  encima del lienzo, así que no encoge la caja: sin este dato se encuadra
   *  debajo del panel y media mitad del mapa queda oculta. */
  insetDerecha?: number;
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
      const k = acotar(v.k * factor, Math.min(ZOOM_MIN, v.k), ZOOM_MAX);
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

    // Se encuadra en lo que se ve, no en la caja: el panel derecho no encoge
    // el lienzo, solo lo tapa.
    const visible = Math.max(120, board.clientWidth - insetDerecha);
    const k = acotar(
      Math.min((visible - 64) / ancho, (board.clientHeight - 120) / alto),
      ZOOM_ENCUADRE_MIN,
      1,
    );
    setVista({
      x: (visible - ancho * k) / 2 - map.offsetLeft,
      y: 0,
      k,
    });
  }, [boardRef, mapRef, insetDerecha]);

  /** Repo nuevo: encuadre nuevo y cámara sin tocar. */
  const olvidar = useCallback(() => {
    encuadrado.current = null;
    movida.current = false;
  }, []);

  /* Bienvenida: al abrir un repo se encuadra una vez por mapa. Después
   *  manda el ratón; al cambiar de vista se vuelve a encuadrar solo. */
  useLayoutEffect(() => {
    if (!listo || !repo) return;
    const clave = `${repo}|${mapa}`;
    if (encuadrado.current === clave) return;
    if (!boardRef.current || !mapRef.current) return;
    encuadrado.current = clave;
    const raf = requestAnimationFrame(encuadrar);
    return () => cancelAnimationFrame(raf);
  }, [repo, mapa, listo, encuadrar, boardRef, mapRef]);

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
        const k = acotar(
          v.k * (e.deltaY < 0 ? ZOOM_PASO : 1 / ZOOM_PASO),
          Math.min(ZOOM_MIN, v.k),
          ZOOM_MAX,
        );
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

  /* El lienzo también cambia de ancho sin que lo haga la ventana: al abrir o
   * cerrar un panel del marco. Con la cámara sin tocar se reencuadra (cabe otra
   * vez entero); con la cámara movida no se le quita la vista al usuario, solo
   * se conserva el centro de lo que estaba mirando. */
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let ancho: number | null = null;

    const alCambiarElLienzo = (entradas: ResizeObserverEntry[]) => {
      const nuevo = entradas[0]?.contentRect.width ?? board.clientWidth;
      const previo = ancho;
      ancho = nuevo;
      // La primera medida solo sirve de referencia: no es un cambio.
      if (previo === null || previo === nuevo) return;
      if (!movida.current) {
        encuadrar();
        return;
      }
      const desplazamiento = Math.round((nuevo - previo) / 2);
      setVista((v) => ({ ...v, x: v.x + desplazamiento }));
    };

    const ro = new ResizeObserver(alCambiarElLienzo);
    ro.observe(board);
    return () => ro.disconnect();
  }, [repo, listo, encuadrar, boardRef]);

  /* Abrir o cerrar el panel derecho no cambia el ancho del lienzo, solo el
   * hueco visible. Con la cámara sin tocar se reencuadra en el hueco nuevo;
   * con la cámara movida se desplaza medio hueco, para que lo que estabas
   * mirando siga en el centro de lo que se ve. */
  const insetPrevio = useRef(insetDerecha);
  useEffect(() => {
    const previo = insetPrevio.current;
    insetPrevio.current = insetDerecha;
    if (previo === insetDerecha) return;
    if (!movida.current) {
      encuadrar();
      return;
    }
    const delta = Math.round((insetDerecha - previo) / 2);
    setVista((v) => ({ ...v, x: v.x - delta }));
  }, [insetDerecha, encuadrar]);

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
      /* Los diálogos se portalean a `document.body`, pero React les hace
       * burbujear el evento por el árbol hasta este `section`. Sin el corte,
       * pulsar «Descartar» (o cualquier botón del portal) empezaba un arrastre,
       * el tablero capturaba el puntero y el clic se quedaba aquí: el botón no
       * llegaba a pulsarse nunca. */
      if (!e.currentTarget.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest(".node, .vista, .aviso-recorte, .mapas-nav")) return;
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
    // Mismo corte que en el arrastre: el portal no debe reencuadrar el mapa.
    // Sobre un nodo (p. ej. el puente Git) el doble clic es del nodo, no un
    // reset de cámara: si no, «abrir mapa de Git» parece que no hace nada.
    onDoubleClick: (e: ReactMouseEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest(".node, .vista, .aviso-recorte, .mapas-nav")) {
        return;
      }
      reset();
    },
  };

  return { vista, arrastrando, encuadrar, zoom, reset, olvidar, mano };
}
