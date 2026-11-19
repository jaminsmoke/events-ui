export default {
  nombre: "historial-aprobacion",
  descripcion: "Aprobar archiva con sus fases y el historial es solo lectura",
  run: async ({ page, UI, api, esperar, expect, resultado }) => {
    const headers = { "content-type": "application/json" };
    const crear = await api("/ideas?repo=lab", {
      method: "POST",
      headers,
      body: JSON.stringify({ title: "Historial E2E", status: "proposed" }),
    });
    expect(crear.status === 201, `no se pudo crear: ${crear.status}`);
    const uid = crear.data.uid;

    const plan = await api(`/ideas/${uid}?repo=lab`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "roadmap",
        fases: [{ titulo: "Cierre", requisitos: [{ titulo: "Comprobar el cierre" }] }],
      }),
    });
    expect(plan.status === 200, `roadmap: ${JSON.stringify(plan.data)}`);

    const cerrar = await api(`/ideas/${uid}?repo=lab`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "verificacion",
        fases: [
          {
            orden: 1,
            titulo: "Cierre",
            estado: "completada",
            nota: "",
            requisitos: [{ orden: 1, titulo: "Comprobar el cierre", hecho: true }],
          },
        ],
      }),
    });
    expect(cerrar.status === 200, `verificación: ${JSON.stringify(cerrar.data)}`);

    const aprobar = await api(`/ideas/${uid}?repo=lab`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        status: "revision_aprobada",
        approved_by: "agente",
        revision_nota: "Todo comprobado",
      }),
    });
    expect(aprobar.status === 200, `aprobación: ${JSON.stringify(aprobar.data)}`);
    expect(aprobar.data.status === "historial", "aprobar debe archivar en historial");
    expect(
      aprobar.data.fases[0].estado === "completada" &&
        aprobar.data.fases[0].requisitos[0].hecho === true,
      "el historial debe conservar la fase completada y su requisito",
    );
    expect(
      aprobar.data.revision_approved_by === "agente" &&
        aprobar.data.revision_nota === "Todo comprobado",
      "el historial debe conservar la firma",
    );

    await page.goto(UI, { waitUntil: "domcontentloaded" });
    const selector = page.getByRole("button", { name: "lab", exact: true });
    const pruebas = page.getByRole("button", { name: "Pruebas", exact: true });
    await selector.or(pruebas).first().waitFor();
    if (await selector.isVisible()) await selector.click();

    const fila = page.locator(`.lane-historial .row[data-uid="${uid}"]`);
    const cabeza = fila.locator(".row-head");
    await cabeza.waitFor({ timeout: 20_000 });
    await cabeza.click();
    await fila.locator(".fases").waitFor();

    expect(
      (await fila.getByRole("button", { name: "Editar", exact: true }).count()) === 0,
      "el historial no debe ofrecer Editar",
    );
    expect(
      (await fila.getByRole("button", { name: "Borrar", exact: true }).count()) === 0,
      "el historial no debe ofrecer Borrar",
    );
    expect(
      (await fila.getByRole("button", { name: "Datos…", exact: true }).count()) === 0,
      "el historial no debe ofrecer Datos…",
    );
    expect((await fila.locator(".fase-estado").count()) === 0, "no debe haber selector de fase");
    expect(!(await fila.locator(".fase-nueva").isVisible()), "no debe haber formulario de fase");

    await fila.locator(".fase-check").first().click();
    const casilla = fila.locator(".requisito input").first();
    await casilla.waitFor();
    expect(await casilla.isDisabled(), "el requisito debe estar de lectura");
    expect(await casilla.isChecked(), "el requisito debe seguir marcado");
    expect((await fila.innerText()).includes("Cierre"), "la fase debe seguir en la ficha");
    await fila.locator(".fila-detalle").screenshot({ path: resultado("historial.png") });
    await page.screenshot({ path: resultado("historial-mapa.png") });

    await esperar(
      () => page.locator(".wire.historial").count().then((n) => n === 1),
      "el cable del historial",
    );

    await api(`/ideas/${uid}?repo=lab`, { method: "DELETE" });
  },
};
