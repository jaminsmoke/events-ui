// El filtro por `origen` y la purga del registro, de verdad: se escribe un
// evento como si viniera del productor externo (reparto de los roles: la app
// no escribe los externos) y se comprueba que `?origen=` los distingue, y que
// la purga del registro cede su parte sobre `/log`.

import { DatabaseSync } from "node:sqlite";
import path from "node:path";

export default {
  nombre: "origen-y-registro",
  descripcion: "Origen idea/externo en el log + purga del registro operativo",

  run: async (ctx) => {
    const { api, expect } = ctx;

    // Rol de productor externo: fila en el log, con su origen puesto.
    const db = new DatabaseSync(path.join(ctx.tmp, "repos", "lab", ".EUI", "EUI_DATABASE.sqlite"));
    db.exec(
      "INSERT INTO event (ts, type, payload, origen) VALUES " +
        "('2026-11-18T00:00:00Z', 'sistema.reinicio', '{}', 'externo')",
    );
    db.close();

    const externos = await api("/eventos?origen=externo&repo=lab");
    await expect(
      externos.data.length === 1 && externos.data[0].type === "sistema.reinicio",
      "el filtro de origen externo dice uno",
    );
    const deIdeas = await api("/eventos?origen=idea&repo=lab");
    await expect(deIdeas.data.length === 0, "de ideas no hay ninguna en este lab fresco");

    const antes = await api("/log?limite=200");
    await expect(antes.data.length > 0, "el registro ya tiene entradas");

    const purga = await api("/log/purgar", { method: "POST" });
    await expect(purga.status === 200, "la purga responde 200");
    await expect(
      typeof purga.data.eliminadas_por_edad === "number" &&
        typeof purga.data.eliminadas_por_conteo === "number",
      "la purga dice qué se llevó",
    );
  },
};
