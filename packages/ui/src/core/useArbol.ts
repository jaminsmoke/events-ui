import { useEffect, useRef, useState } from "react";

import { api, unwrap } from "./api";
import type { NodoArbol } from "./api";
import { mezclarNiveles } from "./niveles";
import type { Niveles } from "./niveles";
import { suscribirSondeo } from "./sondeo";

/** Lo cargado pertenece a *un* repo: al cambiar de carpeta, lo viejo deja de
 *  valer en el render en vez de pintarse un frame con el árbol anterior. */
type Cargado = { repo: string; hijos: Record<string, NodoArbol[]> };
type Fallo = { repo: string; mensaje: string };

/** Hijos por carpeta del repo, refrescados solos.
 *
 *  No hay watcher: se piden los niveles que el pane tiene desplegados y se
 *  vuelven a pedir en cada latido del sondeo. Son un `scandir` por carpeta —ni
 *  un subproceso ni un recorrido del árbol entero—, así que lo que se crea o
 *  se borra fuera de la app aparece en un par de segundos.
 *
 *  `rutas` es la raíz (`""`) más lo desplegado. Como la clave del efecto es su
 *  contenido, un array nuevo en cada render no reprograma nada. */
export function useArbol(repo: string | null, rutas: string[]) {
  const [cargado, setCargado] = useState<Cargado | null>(null);
  const [fallo, setFallo] = useState<Fallo | null>(null);
  const clave = rutas.join("\u0000");

  // Lo que ya se pintó, para comparar nivel a nivel con lo recién pedido: un
  // nivel igual conserva su array y el mapa no se rehace entero.
  const previos = useRef<{ repo: string | null; hijos: Niveles }>({ repo: null, hijos: {} });

  // Sin repo no se pide nada y no hay estado que limpiar: el render ya
  // descarta lo cargado de otra carpeta.
  useEffect(() => {
    if (!repo) return;
    let vivo = true;
    let ocupado = false;

    const pedir = async () => {
      if (ocupado) return;
      ocupado = true;
      try {
        const pedidas = clave === "" ? [] : clave.split("\u0000");
        const niveles = await unwrap(
          api.GET("/arbol", { params: { query: { repo, rutas: pedidas } } }),
        );
        if (!vivo) return;
        // `hijos` viaja opcional en el contrato (tiene valor por defecto en
        // el core), pero un nivel siempre trae su lista: vacía es una carpeta
        // vacía.
        const antes = previos.current.repo === repo ? previos.current.hijos : {};
        const { hijos: mapa, cambio } = mezclarNiveles(antes, niveles);
        previos.current = { repo, hijos: mapa };
        // Sin cambios no se toca el estado: el pane no se repinta cada latido.
        if (cambio) setCargado({ repo, hijos: mapa });
        setFallo(null);
      } catch (err) {
        if (vivo) {
          setFallo({ repo, mensaje: err instanceof Error ? err.message : String(err) });
        }
      } finally {
        ocupado = false;
      }
    };

    const baja = suscribirSondeo(() => void pedir());
    void pedir();
    return () => {
      vivo = false;
      baja();
    };
  }, [repo, clave]);

  const hijos = cargado && cargado.repo === repo ? cargado.hijos : {};

  return { hijos, error: fallo && fallo.repo === repo ? fallo.mensaje : null };
}
