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
export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 1.5;
export const ZOOM_PASO = 1.08;

/** El zoom no es continuo: cae en escalones del 5 %. Un `scale` arbitrario
 *  (0,5196…) deja el texto en coordenadas fraccionarias y el rasterizador no
 *  puede alinearlo al píxel; los pasos fijos sí. */
const PASO_ESCALA = 0.05;
const cuantizar = (k: number) => Math.round(k / PASO_ESCALA) * PASO_ESCALA;
/** Hacia abajo: redondear al alza al encoger volvería a recortar el mapa. */
const cuantizarAbajo = (k: number) => Math.floor(k / PASO_ESCALA + 1e-9) * PASO_ESCALA;

/** Redondea al píxel del dispositivo: a dpr 1, entero; a dpr 1,25, múltiplo
 *  de 0,8. Medio píxel de `translate` suaviza todo el texto. */
const alPixel = (n: number) => {
  const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  return Math.round(n * dpr) / dpr;
};

/** Suelo de «encuadrar»: el mismo que el del zoom a mano.
 *
 *  Antes bajaba hasta el 20 % para que el esquema entrara entero. A 800×600
 *  eso dejaba el texto al 29 %, ilegible, y el mapa pegado al borde superior.
 *  Ahora, si no cabe, se recorta y el aviso de recorte lo dice: el texto se
 *  lee y el usuario puede arrastrar para ver el resto. */
export const ZOOM_ENCUADRE_MIN = ZOOM_MIN;

/** Suelo de «ver completo»: el mapa entero por debajo del texto legible.
 *
 *  Es una vista para mirar el esquema de un vistazo, no para trabajar: por
 *  debajo del suelo legible la UI esconde el texto secundario
 *  (`.vista-completa`) y acercar devuelve al 75 %. Nunca menos de 20 %: a esa
 *  escala el mapa ya no se distingue. */
export const ZOOM_COMPLETO_MIN = 0.2;

/** Por debajo de este zoom el texto secundario deja de llegar al suelo
 *  legible: 10,5 px por 0,9 son 9,45 px, y un rótulo de 9,5 px se queda en
 *  8,55. Ahí la UI lo oculta o lo refluye (`.texto-compacto`). */
export const ZOOM_TEXTO_MIN = 0.9;

export type Vista = { x: number; y: number; k: number };

const acotar = (valor: number, min: number, max: number) => Math.min(max, Math.max(min, valor));

/** Una sola regla de encuadre, sin DOM: el mapa entero si cabe, centrado en el
 *  alto libre del lienzo y nunca por debajo del suelo legible.
 *
 *  `offset` es dónde está el mapa dentro del lienzo (`offsetLeft/offsetTop`),
 *  que se descuenta para que el centro sea el del área visible. `relleno` es
 *  el padding del lienzo: el centro se calcula dentro de él, no del borde.
 *  `insetDerecha` es lo que tapa el panel de Resumen. */
export type Encuadre = {
  mapa: { ancho: number; alto: number };
  board: { ancho: number; alto: number };
  offset: { x: number; y: number };
  insetDerecha?: number;
  relleno?: { arriba: number; abajo: number };
  /** Aire horizontal que se deja a los lados al encuadrar. */
  margen?: number;
  /** «Ver completo»: deja bajar del suelo legible lo justo para que quepa. */
  completo?: boolean;
};

export function encuadreDe({
  mapa,
  board,
  offset,
  insetDerecha = 0,
  relleno = { arriba: 0, abajo: 0 },
  margen = 64,
  completo = false,
}: Encuadre): Vista {
  if (!mapa.ancho || !mapa.alto) return { x: 0, y: 0, k: 1 };
  const anchoVisible = Math.max(120, board.ancho - insetDerecha);
  const altoVisible = Math.max(120, board.alto - relleno.arriba - relleno.abajo);
  const bruto = Math.min((anchoVisible - margen) / mapa.ancho, altoVisible / mapa.alto);
  // Normal: nunca por debajo del suelo legible, y si no cabe se recorta (el
  // aviso ofrece «ver completo»). Completo: baja lo justo para que el esquema
  // entero quepa, en escalones del 5 % hacia abajo.
  const k = completo
    ? acotar(cuantizarAbajo(acotar(bruto, ZOOM_COMPLETO_MIN, 1)), ZOOM_COMPLETO_MIN, 1)
    : acotar(cuantizar(acotar(bruto, ZOOM_ENCUADRE_MIN, 1)), ZOOM_ENCUADRE_MIN, 1);
  // Si no cabe, se ancla a la izquierda: el flujo empieza en la Entrada y el
  // resto se alcanza arrastrando. Centrarlo recortaría las dos puntas y la
  // primera columna desaparecería sin decir por dónde se empieza.
  const cabe = mapa.ancho * k <= anchoVisible;
  return {
    x: (cabe ? (anchoVisible - mapa.ancho * k) / 2 : 0) - offset.x,
    y: relleno.arriba + (altoVisible - mapa.alto * k) / 2 - offset.y,
    k,
  };
}

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
      // Desde «ver completo» acercar devuelve al suelo legible de una vez: un
      // 31 % seguiría sin leerse y el texto oculto no volvería.
      if (v.k < ZOOM_MIN - 1e-9) {
        if (factor <= 1) return v;
        const caja = mapRef.current?.getBoundingClientRect();
        if (!caja) return { ...v, k: ZOOM_MIN };
        const lx = caja.width / v.k / 2;
        const ly = caja.height / v.k / 2;
        return {
          x: alPixel(v.x + lx * (v.k - ZOOM_MIN)),
          y: alPixel(v.y + ly * (v.k - ZOOM_MIN)),
          k: ZOOM_MIN,
        };
      }
      const k = acotar(cuantizar(acotar(v.k * factor, ZOOM_MIN, ZOOM_MAX)), ZOOM_MIN, ZOOM_MAX);
      if (Math.abs(k - v.k) < 1e-9) return v;
      const caja = mapRef.current?.getBoundingClientRect();
      if (!caja) return { ...v, k };
      const lx = caja.width / v.k / 2;
      const ly = caja.height / v.k / 2;
      return {
        x: alPixel(v.x + lx * (v.k - k)),
        y: alPixel(v.y + ly * (v.k - k)),
        k,
      };
    });
  }, [mapRef]);

  /* El encuadre medido en el DOM. Se mide con `offsetWidth` y `clientWidth`,
   *  que no llevan el transform encima, así el cálculo vale con cualquier zoom
   *  y no depende de la vista actual. `completo` deja bajar del suelo legible. */
  const medirEncuadre = useCallback(
    (completo: boolean): Vista | null => {
      const board = boardRef.current;
      const map = mapRef.current;
      if (!board || !map) return null;

      const ancho = map.offsetWidth;
      const alto = map.offsetHeight;
      if (!ancho || !alto) return null;

      // Se encuadra en lo que se ve, no en la caja: el panel derecho no encoge
      // el lienzo, solo lo tapa. El relleno del lienzo entra en la cuenta para
      // que el centro sea el del área visible y no el del borde.
      const estilo = getComputedStyle(board);
      const vista = encuadreDe({
        mapa: { ancho, alto },
        board: { ancho: board.clientWidth, alto: board.clientHeight },
        offset: { x: map.offsetLeft, y: map.offsetTop },
        insetDerecha,
        relleno: {
          arriba: parseFloat(estilo.paddingTop) || 0,
          abajo: parseFloat(estilo.paddingBottom) || 0,
        },
        completo,
      });
      return { ...vista, x: alPixel(vista.x), y: alPixel(vista.y) };
    },
    [boardRef, mapRef, insetDerecha],
  );

  /* Encuadrar: que el esquema quepa entero y centrado. El tope es 1 (nunca
   *  agranda) y el suelo es el mismo de la cámara: lo que no cabe se recorta y
   *  el aviso ofrece «ver completo». */
  const encuadrar = useCallback(() => {
    movida.current = false;
    const vista = medirEncuadre(false);
    if (vista) setVista(vista);
  }, [medirEncuadre]);

  /** «Ver completo»: lo que ofrece el aviso de recorte. Baja del suelo legible
   *  lo justo para que el esquema entero quepa; por debajo, la UI esconde el
   *  texto secundario. Acercar o reencuadrar vuelven al suelo. */
  const encuadrarCompleto = useCallback(() => {
    movida.current = false;
    const vista = medirEncuadre(true);
    if (vista) setVista(vista);
  }, [medirEncuadre]);

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
        // Acercar desde «ver completo» vuelve al suelo legible de una vez.
        if (v.k < ZOOM_MIN - 1e-9) {
          if (e.deltaY >= 0) return v;
          const caja = mapRef.current?.getBoundingClientRect();
          if (!caja) return { ...v, k: ZOOM_MIN };
          const lx = (e.clientX - caja.left) / v.k;
          const ly = (e.clientY - caja.top) / v.k;
          return {
            x: alPixel(v.x + lx * (v.k - ZOOM_MIN)),
            y: alPixel(v.y + ly * (v.k - ZOOM_MIN)),
            k: ZOOM_MIN,
          };
        }
        const k = acotar(
          cuantizar(acotar(v.k * (e.deltaY < 0 ? ZOOM_PASO : 1 / ZOOM_PASO), ZOOM_MIN, ZOOM_MAX)),
          ZOOM_MIN,
          ZOOM_MAX,
        );
        if (Math.abs(k - v.k) < 1e-9) return v;
        // El punto local bajo el cursor se queda bajo el cursor.
        const lx = (e.clientX - caja.left) / v.k;
        const ly = (e.clientY - caja.top) / v.k;
        return {
          x: alPixel(v.x + lx * (v.k - k)),
          y: alPixel(v.y + ly * (v.k - k)),
          k,
        };
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
      const desplazamiento = (nuevo - previo) / 2;
      setVista((v) => ({ ...v, x: alPixel(v.x + desplazamiento) }));
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
    const delta = (insetDerecha - previo) / 2;
    setVista((v) => ({ ...v, x: alPixel(v.x - delta) }));
  }, [insetDerecha, encuadrar]);

  /* Teclado: + y − acercan y alejan, 0 vuelve al 100% y F reencuadra. Nada de
   * atajos sobre un campo de formulario (input, select o textarea): a "f" en
   * el diálogo de descartar no le sigue un encuadre de regalo. */
  useEffect(() => {
    const teclas = (e: KeyboardEvent) => {
      // Un diálogo abierto manda: `f` o `0` no pueden mover la cámara detrás.
      if (document.querySelector('dialog[open], [role="dialog"], .modal-fondo')) return;
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLSelectElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable) ||
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
      setVista((v) => ({ ...v, x: alPixel(v.x + dx), y: alPixel(v.y + dy) }));
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

  return {
    vista,
    // Por debajo del suelo legible solo se llega con «ver completo».
    completo: vista.k < ZOOM_MIN - 1e-9,
    // El secundario se esconde o refluye cuando el zoom ya no lo deja legible.
    compacto: vista.k < ZOOM_TEXTO_MIN - 1e-9,
    arrastrando,
    encuadrar,
    encuadrarCompleto,
    zoom,
    reset,
    olvidar,
    mano,
  };
}
