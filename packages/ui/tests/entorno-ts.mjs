/** Registra `tsx` para importar los `.ts` del paquete sin compilar.
 *
 *  Node no resuelve los imports relativos sin extensión que usa `src/`;
 *  `tsx` sí, como el bundler. Lo necesitan las pruebas puras: las que montan
 *  DOM ya lo traen de `entorno-dom.mjs`. Este fichero no es un `.test.mjs`
 *  a propósito: `node --test` solo corre los que terminan en `.test.mjs`.
 */
import { register } from "tsx/esm/api";

register();
