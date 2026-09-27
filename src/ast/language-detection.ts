export type DetectedLanguage =
  | "typescript" | "tsx" | "javascript" | "html" | "vue" | "svelte" | "css" | "json" | "yaml" | "graphql"
  | "c" | "cpp" | "rust" | "go" | "zig" | "nim"
  | "java" | "kotlin" | "scala" | "groovy"
  | "python" | "ruby" | "php" | "lua" | "perl" | "elixir" | "erlang"
  | "haskell" | "clean" | "clojure" | "swift" | "dart"
  | "csharp" | "vb" | "fsharp" | "r" | "sql"
  | "bash" | "powershell" | "hcl" | "objective-c"
  | "markdown" | "toml" | "xml" | "protobuf" | "make"

export const EXTENSION_LANGUAGE: Readonly<Record<string, DetectedLanguage>> = {
  ts: "typescript", tsx: "tsx", js: "javascript", cjs: "javascript", mjs: "javascript", jsx: "javascript",
  html: "html", htm: "html", vue: "vue", svelte: "svelte", css: "css", scss: "css", sass: "css", less: "css",
  json: "json", jsonc: "json", yml: "yaml", yaml: "yaml", graphql: "graphql", gql: "graphql",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp", hxx: "cpp",
  rs: "rust", go: "go", zig: "zig", nim: "nim",
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala", groovy: "groovy",
  // M49 W21 (#850): Gradle's Groovy DSL. `.gradle` had NO registry entry, so every
  // `build.gradle`/`settings.gradle` was rejected by detectLanguage before a grammar
  // was chosen — the largest real-world Groovy surface (454 files in grails-core alone)
  // was invisible to bb_analyze. The Kotlin DSL was already covered via `kts`.
  gradle: "groovy",
  // M60 (#913 ruling, 2026-09-24): `.gsp` used to sit here, mapped to groovy the same
  // way `.gradle` is — and it is not Groovy either. A Grails Server Page is an HTML
  // document carrying `${}`/`<g:...>` tags and `<%--%>` comments; the Groovy grammar
  // has no productions for it, and 39 of 39 sampled grails-core files parse with ERROR
  // nodes. The class-wide ruling is "stop claiming": an extension whose format no
  // pinned grammar can represent is NOT routed, rather than routed to a grammar that
  // cannot represent it and then reported as covered. The census that owns the class
  // (its evidence, its refusals and the sibling instances) is
  // script/m60/routing-outlier-census.ts → validation/m60/results/routing-outliers.json.
  py: "python", pyw: "python", pyi: "python",
  // `.pyx`/`.pxd` (Cython) sat here until the same ruling. Cython is a different
  // language — `cdef`/`cpdef`/`cimport`, buffer syntax, and the whole `.pxd`
  // declaration grammar — and the Python grammar has no productions for it: measured
  // `.pyx` 231/270 (85.6 %) and `.pxd` 42/44 (95.5 %) carrying ERROR nodes against
  // `.py` 2/86 (2.3 %). The lane still reported 100 % coverage and MISSING=0 there,
  // because F5 compares the analyzer against an oracle that walks the SAME partial
  // tree and recovery keeps symbols flowing through the ERROR regions — which is what
  // made a 68.8 %-unparseable corpus read as a pass. Nothing now claims to have
  // analyzed them; if a Cython grammar is ever vendored, this is the line it changes.
  rb: "ruby", php: "php", lua: "lua", pl: "perl", pm: "perl", t: "perl", perl: "perl",
  ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang",
  hs: "haskell", lhs: "haskell", icl: "clean", dcl: "clean", clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
  swift: "swift", dart: "dart", cs: "csharp", csx: "csharp", vb: "vb", fs: "fsharp", fsi: "fsharp", fsx: "fsharp",
  r: "r", sql: "sql", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", psm1: "powershell", psd1: "powershell",
  tf: "hcl", tfvars: "hcl", tofu: "hcl", hcl: "hcl", m: "objective-c", mm: "objective-c",
  md: "markdown", markdown: "markdown", toml: "toml", proto: "protobuf",
  // M60 XML lane: `xml` was routed for `.xml`/`.xsd`/`.dtd` only, while the wired
  // grammar's OWN `tree-sitter.json` declares `file-types: [xml, svg, xsd, xslt,
  // xsl, rng]`. Three of the grammar's six declared types were unreachable, and
  // the corpus cost is measured, not asserted: 617 `.xsl`, 31 `.xslt`, 155 `.svg`
  // and 110 `.rng` files across the lane's 6 pinned repos — 913 XML documents
  // that bb never opened. Routing is taken from the grammar's own declaration
  // rather than from taste.
  //
  // DELIBERATELY NOT ROUTED, under the M60 #913 ruling ("an extension whose
  // format no pinned grammar can represent is NOT routed"): `.wsdl` (805 files),
  // `.pom` (693), `.xhtml` (36) and `.plist` are XML-shaped, but the grammar
  // does not declare them, so routing them would be a claim the grammar does not
  // back. They stay invisible and are recorded as owed in
  // `reviews/xml/master-review.md` §F — visible debt rather than a silent gap.
  xml: "xml", xsd: "xml", dtd: "xml", svg: "xml", xsl: "xml", xslt: "xml", rng: "xml",
  mk: "make", mak: "make", makefile: "make",
}

const BASENAME_LANGUAGE: Readonly<Record<string, DetectedLanguage>> = {
  "bashrc": "bash",
  ".bashrc": "bash",
  ".zshrc": "bash",
  "makefile": "make",
  "gnumakefile": "make",
  ".makefile": "make",
  ".gnumakefile": "make",
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
