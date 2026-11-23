// El flujo completo de un ítem por la API, reflejado en la UI: se crea en
// el cajón (draft), se manda a Backlog (proposed) y se descarta (rejected).
// La proyección de la UI dice cola: 1 / descartadas: 1 y los eventos cuentan
// created + dos status.

export default {
  nombre: "flujo-cajon-cola-descartadas",
  descripcion: "Creación → Backlog → Descartadas por la API, asumiendo la UI y el log de eventos",

  run: async (ctx) => {
    const { page, api, esperar, expect, resultado } = ctx;

    const creada = await api("/items?repo=lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Flujo de prueba" }),
    });
    await expect(creada.status === 201, "la creación devuelve 201");
    await expect(creada.data.status === "draft", "nace en el cajón");
    const uid = creada.data.uid;

    const encola = await api(`/items/${uid}?repo=lab`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "proposed" }),
    });
    await expect(encola.data.status === "proposed", "va a la cola");

    const descartada = await api(`/items/${uid}?repo=lab`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "rejected", rejected_description: "ruido" }),
    });
    await expect(descartada.data.status === "rejected", "se descarta");

    const eventos = await api("/eventos?repo=lab");
    const tipos = eventos.data.map((e) => e.type);
    await expect(
      tipos.join(",") === "item.created,item.status,item.status",
      `los eventos cuentan el flujo (vinieron: ${tipos.join(",")})`,
    );

    // En la UI: la proyección del repo dice descartadas: 1.
    await page.goto(`${ctx.UI}/`, { waitUntil: "networkidle", timeout: 30_000 });
    // Si un escenario anterior ya dejó `lab` abierto, el selector no aparece.
    const selector = page.getByRole("button", { name: "lab" });
    if ((await selector.count()) > 0) await selector.click();
    await esperar(
      () => page.evaluate(() => document.body.innerText.includes("descartadas: 1")),
      "la proyección a decir descartadas: 1",
      30_000,
    );
    await page.screenshot({ path: resultado("flujo-cajon-cola-descartadas.png") });
  },
};
