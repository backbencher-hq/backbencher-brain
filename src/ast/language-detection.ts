export type DetectedLanguage =
  | "typescript" | "tsx" | "javascript" | "html" | "vue" | "svelte" | "css" | "scss" | "sass" | "json" | "yaml" | "graphql"
  | "c" | "cpp" | "rust" | "go" | "zig" | "nim"
  | "java" | "kotlin" | "scala" | "groovy"
  | "python" | "ruby" | "php" | "lua" | "perl" | "elixir" | "erlang"
  | "haskell" | "clean" | "clojure" | "swift" | "dart"
  // Julia is a DYNAMIC, MULTIPLE-DISPATCH language: dispatch is on argument types at every call
  // site, there is no inheritance, and one name may have many live methods with no override
  // relation between them. That is why the analyzer declines `overrides`/`implements` rather than
  // reusing the managed-OO ontology, and why `<:` is published as `extends` only.
  | "julia"
  | "csharp" | "vb" | "fsharp" | "r" | "sql"
  | "bash" | "powershell" | "hcl" | "terraform" | "objective-c"
  | "markdown" | "toml" | "xml" | "protobuf" | "make"
  // The Solidity lane routes `.sol` below (SOL-21). Its absence here meant the route
  // table could not satisfy its own value type, so `detectLanguageFromPath` returned a
  // language the union did not admit -- the file was detected and then unrepresentable.
  | "solidity"

export const EXTENSION_LANGUAGE: Readonly<Record<string, DetectedLanguage>> = {
  // `.mts` was missing from this table entirely, so 490 tracked files in this repository —
  // much of the m12/m14 gate suite among them — were rejected by `detectLanguageFromPath`
  // before a grammar could even be chosen, and the engine answered "Unsupported file type".
  // `.mts` is a TypeScript ES module: same language, explicit module system.
  //
  // Measured before declaring, by script/m12/measure-extension-coverage.ts over every
  // tracked `.mts` file in the tree:
  //
  //   490 files   490 parsed   8 error files   54 error nodes   0 threw
  //   18,586 symbols   54,485 relationships   2,115 imports
  //
  // 98.4% parse clean, and the 8 imperfect files are gate fixtures rather than library code.
  // The 18,586 symbols were invisible to the index — the difference between "bb indexes
  // TypeScript" and the truth of what this repository is written in.
  //
  // `.cts` is deliberately NOT declared: the measured corpus is ZERO files, so there is
  // nothing to support a claim about it (the same rule that kept `.jul` undeclared). Add it
  // with its numbers once a corpus exists.
  ts: "typescript", tsx: "tsx", mts: "typescript",
  // `.cts` was MISSING while every sibling was present — `ts`, `tsx`, `mts` and `js`, `cjs`, `mjs`, `jsx`.
  // It is TypeScript's CommonJS extension and the exact counterpart of `.mts`, which maps to `typescript`,
  // so this is an omission and not a decision. MEASURED: 3,118 `.cts` files in the corpus, and one lane
  // probed a stride that held 3 of them, which is how it read as a 3-file curiosity rather than a fleet gap.
  // Same defect class as `.graphqls` (97 files) — an extension the corpus carries that NOTHING routes, so the
  // file is read, answered with the fallback, and produces no symbols while APPEARING in the population.
  cts: "typescript", js: "javascript", cjs: "javascript", mjs: "javascript", jsx: "javascript",
  html: "html", htm: "html", vue: "vue", svelte: "svelte", css: "css",
  // scss is its own language, not a css dialect. It was mapped to "css" here while
  // the CSS grammar was the only wasm available, which is a decision made for lack of
  // an alternative and then left in place after the alternative existed — the shape of
  // claim that outlives the reason for it.
  //
  // `sass` was in exactly that state and worse: it mapped to "css" while being DECLARED
  // in SUPPORTED_LANGUAGES, so `sass` was a language no extension could ever select —
  // the registry advertised a lane the router could not enter, and the coverage gate
  // reported it as unreachable. It is routed to its own name now. The GRAMMAR is still
  // the css one (there is no tree-sitter-sass here), and that grammar cannot represent
  // indented syntax — the measured consequence is that a real .sass file parses with
  // ERROR nodes. Naming the lane honestly is what makes that visible per-language
  // instead of hiding it inside "css"; fixing the fidelity needs a sass grammar, which
  // is a separate piece of work and is recorded in script/m60/routing-outlier-census.ts.
  //
  // `less` still maps to "css" deliberately: LESS is a CSS superset and it is NOT in
  // SUPPORTED_LANGUAGES, so no unreachable language is declared by leaving it here.
  scss: "scss", sass: "sass", less: "css",
  json: "json", jsonc: "json",
  // `.jsonl` ADDED — JSON LINES, one JSON document per line, which the `json` grammar reads with NO representational
  // gap. Found by the fleet unrouted-extension census (script/m60/unrouted-extension-census.ts): 31 corpus files,
  // 4,676 symbols and 4,651 relationships through the winning grammar, and the extension was simply missing.
  // IT IS THE SAFEST ENTRY IN THAT CENSUS'S 154-ROW CANDIDATE SET, and chosen over the higher-priced `.jsonschema`
  // (7,255 relationships from THREE files — about 2,400 per file, above any routed language's density here) because
  // THIS ONE HAS NO REPRESENTATIONAL QUESTION TO ANSWER. The census measures that a grammar PRODUCES SYMBOLS, not
  // that it is the RIGHT grammar — `.pyx` sits in the same list at 1,540 files with a Python grammar that cannot
  // represent Cython, which is the failure mode `routing-outlier-census.ts` exists to catch.
  // `.jsonlog` ADDED — a JSON-per-line log, the same shape as `.jsonl` and read by the `json` grammar
  // with no representational gap. From the fleet census: 5 corpus files, 408 symbols, 403 relationships.
  // THE THIRD `.json`-family extension taken and the FIRST LEFT: `.jsonschema` (3 files, 7,255 relationships
  // — ~2,400 per file, ABOVE ANY ROUTED LANGUAGE'S DENSITY HERE) is NOT taken, because the census measures
  // that a grammar PRODUCES SYMBOLS and not that it is the RIGHT grammar, and that density is a claim
  // nobody has checked. `.jsonl` and `.jsonlog` answer a question; `.jsonschema` asks one.
  jsonl: "json", jsonlog: "json", yml: "yaml", yaml: "yaml",
  // `.graphqls` was missing while `graphql` and `gql` were present. It is the GraphQL SCHEMA extension —
  // the same format, spelled for schema files — so this is an omission and not a decision. MEASURED
  // THROUGH PRODUCTION DISCOVERY, not by walking the filesystem: the graphql lane's own instrument priced
  // 97 corpus `.graphqls` files as `filesTheIndexerDidNotAdmit`, and a Lead measurement of the ADMITTED
  // count returns 0 — so all 97 are read by nothing, answered with the fallback, and produce no symbols
  // while APPEARING in the population. Same defect class as `.cts`.
  graphql: "graphql", gql: "graphql", graphqls: "graphql",
  c: "c", h: "c", cpp: "cpp", cc: "cpp", cxx: "cpp", "c++": "cpp", hpp: "cpp", hxx: "cpp",
  // FOUR ADDED 2026-10-12, from the A-lane router census: .ipp (11 corpus files, inline C++ implementation),
  // .inl (3, the same convention spelled differently), .cu (3, CUDA — a C++ dialect the cpp grammar reads),
  // and .pod (11, Perl's own documentation format, beside the .pl/.pm/.t the perl lane already routes).
  // MEASURED TOGETHER: 28 corpus files routed to NOTHING. Same class as .cts, .graphqls, .sbt and .phpt.
  // AND THE CHECK THAT WOULD HAVE CAUGHT THEM IS COMMITTED: script/m60/unrouted-extension-gate.ts.
  ipp: "cpp", inl: "cpp", cu: "cpp", pod: "perl",
  rs: "rust", go: "go", zig: "zig",
  // `.jl` measured, not assumed: 941 tracked files in the Julia corpus, all of which the pinned
  // grammar parses (772 clean, 177 carrying tree-sitter ERROR nodes the patch inventory records).
  // `.jul` exists in the wild and is NOT claimed here — declaring a format the corpus cannot
  // support is the claim-without-coverage class the M60 rules forbid, so it stays undeclared until
  // a corpus measures it.
  jl: "julia",
  // M60 honesty rule applied on measurement, not on the grammar's file-types
  // list. The pinned grammar declares `nimble` and `nims` alongside `nim`, but
  // declaring a format is not evidence the analyzer models it, and routing on
  // the declaration alone is the claim-without-coverage class. So both were
  // MEASURED first, over every tracked file of all 12 pinned corpora:
  //
  //   .nims    65 files   0 error files   0 error nodes   43 symbols   279 relationships   96 imports
  //   .nimble 171 files   0 error files   0 error nodes   26 symbols   315 relationships   11 imports
  //
  // 100% parse health on both, and both carry real declarations rather than
  // being pure data: a .nims is a NimScript (set_cmd/switch/buildFile, all
  // procs), and a .nimble's `task`/`bin` blocks declare things. Routing them is
  // what the evidence supports; rulings NIMD4/NIMD5 in
  // script/m14/spec/nim-completeness.json.
  nim: "nim", nims: "nim", nimble: "nim",
  java: "java", kt: "kotlin", kts: "kotlin", scala: "scala", sc: "scala",
  // `.sbt` ADDED — the Scala Build Tool's own format, which IS Scala source (an sbt file is a Scala program
  // against the sbt DSL). MEASURED by the scala lane: 163 corpus files, routed to NOTHING. Same defect class
  // as `.cts` and `.graphqls` — the file is read, answered with the fallback, and produces no symbols while
  // APPEARING in the population. `.ktm` is deliberately NOT added: the lane measured 0 files for it.
  sbt: "scala", groovy: "groovy",
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
  rb: "ruby",
  // `.phpt` ADDED — the PHP test-file format, PHP source with an expected-output section. MEASURED by the php
  // lane: 1,314 corpus files, routed to NOTHING.
  // `.inc` IS DELIBERATELY NOT ADDED (61 files): `.inc` is genuinely ambiguous across languages — PHP include,
  // Pascal include, assembly include — and this table's own rule is that a format is declared on measurement,
  // not on the extension's existence. 61 files do not justify guessing which language they are.
  php: "php", phpt: "php", lua: "lua", pl: "perl", pm: "perl", t: "perl", perl: "perl",
  ex: "elixir", exs: "elixir", erl: "erlang", hrl: "erlang",
  hs: "haskell", lhs: "haskell", icl: "clean", dcl: "clean", clj: "clojure", cljs: "clojure", cljc: "clojure", edn: "clojure",
  swift: "swift", dart: "dart", cs: "csharp", csx: "csharp", vb: "vb", fs: "fsharp", fsi: "fsharp", fsx: "fsharp",
  r: "r", sql: "sql", sh: "bash", bash: "bash", zsh: "bash", ps1: "powershell", psm1: "powershell", psd1: "powershell",
  sol: "solidity",
  // Terraform is HCL, and `.tf` files ARE Terraform — the same relationship `sass`
  // had with `css` above, resolved the same way. `terraform` was declared in
  // SUPPORTED_LANGUAGES with an analyzer and a grammar arm while every `.tf`/`.tfvars`/
  // `.tofu` file routed to `hcl`, so the language was unreachable and the coverage gate
  // failed on it. The grammar is unchanged (tree-sitter-hcl parses Terraform, measured
  // clean: the gate's .tf fixture yields 8 symbols with no ERROR nodes); what changes is
  // that the lane is named after the thing the files are, so `--language terraform`
  // can find them. `.hcl` keeps its own name for the generic-HCL case.
  tf: "terraform", tfvars: "terraform", tofu: "terraform", hcl: "hcl", m: "objective-c", mm: "objective-c",
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
  // Extensionless files that are nonetheless a language bb can parse. Measured:
  // a project containing a `Rakefile` indexed ZERO files and ZERO symbols, with
  // no error and no warning — the file was silently skipped. The identical Ruby
  // content in `tasks.rb` IS detected, so this was a routing gap and not a
  // parsing failure.
  //
  // Each entry below was checked to have BOTH an analyzer and a grammar, so
  // routing to it cannot create a new class of "detected but unparseable".
  // Deliberately NOT added, because neither support exists:
  //   Dockerfile, Jenkinsfile  — no grammar and no analyzer
  //   Gemfile, CMakeLists.txt  — no grammar
  // Returning null for those is correct and honest; a user with a Dockerfile is
  // not told it is unsupported, which is a separate (and real) gap.
  "rakefile": "ruby",
  "gemfile": "ruby",
  "guardfile": "ruby",
  "capfile": "ruby",
  "vagrantfile": "ruby",
  "brewfile": "ruby",
  "podfile": "ruby",
  "berksfile": "ruby",
  "thorfile": "ruby",
  "buildfile": "ruby",
  "gemrc": "ruby",
  // Python tooling that ships without an extension, in the same class as Rakefile.
  "pipfile": "toml",
  "poetry.lock": "toml",
}

/**
 * Replace comments and string/char literals with spaces, preserving offsets and
 * newlines, so a marker search sees CODE rather than prose about code.
 *
 * Offsets are preserved deliberately: a later stage may care about line numbers,
 * and replacing with equal-length filler keeps that mapping exact. Newlines are
 * kept so a `/m` regex still means "per line".
 *
 * Not a C lexer — it is a marker scrubber. Unterminated block comments and
 * strings run to end of input, which is the conservative direction: text that
 * might be a comment is discarded, so a marker is never missed because a comment
 * was mis-parsed. Missing a real marker (false negative) leaves the file routed
 * as C, the safe default; inventing one (false positive) is the bug being fixed.
 */
function stripCommentsAndStrings(src: string): string {
  let out = ""
  let i = 0
  const n = src.length
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) out += src[k] === "\n" ? "\n" : " "
  }
  while (i < n) {
    const c = src[i]
    const next = src[i + 1]
    if (c === "/" && next === "/") {
      let j = i
      while (j < n && src[j] !== "\n") j++
      blank(i, j)
      i = j
      continue
    }
    if (c === "/" && next === "*") {
      let j = i + 2
      while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++
      const end = Math.min(n, j + 2)
      blank(i, end)
      i = end
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      let j = i + 1
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue }
        if (src[j] === quote) { j++; break }
        if (src[j] === "\n") break // unterminated: stop at EOL, do not swallow the file
        j++
      }
      blank(i, Math.min(j, n))
      i = Math.min(j, n)
      continue
    }
    out += c
    i++
  }
  return out
}

/**
 * Detect syntax from filename conventions. Content is used ONLY to disambiguate
 * ambiguous extensions — currently the `.h` header which is shared by C, C++,
 * and Objective-C. Deterministic marker-based sniffing (not ML):
 *   Objective-C if @interface/@protocol/@implementation/@property present,
 *   C++ if class/namespace/template/virtual/override or std::/C++ includes,
 *   else C. Everything else stays filename-only.
 */
/**
 * The interpreter a file's `#!` line names, or null.
 *
 * Read from the FIRST LINE only, and only for a file with no recognised
 * extension. Two properties make this safe rather than clever:
 *
 *  1. It is a NAME lookup, not a parse. `#!` followed by a known interpreter
 *     path is the POSIX definition of an interpreter line; nothing is inferred
 *     from the body.
 *  2. A recognised extension always wins, because the caller only consults this
 *     when the file has no extension at all. `foo.py` with a bash shebang is
 *     python.
 *
 * `node`, `python`, `ruby` and friends are deliberately ABSENT even though the
 * same argument would apply to them: this rule was added for a measured gap in
 * one lane (bash, 385 files), and a shebang table that grows languages nobody
 * measured is how a router starts disagreeing with the analyzers it feeds. The
 * bash lane's own census is the evidence for the bash entry; another lane's
 * evidence should add its own.
 *
 * `node` now has that evidence, and only `node`. Measured across every tracked
 * file in this repository, there are exactly three extensionless files carrying a
 * shebang: two `/bin/sh` (ide/zed/bb-lsp/bin/bb-lsp-server and
 * script/git-hooks/pre-push, both already routed) and `bin/bb`, the shipped CLI
 * launcher — `#!/usr/bin/env node`, 13 lines of real JavaScript with a top-level
 * await, and until now invisible to the index. `python` and `ruby` have a
 * measured corpus of ZERO files here, so they stay absent until a corpus exists,
 * exactly as `.cts` stayed out of EXTENSION_LANGUAGE.
 */
const SHEBANG_LANGUAGE: ReadonlyArray<readonly [string, DetectedLanguage]> = [
  ["/usr/bin/env node", "javascript"],
  ["/usr/bin/node", "javascript"],
  ["/usr/local/bin/node", "javascript"],
  ["/bin/node", "javascript"],
  ["/bin/bash", "bash"],
  ["/usr/bin/bash", "bash"],
  ["/usr/bin/env bash", "bash"],
  ["/bin/sh", "bash"],
  ["/usr/bin/sh", "bash"],
  ["/usr/bin/env sh", "bash"],
  ["/bin/zsh", "bash"],
  ["/usr/bin/zsh", "bash"],
  ["/usr/bin/env zsh", "bash"],
  ["/bin/dash", "bash"],
  ["/usr/bin/dash", "bash"],
  ["/bin/ksh", "bash"],
  ["/usr/bin/ksh", "bash"],
  ["/usr/bin/env ksh", "bash"],
]

function languageFromShebang(content: string): DetectedLanguage | null {
  // The first line only, and bounded: a `#!` line is short by definition, and
  // an unbounded read of a large binary would be a cost with no benefit.
  const nl = content.indexOf("\n")
  const first = (nl === -1 ? content : content.slice(0, nl)).trim()
  if (!first.startsWith("#!")) return null
  // POSIX permits OPTIONAL WHITESPACE between `#!` and the interpreter path, and
  // `#! /bin/sh` occurs in the wild. The old comparison built the candidate as
  // `#!${interpreter}`, so a single space made every lookup miss and the file was
  // silently un-routed — no error, no index entry, nothing. Normalise the gap
  // once here rather than encoding the tolerance into every comparison.
  const rest = first.slice(2).trimStart()
  for (const [interpreter, lang] of SHEBANG_LANGUAGE) {
    // `=== interpreter` alone, or the interpreter followed by an argument.
    if (rest === interpreter) return lang
    if (rest.startsWith(interpreter) && /[\s]/.test(rest.charAt(interpreter.length))) return lang
  }
  return null
}

export function detectLanguageFromPath(filePath: string, content?: string): DetectedLanguage | null {
  const normalized = filePath.replace(/\\/g, "/")
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1)
  const basenameMatch = BASENAME_LANGUAGE[basename.toLowerCase()]
  if (basenameMatch) return basenameMatch
  const dot = basename.lastIndexOf(".")
  if (dot < 0 || dot === basename.length - 1) {
    // M14 #277: an EXTENSIONLESS file is decided by its shebang. `nvm` and
    // `rbenv` put their entry points in files with no extension at all
    // (`nvm`, `libexec/rbenv`, `libexec/rbenv-init`), and a router that
    // returns null for them cannot see the single most-executed script in
    // either project. Measured over five bash corpora: 385 extensionless files
    // carry a shell shebang and 97.7% of them parse with ZERO error nodes —
    // a BETTER rate than the `.sh` files already being routed (89.1%). The
    // earlier census also measured the candidates this rule deliberately does
    // NOT take, and the reasons are the measurement: `.zsh` is 386 files at
    // 34.7% clean (the pinned grammar does not model zsh) and `.zsh-theme` is
    // 144 at 80.6% (below the rate of the files already routed, so admitting
    // them would lower average fidelity). `.sh` naming zsh content is a
    // SEPARATE finding and is not addressed here — see the lane's spec.
    //
    // The shebang is read only for files with no extension, so a recognised
    // extension always wins: `foo.py` carrying a bash shebang stays python.
    if (dot < 0 && content && content.length > 0) return languageFromShebang(content)
    return null
  }
  const ext = basename.slice(dot + 1).toLowerCase()
  const byExtension = EXTENSION_LANGUAGE[ext]
  if (ext === "h" && content && content.length > 0) {
    const head = content.length > 65536 ? content.slice(0, 65536) : content
    // COMMENTS ARE STRIPPED before sniffing. Several C++ markers are ordinary
    // English that appears in prose about C — `// public:`, `// template<class T>`,
    // `// std::vector`, `// namespace foo`, `// virtual void f()`, `// constexpr`.
    // Every one of those routed a PLAIN C header to the C++ grammar, measured on
    // trivial inputs, while the reverse direction (real C++ read as C) did not
    // happen. So this is a false-positive defect: the header was parsed with a
    // grammar for a different language, and reported as covered.
    //
    // Stripping string literals too, for the same reason — `"namespace foo"`
    // in a C string is not a C++ namespace declaration.
    const code = stripCommentsAndStrings(head)
    // Objective-C markers are unambiguous (@interface/@protocol/@implementation).
    if (/@(?:interface|protocol|implementation)\s+[A-Za-z_]/m.test(code)) return "objective-c"
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
      if (cppMarkers[i].test(code)) return "cpp"
    }
    return "c"
  }
  return byExtension ?? null
}

export function languageExtensionEntries(): ReadonlyArray<readonly [string, DetectedLanguage]> {
  return Object.entries(EXTENSION_LANGUAGE)
}
