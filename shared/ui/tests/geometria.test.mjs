/** Pruebas de la geometría del mapa: sin DOM, sin React.
 *
 *  Todo lo que se calcula aquí —rutas, longitudes, punto a una fracción y
 *  reparto de compuertas— se mide en píxeles locales del mapa y no depende de
 *  la ventana. El hook de `cables.ts` solo mide cajas y aplica estas reglas.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CELDA,
  duracionChispa,
  largo,
  puntoEnTrazo,
  repartirCompuertas,
  salida,
  trazoDe,
} from "../src/modelo/geometria.ts";

/** Un codo recto de 100 px + 100 px: total 200. */
const CODO = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

test("trazoDe pinta una ruta ortogonal con M y L", () => {
  assert.equal(trazoDe(CODO), "M 0 0 L 100 0 L 100 100");
});

test("largo suma los tramos, no la distancia entre extremos", () => {
  assert.equal(largo(CODO), 200);
  assert.equal(largo([]), 0);
  assert.equal(largo([{ x: 7, y: 7 }]), 0);
});

test("puntoEnTrazo reparte por longitud y clampa la fracción", () => {
  assert.deepEqual(puntoEnTrazo(CODO, 0), { x: 0, y: 0, angulo: 0 });
  // La mitad de 200 cae justo en el codo.
  assert.deepEqual(puntoEnTrazo(CODO, 0.5), { x: 100, y: 0, angulo: 0 });
  assert.deepEqual(puntoEnTrazo(CODO, 1), { x: 100, y: 100, angulo: 90 });
  assert.deepEqual(puntoEnTrazo(CODO, -1), { x: 0, y: 0, angulo: 0 });
  assert.deepEqual(puntoEnTrazo(CODO, 2), { x: 100, y: 100, angulo: 90 });
});

test("puntoEnTrazo sin puntos no inventa coordenadas", () => {
  assert.deepEqual(puntoEnTrazo([], 0.5), { x: 0, y: 0, angulo: 0 });
  assert.deepEqual(puntoEnTrazo([{ x: 4, y: 9 }], 0.5), { x: 4, y: 9, angulo: 0 });
});

/** Los ángulos salen de `atan2`, así que se comparan con tolerancia. */
function cerca(actual, esperado) {
  assert.ok(Math.abs(actual - esperado) < 1e-9, `${actual} no es ${esperado}`);
}

test("salida da el ángulo del primer tramo que sale del nudo", () => {
  const nudo = { id: "n", x: 50, y: 50, lado: 0 };
  cerca(salida({ puntos: [{ x: 50, y: 50 }, { x: 120, y: 50 }] }, nudo), 0);
  cerca(salida({ puntos: [{ x: 50, y: 50 }, { x: 50, y: 0 }] }, nudo), -90);
  cerca(salida({ puntos: [{ x: 50, y: 50 }, { x: 50, y: 120 }] }, nudo), 90);
  cerca(salida({ puntos: [{ x: 50, y: 50 }, { x: 0, y: 50 }] }, nudo), 180);
});

test("salida tolera medio píxel y mide desde el primer tramo si no encuentra el nudo", () => {
  const nudo = { id: "n", x: 50, y: 50, lado: 0 };
  cerca(salida({ puntos: [{ x: 50.4, y: 50.2 }, { x: 0, y: 50.2 }] }, nudo), 180);
  cerca(salida({ puntos: [{ x: 0, y: 0 }, { x: 0, y: 10 }] }, nudo), 90);
  assert.equal(salida({ puntos: [] }, nudo), 0);
});

test("duracionChispa acota entre 0,42 y 1,05 s", () => {
  assert.equal(duracionChispa(0), 0.42);
  assert.equal(duracionChispa(45), 0.5);
  assert.equal(duracionChispa(10_000), 1.05);
});

test("una sola compuerta se centra en su nudo y el rombo la circunscribe", () => {
  const nudo = { id: "n", x: 50, y: 80, lado: 0 };
  const cable = {
    puntos: [{ x: 50, y: 80 }, { x: 120, y: 80 }],
    nudo: "n",
    uniones: [["verificacion", "roadmap"]],
    compuerta: { x: 0, y: 0, angulo: 0 },
  };
  repartirCompuertas([cable], [nudo]);
  assert.deepEqual(cable.compuerta, { x: 50, y: 80, angulo: 0 });
  assert.equal(nudo.lado, Math.ceil((CELDA.ancho / 2 + CELDA.alto / 2 + 3) * Math.SQRT2));
});

test("dos compuertas se reparten en fila alrededor del centro, por su abanico", () => {
  const nudo = { id: "n", x: 50, y: 50, lado: 0 };
  // Sale hacia arriba (-90°) y hacia la derecha (0°): el orden es ese.
  const arriba = {
    puntos: [{ x: 50, y: 50 }, { x: 50, y: 0 }],
    nudo: "n",
    uniones: [],
    abierta: true,
    compuerta: { x: 0, y: 0, angulo: 0 },
  };
  const derecha = {
    puntos: [{ x: 50, y: 50 }, { x: 100, y: 50 }],
    nudo: "n",
    uniones: [["revision_aprobada", "historial"]],
    compuerta: { x: 0, y: 0, angulo: 0 },
  };
  repartirCompuertas([derecha, arriba], [nudo]);
  const medio = (CELDA.ancho + 4) / 2;
  assert.equal(arriba.compuerta.x, 50 - medio);
  assert.equal(derecha.compuerta.x, 50 + medio);
  assert.equal(arriba.compuerta.y, 50);
  assert.equal(derecha.compuerta.y, 50);
  // El rombo crece para que las dos celdas y su hueco quepan dentro.
  const ancho = 2 * CELDA.ancho + 4;
  assert.equal(nudo.lado, Math.ceil((ancho / 2 + CELDA.alto / 2 + 3) * Math.SQRT2));
});

test("una compuerta que no se dibuja no ocupa sitio ni agranda el nudo", () => {
  const nudo = { id: "n", x: 50, y: 50, lado: 0 };
  const apagada = {
    puntos: [{ x: 50, y: 50 }, { x: 120, y: 50 }],
    nudo: "n",
    uniones: [],
    compuerta: { x: 7, y: 7, angulo: 0 },
  };
  repartirCompuertas([apagada], [nudo]);
  assert.deepEqual(apagada.compuerta, { x: 7, y: 7, angulo: 0 });
  assert.equal(nudo.lado, 0);
});

test("un cable sin nudo conserva su compuerta y no toca ningún rombo", () => {
  const nudo = { id: "n", x: 50, y: 50, lado: 0 };
  const suelto = {
    puntos: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    uniones: [["verificacion", "roadmap"]],
    compuerta: { x: 50, y: 0, angulo: 0 },
  };
  repartirCompuertas([suelto], [nudo]);
  assert.deepEqual(suelto.compuerta, { x: 50, y: 0, angulo: 0 });
  assert.equal(nudo.lado, 0);
});
