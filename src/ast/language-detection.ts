export type DetectedLanguage =
  | "typescript" | "tsx" | "javascript" | "html" | "vue" | "svelte" | "css" | "json" | "yaml" | "graphql"
  | "c" | "cpp" | "rust" | "go" | "zig" | "nim"
  | "java" | "kotlin" | "scala" | "groovy"
  | "python" | "ruby" | "php" | "lua" | "perl" | "elixir" | "erlang"
  | "haskell" | "clean" | "clojure" | "swift" | "dart"
  | "csharp" | "vb" | "fsharp" | "r" | "sql"
  | "bash" | "powershell" | "hcl" | "objective-c"
  | "markdown" | "toml" | "xml" | "protobuf"

const EXTENSION_LANGUAGE: Readonly<Record<string, DetectedLanguage>> = {
  ts: "typescript", tsx: "tsx", js: "javascript", cjs: "javascript", mjs: "javascript", jsx: "javascript",
  html: "html", htm: "html", vue: "vue", svelte: "svelte", css: "css", scss: "css", sass: "css", less: "css",
  json: "json", jsonc: "json", yml: "yaml", yaml: "yaml", graphql: "graphql", gql: "graphql",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp", hxx: "cpp",
  rs: "rust", go: "go", zig: "zig", nim: "nim",
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala", groovy: "groovy", gsp: "groovy",
  py: "python", pyw: "python", pyi: "python", pyx: "python", pxd: "python",
  rb: "ruby", php: "php", lua: "lua", pl: "perl", pm: "perl", t: "perl", perl: "perl",
  ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang",
  hs: "haskell", lhs: "haskell", icl: "clean", dcl: "clean", clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
  swift: "swift", dart: "dart", cs: "csharp", csx: "csharp", vb: "vb", fs: "fsharp", fsi: "fsharp", fsx: "fsharp",
  r: "r", sql: "sql", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", psm1: "powershell", psd1: "powershell",
  tf: "hcl", tfvars: "hcl", tofu: "hcl", hcl: "hcl", m: "objective-c", mm: "objective-c",
  md: "markdown", markdown: "markdown", toml: "toml", xml: "xml", proto: "protobuf",
}

const BASENAME_LANGUAGE: Readonly<Record<string, DetectedLanguage>> = {
  "bashrc": "bash",
  ".bashrc": "bash",
  ".zshrc": "bash",
}

/**
 * Detect syntax from filename conventions only. Content is reserved for a
 * future independently-validated shebang/modeline detector; it is not used to
 * guess ambiguous grammars today.
 */
export function detectLanguageFromPath(filePath: string, _content?: string): DetectedLanguage | null {
  const normalized = filePath.replace(/\\/g, "/")
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1)
  const basenameMatch = BASENAME_LANGUAGE[basename.toLowerCase()]
  if (basenameMatch) return basenameMatch
  const dot = basename.lastIndexOf(".")
  if (dot < 0 || dot === basename.length - 1) return null
  return EXTENSION_LANGUAGE[basename.slice(dot + 1).toLowerCase()] ?? null
}

export function languageExtensionEntries(): ReadonlyArray<readonly [string, DetectedLanguage]> {
  return Object.entries(EXTENSION_LANGUAGE)
}
