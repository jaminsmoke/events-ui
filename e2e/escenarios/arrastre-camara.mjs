/** Arrastrar la cámara no puede perder frames.
 *
 *  `vista` vive en App y cada `pointermove` re-renderiza App (Lienzo se salta
 *  por memo). Antes de pasar el transform a una ref o a rAF hay que medir: este
 *  escenario arrastra el mapa 40 pasos y mide el hueco entre marcos, las
 *  tareas largas y que el mapa se haya movido de verdad. Los números salen por
 *  consola; los topes son el presupuesto que se decidió al medir.
 */
export default {
  nombre: "arrastre-camara",
  descripcion: "Un arrastre de 40 pasos no pierde frames ni encola tareas largas",

  run: async ({ page, UI, expect }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.goto(UI, { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("eui.repo"));
    await page.reload({ waitUntil: "domcontentloaded" });
    const lab = page.getByRole("button", { name: "lab", exact: true });
    await lab.waitFor({ timeout: 15_000 });
    await lab.click();
    await page.locator(".map").waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);

    const antes = await page.evaluate(() => {
      const matriz = new DOMMatrix(getComputedStyle(document.querySelector(".map")).transform);
      return { x: matriz.e, y: matriz.f };
    });

    await page.evaluate(() => {
      const medida = { marcos: [], largas: [] };
      window.__camara = medida;
      medida.obs = new PerformanceObserver((lista) => {
        for (const entrada of lista.getEntries()) medida.largas.push(entrada.duration);
      });
      medida.obs.observe({ entryTypes: ["longtask"] });
      const inicio = performance.now();
      const paso = () => {
        medida.marcos.push(performance.now());
        if (performance.now() - inicio < 2_000) requestAnimationFrame(paso);
      };
      requestAnimationFrame(paso);
    });

    const caja = await page.locator(".board").boundingBox();
    const x = caja.x + caja.width / 2;
    const y = caja.y + caja.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let paso = 1; paso <= 40; paso++) {
      await page.mouse.move(x + paso * 4, y + paso * 2);
    }
    await page.mouse.up();
    await page.waitForTimeout(400);

    const medida = await page.evaluate(() => {
      const m = window.__camara;
      m.obs.disconnect();
      const huecos = m.marcos
        .slice(1)
        .map((t, i) => t - m.marcos[i])
        .sort((a, b) => a - b);
      const matriz = new DOMMatrix(getComputedStyle(document.querySelector(".map")).transform);
      return {
        marcos: m.marcos.length,
        mediana: huecos[Math.floor(huecos.length / 2)] ?? 0,
        p95: huecos[Math.floor(huecos.length * 0.95)] ?? 0,
        maximo: huecos.at(-1) ?? 0,
        largas: m.largas,
        x: matriz.e,
        y: matriz.f,
      };
    });
    console.log(
      `  arrastre: ${medida.marcos} marcos, mediana ${medida.mediana.toFixed(1)} ms, ` +
        `p95 ${medida.p95.toFixed(1)} ms, máx ${medida.maximo.toFixed(1)} ms, ` +
        `tareas largas ${JSON.stringify(medida.largas.map((d) => Math.round(d)))}`,
    );

    expect(
      medida.x !== antes.x || medida.y !== antes.y,
      "el arrastre no movió el mapa",
    );
    expect(
      medida.largas.every((d) => d < 100),
      `el arrastre encoló tareas largas: ${JSON.stringify(medida.largas.map((d) => Math.round(d)))}`,
    );
    expect(medida.p95 <= 40, `p95 del hueco entre marcos: ${medida.p95.toFixed(1)} ms`);
    expect(medida.maximo <= 120, `hueco máximo entre marcos: ${medida.maximo.toFixed(1)} ms`);

    await page.evaluate(() => localStorage.removeItem("eui.repo"));
    await page.setViewportSize({ width: 1500, height: 950 });
    await page.goto("about:blank");
  },
};
