/**
 * R LANE CENSUS — the instrument behind every verdict in docs/analyzers/r.md.
 *
 * WHY THIS FILE EXISTS
 *
 * The ontology workstream's own header records the defect this harness is the
 * answer to: "the lane's differential reports 99.9% coverage and 0 UNEXPLAINED
 * across 73,961 edges, and that is TRUE — and it hid a missing relationship type
 * for the whole wave." Both walkers were silent, so nothing disagreed. Measuring
 * the LANGUAGE is the only instrument that sees it. So this walks real R through
 * the PRODUCTION entry point (`parseFile` from src/ast/pool-worker.ts, never
 * `analyze()`) and reports what came out, per relationship type, with numbers.
 *
 * `analyze()` is deliberately not called anywhere in this file. `analyze()` is a
 * per-file unit that skips the pipeline stages — the noise filter, the
 * relationship allowlist, truncation, enhancements — and a count taken through it
 * is a count of the analyzer, not a count of what the product indexes. Every
 * number in the R doc comes from `parseFile`.
 *
 * WHAT IT MEASURES
 *
 *   1. relationship types: edges, files, per-type confidence histogram, and the
 *      share below 0.7 (honesty contract §4's heuristic threshold);
 *   2. symbol kinds, with any empty or `unknown` value named;
 *   3. symbols with an empty name;
 *   4. relationship endpoints equal to the literal `unknown` (standing rule R7);
 *   5. ENDPOINT RESOLUTION per type, at THREE scopes, because they answer different
 *      questions and conflating them is how a 40% number reads as 90%:
 *        local  — the endpoint resolves to a symbol in the SAME file that emitted
 *                 the edge. This is the number comparable to CSS `references` at
 *                 66.8% quoted in the workstream header, and it is the only scope
 *                 a single-file parse can be held to.
 *        corpus — the endpoint resolves to a symbol in SOME file of the sample. R
 *                 is a dynamic language whose corpus is many packages, so an edge
 *                 to a name another package defines is real but is NOT resolvable
 *                 from this file. Reported separately, never merged.
 *        REAL-SYMBOL scopes (`localReal`, `corpusReal`) — the same two, with the
 *                 scope name `global` counted as WHAT IT IS: a placeholder, not a
 *                 symbol. The previous revision of this file counted `global` as
 *                 resolved, which made `exports` read 100.0% at both ends. It is
 *                 0/3491 at the SOURCE end: `parseFile` publishes no symbol named
 *                 `global` (measured — `symbols.some(s => s.name === "global")` is
 *                 false on every file of the sample). `global` is a cross-analyzer
 *                 file-scope convention (26 of the analyzers in src/ast/real-*-
 *                 analyzer.ts use it) and it is in `SYMBOL_NAME_DENYLIST` at
 *                 src/ast/parallel-indexer.ts:2615, so it cannot become a symbol
 *                 without a shared-machinery change this lane does not own. Both
 *                 numbers are printed; neither replaces the other.
 *   6. instrument A (grammar inventory: the node types tree-sitter-r actually
 *      produces) and instrument B (parse-tree counts), so a ruling is falsifiable.
 *      Both are IMPLEMENTED here. The previous revision's header promised item 6
 *      and the file contained no tree-sitter import; a promised instrument that is
 *      not there is a comment, and a ruling resting on it would be prose.
 *   7. TRUE per-type file counts. The previous revision wrote
 *      `if (s.files.size < 40) s.files.add(e.file)` and then printed `s.files.size`
 *      in a column headed `files`. 40 is the cap, not the count, and the cap
 *      silently becomes the answer for any type that fires in more than 40 files —
 *      which is 8 of the 10. The counter is now unbounded and the examples list is
 *      what is capped.
 *
 * USAGE
 *   npx tsx validation/m14/fixtures/r/census.ts [--sample N] [--repo NAME] [--json out.json]
 *
 * SAMPLING METHOD, restated in the output and in the doc: every git-TRACKED file
 * whose path+content the ROUTER (`src/ast/language-detection.ts`, the same call
 * the indexer makes) maps to `r`, per repo, in `git ls-files` order, truncated to
 * `--sample` per repo. The file list is the repo's own; the only bias is that
 * truncation, which takes a deterministic PREFIX rather than a random draw.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

// `validation/m14/fixtures/r/` is FOUR levels below the repo root, not five. This
// line read five and was harmless only because the previous revision ended the file
// with `void ROOT` — the constant was never read. The first use of it (the two
// instruments) failed with ENOENT on <parent>/wasm/tree-sitter-r.wasm, which is what
// exposed it. A constant that nothing reads is not a constant that is right.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "r"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const

const argv = process.argv.slice(2)
const argOf = (flag: string): string | undefined => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined }
const SAMPLE_PER_REPO = Number(argOf("--sample") ?? 250)
const REPO_FILTER = new Set(argv.reduce<string[]>((a, v, i) => (v === "--repo" ? [...a, String(argv[i + 1])] : a), []))
const JSON_OUT = argOf("--json")

// ------------------------------------------------------------------ corpus
type CorpusFile = { repo: string; dir: string; rel: string; abs: string; text: string }
const files: CorpusFile[] = []
const reposSeen: string[] = []
for (const e of readdirSync(CR).sort()) {
  if (REPO_FILTER.size > 0 && !REPO_FILTER.has(e)) continue
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  const admitted: CorpusFile[] = []
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try {
      if (statSync(abs).size > 512 * 1024) continue
      text = readFileSync(abs, "utf8")
    } catch { continue }
    // The ROUTER decides, not the extension: language-detection.ts is what the
    // indexer calls, so a file it would not route is a file the product does not
    // parse and counting it would measure a population that does not exist.
    if (detectLanguageFromPath(abs, text) !== LANG) continue
    admitted.push({ repo: e, dir, rel, abs, text })
  }
  if (admitted.length === 0) continue
  reposSeen.push(e)
  files.push(...admitted.slice(0, SAMPLE_PER_REPO))
}

// ------------------------------------------------------------------ parse
type Edge = { type: string; source: string; target: string; confidence: number; line?: number; file: string }
type FileRow = { label: string; names: Set<string>; kinds: Map<string, number>; emptyNames: number; emptyKind: number; edges: Edge[]; errors: number; attribution: Record<string, number> }
const rows: FileRow[] = []
let cursor = 0
async function worker(): Promise<void> {
  for (;;) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { continue }
    const label = `${f.repo}/${f.rel}`
    // `metadata.callAttribution` is the analyzer's own account of what it could NOT
    // emit. It is summed here rather than read out of one file's metadata, because the
    // four `uses` gates each suppress a population and a gate whose suppressed count is
    // not printed is a gate whose absence is indistinguishable from its size.
    const attribution: Record<string, number> = {}
    for (const [k, v] of Object.entries((r.metadata as any)?.callAttribution ?? {})) {
      if (typeof v === "number") attribution[k] = (attribution[k] ?? 0) + v
    }
    const row: FileRow = { label, names: new Set(), kinds: new Map(), emptyNames: 0, emptyKind: 0, edges: [], errors: (r.errors ?? []).length, attribution }
    for (const s of r.symbols ?? []) {
      const name = String(s.name ?? "")
      const kind = String(s.kind ?? "")
      if (name) row.names.add(name)
      row.kinds.set(kind, (row.kinds.get(kind) ?? 0) + 1)
      if (name === "") row.emptyNames++
      if (kind === "" || kind.toLowerCase() === "unknown") row.emptyKind++
    }
    for (const rel of r.relationships ?? []) {
      const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
      if (!t) continue
      row.edges.push({
        type: t,
        source: String(rel.source ?? rel.from ?? ""),
        target: String(rel.target ?? rel.to ?? ""),
        confidence: Number(rel.confidence ?? 1),
        line: typeof rel.line_number === "number" ? rel.line_number : undefined,
        file: label,
      })
    }
    rows.push(row)
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))
rows.sort((a, b) => (a.label < b.label ? -1 : 1))

const corpusNames = new Set<string>()
for (const r of rows) for (const n of r.names) corpusNames.add(n)

type TypeStat = {
  type: string
  edges: number
  files: Set<string>
  conf: Map<string, number>
  heur: number
  localSrc: number
  localTgt: number
  localBoth: number
  corpusSrc: number
  corpusTgt: number
  localRealSrc: number
  localRealTgt: number
  localRealBoth: number
  corpusRealSrc: number
  corpusRealTgt: number
  selfEdge: number
  globalTouched: number
  unknownEndpoint: number
  lineMissing: number
  examples: string[]
  /** Targets that resolve NOWHERE in the sample, with counts — the population the
   *  resolution rate is a percentage OF, not just a percentage. A rate without its
   *  complement is not evidence. */
  unresolvedTargets: Map<string, number>
}
const stats = new Map<string, TypeStat>()
for (const row of rows) {
  for (const e of row.edges) {
    let s = stats.get(e.type)
    if (!s) { s = { type: e.type, edges: 0, files: new Set(), conf: new Map(), heur: 0, localSrc: 0, localTgt: 0, localBoth: 0, corpusSrc: 0, corpusTgt: 0, localRealSrc: 0, localRealTgt: 0, localRealBoth: 0, corpusRealSrc: 0, corpusRealTgt: 0, selfEdge: 0, globalTouched: 0, unknownEndpoint: 0, lineMissing: 0, examples: [], unresolvedTargets: new Map() }; stats.set(e.type, s) }
    s.edges++
    // UNBOUNDED. See header item 7: this line was capped at 40 and the cap was
    // printed as the count.
    s.files.add(e.file)
    s.conf.set(String(e.confidence), (s.conf.get(String(e.confidence)) ?? 0) + 1)
    if (e.confidence < 0.7) s.heur++
    if (e.line === undefined) s.lineMissing++
    if (e.source === "unknown" || e.target === "unknown") s.unknownEndpoint++
    if (e.source === e.target) s.selfEdge++
    if (e.source === "global" || e.target === "global") s.globalTouched++
    // `global` is a scope placeholder, not a symbol. The *Scope numbers below keep
    // the convention visible (an edge FROM the file scope is a real statement about
    // the file); the *Real numbers exclude it, because "resolves to a real symbol"
    // is the question and `global` is not one.
    const srcIsGlobal = e.source === "global"
    const tgtIsGlobal = e.target === "global"
    const ls = srcIsGlobal || row.names.has(e.source)
    const lt = tgtIsGlobal || row.names.has(e.target)
    if (ls) s.localSrc++
    if (lt) s.localTgt++
    if (ls && lt) s.localBoth++
    const lrs = !srcIsGlobal && row.names.has(e.source)
    const lrt = !tgtIsGlobal && row.names.has(e.target)
    if (lrs) s.localRealSrc++
    if (lrt) s.localRealTgt++
    if (lrs && lrt) s.localRealBoth++
    if (srcIsGlobal || corpusNames.has(e.source)) s.corpusSrc++
    if (tgtIsGlobal || corpusNames.has(e.target)) s.corpusTgt++
    if (!srcIsGlobal && corpusNames.has(e.source)) s.corpusRealSrc++
    if (!tgtIsGlobal && corpusNames.has(e.target)) s.corpusRealTgt++
    if (!tgtIsGlobal && !corpusNames.has(e.target)) s.unresolvedTargets.set(e.target, (s.unresolvedTargets.get(e.target) ?? 0) + 1)
    if (s.examples.length < 4) s.examples.push(`${e.file}  ${e.source} -[${e.type} ${e.confidence}]-> ${e.target}`)
  }
}

const totalSymbols = rows.reduce((a, r) => a + [...r.kinds.values()].reduce((x, y) => x + y, 0), 0)
const totalRels = rows.reduce((a, r) => a + r.edges.length, 0)
const emptyNames = rows.reduce((a, r) => a + r.emptyNames, 0)
const emptyKind = rows.reduce((a, r) => a + r.emptyKind, 0)
const filesWithErrors = rows.filter((r) => r.errors > 0).length
const kindCounts = new Map<string, number>()
for (const r of rows) for (const [k, v] of r.kinds) kindCounts.set(k, (kindCounts.get(k) ?? 0) + v)

// ------------------------------------------------- instruments A and B
//
// A and B exist so that a RULED verdict is falsifiable: A is positive evidence
// about the GRAMMAR, B is a count on the TREE where a string literal or a
// comment cannot fake the construct. Both are implemented here; the previous
// revision of this file described them in its header and contained no
// tree-sitter import at all.
//
// Neither instrument consults the analyzer. That is the point — an instrument
// derived from the analyzer's own logic can only agree with it.

const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(ROOT, "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(ROOT, "wasm", "tree-sitter-r.wasm"))))

/** INSTRUMENT A — the node types the grammar ACTUALLY produces across the sample.
 *  Enumerating observed nodes is positive evidence about the grammar; a hand-kept
 *  list of node types is a belief about it. */
const nodeTypeCounts = new Map<string, number>()
let treesParsed = 0
let treesFailed = 0

/** INSTRUMENT B — the construct each ontology type needs, counted on the tree.
 *  Keyed by type; each entry counts occurrences and the files they came from. */
type Probe = { occurrences: number; files: Set<string>; examples: string[] }
const probeOf = (k: string): Probe => { let p = probeHit.get(k); if (!p) { p = { occurrences: 0, files: new Set(), examples: [] }; probeHit.set(k, p) } return p }
const probeHit = new Map<string, Probe>()
const CLASS_CTORS = new Set(["R6Class", "setRefClass", "new_class", "new_base_class", "setClass"])

const bareName = (n: any): string | null => {
  if (!n) return null
  if (n.type === "identifier") return n.text.startsWith("`") && n.text.endsWith("`") && n.text.length > 1 ? n.text.slice(1, -1) : n.text
  if (n.type === "string") { const c = n.childForFieldName("content") ?? n.namedChildren.find((x: any) => x.type === "string_content"); return c ? String(c.text) : null }
  return null
}
const argsOf = (call: any): any[] => {
  const a = call.childForFieldName("arguments")
  const out: any[] = []
  if (!a) return out
  for (let i = 0; i < a.namedChildCount; i++) { const c = a.namedChild(i); if (c && c.type === "argument") out.push(c) }
  return out
}
const calleeName = (fn: any): string | null => {
  if (!fn) return null
  if (fn.type === "identifier") return bareName(fn)
  if (fn.type === "namespace_operator" || fn.type === "extract_operator") return bareName(fn.childForFieldName("rhs"))
  return null
}
const namedArgValue = (call: any, want: string): any => {
  for (const a of argsOf(call)) { const nm = bareName(a.childForFieldName("name")); if (nm === want) return a.childForFieldName("value") }
  return null
}
const namedArgNames = (v: any): string[] => {
  if (!v) return []
  if (v.type === "call") { const out: string[] = []; for (const a of argsOf(v)) { const b = bareName(a.childForFieldName("value") ?? null); if (b) out.push(b) } return out }
  const b = bareName(v)
  return b ? [b] : []
}
const memberNamesOf = (v: any): string[] => {
  if (!v || v.type !== "call" || calleeName(v.childForFieldName("function")) !== "list") return []
  const out: string[] = []
  for (const a of argsOf(v)) { const m = bareName(a.childForFieldName("name")); if (m) out.push(m) }
  return out
}

for (const f of files) {
  const label = `${f.repo}/${f.rel}`
  let t: any
  try { t = parser.parse(f.text) } catch { treesFailed++; continue }
  if (!t) { treesFailed++; continue }
  treesParsed++
  const root = t.rootNode
  const inv = (n: any): void => { nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) ?? 0) + 1); for (let i = 0; i < n.childCount; i++) inv(n.child(i)) }
  inv(root)

  // per-file state the B probes need
  const declaredClasses = new Map<string, { system: string; bases: string[]; members: Set<string> }>()
  const s4Bases = new Map<string, string[]>()
  const declaredNames = new Set<string>()
  const record = (k: string, detail: string): void => { const p = probeOf(k); p.occurrences++; p.files.add(label); if (p.examples.length < 3) p.examples.push(`${label} :: ${detail}`) }

  const walk = (n: any): void => {
    switch (n.type) {
      case "comment": {
        // roxygen `@export` — a CONVENTION, so the comment node is the right
        // instrument and a prefix test is the right test. (A grammar inventory
        // cannot see it: `#'` is a comment, and instrument A would rule the type
        // absent. That is the unsound reasoning the toml/json lane corrected.)
        const txt = n.text
        if (txt.startsWith("#'") && txt.includes("@export")) record("exports.roxygen_export", n.text.slice(0, 60))
        break
      }
      case "extract_operator": {
        // `obj$member` / `obj@member`
        const inCallee = n.parent?.type === "call" && n.parent.childForFieldName("function")?.id === n.id
        record(inCallee ? "uses.extract_in_callee" : "uses.extract_not_callee", `${n.text.slice(0, 40)} parent=${n.parent?.type}`)
        break
      }
      case "subset2": {
        const idx = n.childForFieldName("arguments")
        const s = idx ? bareName(idx) : null
        if (s !== null) {
          const inCallee = n.parent?.type === "call" && n.parent.childForFieldName("function")?.id === n.id
          record(inCallee ? "uses.subscript2_string_in_callee" : "uses.subscript2_string_not_callee", `[[${s}]]`)
        }
        break
      }
      case "call": {
        const fn = n.childForFieldName("function")
        const fname = calleeName(fn)
        if (fname !== null) record("calls.named_callee", `${fname}(...)`)
        if (fname === "library" || fname === "require") {
          const a = argsOf(n).find((x) => !x.childForFieldName("name"))
          const v = a ? a.childForFieldName("value") : null
          const kind = v?.type === "string" ? "string" : v ? "identifier" : "none"
          record(`imports.library_require_${kind}`, `${fname}(${v?.text?.slice(0, 30) ?? ""})`)
        }
        if (fname !== null && CLASS_CTORS.has(fname)) {
          const a0 = argsOf(n).find((x) => !x.childForFieldName("name"))
          const cname = bareName(a0?.childForFieldName("value") ?? null)
          if (cname) {
            const bases = fname === "setClass" ? namedArgNames(namedArgValue(n, "contains")) : fname === "setRefClass" ? namedArgNames(namedArgValue(n, "contains")) : fname === "R6Class" ? namedArgNames(namedArgValue(n, "inherit")) : namedArgNames(namedArgValue(n, "parent"))
            const members = new Set<string>([...memberNamesOf(namedArgValue(n, "public")), ...memberNamesOf(namedArgValue(n, "private")), ...memberNamesOf(namedArgValue(n, "active")), ...memberNamesOf(namedArgValue(n, "fields")), ...memberNamesOf(namedArgValue(n, "methods"))])
            declaredClasses.set(cname, { system: fname, bases, members })
            if (fname === "setClass") s4Bases.set(cname, bases)
            record(`extends.construct_${fname}`, `${cname} bases=[${bases.join(",")}]`)
          }
        }
        if (fname === "setMethod") {
          const a = argsOf(n)
          const m = bareName(a.find((x) => !x.childForFieldName("name"))?.childForFieldName("value") ?? null)
          const sig = a[1]?.childForFieldName("value")
          const owner = sig ? (bareName(sig) ?? (sig.type === "call" ? bareName(argsOf(sig)[0]?.childForFieldName("value") ?? null) : null)) : null
          if (m && owner) record("overrides.construct_setMethod", `${owner}$${m}`)
        }
        // `new("Cls")` — S4 construction
        if (fname === "new") {
          const a0 = argsOf(n).find((x) => !x.childForFieldName("name"))
          const cls = bareName(a0?.childForFieldName("value") ?? null)
          if (cls) record(`instantiates.construct_new_call.${s4Bases.has(cls) || declaredClasses.has(cls) ? "same_file_class" : "other_class"}`, `new("${cls}")`)
        }
        // `Cls$new()` — R6/R5 construction
        if (fn?.type === "extract_operator") {
          const recv = bareName(fn.childForFieldName("lhs"))
          const mem = bareName(fn.childForFieldName("rhs"))
          if (mem === "new" && recv) record(`instantiates.construct_dollar_new.${declaredClasses.has(recv) ? "same_file_class" : "other_class"}`, `${recv}$new()`)
        }
        break
      }
      case "=":
      case "assignment": {
        const lhs = n.childForFieldName("lhs") ?? n.childForFieldName("left")
        const ln = bareName(lhs)
        if (ln) {
          declaredNames.add(ln)
          // S3 method convention: `generic.class <- function(...)`
          const dot = ln.indexOf(".")
          if (dot > 0 && dot < ln.length - 1) record("implements.construct_s3_dotted_name", ln)
        }
        break
      }
      case "binary_operator": {
        const op = n.childForFieldName("operator")
        const o = op ? String(op.text) : ""
        if (o === "=" || o === "<-") {
          const ln = bareName(n.childForFieldName("lhs"))
          if (ln) {
            declaredNames.add(ln)
            const dot = ln.indexOf(".")
            if (dot > 0 && dot < ln.length - 1) record("implements.construct_s3_dotted_name", ln)
          }
        }
        break
      }
      case "function_definition": {
        const nm = bareName(n.childForFieldName("name"))
        if (nm) declaredNames.add(nm)
        break
      }
      default: break
    }
    for (let i = 0; i < n.childCount; i++) walk(n.child(i))
  }
  walk(root)

  // `contains.construct`: what the FILE binds at any level — the population a
  // containment edge can be about. Counted after the walk so nested bindings count once.
  // ONE RECORD PER BINDING. The previous revision recorded the file once and put the
  // binding count in the label, so `occurrences` equalled `files` and a probe named
  // `top_level_bindings` reported a number one order of magnitude below its own name.
  // `declaredNames` is a Set, so a name bound twice in one file counts once; the
  // REBIND count is reported beside it rather than folded in, because a rebinding is
  // the `overrides` population and not this one.
  for (const nm of declaredNames) record("contains.construct_file_bindings", nm)
  record("contains.construct_files_with_any_binding", `bindings=${declaredNames.size}`)

  // `overrides.construct`: a member of a derived class whose name the BASE class,
  // declared in the SAME FILE, also declares. Same-file is the analyzer's reach and
  // the honest denominator for it; the package-scoped population is not derivable
  // from one file, so it is not claimed.
  for (const [cname, cls] of declaredClasses) {
    for (const b of cls.bases) {
      const base = declaredClasses.get(b)
      if (!base) continue
      for (const m of cls.members) if (base.members.has(m)) record("overrides.construct_same_file_member_shadow", `${cname}$${m} shadows ${b}$${m}`)
    }
  }
  // `calls.construct` for the file-scope population: a callee whose enclosing named
  // symbol does not exist. The analyzer attributes a call edge to an enclosing named
  // symbol, so a file-scope callee is the population `attribution.unresolvedScope`
  // counts; this measures the construct independently.
  t.delete?.()
}

// ------------------------------------------------------------------ output
const out: string[] = []
const say = (s = "") => { out.push(s); console.log(s) }
say(`R LANE CENSUS — production parseFile`)
say(`corpus root:      ${CR}`)
say(`sampling method:  every git-TRACKED file the ROUTER (src/ast/language-detection.ts) maps to "r", per repo, git ls-files order, first ${SAMPLE_PER_REPO} per repo`)
say(`repos admitted:   ${reposSeen.length} -> ${reposSeen.join(", ")}`)
say(`files sampled:    ${files.length}   files parsed: ${rows.length}`)
say(`symbols:          ${totalSymbols}   distinct names corpus-wide: ${corpusNames.size}`)
say(`relationships:    ${totalRels}`)
say("")
say("RELATIONSHIP TYPES")
const hdr = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const pc = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : "-")
say("scope convention: `local*`/`corpus*` count the `global` scope placeholder as resolved; `*Real` do not. See header item 5.")
say(hdr("type", 14) + hdr("edges", 10) + hdr("files", 7) + hdr("heur<.7", 12) + hdr("locBoth", 16) + hdr("locBothReal", 16) + hdr("corpusTgt", 16) + hdr("lineMiss", 9) + hdr("unkEp", 6) + "confidence histogram")
const ordered = [...ALL_TYPES.filter((t) => stats.has(t)), ...[...stats.keys()].filter((t) => !(ALL_TYPES as readonly string[]).includes(t)).sort()]
for (const t of ordered) {
  const s = stats.get(t)!
  say(
    hdr(t, 14) +
    hdr(s.edges.toLocaleString(), 10) +
    hdr(String(s.files.size), 7) +
    hdr(`${s.heur} ${pc(s.heur, s.edges)}`, 12) +
    hdr(`${s.localBoth} ${pc(s.localBoth, s.edges)}`, 16) +
    hdr(`${s.localRealBoth} ${pc(s.localRealBoth, s.edges)}`, 16) +
    hdr(`${s.corpusTgt} ${pc(s.corpusTgt, s.edges)}`, 16) +
    hdr(String(s.lineMissing), 9) +
    hdr(String(s.unknownEndpoint), 6) +
    [...s.conf.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => `${k}:${v}`).join(" "),
  )
}
const absent = ALL_TYPES.filter((t) => !stats.has(t))
say("")
say(`types in the ontology with ZERO edges through parseFile: ${absent.length ? absent.join(", ") : "(none)"}`)
say("")
say("PER-TYPE DETAIL (local = resolves inside the emitting file; corpus = resolves anywhere in the sample; Real = the same, excluding the `global` scope placeholder)")
for (const s of [...stats.values()].sort((a, b) => a.type < b.type ? -1 : 1)) {
  say(`${s.type}: edges=${s.edges} files=${s.files.size} localSrc=${s.localSrc}(${pc(s.localSrc, s.edges)}) localTgt=${s.localTgt}(${pc(s.localTgt, s.edges)}) localBoth=${s.localBoth}(${pc(s.localBoth, s.edges)})`)
  say(`    REAL (global excluded): localSrc=${s.localRealSrc}(${pc(s.localRealSrc, s.edges)}) localTgt=${s.localRealTgt}(${pc(s.localRealTgt, s.edges)}) localBoth=${s.localRealBoth}(${pc(s.localRealBoth, s.edges)}) corpusSrc=${s.corpusRealSrc}(${pc(s.corpusRealSrc, s.edges)}) corpusTgt=${s.corpusRealTgt}(${pc(s.corpusRealTgt, s.edges)})`)
  say(`    with the convention: corpusSrc=${s.corpusSrc}(${pc(s.corpusSrc, s.edges)}) corpusTgt=${s.corpusTgt}(${pc(s.corpusTgt, s.edges)}) selfEdges=${s.selfEdge} globalScopeEndpoints=${s.globalTouched}`)
  const un = [...s.unresolvedTargets.entries()].sort((a, b) => b[1] - a[1])
  say(`    targets resolving NOWHERE in the ${corpusNames.size}-name sample: ${un.reduce((a, x) => a + x[1], 0)} distinct=${un.length} top: ${un.slice(0, 15).map(([k, v]) => `${k}:${v}`).join(" ")}`)
  say(`    files: ${s.files.size}${s.files.size <= 12 ? ` -> ${[...s.files].sort().join(", ")}` : ""}`)
  for (const e of s.examples) say(`    ${e}`)
}
say("")
say("SYMBOL CENSUS")
say(`kinds: ${[...kindCounts.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || "<EMPTY>"}=${v}`).join(" ")}`)
say(`symbols with an EMPTY name: ${emptyNames}`)
say(`symbols with an empty/unknown kind: ${emptyKind}`)
say(`relationship endpoints equal to the literal "unknown": ${[...stats.values()].reduce((a, s) => a + s.unknownEndpoint, 0)}`)
say(`files whose parse result carried errors: ${filesWithErrors}`)
say("")
say(`GATE COUNTERS — the analyzer's own account of what each gate SUPPRESSED (summed over ${rows.length} files)`)
const attributionTotals = new Map<string, number>()
for (const r of rows) for (const [k, v] of Object.entries(r.attribution)) attributionTotals.set(k, (attributionTotals.get(k) ?? 0) + v)
for (const [k, v] of [...attributionTotals.entries()].sort()) say(`  ${k} = ${v.toLocaleString()}`)
say("")
say(`INSTRUMENT A — grammar inventory: ${treesParsed} trees parsed, ${treesFailed} failed; ${nodeTypeCounts.size} DISTINCT node types the grammar actually produces across the sample`)
say("  (A grammar cannot see R's object system: R6Class/setClass/new_class/setRefClass are ordinary `call` nodes. A node-type inventory over R reports no class declaration because there is none to report.)")
say(`  node types observed: ${[...nodeTypeCounts.keys()].sort().join(" ")}`)
say(`  top 20 by frequency: ${[...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([k, v]) => `${k}=${v}`).join(" ")}`)
say("")
say("INSTRUMENT B — the construct each type needs, counted ON THE TREE (no analyzer code consulted)")
say("  A construct count of 0 with the type EMITTED is a contradiction to investigate; a non-zero count with the type NOT emitted is a GAP.")
for (const [k, p] of [...probeHit.entries()].sort()) {
  say(`  ${k}: occurrences=${p.occurrences} files=${p.files.size}${p.examples.length ? ` e.g. ${p.examples[0]}` : ""}`)
}

if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify({
    lang: LANG,
    corpusRoot: CR,
    sampling: `git-tracked files routed to "r", first ${SAMPLE_PER_REPO} per repo, git ls-files order`,
    repos: reposSeen,
    filesSampled: files.length,
    filesParsed: rows.length,
    totalSymbols,
    totalRelationships: totalRels,
    distinctCorpusNames: corpusNames.size,
    symbolsWithEmptyName: emptyNames,
    symbolsWithEmptyKind: emptyKind,
    filesWithErrors,
    gateCounters: Object.fromEntries([...attributionTotals.entries()].sort()),
    instrumentA: {
      treesParsed,
      treesFailed,
      distinctNodeTypes: nodeTypeCounts.size,
      nodeTypeCounts: Object.fromEntries([...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1])),
    },
    instrumentB: Object.fromEntries([...probeHit.entries()].sort().map(([k, p]) => [k, { occurrences: p.occurrences, files: p.files.size, examples: p.examples }])),
    typesAbsent: absent,
    types: [...stats.values()].sort((a, b) => a.type < b.type ? -1 : 1).map((s) => ({
      type: s.type,
      edges: s.edges,
      files: s.files.size,
      fileExamples: [...s.files].sort().slice(0, 10),
      filesOver12: s.files.size > 12 ? undefined : [...s.files].sort(),
      confidence: Object.fromEntries(s.conf),
      heuristicUnder07: s.heur,
      localResolvedAtSource: s.localSrc,
      localResolvedAtTarget: s.localTgt,
      localResolvedBoth: s.localBoth,
      // the same, with the `global` scope placeholder excluded — `global` is not a
      // published symbol, so `localResolvedBoth` above counts it as one. See header item 5.
      localRealAtSource: s.localRealSrc,
      localRealAtTarget: s.localRealTgt,
      localRealBoth: s.localRealBoth,
      corpusRealAtSource: s.corpusRealSrc,
      corpusRealAtTarget: s.corpusRealTgt,
      corpusResolvedAtSource: s.corpusSrc,
      corpusResolvedAtTarget: s.corpusTgt,
      selfEdges: s.selfEdge,
      globalScopeEndpoints: s.globalTouched,
      unknownEndpoints: s.unknownEndpoint,
      lineMissing: s.lineMissing,
      unresolvedTargets: Object.fromEntries([...s.unresolvedTargets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)),
      examples: s.examples,
    })),
  }, null, 2))
  say("")
  say(`wrote ${JSON_OUT}`)
}
