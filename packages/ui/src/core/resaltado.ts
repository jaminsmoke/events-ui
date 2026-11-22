import type { HighlighterCore, LanguageRegistration, ThemedToken } from "shiki/core";

/** Lenguaje de Shiki por extensión; `null` es texto plano.
 *
 *  Solo se mapean extensiones con gramática cargada abajo: el resto se pinta
 *  sin colores en vez de adivinar. Un archivo sin extensión conocido (Makefile,
 *  LICENSE…) cae aquí y se lee igual.
 */
const POR_EXTENSION: Record<string, string> = {
  // Documentos y datos
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  jsonl: "jsonl",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  properties: "properties",
  csv: "csv",
  tsv: "tsv",
  rst: "rst",
  adoc: "asciidoc",
  asciidoc: "asciidoc",
  tex: "latex",
  latex: "latex",
  typ: "typst",
  http: "http",
  mermaid: "mermaid",
  mmd: "mermaid",
  // Web
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  xml: "xml",
  svg: "xml",
  xsl: "xml",
  graphql: "graphql",
  gql: "graphql",
  // Lenguajes
  py: "python",
  pyw: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  rake: "ruby",
  lua: "lua",
  luau: "luau",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "fish",
  ps1: "powershell",
  psm1: "powershell",
  psd1: "powershell",
  bat: "bat",
  cmd: "bat",
  vim: "vim",
  dart: "dart",
  scala: "scala",
  sc: "scala",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  edn: "clojure",
  hs: "haskell",
  lhs: "haskell",
  ml: "ocaml",
  mli: "ocaml",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hrl: "erlang",
  r: "r",
  jl: "julia",
  pl: "perl",
  pm: "perl",
  groovy: "groovy",
  gradle: "groovy",
  nim: "nim",
  zig: "zig",
  cr: "crystal",
  gleam: "gleam",
  odin: "odin",
  sol: "solidity",
  cairo: "cairo",
  pas: "pascal",
  vb: "vb",
  elm: "elm",
  purs: "purescript",
  f: "fortran-free-form",
  f90: "fortran-free-form",
  f95: "fortran-free-form",
  f03: "fortran-free-form",
  f08: "fortran-free-form",
  asm: "asm",
  s: "asm",
  razor: "razor",
  cshtml: "razor",
  hbs: "handlebars",
  handlebars: "handlebars",
  twig: "twig",
  liquid: "liquid",
  jinja: "jinja",
  j2: "jinja",
  cypher: "cypher",
  hurl: "hurl",
  wasm: "wasm",
  wat: "wasm",
  // Infraestructura y cambios
  proto: "proto",
  prisma: "prisma",
  tf: "terraform",
  tfvars: "terraform",
  hcl: "hcl",
  nix: "nix",
  mk: "makefile",
  make: "makefile",
  cmake: "cmake",
  sql: "sql",
  plsql: "plsql",
  diff: "diff",
  patch: "diff",
  dockerfile: "dockerfile",
};

/** Nombres completos con gramática propia, sin depender de la extensión. */
const POR_NOMBRE: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  gnumakefile: "makefile",
  "cmakelists.txt": "cmake",
  justfile: "just",
  codeowners: "codeowners",
  "nginx.conf": "nginx",
  ".editorconfig": "ini",
  ".npmrc": "ini",
};

export function lenguajeDe(ruta: string): string | null {
  const nombre = (ruta.split("/").pop() ?? "").toLowerCase();
  const porNombre = POR_NOMBRE[nombre];
  if (porNombre) return porNombre;
  // `.env`, `.env.local`, `.env.production`… comparten gramática.
  if (nombre === ".env" || nombre.startsWith(".env.")) return "dotenv";
  const punto = nombre.lastIndexOf(".");
  if (punto <= 0) return null;
  return POR_EXTENSION[nombre.slice(punto + 1)] ?? null;
}

type Cargador = () => Promise<{ default: LanguageRegistration | LanguageRegistration[] }>;

/** Gramáticas que puede pedir `POR_EXTENSION`, cada una en su chunk. */
const GRAMATICAS: Record<string, Cargador> = {
  // Cada gramática es su propio chunk: no se descarga hasta abrir el archivo.
  markdown: () => import("shiki/langs/markdown.mjs"),
  mdx: () => import("shiki/langs/mdx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  json5: () => import("shiki/langs/json5.mjs"),
  jsonl: () => import("shiki/langs/jsonl.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  properties: () => import("shiki/langs/properties.mjs"),
  csv: () => import("shiki/langs/csv.mjs"),
  tsv: () => import("shiki/langs/tsv.mjs"),
  rst: () => import("shiki/langs/rst.mjs"),
  asciidoc: () => import("shiki/langs/asciidoc.mjs"),
  latex: () => import("shiki/langs/latex.mjs"),
  typst: () => import("shiki/langs/typst.mjs"),
  http: () => import("shiki/langs/http.mjs"),
  mermaid: () => import("shiki/langs/mermaid.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  vue: () => import("shiki/langs/vue.mjs"),
  svelte: () => import("shiki/langs/svelte.mjs"),
  astro: () => import("shiki/langs/astro.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  sass: () => import("shiki/langs/sass.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
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
  luau: () => import("shiki/langs/luau.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  fish: () => import("shiki/langs/fish.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  bat: () => import("shiki/langs/bat.mjs"),
  vim: () => import("shiki/langs/vim.mjs"),
  dart: () => import("shiki/langs/dart.mjs"),
  scala: () => import("shiki/langs/scala.mjs"),
  clojure: () => import("shiki/langs/clojure.mjs"),
  haskell: () => import("shiki/langs/haskell.mjs"),
  ocaml: () => import("shiki/langs/ocaml.mjs"),
  elixir: () => import("shiki/langs/elixir.mjs"),
  erlang: () => import("shiki/langs/erlang.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  julia: () => import("shiki/langs/julia.mjs"),
  perl: () => import("shiki/langs/perl.mjs"),
  groovy: () => import("shiki/langs/groovy.mjs"),
  nim: () => import("shiki/langs/nim.mjs"),
  zig: () => import("shiki/langs/zig.mjs"),
  crystal: () => import("shiki/langs/crystal.mjs"),
  gleam: () => import("shiki/langs/gleam.mjs"),
  odin: () => import("shiki/langs/odin.mjs"),
  solidity: () => import("shiki/langs/solidity.mjs"),
  cairo: () => import("shiki/langs/cairo.mjs"),
  pascal: () => import("shiki/langs/pascal.mjs"),
  vb: () => import("shiki/langs/vb.mjs"),
  elm: () => import("shiki/langs/elm.mjs"),
  purescript: () => import("shiki/langs/purescript.mjs"),
  "fortran-free-form": () => import("shiki/langs/fortran-free-form.mjs"),
  asm: () => import("shiki/langs/asm.mjs"),
  razor: () => import("shiki/langs/razor.mjs"),
  handlebars: () => import("shiki/langs/handlebars.mjs"),
  twig: () => import("shiki/langs/twig.mjs"),
  liquid: () => import("shiki/langs/liquid.mjs"),
  jinja: () => import("shiki/langs/jinja.mjs"),
  cypher: () => import("shiki/langs/cypher.mjs"),
  hurl: () => import("shiki/langs/hurl.mjs"),
  wasm: () => import("shiki/langs/wasm.mjs"),
  proto: () => import("shiki/langs/proto.mjs"),
  prisma: () => import("shiki/langs/prisma.mjs"),
  terraform: () => import("shiki/langs/terraform.mjs"),
  hcl: () => import("shiki/langs/hcl.mjs"),
  nix: () => import("shiki/langs/nix.mjs"),
  makefile: () => import("shiki/langs/makefile.mjs"),
  cmake: () => import("shiki/langs/cmake.mjs"),
  nginx: () => import("shiki/langs/nginx.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  plsql: () => import("shiki/langs/plsql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  dotenv: () => import("shiki/langs/dotenv.mjs"),
  codeowners: () => import("shiki/langs/codeowners.mjs"),
  just: () => import("shiki/langs/just.mjs"),
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
