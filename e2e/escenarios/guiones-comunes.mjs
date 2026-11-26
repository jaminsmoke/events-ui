// Los guiones del laboratorio comparten `item`, `fase` y `exigirUid`: la
// prueba los usa directamente y construye y ejecuta todos los guiones contra
// una API falsa, sin navegador.
//
// `guiones.ts` solo importa tipos, así que Node lo carga con su type
// stripping: lo que se prueba son los constructores, no la pantalla.
import { PRUEBAS, exigirUid, fase, item } from "../../apps/desktop/src/guiones.ts";

/** Una API de mentira que apunta lo que pide cada paso. */
function apiFalsa() {
  const llamadas = [];
  let n = 0;
  return {
    llamadas,
    crear: async (body) => {
      const uid = `uid-${++n}`;
      llamadas.push({ tipo: "crear", uid, body });
      return { uid };
    },
    mover: async (uid, status) => {
      llamadas.push({ tipo: "mover", uid, status });
    },
    editar: async (uid, cambios) => {
      llamadas.push({ tipo: "editar", uid, cambios });
    },
    commit: async (mensaje) => {
      llamadas.push({ tipo: "commit", mensaje });
    },
    // `commit-panel` se salta el paso si no hay cambios que commitear.
    cambios: 1,
    abrirMapa: (mapa) => {
      llamadas.push({ tipo: "abrirMapa", mapa });
    },
  };
}

export default {
  nombre: "guiones-comunes",
  descripcion: "Los guiones comparten item/fase/exigirUid y todos se construyen y corren",
  run: async ({ expect }) => {
    // Los helpers, por su cuenta: es el contrato que comparten los guiones.
    const armada = fase(2, "Prueba", "completada", [["Uno", true], ["Dos", false]], "nota");
    expect(
      armada.orden === 2 && armada.estado === "completada" && armada.nota === "nota",
      "fase() no arma la fase",
    );
    expect(
      armada.requisitos.length === 2 &&
        armada.requisitos[1].orden === 2 &&
        armada.requisitos[1].hecho === false,
      "fase() no numera los requisitos",
    );

    let uid = null;
    const uidExigido = exigirUid(() => uid);
    let aviso = "";
    try {
      uidExigido();
    } catch (err) {
      aviso = err instanceof Error ? err.message : String(err);
    }
    expect(aviso === "Falta el uid del ítem creado.", `exigirUid avisa «${aviso}»`);
    uid = "abc";
    expect(uidExigido() === "abc", "exigirUid no devuelve el uid");

    const creado = item(async () => ({ uid: "xyz" }));
    await creado.crear({ title: "T" });
    expect(creado.uid() === "xyz", "item() no recuerda el uid");

    const sinIdea = item(async () => null);
    aviso = "";
    try {
      await sinIdea.crear({ title: "T" });
    } catch (err) {
      aviso = err instanceof Error ? err.message : String(err);
    }
    expect(aviso === "El core no devolvió el ítem creado.", `item() avisa «${aviso}»`);

    // Todos los guiones: mismos pasos, mismos textos y sin errores. Los pasos
    // de «mirar» solo duermen para que el ojo vea el estado: se comprueban
    // pero no se ejecutan.
    const ids = new Set();
    const fasesEnviadas = [];
    for (const prueba of PRUEBAS) {
      expect(!ids.has(prueba.id), `id de prueba repetido: ${prueba.id}`);
      ids.add(prueba.id);
      const api = apiFalsa();
      const pasos = prueba.construir(api);
      expect(pasos.length > 0, `«${prueba.id}» no tiene pasos`);
      const textos = new Set();
      for (const paso of pasos) {
        expect(paso.texto.trim() !== "", `«${prueba.id}» tiene un paso sin texto`);
        expect(!textos.has(paso.texto), `«${prueba.id}» repite el texto «${paso.texto}»`);
        textos.add(paso.texto);
        if (!paso.texto.startsWith("Mirar")) await paso.ejecutar();
      }
      for (const llamada of api.llamadas) {
        if (llamada.tipo === "editar" && llamada.cambios.fases) {
          fasesEnviadas.push(...llamada.cambios.fases);
        }
      }
    }
    expect(ids.size === 9, `se esperaban 9 guiones y hay ${ids.size}`);
    expect(fasesEnviadas.length > 0, "ningún guion envió fases");
    for (const enviada of fasesEnviadas) {
      expect(enviada.titulo !== "", "una fase sin título");
      expect(
        Array.isArray(enviada.requisitos) && enviada.requisitos.length > 0,
        `la fase «${enviada.titulo}» sin requisitos`,
      );
      for (const requisito of enviada.requisitos) {
        expect(
          requisito.orden >= 1 && requisito.titulo !== "" && typeof requisito.hecho === "boolean",
          `requisito mal formado en «${enviada.titulo}»`,
        );
      }
    }
  },
};
