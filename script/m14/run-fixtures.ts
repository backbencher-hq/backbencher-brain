/**
 * M14.0.F3 — Adversarial Fixture Runner
 *
 * Runs validation/m14/fixtures/<lang>/*.{src} through the REAL analyzer
 * (same lazy imports as engine.ts, same wasm grammars) and compares output
 * against expectation files authored BEFORE observing analyzer behavior.
 *
 * Expectation matching semantics:
 *   expectSymbols / expectRelationships : each entry must match >=1 actual item.
 *       An entry matches when EVERY specified constraint field matches
 *       (unspecified fields are wildcards). Extra actual items are fine.
 *   forbidSymbols / forbidRelationships / forbidDecorators : NO actual item may match the entry.
 *       forbidDecorators takes { symbol?, contains } — the negative half of the decorator
 *       payload, added by the C2a alias-qualifier round because a `contains` assertion on a
 *       decorator cannot fail when the wrong spelling CONTAINS the right one.
 *   Relationship constraints: type, from, target, confidenceMin, confidenceMax,
 *       meta.<key> (e.g. "meta.relationshipType": "implements").
 *   Symbol constraints: name, kind.
 *
 * CLI: bun run script/m14/run-fixtures.ts [--lang java,groovy]
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = process.env.BB_M14_ROOT ? path.resolve(process.env.BB_M14_ROOT) : path.resolve((import.meta as any).dirname ?? path.dirname(Bun?.main ?? process.argv[1] ?? "."), "..", "..")
const FIXTURES_DIR = path.join(ROOT, "validation", "m14", "fixtures")

const LANGS: Record<string, { wasm: string; analyzerFile: string; className: string; ext: string }> = {
  // M60 VB wave. `ext` is `vb`, which is what language-detection.ts routes, and
  // `wasm` is the GRAMMAR's name rather than the language's -- the lane reads
  // tree-sitter-vbnet, and the pin's `wired` field names the same file, so a swap
  // of the wasm here is a swap the pin catches.
  vb: { wasm: "tree-sitter-vbnet.wasm", analyzerFile: "real-vb-analyzer", className: "RealVbAnalyzer", ext: "vb" },
  clojure: { wasm: "tree-sitter-clojure.wasm", analyzerFile: "real-clojure-analyzer", className: "RealClojureAnalyzer", ext: "clj,cljc,cljs" },
  javascript: { wasm: "tree-sitter-javascript.wasm", analyzerFile: "real-javascript-analyzer", className: "RealJavaScriptAnalyzer", ext: "js" },
  vue: { wasm: "tree-sitter-vue.wasm", analyzerFile: "real-vue-analyzer", className: "RealVueAnalyzer", ext: "vue" },
  svelte: { wasm: "tree-sitter-svelte.wasm", analyzerFile: "real-svelte-analyzer", className: "RealSvelteAnalyzer", ext: "svelte" },
    typescript: { wasm: "tree-sitter-typescript.wasm", analyzerFile: "real-typescript-analyzer", className: "RealTypeScriptAnalyzer", ext: "ts" },
    java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java" },
  groovy: { wasm: "tree-sitter-groovy.wasm", analyzerFile: "real-groovy-analyzer", className: "RealGroovyAnalyzer", ext: "groovy" },
  kotlin: { wasm: "tree-sitter-kotlin.wasm", analyzerFile: "real-kotlin-analyzer", className: "RealKotlinAnalyzer", ext: "kt" },
  scala: { wasm: "tree-sitter-scala.wasm", analyzerFile: "real-scala-analyzer", className: "RealScalaAnalyzer", ext: "scala" },
  c: { wasm: "tree-sitter-c.wasm", analyzerFile: "real-c-analyzer", className: "RealCAnalyzer", ext: "c" },
  cpp: { wasm: "tree-sitter-cpp.wasm", analyzerFile: "real-cpp-analyzer", className: "RealCppAnalyzer", ext: "cpp" },
  rust: { wasm: "tree-sitter-rust.wasm", analyzerFile: "real-rust-analyzer", className: "RealRustAnalyzer", ext: "rs" },
  python: { wasm: "tree-sitter-python.wasm", analyzerFile: "real-python-analyzer", className: "RealPythonAnalyzer", ext: "py" },
  go: { wasm: "tree-sitter-go.wasm", analyzerFile: "real-go-analyzer", className: "RealGoAnalyzer", ext: "go" },
  zig: { wasm: "tree-sitter-zig.wasm", analyzerFile: "real-zig-analyzer", className: "RealZigAnalyzer", ext: "zig" },
  csharp: { wasm: "tree-sitter-c_sharp.wasm", analyzerFile: "real-csharp-analyzer", className: "RealCSharpAnalyzer", ext: "cs" },
  dart: { wasm: "tree-sitter-dart.wasm", analyzerFile: "real-dart-analyzer", className: "RealDartAnalyzer", ext: "dart" },
  swift: { wasm: "tree-sitter-swift.wasm", analyzerFile: "real-swift-analyzer", className: "RealSwiftAnalyzer", ext: "swift" },
  objc: { wasm: "tree-sitter-objc.wasm", analyzerFile: "real-objective-c-analyzer", className: "RealObjectiveCAnalyzer", ext: "m" },
  // M60 julia wave. A lane that cannot fail is decoration: the language was named in
  // language-detection.ts and dispatched in engine.ts — so the website advertised it —
  // while being absent from this map, which is the gate that would have caught the four
  // defects registration exposed (a drifting scope that reassigned ownership of every
  // later sibling, `f(x)::T = …` being invisible, 2,502 false self-calls, and every type
  // referencing itself). `ext` is `jl` only: `.jul` exists in the wild and is deliberately
  // undeclared, since no corpus measures it and declaring it would be a claim without
  // coverage.
  julia: { wasm: "tree-sitter-julia.wasm", analyzerFile: "real-julia-analyzer", className: "RealJuliaAnalyzer", ext: "jl" },
  php: { wasm: "tree-sitter-php.wasm", analyzerFile: "real-php-analyzer", className: "RealPhpAnalyzer", ext: "php" },
  ruby: { wasm: "tree-sitter-ruby.wasm", analyzerFile: "real-ruby-analyzer", className: "RealRubyAnalyzer", ext: "rb" },
  // M14.6 perl wave: the lane had no fixture directory at all, so none of its
  // defects were pinned. `ext` carries the whole production surface: the
  // fixtures are .pm because the language is, and `t` is in the universe because
  // perl5's own test suite is 2,000+ of the corpus files a differential draws.
  perl: { wasm: "tree-sitter-perl.wasm", analyzerFile: "real-perl-analyzer", className: "RealPerlAnalyzer", ext: "pm,pl,t" },
  haskell: { wasm: "tree-sitter-haskell.wasm", analyzerFile: "real-haskell-analyzer", className: "RealHaskellAnalyzer", ext: "hs" },
  elixir: { wasm: "tree-sitter-elixir.wasm", analyzerFile: "real-elixir-analyzer", className: "RealElixirAnalyzer", ext: "ex" },
  // M14.7-DataConfigDocs.yaml (#286): yaml joins the fixture lane with 24 fixtures, each
  // authored from re-probed emission (script/m14/tmp/yaml-fixture-dump.ts ->
  // validation/m14/results/yaml-fixture-emission.json) and each paired with a NEGATIVE
  // twin where a channel could over-fire. Six of the twelve grammar node types the lane
  // did not name are reachable only from a fixture, not from any corpus: a 400-file draw
  // over eight pinned repositories contains 19 `tag` nodes (all `!vault`/`!unsafe` cipher
  // markers), ZERO directives, and 2 anchors (script/m14/results/yaml-f8-corpus-census.json).
  // Without this lane the tags, directives, anchors and merge-key contracts would have had
  // no evidence at all.
  yaml: { wasm: "tree-sitter-yaml.wasm", analyzerFile: "real-yaml-analyzer", className: "RealYamlAnalyzer", ext: "yaml,yml" },
  // M59 (#825): xml had NO fixture lane at all, while being one of only two
  // analyzers that emitted a line before the round (27 of 27 relationships on
  // the M59 coverage probe). Nothing pinned its line contract, so nothing could
  // have caught a regression in it — added with the xml/lines-825 fixture.
  xml: { wasm: "tree-sitter-xml.wasm", analyzerFile: "real-xml-analyzer", className: "RealXmlAnalyzer", ext: "xml" },
  // M14 #275/#880: erlang joins the fixture lane. The export invariant below is
  // arity-aware for exactly this reason: `-export([pick/0, pick/1]).` is a legal
  // export list (arity is function identity in Erlang), and the name-only
  // duplicate check would have rejected correct output.
  erlang: { wasm: "tree-sitter-erlang.wasm", analyzerFile: "real-erlang-analyzer", className: "RealErlangAnalyzer", ext: "erl" },
  // M60 (#884): clean had a fixture on disk and NO runner entry, so
  // `validation/m14/fixtures/clean/import-modules-alias-884` was committed against
  // an OPEN defect and executed by nothing: the lane's matrix cell read "no
  // adversarial fixture lane" while the pin sat in the tree. The wasm
  // (tree-sitter-clean.wasm), the analyzer class and the `.icl` // `.dcl` routing
  // (src/ast/language-detection.ts) all already existed — only this map was short,
  // which is why an inert fixture is worse than a missing one: it looks like
  // evidence. A fixture lane is not a directory, it is a directory this map names.
  clean: { wasm: "tree-sitter-clean.wasm", analyzerFile: "real-clean-analyzer", className: "RealCleanAnalyzer", ext: "icl,dcl" },
  // M60 XML lane, 2026-09-27: FOUR lanes had fixture DIRECTORIES with authored
  // expectations and no entry in this map, so `getParser(lang)` read
  // `LANGS[lang].wasm` off `undefined` and the mutation harness CRASHED before
  // it verified a single mutant — for every lane, not just these four. A gate
  // that cannot run is not a green gate, and the cost was invisible because the
  // crash looked like an unrelated TypeError rather than a missing entry.
  //
  // A fixture lane is not a directory, it is a directory THIS MAP NAMES; the
  // clean round recorded that for `clean` and the same shape recurred four times
  // over. Each entry below is mechanical (wasm, analyzer module, class, and the
  // extension the fixtures actually use — measured from the directories, not
  // assumed), and each is verified by running the lane.
  sql: { wasm: "tree-sitter-sql.wasm", analyzerFile: "real-sql-analyzer", className: "RealSqlAnalyzer", ext: "sql" },
  hcl: { wasm: "tree-sitter-hcl.wasm", analyzerFile: "real-hcl-analyzer", className: "RealHclAnalyzer", ext: "tf,tfvars,tofu,hcl" },
  // M60 Make wave (2026-09-27). The analyzer was wired into engine.ts and named
  // in SUPPORTED_LANGUAGES — so the website advertised it — while being absent
  // from every gate that could fail. A lane that cannot fail is decoration, and
  // that is the exact state this registration ends: 5 fixtures, 71 asserted
  // relationships and 28 forbidden wrong answers, none of which the runner read
  // before now.
  make: { wasm: "tree-sitter-make.wasm", analyzerFile: "real-makefile-analyzer", className: "RealMakefileAnalyzer", ext: "mk" },
  // M60 fsharp wave (2026-09-28). The lane had NO fixture directory, so F3 read
  // `fixtures: n/a` in the completion matrix and nothing measured what the analyzer
  // called things — which is how 60 symbols named with an entire function signature
  // and 368 `contains X -> X` self-edges survived. `ext` carries the WHOLE production
  // surface language-detection.ts routes (fs, fsi, fsx) because the lane's grammar
  // parses signature files as IMPLEMENTATION files — `engine.ts` resolves exactly one
  // wasm, `tree-sitter-fsharp.wasm`, for all three extensions, and the separate
  // `tree-sitter-fsharp_signature.wasm` is NOT wired. A fixture lane that swept only
  // `.fs` would have been measuring a surface the product never sees.
  fsharp: { wasm: "tree-sitter-fsharp.wasm", analyzerFile: "real-fsharp-analyzer", className: "RealFsharpAnalyzer", ext: "fs,fsi,fsx" },
  // NIM wave (2026-09-27). `ext` carries .nim and .nims but NOT .nimble: the
  // router does not send .nimble here (decision NIMD4 in
  // script/m14/spec/nim-completeness.json), and a lane that swept a file the
  // indexer would never route is the inert-pin class — it would report coverage
  // the production path does not have.
  nim: { wasm: "tree-sitter-nim.wasm", analyzerFile: "real-nim-analyzer", className: "RealNimAnalyzer", ext: "nim,nims,nimble" },
  java: { wasm: "tree-sitter-java.wasm", analyzerFile: "real-java-analyzer", className: "RealJavaAnalyzer", ext: "java" },
  typescript: { wasm: "tree-sitter-typescript.wasm", analyzerFile: "real-typescript-analyzer", className: "RealTypeScriptAnalyzer", ext: "ts" },
  // GraphQL joined 2026-09-27 with the M12.38/#177 wave. The lane did not exist,
  // which is why 31 measured defects survived in an analyzer whose only pinned
  // surface was 97 hand-audited facts over three m12 fixtures — including 3,131
  // of 3,332 symbols on the GitHub public schema pointing at a DOCSTRING line,
  // and every `extend type …` member dropped. `ext` carries all three of the
  // extensions language-detection.ts routes to `graphql`, because the fixtures
  // deliberately use `.graphqls` and `.gql` so a regression that keys on one
  // extension cannot pass.
  graphql: { wasm: "tree-sitter-graphql.wasm", analyzerFile: "real-graphql-analyzer", className: "RealGraphqlAnalyzer", ext: "graphql,graphqls,gql" },
  // --- from the m60 grammar-governance merge: two lanes the other laptop's wave had
  // not registered. A fixture lane is not a directory, it is a directory this map
  // NAMES — and `payload-matrix.ts` enumerates the payload languages from
  // `validation/m14/fixtures/*`, so an unregistered lane has no P1 row to convict it.
  // M14 (#288 / M60.LCM): html joins the fixture lane. html was the LAST
  // ungated web-family language: its analyzer had an M12 corpus claim, a regex
  // census row and a grammar-audit pass, and no fixture, no mutant, no
  // differential oracle and no completeness spec. Every M14/M49/M60 cell read
  // `n/a` — the gates could not ask the question, which is how 59.9% of its
  // symbols were measured carrying a name that is not unique in their own file
  // while every gate stayed green. The lane is what makes the rest possible:
  // F4's runner throws `unknown language html` without it, and
  // `script/m60/payload-matrix.ts` enumerates the payload languages from
  // `validation/m14/fixtures/*`, so html had no P1 row to convict it either.
  // `ext` carries BOTH html spellings because `language-detection.ts` routes
  // `.htm` to the same analyzer and a lane that only claimed `.html` would
  // silently skip half its own routing.
  // M14 #277: bash joins the fixture lane. The lane had FOUR artifacts and no
  // runner entry, so nothing could have caught a regression in any of them —
  // and the four are a differential whose truth was authored by the same hand
  // as the analyzer (55 facts, all `authority: manual_audit`, 12 of which
  // pinned the pre-wave `global` phantom endpoint and 2 of which pinned a trap
  // edge whose SOURCE was a signal name and whose TARGET was a whole command
  // string), a corpus measurement, a grammar-limit census, and a node-type
  // "safety" check whose referenced-type list was hardcoded rather than
  // measured (retired to `script/m12/bash-node-types-legacy-inventory.ts`,
  // reasoning preserved, and replaced by a derived gate). A fixture lane is
  // not a directory, it is a directory this map names.
  html: { wasm: "tree-sitter-html.wasm", analyzerFile: "real-html-analyzer", className: "RealHtmlAnalyzer", ext: "html,htm" },
  toml: { wasm: "tree-sitter-toml.wasm", analyzerFile: "real-toml-analyzer", className: "RealTomlAnalyzer", ext: "toml" },
  css: { wasm: "tree-sitter-css.wasm", analyzerFile: "real-css-analyzer", className: "RealCssAnalyzer", ext: "css" },
  markdown: { wasm: "tree-sitter-markdown.wasm", analyzerFile: "real-markdown-analyzer", className: "RealMarkdownAnalyzer", ext: "md,markdown" },
  scss: { wasm: "tree-sitter-scss.wasm", analyzerFile: "real-scss-analyzer", className: "RealScssAnalyzer", ext: "scss" },
  bash: { wasm: "tree-sitter-bash.wasm", analyzerFile: "real-bash-analyzer", className: "RealBashAnalyzer", ext: "sh,bash" },
  json: { wasm: "tree-sitter-json.wasm", analyzerFile: "real-json-analyzer", className: "RealJsonAnalyzer", ext: "json,jsonc,json5" },
  powershell: { wasm: "tree-sitter-powershell.wasm", analyzerFile: "real-powershell-analyzer", className: "RealPowershellAnalyzer", ext: "ps1,psm1,psd1" },
  // M60 Solidity lane. The wasm name is the GRAMMAR's, and it is the name the pin's
  // `wired` field records, so a swap here is a swap the pin gate catches. The pin
  // is byte-identical to the npm tarball tree-sitter-solidity@1.2.13 with zero local
  // patches (script/m14/verify-grammar-pins.ts, LANES.solidity), which is the only
  // provenance kind structurally immune to the failure the PowerShell lane hit.
  solidity: { wasm: "tree-sitter-solidity.wasm", analyzerFile: "real-solidity-analyzer", className: "RealSolidityAnalyzer", ext: "sol" },
}

interface Entry { [k: string]: any }

// M59 (#825): `line_number: null` is a supported constraint (see below) — the
// unknown state, asserted rather than assumed. `undefined`/`null` both satisfy it;
// a number (including the old fabricated 0) does not.
/**
 * Keys a `parameters` pin may NOT assert, each for a named reason:
 *   `note`    — documentation; dart's DARTD13 rows carry one.
 *   `isNamed` — dart carries it on the SYMBOL's metadata, not on a parameter,
 *               so asserting it here would be a false alarm in another lane.
 * Everything else a pin names IS asserted (go #914): `isVariadic` decides a Go
 * method signature, and a payload field no pin can reach is exactly where a
 * regression hides.
 */
const PARAM_PIN_EXEMPT = new Set(["note", "isNamed"])

/**
 * M60 fsharp wave (2026-09-28) — a SILENTLY DEAD FORBID is now a loud failure.
 *
 * `matchConstraints` skips the documentation keys it knows (`comment`, `note`) and
 * treats every OTHER key in an expectation row as a required constraint on the actual
 * object. So a `forbid` row carrying a documentation key the runner does not know —
 * `_why`, written by this lane's own first draft — can never match anything, and the
 * row is dead: it asserts nothing, passes on every run, and looks like coverage in the
 * fixture file. Five of the lane's seven mutants survived for exactly this reason, and
 * the honest reading is that the FORBID half of three new fixtures was inert.
 *
 * A key the runner does not recognise in a CONSTRAINT row is therefore reported, not
 * swallowed. This can only turn a silent pass into a loud one: every constraint key
 * already used by the 33 registered lanes is in the allowlist below, so no existing
 * lane changes verdict. The check is a report, not an exception, so one bad row cannot
 * take a whole lane's run down — it is visible in the fixture's problem list instead.
 */
const CONSTRAINT_KEY_ALLOWLIST = new Set([
  // symbol rows
  "name", "kind", "ownerName", "scope", "owner", "ownerKind", "range", "startLine", "endLine",
  "startColumn", "endColumn", "genericParameters", "parameters", "returnType", "type",
  "visibility", "isAsync", "isAbstract", "isExported", "isDeclaration", "isRecordField",
  "docstring", "decorators", "complexity", "linesOfCode", "id", "line",
  // relationship rows
  "from", "to", "source", "target", "fromSymbol", "toSymbol", "relationshipType",
  "line_number", "confidence", "contains", "symbol", "isImport", "isContained",
  // modifiers
  "confidenceMin", "confidenceMax",
])
/** Keys that are documentation by contract, on any row. */
const CONSTRAINT_DOC_KEYS = new Set(["comment", "note"])

function unknownConstraintKeys(rows: any[] | undefined): string[] {
  const bad = new Set<string>()
  for (const row of rows ?? []) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue
    for (const k of Object.keys(row)) {
      if (CONSTRAINT_DOC_KEYS.has(k)) continue
      if (k.startsWith("meta.")) continue
      if (k.endsWith("EndsWith")) continue
      if (!CONSTRAINT_KEY_ALLOWLIST.has(k)) bad.add(k)
    }
  }
  return [...bad].sort()
}

function matchConstraints(actual: Entry, want: Entry): boolean {
  for (const [k, v] of Object.entries(want)) {
    // Documentation fields on expectation entries are NOT match constraints.
    if (k === "comment") continue
    if (k === "note") continue
    // M59 (#825) — the UNKNOWN state as a first-class assertion. `line_number:
    // null` means "this edge must NOT name a line": the field is absent (the
    // analyzers' contract) or explicitly null (the store's contract). It is what
    // lets a fixture pin the RIGHT answer for an edge whose target is written
    // NOWHERE in the source (kotlin's data-class phantoms, java's lombok /
    // Spring-Data phantoms). The only honest value there is no value, and before
    // this the runner had no way to say so — the pre-fix state (an enclosing
    // declaration's line) was indistinguishable from the fixed one.
    if (k === "line_number" && v === null) {
      if (actual.line_number !== undefined && actual.line_number !== null) return false
      continue
    }
    if (k === "confidenceMin") {
      if (!(typeof actual.confidence === "number" && actual.confidence >= v)) return false
    } else if (k === "confidenceMax") {
      if (!(typeof actual.confidence === "number" && actual.confidence <= v)) return false
    } else if (k.endsWith("EndsWith")) {
      const field = k.slice(0, -"EndsWith".length)
      const aliases: Record<string, string[]> = { target: ["target", "to", "toSymbol"], from: ["from", "source", "fromSymbol"] }
      const vals = (aliases[field] ?? [field]).map(a => actual[a]).filter(x => typeof x === "string")
      if (!vals.some(x => x.endsWith(v))) return false
    } else if (k.startsWith("meta.")) {
      const mk = k.slice(5)
      const mv = (actual.metadata ?? {})[mk]
      // M49 (#868): metadata LIST mirrors (a symbol's `decoratorLines`, parallel
      // to `decorators`) were unpinnable — the strict `!==` can never be true for
      // an array, so a fixture could not state the list it wanted. Arrays now
      // compare by sorted JSON, exactly as the imports matcher above does, so a
      // list mirror is pinned as a set rather than being silently unassertable.
      if (Array.isArray(v)) {
        if (!Array.isArray(mv)) return false
        if (JSON.stringify([...mv].sort()) !== JSON.stringify([...v].sort())) return false
      } else if (v === null) {
        // M59 fixed this hole for `line_number`; it is the SAME hole one level
        // down. Several analyzers emit a metadata label on TRUE only and omit it
        // otherwise (`isShellDefined`, `isAssignedInFile`), so the ABSENT case is
        // the one a consumer actually hits most — and a strict `!==` can never be
        // true for it, so a fixture could not state it. `meta.x: null` now means
        // "this edge must NOT carry x", reusing the `line_number: null` convention
        // rather than inventing a second spelling. Additive: every other value
        // compares exactly as before.
        if (mv !== undefined && mv !== null) return false
      } else if (mv !== v) return false
    } else if (actual[k] !== v) {
      // relationship field aliases
      const aliases: Record<string, string[]> = {
        from: ["from", "source", "fromSymbol"],
        target: ["target", "to", "toSymbol"],
        type: ["type", "relationshipType"],
      }
      const alt = aliases[k]
      if (alt && alt.some(a => actual[a] === v)) continue
      return false
    }
  }
  return true
}

function normRel(r: Entry): Entry {
  return {
    ...r,
    from: r.from ?? r.source ?? r.fromSymbol,
    target: r.target ?? r.to ?? r.toSymbol,
    type: r.type ?? r.relationshipType,
  }
}

let _wtsState: { P: any; L: any } | null = null
const _parserCache = new Map<string, any>()

async function getParser(lang: string): Promise<any> {
  if (_parserCache.has(lang)) return _parserCache.get(lang)
  const cfg = LANGS[lang]
  const wts: any = await import("web-tree-sitter")
  const ParserClass = wts.Parser ?? wts.default ?? wts
  const Language = wts.Language ?? wts.default?.Language
  if (!_wtsState) await ParserClass.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  ;(_wtsState as any) = { P: ParserClass, L: Language }
  const grammar = await Language.load(fs.readFileSync(path.join(ROOT, "wasm", cfg.wasm)))
  const parser = new ParserClass()
  parser.setLanguage(grammar)
  _parserCache.set(lang, parser)
  return parser
}

// Universal invariants applied to EVERY fixture of a language, independent of
// fixture-specific expectations. Package-segment words are never valid
// inheritance/implements targets — an edge to them is grammar-illiterate output.
const UNIVERSAL_FORBIDDEN_RELATIONSHIPS: Record<string, any[]> = {
  java: [],
  groovy: [
    { type: "implements", target: "java" },
    { type: "implements", target: "io" },
    { type: "implements", target: "lang" },
    { type: "implements", target: "groovy" },
    { type: "extends", target: "java" },
    { type: "extends", target: "io" },
    { type: "extends", target: "lang" },
    { type: "extends", target: "groovy" },
  ],
  kotlin: [],
  scala: [],
}

async function runLang(runLangLang: string, overrideAnalyzer?: any): Promise<{ pass: number; fail: number; details: any[] }> {
  const cfg = LANGS[runLangLang]
  const dir = path.join(FIXTURES_DIR, runLangLang)
  if (!fs.existsSync(dir)) return { pass: 0, fail: 0, details: [{ fixture: "(none)", ok: true }] }

  const parser = await getParser(runLangLang)
  let analyzer: any
  if (overrideAnalyzer) {
    analyzer = overrideAnalyzer
  } else {
    const mod: any = await import(`../../src/ast/${cfg.analyzerFile}`)
    analyzer = new mod[cfg.className]()
    // Hand the analyzer the grammar it re-parses damaged regions with.
    //
    // This lane calls `analyzer.analyze(...)` DIRECTLY (below) rather than
    // going through `ASTEngine.parseFile`, so the engine's own `setGrammar`
    // handoff in `parseRaw` never runs for it — and `analyze` is synchronous
    // while `Language.load` is not, so the analyzer cannot build that parser
    // itself. The consequence was that every recovery pass was INERT in the
    // fixture lane: the SQL declaration-resync and the EXECUTE-literal pass both
    // saw no grammar, took the `acquireParser()` failure branch, and were
    // skipped. That is not a theoretical gap — it is why the resync could not be
    // pinned by any synthetic fixture and needed its own corpus gate
    // (script/m60/verify-sql-resync.ts, which does call `setGrammar`), and it is
    // why a mutant that deletes the EXECUTE pass would have "passed" by never
    // running. The engine's comment on the handoff asserts "the pass is exercised
    // by the fixture lane and not only in production"; that was true only for
    // the engine path, and this is the line that makes it true for this one.
    // `setGrammar` is STATIC, so it lives on the constructor and not on the
    // instance — reaching for `analyzer.setGrammar` finds nothing and the handoff
    // silently does not happen, which is the same inertness under a different
    // name.
    const ctor: any = analyzer?.constructor
    if (typeof ctor?.setGrammar === "function") {
      try {
        ctor.setGrammar((parser as any).language, (parser as any).constructor)
      } catch {
        // No grammar available: the analyzer keeps its main pass only and says
        // so in its ambiguity counters. Same contract as the engine path.
      }
    }
  }

  const exts = cfg.ext.split(",")
  // `.expectation.json` files are excluded because for a lane whose extension IS
  // `json` an expectation file ends in `.json` too, so it was picked up as a FIXTURE
  // and then reported as a missing expectation of its own. Every existing lane dodged
  // this by accident: bash expects `.sh`, typescript expects `.ts`, so the two
  // extensions never collided. json is the first lane where they do, and the failure
  // mode is six phantom "missing expectation file" rows that look like a lane problem
  // and are a runner problem.
  const sources = fs.readdirSync(dir).filter(f => exts.some(e => f.endsWith("." + e)) && !f.endsWith(".expectation.json"))
  let pass = 0, fail = 0
  const details: any[] = []
  for (const src of sources.sort()) {
    const base = src.slice(0, src.lastIndexOf("."))
    const expPath = path.join(dir, `${base}.expectation.json`)
    if (!fs.existsSync(expPath)) { fail++; details.push({ fixture: `${runLangLang}/${base}`, ok: false, reason: "missing expectation file" }); continue }
    const exp = JSON.parse(fs.readFileSync(expPath, "utf8"))

    const content = fs.readFileSync(path.join(dir, src), "utf8")
    const tree = parser.parse(content)

    // vue/svelte: production parity — engine parseFile performs the SFC
    // script-block pre-parse exactly as real indexing does.
    let result: any
    if (runLangLang === "vue" || runLangLang === "svelte" || runLangLang === "html" || runLangLang === "toml" || runLangLang === "markdown") {
      const engine = await import("../../src/ast/engine")
      result = await (engine as any).ASTEngine.parseFile(path.join(dir, src), content)
      // Mutation harness (M14.0.F4): the mutant wraps analyzer output. For
      // SFC languages parseFile is the real entry, so apply the mutant's
      // transform to its result (without this, vue/svelte mutants could
      // never be caught — the suite would silently accept defects).
      if (overrideAnalyzer && typeof (overrideAnalyzer as any).transform === "function") {
        result = (overrideAnalyzer as any).transform(result, content)
      }
    } else {
      result = await analyzer.analyze(tree.rootNode, content, `fixtures/${runLangLang}/${src}`)
    }
    const fixtureFilePath = `fixtures/${runLangLang}/${src}`
    const symbols: Entry[] = result.symbols ?? []
    const rels: Entry[] = (result.relationships ?? []).map(normRel)

    const problems: string[] = []

    // M60 fsharp wave: an unrecognised key in a CONSTRAINT row is a silently dead
    // assertion. See CONSTRAINT_KEY_ALLOWLIST's header — five of the fsharp lane's
    // seven mutants survived a forbid half that had been inert for this reason, and
    // a forbid that can never match is worse than no forbid, because it reads as
    // coverage in the fixture file.
    for (const sect of ["expectSymbols", "expectRelationships", "forbidSymbols", "forbidRelationships", "forbidDecorators"] as const) {
      const unknown = unknownConstraintKeys((exp as any)[sect])
      if (unknown.length) {
        problems.push(
          `inert assertion: ${sect} row(s) carry key(s) ${JSON.stringify(unknown)} which matchConstraints treats as REQUIRED constraints on the actual object — the row can never match, so it asserts nothing. Use "note" or "comment" for documentation.`,
        )
      }
    }

    for (const want of exp.expectSymbols ?? []) {
      if (!symbols.some(s => matchConstraints(s, want))) {
        problems.push(`expected symbol not found: ${JSON.stringify(want)}; got: ${symbols.map((s: any) => s.name + ":" + s.kind).slice(0, 20).join(", ")}`)
      }
    }
    // RSD3-style pin (2026-09-05): multiple declarations that share a
    // (owner,name) identity — rust `struct Foo` + several `impl Foo` blocks,
    // or a field plus a same-named accessor — must still get DISTINCT symbol
    // ids. Duplicate ids silently drop nodes from id-keyed graph consumers
    // and conflate distinct declarations. Each entry names a symbol to check
    // (name required; ownerName/kind optional filters).
    for (const want of exp.expectUniqueIds ?? []) {
      const hits = symbols.filter(s => matchConstraints(s, want))
      const ids = hits.map(s => s.id)
      if (new Set(ids).size !== ids.length) {
        problems.push(`expected unique ids among ${JSON.stringify(want)}; got: ${JSON.stringify(ids)}`)
      }
    }
    for (const want of exp.expectQualifiedCalls ?? []) {
      // ownerName-aware lookup (mirrors expectSymbols/expectParameters):
      // same-named methods across classes (Alpha.run / Beta.run) or repeated
      // normalized names (constructor) need the owning scope to disambiguate.
      // Added 2026-09-05 with the cpp CPPD10 pin — the previous bare-name
      // lookup silently checked whichever class came first.
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      const qc: string[] = sym?.qualified_calls ?? []
      for (const inc of want.includes ?? []) {
        if (!qc.some((c: string) => c === inc || c.endsWith("." + inc))) {
          problems.push(`expected ${want.symbol}.qualified_calls to include "${inc}"; got: ${JSON.stringify(qc)}`)
        }
      }
      // CPPD10 pin (2026-09-05): cross-class payload pollution can only be
      // caught by asserting ABSENCE — an includes-only check passes on a
      // polluted list ([aFn,bFn] still includes aFn).
      for (const notInc of want.notIncludes ?? []) {
        if (qc.some((c: string) => c === notInc || c.endsWith("." + notInc))) {
          problems.push(`expected ${want.symbol}.qualified_calls NOT to include "${notInc}"; got: ${JSON.stringify(qc)}`)
        }
      }
      // SCD7 payload-noise pin: countMatches catches DUPLICATED paths (curried
      // wrappers double-pushed "self.add") — an includes-only check passes on
      // a doubled array.
      if (want.countEquals !== undefined) {
        const inc = want.countEquals.path
        const n = qc.filter((c: string) => c === inc || c.endsWith("." + inc)).length
        if (n !== want.countEquals.count) {
          problems.push(`expected ${want.symbol}.qualified_calls to contain "${inc}" exactly ${want.countEquals.count} time(s); got ${n}: ${JSON.stringify(qc)}`)
        }
      }
    }
    for (const want of exp.expectTaintSources ?? []) {
      // TS T9 wave: taint payloads had zero fixture coverage family-wide.
      // { symbol, includes?, notIncludes? } over taintSources snippets.
      const sym = symbols.find((s: any) => s.name === want.symbol)
      const ts: any[] = (sym as any)?.taintSources ?? []
      for (const tInc of want.includes ?? []) {
        if (!ts.some((t: any) => (t.snippet ?? t) === tInc)) {
          problems.push(`expected ${want.symbol}.taintSources to include "${tInc}"; got: ${JSON.stringify(ts)}`)
        }
      }
      for (const tNot of want.notIncludes ?? []) {
        if (ts.some((t: any) => (t.snippet ?? t) === tNot)) {
          problems.push(`expected ${want.symbol}.taintSources NOT to include "${tNot}"; got: ${JSON.stringify(ts)}`)
        }
      }
    }

    for (const want of exp.expectTaintSinks ?? []) {
      // Mirror of expectTaintSources, for the SINK payload. The source side got
      // this gate with the TS T9 wave; the sink side had NONE, which is how
      // `re.exec(input)` (RegExp.prototype.exec) and any project-local
      // `execute(q)` stayed reported as command_injection / sql_injection for
      // the whole life of the analyzer — the false positive was simply not
      // checkable. { symbol, includes?, notIncludes?, includesVuln? } over
      // taintSinks snippets (and optionally the vulnerability_type).
      const sym = symbols.find((s: any) => s.name === want.symbol)
      const tk: any[] = (sym as any)?.taintSinks ?? []
      for (const tInc of want.includes ?? []) {
        if (!tk.some((t: any) => (t.snippet ?? t) === tInc)) {
          problems.push(`expected ${want.symbol}.taintSinks to include "${tInc}"; got: ${JSON.stringify(tk)}`)
        }
      }
      for (const tNot of want.notIncludes ?? []) {
        if (tk.some((t: any) => (t.snippet ?? t) === tNot)) {
          problems.push(`expected ${want.symbol}.taintSinks NOT to include "${tNot}"; got: ${JSON.stringify(tk)}`)
        }
      }
      for (const v of want.includesVuln ?? []) {
        if (!tk.some((t: any) => t.vulnerability_type === v)) {
          problems.push(`expected ${want.symbol}.taintSinks to include vulnerability_type "${v}"; got: ${JSON.stringify(tk)}`)
        }
      }
      for (const v of want.notIncludesVuln ?? []) {
        if (tk.some((t: any) => t.vulnerability_type === v)) {
          problems.push(`expected ${want.symbol}.taintSinks NOT to include vulnerability_type "${v}"; got: ${JSON.stringify(tk)}`)
        }
      }
    }
    for (const want of exp.expectSymbolRanges ?? []) {
      // Vue V1 wave (H3): pin line+byte coherence of a symbol range.
      // { symbol, ownerName?, startLine?, startColumn?, endLine?, endColumn?,
      //   startIndex?, endIndex? } — only specified fields are checked.
      const sym = symbols.find((s: any) => s.name === want.symbol &&
        (want.ownerName === undefined || (s as any).ownerName === want.ownerName))
      if (!sym) { problems.push(`expectSymbolRanges: symbol ${want.symbol} not found`); continue }
      const range: any = (sym as any).range ?? {}
      for (const k of ["startLine", "startColumn", "endLine", "endColumn", "startIndex", "endIndex"]) {
        if ((want as any)[k] !== undefined && range[k] !== (want as any)[k]) {
          problems.push(`expected ${want.symbol} range ${k}=${JSON.stringify((want as any)[k])}; got ${JSON.stringify(range[k])} (full: ${JSON.stringify(range)})`)
        }
      }
    }
    for (const want of exp.expectTypeParameters ?? []) {      const sym = symbols.find((s: any) => s.name === want.symbol)
      const tps = (sym?.genericParameters ?? sym?.metadata?.typeParameters ?? [])
      for (const inc of (want.includes ?? [])) {
        if (!tps.some((t) => t === inc || t.includes(inc))) {
          problems.push('expected ' + want.symbol + ' typeParameters to include "' + inc + '"; got: ' + JSON.stringify(tps))
        }
      }
      // `exact` exists because `includes` is a SUBSTRING test: a mutant that
      // appends or duplicates text still contains the pinned substring and
      // survives. Found 2026-09-16 (#382) — the near-miss mutant
      // typescript/type-parameter-names-only-positional produced
      // "T extends HasId = HasIdHasId" and passed an `includes` pin unchanged,
      // so the pin had to state the whole list, not a fragment of it.
      if (want.exact) {
        const got = [...tps].map(String).sort()
        const expected = [...want.exact].map(String).sort()
        if (JSON.stringify(got) !== JSON.stringify(expected)) {
          problems.push(
            'expected ' + want.symbol + ' typeParameters to be exactly ' + JSON.stringify(expected) + '; got: ' + JSON.stringify(tps),
          )
        }
      }
    }
    for (const want of exp.expectParameters ?? []) {
      // ownerName-aware lookup (mirrors expectSymbols): overloaded names like
      // dart's multiple `constructor` symbols need the owning class to disambiguate.
      // Optional metadataKind narrows accessor pairs (value getter has no params;
      // the setter carries them — pick the setter explicitly).
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName) &&
        (want.metadataKind === undefined || (s.metadata ?? {})[want.metadataKind]))
      if (!sym) { problems.push(`expectParameters: symbol ${want.symbol}${want.ownerName ? " in " + want.ownerName : ""} not found`); continue }
      const actual: Entry[] = sym?.parameters ?? []
      for (const wp of want.parameters ?? []) {
        // EVERY key the pin names, not just name/type (go #914). The old
        // matcher hard-coded those two fields, so a payload field that decides
        // a signature could not be pinned at all: `...T` is a DIFFERENT Go type
        // from `T`, the analyzer carries that in `isVariadic`, and a field that
        // cannot be asserted is exactly where a regression hides. Keys a pin
        // does not name are still ignored, so every existing pin keeps its
        // exact meaning.
        const hit = actual.some((p: any) =>
          Object.entries(wp).every(([k, v]) => PARAM_PIN_EXEMPT.has(k) || p[k] === v),
        )
        if (!hit) {
          problems.push(`expected ${want.symbol} parameter ${JSON.stringify(wp)}; got: ${JSON.stringify(actual.map((p: any) => ({ name: p.name, type: p.type })))}`)
        }
      }
    }
    for (const want of exp.forbidParameters ?? []) {
      // Negative twin of expectParameters (family contract: every expect
      // channel has a forbid counterpart). Pins "this parameter must NOT
      // exist on that symbol" — the CLJ1 wave needs it for two defect
      // classes that expect-only matchers cannot express: the rest marker
      // leaking as a parameter name (`[& args]` → ["&","args"]) and body
      // vectors leaking into parameters (`(defn leaky [x] [y z])` →
      // [x, y, z]). Owner-name aware like expectParameters.
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      if (!sym) continue // absent symbol is expectSymbols' contract, not this one's
      const actual: Entry[] = sym?.parameters ?? []
      for (const wp of want.names ?? []) {
        if (actual.some((p: any) => p.name === wp)) {
          problems.push(`forbidden ${want.symbol} parameter ${JSON.stringify(wp)} present; got: ${JSON.stringify(actual.map((p: any) => p.name))}`)
        }
      }
      // Negative twin of expectParameters' TYPE half, added by the csharp lane's
      // R7 paydown (2026-09-22) because the class it pins has no other channel:
      // a value in a parameter's `type` field that is not a type. Two measured
      // shapes — the placeholder literal (`|| "unknown"`) and the parameter's OWN
      // NAME leaking through a last-resort type scan on a damaged list
      // (`void M(int a, b)` -> type `"b"`) — are both "the field holds something
      // that is not what the field claims", and an expect-only matcher cannot see
      // either: `expectParameters` skips a key the want does not mention, so a
      // reverted `|| "unknown"` passes every pin. A blank name (`{ name: "" }`,
      // which the grammar's recovery invites by inserting an empty `identifier`
      // child) is the same shape in the NAME field and is pinned through `names`.
      // Family-wide on purpose: any lane can now forbid a placeholder type, which
      // is where a bug found in one analyzer catches its siblings.
      for (const wp of want.types ?? []) {
        if (actual.some((p: any) => p.type === wp)) {
          problems.push(`forbidden ${want.symbol} parameter type ${JSON.stringify(wp)} present; got: ${JSON.stringify(actual.map((p: any) => ({ name: p.name, type: p.type })))}`)
        }
      }
    }
    // M60 (powershell): three ADDITIVE payload channels. The lane's pre-wave
    // analyzer wrote `isStatic`, `returnType` and `docstring` into the symbol's
    // `metadata`, and `pool-worker.ts` drops the whole `metadata` object at the
    // worker boundary except the narrow `isDeclaration` key — so all three were
    // discarded before the store saw them, and nothing in the harness could say
    // so: `expectParameters` covers parameters, `expectDecorators` decorators,
    // `expectVisibility` visibility, and these three had no channel at all. An
    // unpinnable payload field is where a regression hides, which is the same
    // argument that added `forbidDecorators` (C2a) and the parameter-type half of
    // `forbidParameters` (csharp R7). Each entry is { symbol, ownerName? } plus
    // one assertion; unspecified fields are wildcards, and `comment`/`note` are
    // documentation, as everywhere else in this matcher.
    for (const want of exp.expectReturnType ?? []) {
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      if (!sym) { problems.push(`expectReturnType: symbol ${want.symbol} not found`); continue }
      if (want.returnType !== undefined && sym.returnType !== want.returnType) {
        problems.push(`expected ${want.symbol} returnType ${JSON.stringify(want.returnType)}; got ${JSON.stringify(sym.returnType)}`)
      }
    }
    for (const want of exp.expectIsStatic ?? []) {
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      if (!sym) { problems.push(`expectIsStatic: symbol ${want.symbol} not found`); continue }
      const actual = sym.isStatic === true
      if (want.isStatic !== undefined && actual !== want.isStatic) {
        problems.push(`expected ${want.symbol} isStatic ${want.isStatic}; got ${actual}`)
      }
    }
    for (const want of exp.expectDocstring ?? []) {
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      if (!sym) { problems.push(`expectDocstring: symbol ${want.symbol} not found`); continue }
      const text = String(sym.docstring ?? "")
      if (want.contains !== undefined && !text.includes(want.contains)) {
        problems.push(`expected ${want.symbol} docstring to contain ${JSON.stringify(want.contains)}; got ${JSON.stringify(text.slice(0, 200))}`)
      }
      if (want.minLength !== undefined && text.length < want.minLength) {
        problems.push(`expected ${want.symbol} docstring length >= ${want.minLength}; got ${text.length}`)
      }
    }
    // The negative half of the docstring channel, and the class that made it
    // necessary: the first powershell docstring scanner skipped blank lines while
    // walking upward, so a FILE BANNER became the documentation of whichever
    // declaration came first. `forbidDocstring` is the only way to say "this
    // symbol must have NO documentation", which an expect-channel cannot.
    for (const want of exp.forbidDocstring ?? []) {
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      if (!sym) continue
      const text = String(sym.docstring ?? "")
      if (text.length === 0) continue
      if (want.contains === undefined) {
        problems.push(`forbidden docstring present on ${want.symbol}: ${JSON.stringify(text.slice(0, 200))}`)
      } else if (text.includes(want.contains)) {
        problems.push(`forbidden docstring content on ${want.symbol}: contains ${JSON.stringify(want.contains)}`)
      }
    }
    // The fourth additive payload channel (M60, powershell): cyclomatic
    // complexity. `isBranch` decides it, and a node type the predicate never
    // names is uncounted by construction — powershell's `switch_clause` was, so
    // a ten-case switch measured 1. `metadata.complexity` (symbols + relationships)
    // is NOT this and must not be substituted for it: that is a count of emitted
    // facts and it grows with the analyzer's own output, so pinning it would
    // pin the regression in place.
    for (const want of exp.expectComplexity ?? []) {
      if (want.symbol) {
        const sym = symbols.find((s: any) => s.name === want.symbol && (want.ownerName === undefined || s.ownerName === want.ownerName))
        if (!sym) { problems.push(`expectComplexity: symbol ${want.symbol} not found`); continue }
        const cx = (sym as any).complexity
        if (want.equals !== undefined && cx !== want.equals) {
          problems.push(`expected ${want.symbol} complexity ${want.equals}; got ${cx}`)
        }
        if (want.min !== undefined && !(typeof cx === "number" && cx >= want.min)) {
          problems.push(`expected ${want.symbol} complexity >= ${want.min}; got ${cx}`)
        }
        continue
      }
      const fileCx = (result as any)?.metadata?.cyclomaticComplexity
      if (want.fileEquals !== undefined && fileCx !== want.fileEquals) {
        problems.push(`expected file cyclomaticComplexity ${want.fileEquals}; got ${fileCx} (a switch case is a decision point: \`switch_clause\` was never named, so a ten-case switch measured 1)`)
      }
      if (want.fileMin !== undefined && !(typeof fileCx === "number" && fileCx >= want.fileMin)) {
        problems.push(`expected file cyclomaticComplexity >= ${want.fileMin}; got ${fileCx}`)
      }
    }
    for (const want of exp.expectVisibility ?? []) {
      const sym = symbols.find((s: any) => s.name === want.symbol)
      if (!sym) { problems.push(`expectVisibility: symbol ${want.symbol} not found`); continue }
      if (want.visibility && sym.visibility !== want.visibility) {
        problems.push(`expected ${want.symbol} visibility ${want.visibility}; got ${sym.visibility}`)
      }
    }
        for (const want of exp.expectComplexity ?? []) {
      // ownerName-aware lookup (mirrors expectSymbols): overloaded / repeated
      // names across owners (protocol declaration + implementation of the
      // same selector) need the owning scope to disambiguate.
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      const cx: number | undefined = sym?.complexity
      if (want.equals !== undefined && cx !== want.equals) {
        problems.push(`expected ${want.symbol} complexity ${want.equals}; got ${cx}`)
      } else if (want.min !== undefined && !(typeof cx === "number" && cx >= want.min)) {
        problems.push(`expected ${want.symbol} complexity >= ${want.min}; got ${cx}`)
      } else if (want.max !== undefined && !(typeof cx === "number" && cx <= want.max)) {
        problems.push(`expected ${want.symbol} complexity <= ${want.max}; got ${cx}`)
      }
    }
    for (const want of exp.expectComments ?? []) {
      const sym = symbols.find((s: any) => s.name === want.symbol)
      const cc: number = Array.isArray(sym?.comments) ? sym.comments.length : 0
      if (want.minCount && cc < want.minCount) {
        problems.push(`expected ${want.symbol} comments >= ${want.minCount}; got ${cc}`)
      }
    }
        for (const want of exp.expectApiContractPaths ?? []) {
      const sym = symbols.find((s: any) => s.name === want.symbol)
      const actualPath = sym?.apiContractPath ?? sym?.api_contract_path
      if (want.equals && actualPath !== want.equals) {
        problems.push(`expected ${want.symbol} apiContractPath ${JSON.stringify(want.equals)}; got ${JSON.stringify(actualPath)}`)
      }
    }
    for (const want of exp.forbidApiContractPaths ?? []) {
      // TS T2/T4 wave: lifecycle hooks (@PostConstruct) and path-less
      // mappings must emit NO contract — expectApiContractPaths can only
      // assert presence. Symbol match mirrors the expect variant.
      const sym = symbols.find((s: any) => s.name === want.symbol &&
        (want.ownerName === undefined || (s as any).ownerName === want.ownerName))
      const actualPath = (sym as any)?.apiContractPath ?? (sym as any)?.api_contract_path
      if (sym && actualPath !== undefined) {
        problems.push(`forbidden apiContractPath present: ${want.symbol} has ${JSON.stringify(actualPath)}`)
      }
    }
    for (const want of exp.expectExports ?? []) {
      // Each constraint field must match >=1 export (unspecified fields
      // wildcards). ER3 (erlang wave): `note` is documentation here too — see the
      // expectImports comment below for why the three matchers must agree.
      const hit = (result.exports ?? []).find((e: any) => matchConstraints(e, want))
      if (!hit) problems.push(`expected export not found: ${JSON.stringify(want)}; got: ${JSON.stringify((result.exports ?? []).map((e: any) => e.name))}`)
    }
    for (const want of exp.expectExportRanges ?? []) {
      // Sv2 #736-D1: pin SFC coherence of an export range.
      // { export, startLine?, startColumn?, endLine?, endColumn?,
      //   startIndex?, endIndex? } — only specified fields are checked.
      const ex = (result.exports ?? []).find((e: any) => e.name === want.export)
      if (!ex) { problems.push(`expectExportRanges: export ${want.export} not found`); continue }
      const range: any = (ex as any).range ?? {}
      for (const k of ["startLine", "startColumn", "endLine", "endColumn", "startIndex", "endIndex"]) {
        if ((want as any)[k] !== undefined && range[k] !== (want as any)[k]) {
          problems.push(`expected export ${want.export} range ${k}=${JSON.stringify((want as any)[k])}; got ${JSON.stringify(range[k])} (full: ${JSON.stringify(range)})`)
        }
      }
    }
    for (const want of exp.expectImports ?? []) {
      // Each constraint field must match >=1 import (unspecified fields are
      // wildcards; `comment` is documentation, never a constraint — mirrors
      // matchConstraints, unified 2026-09-05 by the rust RSD6 fixture).
      // ER3 (erlang wave): `note` joins `comment` here. matchConstraints — which
      // every symbol/relationship pin goes through — has skipped both since M14,
      // but the exports/imports matchers treated a `note` as a constraint, so a
      // documented pin failed with "expected export not found" naming a key that
      // is documentation. No existing pin relied on that (all lanes pass before
      // and after), so this only makes the three matchers agree.
      const hit = (result.imports ?? []).find((imp: any) =>
        Object.entries(want).every(([k, v]) => {
          if (k === "comment" || k === "note") return true
          if (k.startsWith("meta.")) return ((imp.metadata ?? {})[k.slice(5)] ?? imp[k.slice(5)]) === v
          if (Array.isArray(v)) return JSON.stringify([...(imp[k] ?? [])].sort()) === JSON.stringify([...v].sort())
            // M14 (#888, html): an OBJECT payload compares by value. `range` is the one that
            // matters — an import's line is what makes it checkable against the source, and
            // the pre-fix html analyzer published the ELEMENT's range rather than the
            // ATTRIBUTE's, so a multi-line start tag produced a wrong import line. With
            // identity comparison a pin naming `range` could never match, which is exactly
            // how that defect stayed unpinned. No existing pin names an object field on an
            // import, so this changes no pin's existing meaning.
            // Re-applied 2026-09-29 from origin/main during the merge. It is COMPLEMENTARY to
            // the `note` clause above, not competing: upstream lacked the `note` clause
            // (erlang ER3) and this side lacked the object comparison (html #888), so each side
            // passed its own lane and failed the other's — the clearest evidence yet that a
            // merge cannot be resolved by picking a side.
            if (v !== null && typeof v === "object") return JSON.stringify(imp[k]) === JSON.stringify(v)
          return imp[k] === v
        }),
      )
      if (!hit) problems.push(`expected import not found: ${JSON.stringify(want)}; got: ${JSON.stringify((result.imports ?? []).map((i: any) => ({ module: i.module, ns: i.isNamespaceImport, items: i.items })))}`)
    }
    for (const want of exp.expectDecorators ?? []) {
      // Each entry: { symbol, ownerName?, contains } — symbol.decorators must
      // include an entry whose text contains `contains`. Reads ONLY s.decorators
      // (not metadata.annotations fallback) so decorator emission itself stays
      // pinned per symbol kind.
      //
      // M60.P1 (cpp): `ownerName` joins the filter because a lane that NORMALIZES a
      // declaration's name cannot address it by name at all. cpp publishes every
      // constructor as the symbol named `constructor` (and this file's own
      // expectParameters comment already records the same problem for dart's
      // multiple `constructor` symbols), so `{ symbol: "constructor",
      // ownerName: "Shape" }` is the only way to pin a modifier on ONE
      // constructor — and without it the pin silently resolves to whichever
      // constructor happens to come first in the file, which is a pin that can
      // pass against the wrong declaration. This mirrors expectParameters,
      // expectVisibility and expectComplexity, which all had the filter already;
      // `ownerName` was already in CONSTRAINT_KEY_ALLOWLIST, so no other lane
      // changes meaning.
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      const decs: string[] = sym?.decorators ?? []
      if (!decs.some((d) => d.includes(want.contains))) {
        problems.push(`expected ${want.symbol}${want.ownerName ? " in " + want.ownerName : ""} decorators to include "${want.contains}"; got ${JSON.stringify(decs)} (meta.annotations=${JSON.stringify(sym?.metadata?.annotations)})`)
      }
    }
    for (const want of exp.forbidDecorators ?? []) {
      // The NEGATIVE half of the decorator payload (C2a, 2026-09-23). `expectDecorators`
      // could not hold the alias-qualifier rule: the pre-fix spelling
      // `global::System.Serializable` CONTAINS the post-fix spelling
      // `System.Serializable`, so a `contains` assertion is satisfied by both and can never
      // fail on the revert. The class it was blind to was measured on real code — 95
      // decorator rows in the two pinned csharp corpora carried the qualifier — so the
      // payload needed a gate that can say no.
      //
      // Semantics mirror forbidSymbols/forbidRelationships: { symbol?, ownerName?, contains }
      // — every decorator of every symbol (or of the named symbol when given) must
      // NOT include `contains`. Unspecified fields are wildcards; `comment`/`note`
      // are documentation. `ownerName` is the same M60.P1 addition as
      // `expectDecorators` above, and it is what keeps the negative twin from
      // being blunter than the positive one: a forbid row that can only name a
      // symbol, for a lane that normalizes constructors, would forbid the modifier
      // on EVERY constructor rather than the one under test.
      const scope = want.symbol
        ? symbols.filter((s: any) =>
            s.name === want.symbol &&
            (want.ownerName === undefined || s.ownerName === want.ownerName))
        : symbols
      for (const s of scope) {
        for (const d of (s.decorators ?? []) as string[]) {
          if (String(d).includes(want.contains)) {
            problems.push(`forbidden decorator present on ${s.name}: ${JSON.stringify(d)} (entry contains "${want.contains}")`)
          }
        }
      }
    }
    for (const want of exp.expectPrimaryFramework ?? []) {
      const actual = (result.metadata as any)?.framework ?? null
      if (actual !== want) problems.push(`expected primary framework ${JSON.stringify(want)}; got ${JSON.stringify(actual)} (detected=${JSON.stringify((result.metadata as any)?.detectedFrameworks)})`)
    }
    for (const want of exp.expectMetadata ?? []) {
      // Partial file-metadata assertion (family contract: a fixture may pin
      // any analyzable payload, not only symbols/edges). Added by the CLJ1
      // wave to make the complexity convention pinnable: the pre-fix clojure
      // fallback fabricated `cyclomaticComplexity = symbols.length` (vars and
      // modules counted as decisions) — differential-invisible, so ONLY a
      // metadata pin can hold the correct baseline (function count).
      for (const [k, v] of Object.entries(want)) {
        if (k === "comment") continue
        const actual = (result.metadata as any)?.[k]
        if (JSON.stringify(actual) !== JSON.stringify(v)) {
          problems.push(`expected metadata.${k} = ${JSON.stringify(v)}; got ${JSON.stringify(actual)}`)
        }
      }
    }
    for (const want of exp.expectComplexity ?? []) {
      // ownerName-aware lookup (mirrors expectSymbols): overloaded / repeated
      // names across owners (protocol declaration + implementation of the
      // same selector) need the owning scope to disambiguate.
      const sym = symbols.find((s: any) =>
        s.name === want.symbol &&
        (want.ownerName === undefined || s.ownerName === want.ownerName))
      const cx: number | undefined = sym?.complexity
      if (want.equals !== undefined && cx !== want.equals) {
        problems.push(`expected ${want.symbol} complexity ${want.equals}; got ${cx}`)
      } else if (want.min !== undefined && !(typeof cx === "number" && cx >= want.min)) {
        problems.push(`expected ${want.symbol} complexity >= ${want.min}; got ${cx}`)
      } else if (want.max !== undefined && !(typeof cx === "number" && cx <= want.max)) {
        problems.push(`expected ${want.symbol} complexity <= ${want.max}; got ${cx}`)
      }
    }
    for (const want of exp.expectPatterns ?? []) {
      // string[] against metadata.patterns — pins the scala SCD5 contract
      // (annotation-NAME pattern flags, not text.includes substrings).
      const actual: string[] = (result.metadata as any)?.patterns ?? []
      if (!actual.includes(want)) problems.push(`expected pattern "${want}" not detected; got: ${JSON.stringify(actual)}`)
    }
    for (const want of exp.forbidPatterns ?? []) {
      // SCD5 fabrication guard: a pattern that no honest annotation in this
      // fixture could set must NEVER appear (the text.includes regression
      // class fabricated flags from unrelated identifiers).
      const actual: string[] = (result.metadata as any)?.patterns ?? []
      if (actual.includes(want)) problems.push(`forbidden pattern present: "${want}" (patterns: ${JSON.stringify(actual)})`)
    }
    for (const want of exp.expectComments ?? []) {
      // { symbol, contains?, notContains? } — pins leading-comment capture
      // AND misattribution guards (a comment stolen from a previous
      // declaration violates notContains).
      const sym = symbols.find((s: any) => s.name === want.symbol)
      const comments: string[] = sym?.comments ?? []
      if (want.contains && !comments.some((c) => c.includes(want.contains))) {
        problems.push(`expected ${want.symbol} comments to include "${want.contains}"; got ${JSON.stringify(comments)}`)
      }
      if (want.notContains && comments.some((c) => c.includes(want.notContains))) {
        problems.push(`expected ${want.symbol} comments NOT to include "${want.notContains}"; got ${JSON.stringify(comments)}`)
      }
    }
    for (const want of exp.expectFrameworks ?? []) {
      const actual: string[] = (result.metadata as any)?.detectedFrameworks ?? []
      if (!actual.includes(want)) problems.push(`expected framework "${want}" not detected; got: ${JSON.stringify(actual)}`)
    }
    // S1.24 (M49 #741): `expectFrameworks` is a must-include list, so a detector
    // that over-matches (substring instead of root-prefix) passes every fixture
    // that pins only positives — the go fixture's header already CLAIMS an
    // "exact detected set" the runner could not check. This is the symmetric
    // negative, matching forbidSymbols/forbidRelationships.
    for (const want of exp.forbidFrameworks ?? []) {
      const actual: string[] = (result.metadata as any)?.detectedFrameworks ?? []
      if (actual.includes(want)) problems.push(`forbidden framework detected: "${want}"; got: ${JSON.stringify(actual)}`)
    }
    for (const want of exp.expectErrors ?? []) {
      // analyzers place parse errors at result.errors (older contract) or in
      // metadata.errors (rust/others) — search BOTH (unified 2026-09-05 by
      // the rust RSD2 error-file-payload fixture).
      const errList: any[] = [...(result.errors ?? []), ...(result.metadata?.errors ?? [])]
      const hit = errList.find((e: any) =>
        Object.entries(want).every(([k, v]) => (e.range?.[k] ?? e[k]) === v),
      )
      if (!hit) problems.push(`expected error not found: ${JSON.stringify(want)}; got: ${JSON.stringify(errList.slice(0, 5).map((e: any) => e.range))}`)
    }

    for (const want of exp.expectErrorCount ?? []) {
      // M14 (#888, html): the only pre-existing channel for this was
      // `expectErrors`, which is a >=1 match — so a lane that reported the SAME
      // parse error twice passed it. That is exactly the html defect the parse
      // walk carried: the analyzer walked for ERROR/MISSING nodes with an
      // UNBOUNDED stack while the engine walks the same tree with a cap of 50,
      // and a 300-line broken file published 350 warnings for 300 lines. Two
      // copies of one error are indistinguishable to `expectErrors` and obvious
      // to a count, so the count is the channel the class needed.
      // `{ equals: N }` for the total, `{ atLeast: N }` / `{ atMost: N }` for a
      // bound — the same shape `expectSymbolCount`'s `equals` uses, plus bounds
      // because a cap is a bound and not a constant.
      const errList: any[] = [...(result.errors ?? []), ...(result.metadata?.errors ?? [])]
      const n = errList.length
      if (want.equals !== undefined && n !== want.equals) {
        problems.push(`expected ${want.equals} parse error(s); got ${n}`)
      }
      if (want.atLeast !== undefined && !(n >= want.atLeast)) {
        problems.push(`expected at least ${want.atLeast} parse error(s); got ${n}`)
      }
      if (want.atMost !== undefined && !(n <= want.atMost)) {
        problems.push(`expected at most ${want.atMost} parse error(s); got ${n}`)
      }
    }
    for (const want of exp.forbidSymbols ?? []) {
      const hit = symbols.find(s => matchConstraints(s, want))
      if (hit) problems.push(`forbidden symbol present: ${JSON.stringify(want)} (found ${hit.name}:${hit.kind})`)
    }
    for (const want of exp.forbidErrors ?? []) {
      // TS T1 wave: absence assertions for parse/lint errors (a plain
      // module must produce zero hook warnings). Matches expectErrors
      // field-for-field over range ?? top level.
      const errList: any[] = [...(result.errors ?? []), ...(result.metadata?.errors ?? [])]
      const hit = errList.find((e: any) =>
        Object.entries(want).every(([k, v]) => (e.range?.[k] ?? e[k]) === v),
      )
      if (hit) problems.push(`forbidden error present: ${JSON.stringify(want)} (found ${JSON.stringify(hit.message ?? hit).slice(0, 120)})`)
    }
    for (const want of exp.expectSymbolCount ?? []) {
      // { name, equals } — pins DEDUPE: overload groups must yield exactly
      // one symbol per name (duplicate constructor symbols violated this).
      // Optional ownerName/kind narrow the bucket (accessor pairs: Counter
      // keeps its getter+setter pair, IconSet's same-name getter excluded).
      const n = symbols.filter((s: any) =>
        s.name === want.name &&
        (want.ownerName === undefined || s.ownerName === want.ownerName) &&
        (want.kind === undefined || s.kind === want.kind)).length
      if (n !== want.equals) {
        problems.push(`expected ${want.equals} symbol(s) named "${want.name}"${want.ownerName ? ` in ${want.ownerName}` : ""}${want.kind ? ` kind=${want.kind}` : ""}; got ${n}`)
      }
    }
    for (const want of exp.expectRelationshipCount ?? []) {
      // { type, from, target, equals } — pins DEDUPE on relationship edges:
      // vue re-emitted sub-analyzer contains edges, doubling every class
      // member's containment. matchConstraints with an added equals check
      // (exact count of matching edges, not >=1 like expectRelationships).
      const n = rels.filter(r => matchConstraints(r, { ...want, equals: undefined })).length
      if (n !== want.equals) {
        problems.push(`expected ${want.equals} relationship(s) ${JSON.stringify({ type: want.type, from: want.from, target: want.target })}; got ${n}`)
      }
    }
    for (const want of exp.forbidImports ?? []) {
      const hit = (result.imports ?? []).find((imp: any) =>
        Object.entries(want).every(([k, v]) => {
          // Documentation keys are NOT match constraints, exactly as in
          // matchConstraints: a `note` explaining the pre-fix shape must not
          // make the assertion unassertable. Without this exemption a
          // forbidImports pin that DOCUMENTS itself could never fire — the
          // three perl mutants perl/no-strict-recorded-as-import,
          // perl/version-requirement-recorded-as-import and
          // perl/use-constant-becomes-an-import all survived a suite that
          // looked complete, and only because their pins carried a note.
          if (k === "comment" || k === "note") return true
          if (k.startsWith("meta.")) return ((imp.metadata ?? {})[k.slice(5)] ?? imp[k.slice(5)]) === v
          return imp[k] === v
        }),
      )
      if (hit) problems.push(`forbidden import present: ${JSON.stringify(want)} (found ${hit.module})`)
    }
    for (const want of exp.forbidExports ?? []) {
      // Groovy G7 wave: anonymous-class noise names must never leak into the
      // export list. No negation existed (expectExports is >=1 match only).
      const hit = (result.exports ?? []).find((e: any) => matchConstraints(e, want))
      if (hit) problems.push(`forbidden export present: ${JSON.stringify(want)}`)
    }
    // M49 JVM-closure exports-family invariant — runs on EVERY fixture, every
    // language (reviews/jvm-closure-audit.md, exports-fork verdict): the
    // export list is the index's importable-unit set, so
    //   1. export names must be UNIQUE — a duplicate cannot identify its
    //      provider (java/groovy overloads emitted ["Svc","greet","greet"]
    //      before the JAD3/G3 member-export reversal), and
    //   2. every export name must resolve to a TOP-LEVEL symbol — bare
    //      member names are not importable; membership rides Contains.
    // This kills the exports fork (and its next occurrence) at gate time
    // instead of audit time.
    const exportNames = (result.exports ?? []).map((e: any) => e.name)
    // Erlang #880: arity is function identity — `-export([pick/0, pick/1]).`
    // is a legal export list. Dedup by name+arity where the export carries an
    // arity, by bare name otherwise (all other languages).
    const exportKey = (e: any) => (e.arity !== undefined && e.arity !== null ? `${e.name}/${e.arity}` : e.name)
    const exportKeys = (result.exports ?? []).map(exportKey)
    const dupExports = exportKeys.filter((n: string, i: number) => exportKeys.indexOf(n) !== i)
    if (dupExports.length) {
      problems.push(`export invariant violated: duplicate export name(s) ${JSON.stringify([...new Set(dupExports)])}`)
    }
    // Top-level resolvability — an export must name an IMPORTABLE UNIT, i.e.
    // a name an importer can bind. Honest semantics per language family:
    //   - ownerless symbols (file-scope units: types, fns, consts),
    //   - csharp namespace symbols AND namespace-owned types (using binds
    //     the bare name within the namespace scope), plus TS namespace-owned
    //     exports (`export namespace NS { export class Visible }` — Visible
    //     is importable as NS.Visible; the export entry is its public name),
    //   - haskell/ocaml-style MODULE-owned symbols (import Data.User (mkUser)
    //     binds mkUser directly — the module is the namespace, members are
    //     importable by name),
    //   - NOT type-owned members (java/groovy/kotlin/scala/cpp/go methods:
    //     `import Cls` binds the type, never bare members — membership rides
    //     Contains). This asymmetry IS the exports-family ruling.
    //   - JS/TS module-system forms: `default` is THE module's main binding
    //     (a symbol may not exist for anonymous decls — the export entry is
    //     the binding), and CJS assignments (`exports.x`, `module.exports.y`,
    //     `module.exports = {...}`) create live module properties importable
    //     by name without a corresponding symbol. Both are bindings.
    const nsNames = new Set(
      symbols.filter((s: any) => s.metadata?.isCSharpNamespace).map((s: any) => s.name),
    )
    const moduleNames = new Set(
      symbols
        .filter((s: any) => s.kind === "module" || s.kind === "Module" || s.kind === "namespace" || s.kind === "Namespace")
        .map((s: any) => s.name),
    )
    // A symbol whose owner is ITS OWN FILE is a file-scope unit — the case the
    // rule above already names ("ownerless symbols (file-scope units: types,
    // fns, consts)") reaches in a language that can genuinely have no module.
    // Erlang's include fragments are exactly that: an .erl file whose `-module`
    // line is commented out because the file is textually included into another
    // module (OTP ships them — lib/syntax_tools/examples/merl/basic_test.erl is
    // one). The analyzer owns those members by the file path, because the path
    // is the only identity the file has and inventing a module name from the
    // filename would fabricate a module that does not exist. That makes the
    // member file-scoped, hence importable by its bare name, hence top level —
    // the same class of unit the ownerless clause already admits. Without this,
    // every `-export` in an Erlang include fragment is reported as unresolvable.
    const isFileScopeUnit = (s: any) => !!s.ownerName && s.ownerName === fixtureFilePath
    const topLevelNames = new Set(
      symbols
        .filter(
          (s: any) =>
            !s.ownerName ||
            nsNames.has(s.ownerName) ||
            moduleNames.has(s.ownerName) ||
            isFileScopeUnit(s),
        )
        .map((s: any) => s.name),
    )
    // JS/TS module-system binding forms — these are importable units even
    // though no local symbol carries the name:
    //   `default` — the module's main binding (anon decls have no symbol);
    //   dotted names — CJS deep paths (`exports.a.b` = live module props);
    //   `exports`-rebind/object-literal members — live module properties;
    //   `require`-bound names re-published via `module.exports = { def, a }`;
    //   local names re-exported under an alias (`export { alpha as beta }` —
    //   beta is the public binding; alpha is the private local).
    //   Re-export-from (`export { a } from "./m"`) likewise.
    // Only type-owned bare members (java/groovy/kotlin/scala/cpp/go methods)
    // are rejected — membership rides Contains.
    const lang = result.language ?? runLangLang
    const isJsFamily = lang === "javascript" || lang === "typescript" || lang === "vue" || lang === "svelte"
    const hasReExport = (result.imports ?? []).some((i: any) => i.metadata?.reExport)
    const viaCommonJs = (result.exports ?? []).some((e: any) => e.metadata?.viaCommonJs)
    const exportedNamesSet = new Set(exportNames)
    const symbolNames = new Set(symbols.map((s: any) => s.name))
    const isJsModuleBinding = (n: string) =>
      n === "default" ||
      n.includes(".") ||
      hasReExport ||
      viaCommonJs ||
      // aliased re-export of a local: some local symbol exists that is NOT
      // itself in the export list under its own name (alpha as beta)
      (isJsFamily && [...symbolNames].some((sn) => !exportedNamesSet.has(sn) && topLevelNames.has(sn)))
    const unresolvable = [...new Set(exportNames)].filter((n: string) => !topLevelNames.has(n) && !isJsModuleBinding(n))
    if (unresolvable.length) {
      problems.push(`export invariant violated: export(s) ${JSON.stringify(unresolvable)} do not resolve to a top-level symbol (membership rides Contains)`)
    }
    for (const want of exp.expectRelationships ?? []) {
      if (!rels.some(r => matchConstraints(r, want))) {
        problems.push(`expected relationship not found: ${JSON.stringify(want)}; got: ${rels.map((r: any) => r.type + "[" + r.from + "->" + r.target + "]" + (r.confidence != null ? "@" + r.confidence : "")).slice(0, 30).join("; ")}`)
      }
    }
    for (const want of [...(exp.forbidRelationships ?? []), ...(UNIVERSAL_FORBIDDEN_RELATIONSHIPS[lang] ?? [])]) {
      const hit = rels.find(r => matchConstraints(r, want))
      if (hit) problems.push(`forbidden relationship present: ${JSON.stringify(want)} (found ${hit.type}[${hit.from}->${hit.target}]${hit.confidence != null ? "@" + hit.confidence : ""})`)
    }

    if (problems.length === 0) pass++
    else fail++
    details.push({ fixture: `${runLangLang}/${base}`, ok: problems.length === 0, problems })
  }
  return { pass, fail, details }
}

export { runLang, LANGS, matchConstraints, getParser }

async function main() {
  const argLangs = process.argv.includes("--lang")
    ? process.argv[process.argv.indexOf("--lang") + 1].split(",")
    : Object.keys(LANGS)

  // M49 G8 (#841 round) — the scoped-run hazard, found by doing it.
  // `--lang groovy` used to run the selected lane and then emit the result as
  // **M14.0.F3**, i.e. it replaced the canonical 22-language fixture evidence
  // with a one-language file (22 checks → 1; 21 languages' fixture detail —
  // thousands of pinned expectations' outcomes — deleted, with nothing in the
  // artifact saying so) and, worse, `--update-baseline` on such a run would have
  // DROPPED every language it did not touch from `fixture-baseline.json`, i.e.
  // silenced their regression gate permanently. This is the same defect class
  // the W21 oracle guard closed in `script/m59/oracle-callsite.ts` (`oracle-callsite.ts`
  // had no scoped-run guard, so `--only=groovy --files-per-lang=40` replaced the
  // canonical 22-language evidence with a 40-file single-language one). A lane
  // run is for inspecting a lane, so it now writes NO evidence and cannot touch
  // the baseline: the canonical artifact is only ever produced by a run that
  // covers every lane, which is what a milestone claim has to rest on.
  const scoped = argLangs.length !== Object.keys(LANGS).length
  if (scoped) {
    console.log(
      `\nSCOPED run (${argLangs.join(",")} of ${Object.keys(LANGS).length} lanes): results are printed here and NO evidence is written — ` +
        `the canonical validation/m14/results/M14.0.F3.json is NOT touched, and --update-baseline is refused, because either would shrink the milestone's claim to the lanes this run covered.`,
    )
  }
  if (scoped && process.argv.includes("--update-baseline")) {
    console.error("refusing --update-baseline on a scoped run: it would drop every lane the run did not cover")
    process.exit(5)
  }

  // M60 (#884) — fixture-lane coverage. `LANGS` names the lanes this runner can run;
  // `validation/m14/fixtures/<lang>/` is where those lanes' fixtures live. The two are
  // maintained by hand and can drift, and when they drift the failure is SILENT:
  // `clean`'s `import-modules-alias-884` pair was committed against an OPEN defect and
  // executed by nothing, so the lane's matrix cell read "no adversarial fixture lane"
  // while its pin sat in the tree. That is worse than a missing fixture — it looks like
  // evidence and cannot fail, which is the one property a gate may not have. A fixture
  // lane is not a directory; it is a directory this map names. Checked on a FULL run for
  // the same reason the baseline gate is: a milestone claim may not rest on a partial one.
  if (!scoped) {
    const dirs = fs
      .readdirSync(FIXTURES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    const orphaned = dirs.filter((d) => !(d in LANGS))
    if (orphaned.length) {
      console.error(`\nfixture-lane gate: ${orphaned.length} fixture director(ies) no runner lane claims: ${orphaned.join(", ")}`)
      for (const d of orphaned) {
        const n = fs.readdirSync(path.join(FIXTURES_DIR, d)).filter((f) => f.endsWith(".expectation.json")).length
        console.error(`  ${d}: ${n} expectation file(s) — evidence nothing executes. Add the lane to LANGS (wasm + analyzerFile + className + ext) or remove the directory.`)
      }
      process.exit(6)
    }
    console.log(`fixture-lane gate: ${dirs.length} fixture director(ies), every one named in LANGS`)
  }

  const allDetails: any[] = []
  const summary: Record<string, { pass: number; fail: number }> = {}
  for (const lang of argLangs) {
    if (!LANGS[lang]) throw new Error(`unknown language ${lang}`)
    const r = await runLang(lang)
    summary[lang] = { pass: r.pass, fail: r.fail }
    allDetails.push(...r.details)
  }

  for (const d of allDetails) {
    console.log(`${d.ok ? "PASS" : "FAIL"}  ${d.fixture}`)
    if (!d.ok) for (const p of d.problems ?? [d.reason]) console.log(`      - ${p.split("; got:")[0]}`)
  }
  console.log("\nsummary:", JSON.stringify(summary))

  // evidence via harness (F2)
  const { emitEvidence } = await import("./evidence-harness")
  const checks = Object.entries(summary).map(([lang, s]) => ({
    id: `fixtures-${lang}`,
    description: `${lang} adversarial fixtures`,
    status: s.fail === 0 ? ("pass" as const) : ("fail" as const),
    detail: `${s.pass}/${s.pass + s.fail} fixtures pass`,
  }))
  if (!scoped) emitEvidence({
    issueId: "M14.0.F3",
    title: "Adversarial fixture corpus",
    claimLevel: "L1",
    layers: ["fixtures"],
    checks,
    limitations: [
      { description: "JVM languages covered in this emission; other languages gain fixtures during their waves (>=5 each per F3 acceptance)" },
      { description: "fixture failures document CURRENT analyzer defects honestly; they convert to passes during wave fixes, never by editing expectations to match buggy output" },
    ],
    data: { summary, details: allDetails },
  })

  // improvement-forcing gate: failing-fixture counts must never grow
  const BASELINE = path.join(ROOT, "validation", "m14", "fixture-baseline.json")
  const currentFail: Record<string, number> = {}
  for (const [l, s] of Object.entries(summary)) currentFail[l] = s.fail
  const updateBaseline = process.argv.includes("--update-baseline")
  if (updateBaseline) {
    fs.writeFileSync(BASELINE, JSON.stringify(currentFail, null, 2) + "\n")
    console.log("fixture baseline updated:", currentFail)
  } else if (fs.existsSync(BASELINE)) {
    const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    if (scoped) console.log(`(baseline gate covers only the ${argLangs.length} lane(s) this scoped run selected; a full run is the milestone's gate)`)
    const regressions = Object.keys(currentFail).filter(l => base[l] !== undefined && currentFail[l] > base[l])
    for (const r of regressions) console.error(`FIXTURE REGRESSION ${r}: ${base[r]} -> ${currentFail[r]} failures`)
    if (regressions.length) process.exit(4)
    console.log("fixture baseline gate: no regressions")
  }
  const totalFail = Object.values(summary).reduce((a, s) => a + s.fail, 0)
  console.log(totalFail > 0 ? `\n${totalFail} fixture(s) FAIL — these are honest defect findings, not harness errors` : "\nall fixtures pass")
  process.exit(0) // F3 gate: fixtures RUN successfully; failures are wave work items, tracked via baseline
}

if (process.argv[1]?.endsWith("run-fixtures.ts")) {
  main().catch(e => { console.error(e); process.exit(1) })
}
