// AST Engine — Core intelligence for ANY programming language
// Parses source files using Tree-sitter WASM grammars
// Extracts symbols, relationships, imports, exports, taint flows

// Types re-exported from types.ts
export * from "./types.js"

// Language detector — maps file extension → language
export function detectLanguage(filePath: string, _content?: string): string | null {
  const ext = filePath.split(".").pop()?.toLowerCase()

  const extensionMap: Record<string, string> = {
    ts: "typescript", tsx: "tsx",
    js: "javascript", cjs: "javascript", mjs: "javascript", jsx: "javascript",
    html: "html", htm: "html",
    vue: "vue", svelte: "svelte",
    css: "css", scss: "css", sass: "css",
    json: "json", yml: "yaml", yaml: "yaml",
    graphql: "graphql", gql: "graphql",
    c: "c", h: "c",
    cpp: "cpp", cc: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp",
    rs: "rust", go: "go", zig: "zig",
    java: "java", kt: "kotlin", kts: "kotlin",
    scala: "scala", sc: "scala",
    groovy: "groovy", gsp: "groovy",
    py: "python", pyw: "python",
    rb: "ruby", php: "php", lua: "lua",
    pl: "perl", pm: "perl", t: "perl",
    ex: "elixir", exs: "elixir",
    erl: "erlang", hrl: "erlang",
    hs: "haskell", lhs: "haskell",
    clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
    icl: "clean", dcl: "clean",
    swift: "swift", dart: "dart",
    cs: "csharp", csx: "csharp",
    fs: "fsharp", fsi: "fsharp", fsx: "fsharp",
    r: "r",
    sql: "sql",
    sh: "bash", bash: "bash", zsh: "bash",
    ps1: "powershell", psm1: "powershell", psd1: "powershell",
    tf: "hcl", tfvars: "hcl", tofu: "hcl", hcl: "hcl",
    m: "objective-c", mm: "objective-c",
  }

  if (ext && ext in extensionMap) return extensionMap[ext]!
  if (filePath.endsWith(".R")) return "r"
  if (filePath.endsWith("source")) return "html"
  return null
}

// Parser/WASM loading — will be fully implemented in M1.5
// Placeholder — returns null until WASM infrastructure is complete
export async function getParser(_language: string): Promise<unknown> {
  throw new Error("WASM parser loading not yet implemented — see M1.5")
}

// Parse a file — full pipeline (M2.3)
export async function parseFile(_filePath: string, _content: string): Promise<unknown> {
  throw new Error("parseFile not yet implemented — see M2.3")
}
