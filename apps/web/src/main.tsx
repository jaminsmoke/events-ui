import App, { montarApp } from "@events-ui/ui";

/** La web no tiene diálogo nativo de carpetas: el selector de la UI
 *  compartida ofrece el explorador servido por `GET /fs`, la lista de
 *  `GET /repos` y pegar la ruta. Desktop añade el diálogo nativo encima. */
montarApp(<App />);
