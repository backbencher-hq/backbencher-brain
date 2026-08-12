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
 * Detect syntax from filename conventions. Content is used ONLY to disambiguate
 * ambiguous extensions — currently the `.h` header which is shared by C, C++,
 * and Objective-C. Deterministic marker-based sniffing (not ML):
 *   Objective-C if @interface/@protocol/@implementation/@property present,
 *   C++ if class/namespace/template/virtual/override or std::/C++ includes,
 *   else C. Everything else stays filename-only.
 */
export function detectLanguageFromPath(filePath: string, content?: string): DetectedLanguage | null {
  const normalized = filePath.replace(/\\/g, "/")
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1)
  const basenameMatch = BASENAME_LANGUAGE[basename.toLowerCase()]
  if (basenameMatch) return basenameMatch
  const dot = basename.lastIndexOf(".")
  if (dot < 0 || dot === basename.length - 1) return null
  const ext = basename.slice(dot + 1).toLowerCase()
  const byExtension = EXTENSION_LANGUAGE[ext]
  if (ext === "h" && content && content.length > 0) {
    const head = content.length > 65536 ? content.slice(0, 65536) : content
    // Objective-C markers are unambiguous (@interface/@protocol/@implementation).
    if (/@(?:interface|protocol|implementation)\s+[A-Za-z_]/m.test(head)) return "objective-c"
    // C++ markers: class declarations with access sections, templates,
    // namespaces, virtual/override, or C++ standard headers.
    const cppMarkers = [
      /\bnamespace\s+[A-Za-z_][\w:]*\s*\{/m,
      /\btemplate\s*</m,
      /\bclass\s+[A-Za-z_][\w:]*\s*(?::\s*[^\n{]*)?\s*\{/m,
      /\b(?:public|private|protected)\s*:/m,
      /\b(?:virtual|override|constexpr|explicit)\b/m,
      /\bstd::[A-Za-z_]/m,
      /#include\s*[<"](?:algorithm|array|bits\/|cassert|cctype|cerrno|cfloat|climits|cmath|cstddef|cstdint|cstdio|cstdlib|cstring|ctime|deque|exception|fstream|functional|iomanip|ios|iosfwd|iostream|istream|iterator|limits|list|locale|map|memory|mutex|new|numeric|ostream|queue|regex|set|sstream|stack|stdexcept|streambuf|string|typeinfo|unordered_map|unordered_set|utility|valarray|vector)[">]/m,
    ]
    for (let i = 0; i < cppMarkers.length; i++) {
      if (cppMarkers[i].test(head)) return "cpp"
    }
    return "c"
  }
  return byExtension ?? null
}

export function languageExtensionEntries(): ReadonlyArray<readonly [string, DetectedLanguage]> {
  return Object.entries(EXTENSION_LANGUAGE)
}
