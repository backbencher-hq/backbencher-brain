/**
 * R7 AUDIT — lane R7_AUDIT_FLEET. Every emitted edge, both endpoints, classified.
 *
 * ## What R7 is
 *
 * `validation/m60/ledger.json` standing rule R7:
 *
 *   "No analyzer may NAME something with a placeholder literal. When a fallback
 *   has nothing truthful to say the honest state is ABSENCE, not the string
 *   'unknown' — a literal in a name-bearing field becomes a symbol (or an edge
 *   endpoint) that does not exist in the source."
 *
 * The rule's ENFORCED half is `script/m60/sentinel-census.ts`, a tree-sitter
 * census over the analyzer sources whose marker rule is the literal `unknown`
 * (`MARKER` at sentinel-census.ts:63). `global`, `module`, `*`, `<unnamed>` and
 * `""` are NOT in that marker set, so an analyzer can be syntactically absent
 * from the register and still put a placeholder in every edge it emits. The
 * register says so itself: the runtime half of R7 — "no emitted row carries a
 * placeholder as a name" — is `runtimeOwed`, and only csharp is listed under
 * `runtimeMeasured`.
 *
 * So this script is the runtime half, for Rust, measured over the production
 * path.
 *
 * ## The instrument, and why it is a tree walk
 *
 * `parseFile` from `src/ast/pool-worker` — the entry the indexer calls, not
 * `analyze()` — over every `.rs` file `git ls-files` reports for the corpus repo.
 * The POPULATION is derived (repo list from `readdirSync`, file list from git),
 * never hand-written, so a file added beside the script cannot rot the count
 * silently (docs/M14-HONESTY-CONTRACT.md, "an instrument must declare the
 * population it covered").
 *
 * No regular expression appears anywhere in this file: every classification is
 * `String` comparison, `startsWith`/`endsWith`/`includes` and charCodeAt tests.
 *
 * ## Endpoint classes
 *
 *   empty                "" or whitespace — the shape the STORE turns into
 *                        `unknown` (parallel-indexer.ts:3370-3371), so an empty
 *                        endpoint here is an R7 violation manufactured at the seam
 *   placeholder          a name on the DECLARED placeholder list below
 *   synthetic            a synthetic name DECLARED in an M60 register (R10's
 *                        `anonymous_impl`), which the rule permits because the
 *                        state is known — counted separately, never as "resolved"
 *   file:unique          a symbol this file declares, exactly once
 *   file:ambiguous       a symbol this file declares, 2+ times (same (owner,name)
 *                        repeats — RSD3 gives them distinct ids, so a NAME lookup
 *                        is genuinely ambiguous)
 *   dotted:both          a `A.b` endpoint whose OWNER and LEAF both resolve here
 *   dotted:ownerOnly     a `A.b` endpoint whose owner resolves and leaf does not
 *   dotted:neither       a `A.b` endpoint whose owner does not resolve
 *   modulePath           a Rust path (`crate::flags`) — an `imports` target by
 *                        construction, not a symbol name
 *   routePath            a URL (`/api/v1`) — the axum/actix route-attribute
 *                        `exports` target, which names no declaration by design
 *   use:bound            bound by THIS file's `use` list (a real binding, no
 *                        symbol — the per-file boundary, M12.44)
 *   repo:declared        declared by another file of the same repository
 *   absent               no file in the corpus declares it, no `use` binds it
 *
 * `placeholder` is the R7 class. `absent` is a resolution measurement, not an R7
 * conviction: for a per-file analyzer a target another file declares is a fact
 * this analyzer cannot see, and the report says which of the two it is.
 *
 * READ-ONLY. Writes nothing.
 *
 * Run: npx tsx script/incoming-rust/rust-r7-audit.ts [--json] [--repo=ripgrep]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ARGS = process.argv.slice(2)
const WANT_JSON = ARGS.includes("--json")
const REPO_FILTER = ARGS.find((a) => a.startsWith("--repo="))?.slice(7)

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references", "exports",
  "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/**
 * THE PLACEHOLDER LIST. Every literal on it is checked for membership; the list
 * is printed with the report so a reader can see what was looked for rather than
 * trusting the count. Sourced from the rule text (which names `unknown`),
 * the handover's R7 enumeration (`*`, `module`, `global`, `<unknown>`), the
 * analyzer's own fallback literals, and the store's own denylist
 * (`SYMBOL_NAME_DENYLIST`, parallel-indexer.ts:2582-2588).
 */
const PLACEHOLDERS = [
  "unknown", "<unknown>", "*", "module", "global", "root", "program",
  "<unnamed>", "unnamed", "anonymous", "anonymous_impl", "<anonymous>",
  "self", "Self", "this", "super", "crate", "mod", "null", "nil",
  "undefined", "none", "None", "default", "placeholder", "<placeholder>",
  "n/a", "N/A", "<none>", "?", "-", "?", "external", "External",
]

/** R10 synthetics DECLARED in the M60 registers — permitted, never counted as
 *  resolved, and reported on their own line so the count is visible. Checked
 *  BEFORE the placeholder list: a declared synthetic is a KNOWN state, and
 *  classifying it as a placeholder contradicts the register that declares it. */
const DECLARED_SYNTHETICS = new Set(["anonymous_impl"])

/** The source spelling the family DECLARES for "this module/file is the source
 *  of the edge" — `metadata.fileLevel: true` tells the store to rewrite
 *  `source_external` to the project-relative path (parallel-indexer.ts:3481), and
 *  `real-graphql-analyzer.ts` publishes exactly this string. It names no
 *  declaration and no placeholder, so it is neither an R7 violation nor a
 *  resolved symbol; it gets its own class. */
const FILE_SOURCE = "(file)"

/** Rust's own keyword vocabulary — never a declaration's name. */
const RUST_KEYWORDS = new Set([
  "as", "async", "await", "break", "const", "continue", "crate", "dyn", "else",
  "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop",
  "match", "mod", "move", "mut", "pub", "ref", "return", "self", "static",
  "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while",
  "union", "abstract", "become", "box", "do", "final", "macro", "override",
  "priv", "typeof", "unsized", "virtual", "yield", "try",
])

function isWhitespaceOnly(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c !== 32 && c !== 9 && c !== 10 && c !== 13) return false
  }
  return true
}

// ---------------------------------------------------------------- population
interface FileRow { repo: string; dir: string; rel: string; abs: string; text: string }
const files: FileRow[] = []
const reposSeen: string[] = []
for (const e of readdirSync(CR)) {
  if (REPO_FILTER && e !== REPO_FILTER) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  reposSeen.push(e)
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 2 * 1024 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "rust") continue
    files.push({ repo: e, dir, rel, abs, text })
  }
}
files.sort((a, b) => (a.repo + a.rel < b.repo + b.rel ? -1 : 1))
let totalBytes = 0
for (const f of files) totalBytes += f.text.length

// ---------------------------------------------------------------- accumulators
interface Acc {
  edges: number
  files: Set<string>
  src: Record<string, number>
  tgt: Record<string, number>
  /** endpoint name -> count, for the classes that are violations or absences */
  placeholderNames: Map<string, number>
  placeholderFiles: Map<string, number>
  emptyFiles: Map<string, number>
  absentNames: Map<string, number>
  examples: Map<string, string[]>
  conf: Map<string, number>
  confUnder07: number
  evidenceClass: Map<string, number>
  kindsOfEndpoint: Map<string, number>
  /** total ENDPOINTS, so the per-class percentage has a denominator */
  endpoints: number
}

/** The classes, in report order. Seeded into every accumulator's example map so
 *  a class that never fires reads as an empty list rather than a crash. */
const CLASS_ORDER_SEED = [
  "empty", "placeholder", "placeholder:foreign",
  "synthetic", "file:source",
  "file:unique", "file:ambiguous",
  "dotted:both", "dotted:ownerOnly", "dotted:neither",
  "modulePath", "pathRoot", "routePath", "use:bound", "repo:declared", "absent",
] as const
type Verdict = (typeof CLASS_ORDER_SEED)[number]

function newAcc(): Acc {
  const examples = new Map<string, string[]>()
  for (const v of CLASS_ORDER_SEED) examples.set(v, [])
  return {
    edges: 0, files: new Set(),
    src: {}, tgt: {},
    placeholderNames: new Map(), placeholderFiles: new Map(),
    emptyFiles: new Map(), absentNames: new Map(), examples,
    conf: new Map(), confUnder07: 0, evidenceClass: new Map(),
    kindsOfEndpoint: new Map(), endpoints: 0,
  }
}
const acc = new Map<Type, Acc>()
for (const t of ALL_TYPES) acc.set(t, newAcc())

const srcAcc = newAcc()
const tgtAcc = newAcc()

// pass 1 needs the file's own symbol table; pass 2 needs repo-wide names.
let symbolsTotal = 0
let emptySymbolNames = 0
let emptySymbolKindNames = 0
const filesWithEdge = new Set<string>()
const declSymbolNamedGlobal = new Map<string, number>()

/** One endpoint's verdict, for one file. */
/**
 * One endpoint's verdict, for one file.
 *
 * ORDER IS THE WHOLE RULE, and the first version of this function got it
 * backwards. R7 reads: "an endpoint must NAME A REAL DECLARATION, not a
 * placeholder." That is a two-part test, and the second part only means anything
 * when the first one fails. The earlier shape asked "is this name on the
 * placeholder list?" FIRST, which convicted 181 `default`, 42 `None`, 22 `none`,
 * 17 `root` and 3 `null` endpoints -- and every one of them is a real Rust
 * declaration: `impl Default for X { fn default() }`, `enum SpecValue { None,
 * .. }`, `grep::searcher::BinaryDetection::none()`, a struct field named `root`.
 * ripgrep's `ignore/src/gitignore.rs:141` declares `pub fn global()`, and that
 * made 7 endpoints read as placeholders for a function the file owns. A correct
 * number about the wrong question.
 *
 * So the order is: empty -> declared synthetic -> file-source spelling ->
 * path shapes -> RESOLUTION -> and only then the placeholder list, which can
 * now only ever fire on a name nothing in the repository declares.
 */
function classify(
  name: string,
  fx: { byName: Map<string, number>; kindsByName: Map<string, string[]>; useBound: Set<string> },
  repoNames: Set<string>,
  out: Acc,
  key: "src" | "tgt",
  label: string,
): Verdict {
  const byName = fx.byName
  const kindsByName = fx.kindsByName
  const useBound = fx.useBound
  out.endpoints++
  const bump = (v: Verdict): void => { out[key][v] = (out[key][v] ?? 0) + 1 }
  if (name.length === 0 || isWhitespaceOnly(name)) {
    bump("empty")
    out.emptyFiles.set(label, (out.emptyFiles.get(label) ?? 0) + 1)
    if (out.examples.get("empty")!.length < 6) out.examples.get("empty")!.push(`${label} EMPTY ENDPOINT`)
    return "empty"
  }
  if (name === FILE_SOURCE) {
    // The family's DECLARED spelling for "this file/module is the source of the
    // edge". `metadata.fileLevel: true` makes the store rewrite `source_external`
    // to the project-relative path (parallel-indexer.ts:3481), and
    // real-graphql-analyzer.ts:1045 publishes exactly this string. It names no
    // declaration and no placeholder, so it gets its own class: folding it into
    // `file:unique` would overstate resolution, and into `placeholder` would
    // indict a spelling six lanes already publish.
    bump("file:source")
    if (out.examples.get("file:source")!.length < 6) out.examples.get("file:source")!.push(`${label} ${name}`)
    return "file:source"
  }
  if (DECLARED_SYNTHETICS.has(name)) { bump("synthetic"); return "synthetic" }
  // A dotted endpoint is the `Type.member` shape `overrides` publishes. Judge the
  // two halves separately: a bare-name lookup of `Flag.is_switch` is a lookup of
  // a name no declaration has, which made the lane census report 1011 of 1011
  // `overrides` targets unresolvable and would repeat the error here.
  if (name.includes(".")) {
    const dot = name.indexOf(".")
    const owner = name.slice(0, dot)
    const leaf = name.slice(dot + 1)
    const ownerOk = repoNames.has(owner)
    const leafOk = repoNames.has(leaf) || byName.has(leaf)
    const v: Verdict = ownerOk && leafOk ? "dotted:both" : ownerOk ? "dotted:ownerOnly" : "dotted:neither"
    bump(v)
    if (out.examples.get(v)!.length < 6) out.examples.get(v)!.push(`${label} ${name}`)
    return v
  }
  // A Rust module path (`crate::flags`, `::libc`) -- an `imports` target by
  // construction, not a symbol name. Its LEAF decides whether the path is
  // informative: `std::io::Read` names a module, while `use super::util` splits
  // to the module `super` and `use crate::flags::Flag` to `crate::flags`, whose
  // leaves are PATH ROOTS. A keyword root is a fact about the written path; a
  // placeholder is a fact about the ANALYZER's fallback. Different classes.
  if (name.includes("::")) {
    const parts = name.split("::").filter(Boolean)
    const leaf = parts.length > 0 ? parts[parts.length - 1] : ""
    if (leaf === "super" || leaf === "crate" || leaf === "self") {
      bump("pathRoot")
      out.absentNames.set(`path-root:${leaf}`, (out.absentNames.get(`path-root:${leaf}`) ?? 0) + 1)
      if (out.examples.get("pathRoot")!.length < 6) out.examples.get("pathRoot")!.push(`${label} ${name}`)
      return "pathRoot"
    }
    bump("modulePath")
    if (out.examples.get("modulePath")!.length < 6) out.examples.get("modulePath")!.push(`${label} ${name}`)
    return "modulePath"
  }
  // A URL -- the route-attribute `exports` target. It names no declaration and no
  // analyzer can make it: the construct publishes a route, not a symbol.
  if (name.startsWith("/")) {
    bump("routePath")
    if (out.examples.get("routePath")!.length < 6) out.examples.get("routePath")!.push(`${label} ${name}`)
    return "routePath"
  }
  // RESOLUTION FIRST. Everything below this line is an endpoint NOTHING in this
  // repository declares, which is the only population over which "is this a
  // placeholder?" is a meaningful question.
  const n = byName.get(name) ?? 0
  if (n === 1) { bump("file:unique"); return "file:unique" }
  if (n > 1) {
    bump("file:ambiguous")
    const ks = [...new Set(kindsByName.get(name) ?? [])].sort().join("+")
    const k = `ambiguous(${ks})`
    out.kindsOfEndpoint.set(k, (out.kindsOfEndpoint.get(k) ?? 0) + 1)
    return "file:ambiguous"
  }
  // Past this point the file does NOT declare the name (`n` was 0 above).
  if (useBound.has(name)) { bump("use:bound"); return "use:bound" }
  const isPlaceholder = PLACEHOLDERS.includes(name)
  if (isPlaceholder) {
    // TWO CLASSES, and the difference is the whole finding.
    //
    // `global` is on the placeholder list because it is the analyzer's FALLBACK.
    // ripgrep's `ignore/src/gitignore.rs:141` declares `pub fn global()`, so a
    // `global` endpoint ON THAT FILE is a real read of a real function — it was
    // caught by `n === 1` above and never reaches here. A `global` on any other
    // file reaches here, and it is the fallback, whether or not some other file
    // in the repository happens to declare the same word. An earlier shape
    // collapsed both into `repo:declared` and reported 0 source violations while
    // 1,169 endpoints were still the fallback: one real function's name in one
    // file licensed the literal in the other 109.
    if (repoNames.has(name)) {
      bump("placeholder:foreign")
    } else {
      bump("placeholder")
    }
    out.placeholderNames.set(name, (out.placeholderNames.get(name) ?? 0) + 1)
    out.placeholderFiles.set(label, (out.placeholderFiles.get(label) ?? 0) + 1)
    if (out.examples.get("placeholder")!.length < 6) out.examples.get("placeholder")!.push(`${label} ${name}`)
    return isPlaceholder && repoNames.has(name) ? "placeholder:foreign" : "placeholder"
  }
  if (repoNames.has(name)) { bump("repo:declared"); return "repo:declared" }
  if (RUST_KEYWORDS.has(name)) {
    // Not on the placeholder list, so not an R7 class -- but a keyword as a NAME is
    // the same defect shape, and it is counted rather than assumed absent.
    bump("absent")
    out.absentNames.set(`keyword:${name}`, (out.absentNames.get(`keyword:${name}`) ?? 0) + 1)
    return "absent"
  }
  bump("absent")
  out.absentNames.set(name, (out.absentNames.get(name) ?? 0) + 1)
  if (out.examples.get("absent")!.length < 6) out.examples.get("absent")!.push(`${label} ${name}`)
  return "absent"
}

let idx = 0
const parseFailures: string[] = []
/**
 * A file's facts, captured ONCE. The classification runs after every file is in
 * hand, because `repo:declared` is a statement about the WHOLE repository and a
 * classification that ran while later files were still unparsed called 14,029
 * targets `absent` that most of them declare — a correct number about the wrong
 * population, which is the failure this instrument exists to avoid.
 */
interface Facts {
  label: string
  repo: string
  byName: Map<string, number>
  kindsByName: Map<string, string[]>
  useBound: Set<string>
  rels: Array<{ t: Type; rel: any }>
  symbols: number
}
const facts: Facts[] = []
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures.push(f.rel); continue }
    const label = `${f.repo}/${f.rel}`
    const byName = new Map<string, number>()
    const kindsByName = new Map<string, string[]>()
    const useBound = new Set<string>()
    let n = 0
    for (const s of r.symbols ?? []) {
      const nm = String(s?.name ?? "")
      if (!nm) { emptySymbolNames++; continue }
      const k = String(s?.kind ?? "")
      if (!k || k === "unknown") emptySymbolKindNames++
      if (nm === "global") declSymbolNamedGlobal.set(label, (declSymbolNamedGlobal.get(label) ?? 0) + 1)
      byName.set(nm, (byName.get(nm) ?? 0) + 1)
      const arr = kindsByName.get(nm) ?? []
      arr.push(k)
      kindsByName.set(nm, arr)
      symbolsTotal++
      n++
    }
    for (const im of r.imports ?? []) {
      for (const it of im?.items ?? []) {
        const nm = String(it ?? "")
        if (nm && !PLACEHOLDERS.includes(nm)) useBound.add(nm)
      }
      const leaf = String(im?.module ?? "").split("::").filter(Boolean).pop() ?? ""
      if (leaf && !PLACEHOLDERS.includes(leaf)) useBound.add(leaf)
    }
    const rels: Array<{ t: Type; rel: any }> = []
    for (const rel of r.relationships ?? []) {
      const t = String(rel?.type ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      rels.push({ t, rel })
      filesWithEdge.add(label)
    }
    facts.push({ label, repo: f.repo, byName, kindsByName, useBound, rels, symbols: n })
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))
facts.sort((a, b) => (a.label < b.label ? -1 : 1))

/** repo-wide declared names, built from every file BEFORE any classification. */
const repoNamesById = new Map<string, Set<string>>()
for (const fx of facts) {
  let set = repoNamesById.get(fx.repo)
  if (!set) { set = new Set(); repoNamesById.set(fx.repo, set) }
  for (const nm of fx.byName.keys()) set.add(nm)
}
function repoNamesFor(repo: string): Set<string> {
  return repoNamesById.get(repo) ?? new Set<string>()
}

// ------------------------------------------------------------------ classify
for (const fx of facts) {
  const repoNames = repoNamesFor(fx.repo)
  for (const { t, rel } of fx.rels) {
    const a = acc.get(t)!
    a.edges++
    a.files.add(fx.label)
    const src = String(rel?.source ?? "")
    const tgt = String(rel?.target ?? "")
    classify(src, fx, repoNames, a, "src", fx.label)
    classify(tgt, fx, repoNames, a, "tgt", fx.label)
    classify(src, fx, repoNames, srcAcc, "src", fx.label)
    classify(tgt, fx, repoNames, tgtAcc, "tgt", fx.label)
    const conf = typeof rel?.confidence === "number" ? String(rel.confidence) : "absent"
    a.conf.set(conf, (a.conf.get(conf) ?? 0) + 1)
    if (typeof rel?.confidence === "number" && rel.confidence < 0.7) a.confUnder07++
    const ec = String(rel?.metadata?.evidenceClass ?? "<absent>")
    a.evidenceClass.set(ec, (a.evidenceClass.get(ec) ?? 0) + 1)
  }
}

// ---------------------------------------------------------------- report
const pct = (n: number, d: number): string => (d === 0 ? "-" : `${((n / d) * 100).toFixed(1)}%`)
const top = (m: Map<string, number>, n = 10): string[] =>
  [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} x${v}`)

const CLASS_ORDER: readonly Verdict[] = [
  "empty", "placeholder", "placeholder:foreign",
  "synthetic", "file:source", "modulePath", "pathRoot", "routePath",
  "file:unique", "file:ambiguous", "dotted:both", "dotted:ownerOnly", "dotted:neither",
  "use:bound", "repo:declared", "absent",
]

function table(a: Acc, which: "src" | "tgt"): Record<string, number> {
  const o: Record<string, number> = {}
  for (const v of CLASS_ORDER) o[v] = a[which][v] ?? 0
  return o
}

const report = {
  lang: "rust",
  corpus: {
    root: CR, repos: reposSeen, files: files.length, bytes: totalBytes,
    fileList: files.map((f) => `${f.repo}/${f.rel}`),
  },
  populationNote:
    "files = every path `git ls-files` reports for the corpus repo whose detected language is rust; derived, not hand-written",
  symbols: { total: symbolsTotal, emptyNames: emptySymbolNames, emptyOrUnknownKind: emptySymbolKindNames },
  placeholderListChecked: PLACEHOLDERS,
  declaredSynthetics: [...DECLARED_SYNTHETICS],
  filesDeclaringASymbolNamedGlobal: [...declSymbolNamedGlobal.entries()],
  parseFailures,
  sourceEndpoint: { endpoints: srcAcc.endpoints, classes: table(srcAcc, "src") },
  targetEndpoint: { endpoints: tgtAcc.endpoints, classes: table(tgtAcc, "tgt") },
  fileSourceSpelling: FILE_SOURCE,
  types: Object.fromEntries(ALL_TYPES.map((t) => {
    const a = acc.get(t)!
    return [t, {
      edges: a.edges, files: a.files.size,
      sourceClasses: table(a, "src"), targetClasses: table(a, "tgt"),
      placeholderNames: Object.fromEntries(a.placeholderNames),
      placeholderFiles: Object.fromEntries(a.placeholderFiles),
      emptyEndpointFiles: Object.fromEntries(a.emptyFiles),
      topAbsentTargets: top(a.absentNames),
      ambiguityKinds: top(a.kindsOfEndpoint, 6),
      confidenceHistogram: Object.fromEntries(a.conf),
      confidenceUnder07: a.confUnder07,
      evidenceClass: Object.fromEntries(a.evidenceClass),
      examples: Object.fromEntries([...a.examples.entries()].map(([k, v]) => [k, v.slice(0, 3)])),
    }]
  })),
}

if (WANT_JSON) {
  console.log(JSON.stringify(report, null, 1))
} else {
  console.log(`R7 audit — ${files.length} files (${(totalBytes / 1024).toFixed(0)} KB) in [${reposSeen.join(", ")}]`)
  console.log(`  population: ${report.populationNote}`)
  console.log(`  symbols ${symbolsTotal} · empty symbol names ${emptySymbolNames} · empty/unknown symbol kinds ${emptySymbolKindNames} · parse failures ${parseFailures.length}`)
  console.log(`  placeholder literals checked (${PLACEHOLDERS.length}): ${PLACEHOLDERS.join(" ")}`)
  console.log(`  declared synthetics (permitted, reported separately): ${[...DECLARED_SYNTHETICS].join(" ")}`)
  if (declSymbolNamedGlobal.size > 0) {
    console.log(`  !! ${declSymbolNamedGlobal.size} corpus file(s) DECLARE a symbol literally named \`global\`, so the placeholder is not unique in this corpus:`)
    for (const [f, n] of declSymbolNamedGlobal) console.log(`       ${f} (${n} declaration${n === 1 ? "" : "s"})`)
  }
  const st = report.sourceEndpoint, tt = report.targetEndpoint
  console.log(`\nSOURCE endpoints over all types (${st.endpoints} edges):`)
  for (const v of CLASS_ORDER) if (st.classes[v]) console.log(`  ${v.padEnd(18)} ${String(st.classes[v]).padStart(7)}  ${pct(st.classes[v], st.endpoints)}`)
  console.log(`\nTARGET endpoints over all types (${tt.endpoints} edges):`)
  for (const v of CLASS_ORDER) if (tt.classes[v]) console.log(`  ${v.padEnd(18)} ${String(tt.classes[v]).padStart(7)}  ${pct(tt.classes[v], tt.endpoints)}`)
  console.log(`\n${"type".padEnd(13)}${"edges".padStart(7)}${"files".padStart(6)}${"src:ph".padStart(8)}${"src:empty".padStart(10)}${"tgt:ph".padStart(8)}${"tgt:empty".padStart(10)}${"tgt:absent".padStart(11)}`)
  console.log("-".repeat(73))
  for (const t of ALL_TYPES) {
    const r = report.types[t]
    console.log(
      t.padEnd(13) + String(r.edges).padStart(7) + String(r.files).padStart(6) +
      String(r.sourceClasses.placeholder).padStart(8) + String(r.sourceClasses.empty).padStart(10) +
      String(r.targetClasses.placeholder).padStart(8) + String(r.targetClasses.empty).padStart(10) +
      String(r.targetClasses.absent).padStart(11),
    )
  }
  console.log("-".repeat(73))
  for (const t of ALL_TYPES) {
    const r = report.types[t]
    if (r.edges === 0) { console.log(`\n${t}: 0 edges through the production path on this corpus`); continue }
    const phSrc = Object.keys(r.placeholderNames).length > 0 ? Object.keys(r.placeholderNames).filter((k) => !k.startsWith("path-leaf:")).length : 0
    console.log(`\n${t}: ${r.edges} edges / ${r.files} files`)
    console.log(`  placeholder endpoints: source ${r.sourceClasses.placeholder} · target ${r.targetClasses.placeholder}` +
      (phSrc || r.targetClasses.placeholder ? ` — names ${top(new Map(Object.entries(r.placeholderNames)), 6).join(", ") || "-"}` : ""))
    if (Object.keys(r.placeholderFiles).length > 0) {
      console.log(`  files carrying a placeholder endpoint: ${Object.keys(r.placeholderFiles).length} — ${Object.keys(r.placeholderFiles).slice(0, 6).join(", ")}`)
    }
    console.log(`  empty endpoints: source ${r.sourceClasses.empty} · target ${r.targetClasses.empty}`)
    console.log(`  target classes: ${CLASS_ORDER.filter((v) => r.targetClasses[v]).map((v) => `${v} ${r.targetClasses[v]}`).join(" · ")}`)
    console.log(`  confidence: ${JSON.stringify(r.confidenceHistogram)} (under 0.7: ${r.confidenceUnder07}) · evidenceClass: ${JSON.stringify(r.evidenceClass)}`)
    if (r.topAbsentTargets.length) console.log(`  top absent targets: ${r.topAbsentTargets.join(", ")}`)
    for (const [k, v] of Object.entries(r.examples)) console.log(`  ${k}: ${(v as string[]).join(" | ")}`)
  }
}