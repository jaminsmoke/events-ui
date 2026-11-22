import type { HighlighterCore, LanguageRegistration, ThemedToken } from "shiki/core";

/** Lenguaje de Shiki por extensión; `null` es texto plano.
 *
 *  Solo se mapean extensiones con gramática cargada abajo: el resto se pinta
 *  sin colores en vez de adivinar. Un archivo sin extensión conocido (Makefile,
 *  LICENSE…) cae aquí y se lee igual.
 */
const POR_EXTENSION: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  css: "css",
  scss: "scss",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  md: "markdown",
  markdown: "markdown",
  py: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  lua: "lua",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  sql: "sql",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
};

export function lenguajeDe(ruta: string): string | null {
  const nombre = ruta.split("/").pop() ?? "";
  if (nombre.toLowerCase() === "dockerfile") return "dockerfile";
  const punto = nombre.lastIndexOf(".");
  if (punto === -1) return null;
  return POR_EXTENSION[nombre.slice(punto + 1).toLowerCase()] ?? null;
}

type Cargador = () => Promise<{ default: LanguageRegistration | LanguageRegistration[] }>;

/** Gramáticas que puede pedir `POR_EXTENSION`, cada una en su chunk. */
const GRAMATICAS: Record<string, Cargador> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
};

// Un archivo enorme tarda segundos en tokenizarse y no compensa: por encima
// de este tamaño se pinta plano. El texto ya viene acotado a 512 KiB.
const LIMITE_RESALTADO = 200_000;

let resaltador: Promise<HighlighterCore> | null = null;
const listos = new Set<string>();

async function crear(): Promise<HighlighterCore> {
  const [core, motor, tema] = await Promise.all([
    import("shiki/core"),
    import("shiki/engine/javascript"),
    import("shiki/themes/github-dark.mjs"),
  ]);
  return core.createHighlighterCore({
    themes: [tema.default],
    langs: [],
    // Regex en JS: ni WASM ni assets aparte, y funciona igual en Tauri y web.
    engine: motor.createJavaScriptRegexEngine(),
  });
}

/** Las líneas ya troceadas en tokens con color; `null` si no hay resaltado.
 *
 *  Es perezoso y opcional: la primera vez carga el core y solo la gramática
 *  del lenguaje pedido; si algo falla —o el archivo es enorme— el visor pinta
 *  texto plano en vez de romperse.
 */
export async function resaltar(
  codigo: string,
  lenguaje: string | null,
): Promise<ThemedToken[][] | null> {
  if (!lenguaje || codigo.length > LIMITE_RESALTADO) return null;
  const cargador = GRAMATICAS[lenguaje];
  if (!cargador) return null;
  try {
    resaltador ??= crear();
    const alto = await resaltador;
    if (!listos.has(lenguaje)) {
      const modulo = await cargador();
      await alto.loadLanguage(modulo.default);
      listos.add(lenguaje);
    }
    return alto.codeToTokensBase(codigo, { lang: lenguaje, theme: "github-dark" });
  } catch {
    return null;
  }
}
