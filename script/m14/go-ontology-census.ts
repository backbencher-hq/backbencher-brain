/**
 * GO ONTOLOGY CENSUS — the go lane's instrument for the relationship-type
 * workstream (docs/analyzers/ONTOLOGY-WORKSTREAM.md).
 *
 * LANE-OWNED, like `script/m14/ruby-truth.ts`, and it does not import
 * `differential.ts`: that file runs a corpus sweep on import, and it is
 * MASTER-owned. This one drives the PRODUCTION entry (`parseFile` from
 * `src/ast/pool-worker`) and computes its own numbers. It writes nothing
 * outside `--out`.
 *
 * WHAT IT MEASURES, and the three instruments, because one cannot answer all
 * of it. The ontology gate's own rule applies: a text regex is the WRONG
 * instrument for "does this language have this construct".
 *
 *   A. PRODUCTION EMISSION (parseFile) — Part 1 q2 "fires". A branch that
 *      never matches is dead code and source derivation cannot see it, so the
 *      count that decides EMITTED-vs-RULED comes from the production path or
 *      it does not count. Also q5 "resolved" and q6 "confident", scored per
 *      edge, and the R7 endpoint checks.
 *
 *   B. GRAMMAR INVENTORY — every node type the pinned wasm actually produces
 *      across the drawn corpus. Positive evidence of absence for a type that
 *      needs a node the language does not have.
 *
 *   C. PARSE-TREE CONSTRUCT COUNT — for a type the language expresses through a
 *      CONVENTION rather than a keyword. Go has no `export` node: exported-ness
 *      is "the first character of the name is an upper-case letter". Go has no
 *      `override` node: shadowing is depth-0 selection winning over depth-1
 *      promotion. A grammar inventory is blind to a convention BY CONSTRUCTION,
 *      which is exactly how the `exports` ruling for json was overturned.
 *
 * WHY SHARDING, measured rather than assumed: go-stdlib admits 11,800 tracked
 * `*.go` files and one worker pass emits ~1.6M edges; holding them plus the
 * tree index needs more than the 4 GB this machine had free at the time of the
 * run. A shard writes only counters and BOUNDED sample lists, so shards sum
 * exactly and `--merge` is a sum, not a union-of-large-sets.
 *
 * USAGE
 *   npx tsx script/m14/go-ontology-census.ts --out census.json [--shard=i/n]
 *   npx tsx script/m14/go-ontology-census.ts --merge a.json b.json ... --out census.json
 *   npx tsx script/m14/go-ontology-census.ts --mode=crossfile --out cross.json
 *
 * `--mode=crossfile` runs the probes that need more than one file (a promoted
 * method declared in a SIBLING file of the same package; an embed of an
 * EXTERNAL type). They measure what the PER-FILE analyzer structurally cannot
 * see, which is a scope statement about the analyzer, not a verdict about the
 * language, so they are reported apart from the per-file verdicts.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]
const SAMPLE_CAP = 6

function argOf(flag: string, dflt?: string): string | undefined {
  const i = process.argv.indexOf(flag)
  if (i !== -1 && i + 1 < process.argv.length) return process.argv[i + 1]
  const j = process.argv.find((a) => a.startsWith(`${flag}=`))
  return j ? j.slice(flag.length + 1) : dflt
}
const REPOS = (argOf("--repo", "go-stdlib,cobra") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const OUT = argOf("--out")
const MODE = argOf("--mode", "emit")
const IS_MERGE = process.argv.includes("--merge")
const MAX_BYTES = 512 * 1024
/** Files to leave out, one `repo/rel` per line. NOT a convenience: the engine
 *  arms a 120 s wall-clock self-destruct around `parser.parse()` and calls
 *  `process.exit` when it fires, so ONE hanging file ends the whole shard and
 *  every file after it in that shard goes unmeasured. Measured on this corpus:
 *  4 files take the pinned wasm past that budget (`go/types/named_test.go`,
 *  `go/types/range.go`, `syscall/ztypes_openbsd_arm.go`,
 *  `test/fixedbugs/issue33062.go`), and two of them also report
 *  `memory access out of bounds` first. They are named here rather than
 *  silently dropped, and their count is reported in the artifact. */
const SKIP = new Set(
  (process.env.BB_GO_SKIP ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
)

/** A shard's JSON is counters + bounded samples only, so merging is addition. */
type Counter = Record<string, number>
type Shard = {
  schema: "go-ontology-census/1"
  mode: string
  repos: string[]
  corpusAdmitted: number
  drawn: number
  parsedThroughProductionEntry: number
  parseFailures: number
  symbols: number
  relationships: number
  wallMs: number
  types: Record<string, {
    edges: number
    files: Record<string, number>
    sampleFiles: string[]
    confidence: Counter
    evidenceClass: Counter
    metadataKeySets: Counter
  }>
  resolutionFileScope: Record<string, Counter>
  integrity: Record<string, Counter>
  r7samples: string[]
  probes: Record<string, { occurrences: number; files: Record<string, number>; samples: string[] }>
  grammarNodeTypes: Record<string, number>
  revisions: Record<string, string>
  /** Files excluded because the engine self-destructs on them. See SKIP. */
  skippedForParseBudget?: string[]
  /** The R7 candidates, for a corpus-wide re-resolution. See the C6 block. */
  r7PendingRows?: Array<{ type: string; file: string; endpoint: string; value: string; imports: Array<[string, string]> }>
  r7PendingTruncated?: number
  /** Sub-0.7 edges with file and endpoints. Contract §4. */
  confidenceOutliers?: string[]
  /** Edges whose BOTH endpoints bind to nothing this file declares. */
  neitherEndpointSamples?: string[]
  /** Edges whose TARGET binds to nothing this file declares. */
  targetOnlyEndpointSamples?: string[]
  /** R7 endpoint adjudication across three scopes. See the C6 block. */
  r7Adjudication?: {
    pending: number
    file: number
    package: number
    importedPackage: number
    unresolved: number
    trueSamples: string[]
    unresolvedSamples: string[]
  }
}

// ── merge ─────────────────────────────────────────────────────────────────────
if (IS_MERGE) {
  const parts = process.argv.slice(2).filter((a) => !a.startsWith("--") && a !== OUT && !/^\d+$/.test(a) && a.endsWith(".json"))
  const acc: Shard = {
    schema: "go-ontology-census/1", mode: MODE, repos: [], corpusAdmitted: 0, drawn: 0,
    parsedThroughProductionEntry: 0, parseFailures: 0, symbols: 0, relationships: 0, wallMs: 0,
    types: {}, resolutionFileScope: {}, integrity: {}, r7samples: [], probes: {}, grammarNodeTypes: {}, revisions: {},
    r7Adjudication: undefined,
  }
  const addCounter = (dst: Counter, src?: Counter) => { for (const [k, v] of Object.entries(src ?? {})) dst[k] = (dst[k] ?? 0) + v }
  for (const p of parts) {
    const s = JSON.parse(readFileSync(p, "utf8")) as Shard
    for (const r of s.repos) if (!acc.repos.includes(r)) acc.repos.push(r)
    addCounter(acc.revisions as unknown as Counter, undefined)
    for (const [k, v] of Object.entries(s.revisions)) acc.revisions[k] = v
    acc.corpusAdmitted = Math.max(acc.corpusAdmitted, s.corpusAdmitted)
    acc.drawn += s.drawn
    acc.parsedThroughProductionEntry += s.parsedThroughProductionEntry
    acc.parseFailures += s.parseFailures
    acc.symbols += s.symbols
    acc.relationships += s.relationships
    acc.wallMs += s.wallMs
    for (const t of ALL_TYPES) {
      const a = (acc.types[t] ??= { edges: 0, files: {}, sampleFiles: [], confidence: {}, evidenceClass: {}, metadataKeySets: {} })
      const b = s.types[t]
      if (!b) continue
      a.edges += b.edges
      addCounter(a.files, b.files)
      addCounter(a.confidence, b.confidence)
      addCounter(a.evidenceClass, b.evidenceClass)
      addCounter(a.metadataKeySets, b.metadataKeySets)
      for (const f of b.sampleFiles) { if (a.sampleFiles.length < SAMPLE_CAP && !a.sampleFiles.includes(f)) a.sampleFiles.push(f) }
      addCounter(acc.resolutionFileScope[t] ??= {}, s.resolutionFileScope[t])
      addCounter(acc.integrity[t] ??= {}, s.integrity[t])
    }
    for (const [k, v] of Object.entries(s.probes)) {
      const a = (acc.probes[k] ??= { occurrences: 0, files: {}, samples: [] })
      a.occurrences += v.occurrences
      addCounter(a.files, v.files)
      for (const sm of v.samples) if (a.samples.length < SAMPLE_CAP * 2) a.samples.push(sm)
    }
    addCounter(acc.grammarNodeTypes, s.grammarNodeTypes)
    for (const r of s.r7samples) if (acc.r7samples.length < 200) acc.r7samples.push(r)
    for (const r of s.confidenceOutliers ?? []) if ((acc.confidenceOutliers ??= []).length < 200) acc.confidenceOutliers!.push(r)
    for (const r of s.neitherEndpointSamples ?? []) if ((acc.neitherEndpointSamples ??= []).length < 240) acc.neitherEndpointSamples!.push(r)
    for (const r of s.targetOnlyEndpointSamples ?? []) if ((acc.targetOnlyEndpointSamples ??= []).length < 240) acc.targetOnlyEndpointSamples!.push(r)
    if (s.r7Adjudication) {
      const a = (acc.r7Adjudication ??= { pending: 0, file: 0, package: 0, importedPackage: 0, unresolved: 0, trueSamples: [], unresolvedSamples: [] })
      a.pending += s.r7Adjudication.pending
      a.file += s.r7Adjudication.file
      a.package += s.r7Adjudication.package
      a.importedPackage += s.r7Adjudication.importedPackage
      a.unresolved += s.r7Adjudication.unresolved
      // Samples stay samples across a merge: the merged list is capped per
      // shard and re-capped here, so it names rows, never counts them.
      for (const m of s.r7Adjudication.unresolvedSamples) if (a.unresolvedSamples.length < 60) a.unresolvedSamples.push(m)
    }
  }
  if (OUT) { writeFileSync(OUT, JSON.stringify(acc, null, 2)); console.log(`merged ${parts.length} shards -> ${OUT}`) }
  printReport(acc)
  process.exit(0)
}

// ── corpus ────────────────────────────────────────────────────────────────────
// Tracked files only (`git ls-files`), the ontology gate's admission rule: a
// build artifact nobody tracks is not evidence about the language.
type File = { repo: string; dir: string; rel: string; abs: string; pkgDir: string; text: string }
const files: File[] = []
const revisions: Record<string, string> = {}
for (const e of REPOS) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue } catch { continue }
  try { revisions[e] = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > MAX_BYTES) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "go") continue
    if (SKIP.has(`${e}/${rel}`)) continue
    files.push({ repo: e, dir, rel, abs, pkgDir: path.dirname(abs), text })
  }
}
files.sort((a, b) => (a.repo + "/" + a.rel < b.repo + "/" + b.rel ? -1 : a.repo + "/" + a.rel > b.repo + "/" + b.rel ? 1 : 0))
let draw = files
const shardArg = process.argv.find((a) => a.startsWith("--shard="))
if (shardArg) {
  const [i, n] = shardArg.slice("--shard=".length).split("/").map(Number)
  draw = files.filter((_, k) => k % n === i)
}
const label = `${REPOS.join(",")}${shardArg ? ` ${shardArg.slice(8)}` : ""}`
console.log(`go ontology census [${MODE}] — ${label}  admitted ${files.length}  drawn ${draw.length}`)

// ── shared tree helpers ───────────────────────────────────────────────────────
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-go.wasm"))))

function firstNamed(n: any, types: string[]): any {
  if (!n) return undefined
  for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c && types.indexOf(c.type) !== -1) return c }
  return undefined
}
const leafOf = (raw: string): string => { const d = raw.lastIndexOf("."); return d === -1 ? raw : raw.slice(d + 1) }

/** The receiver type's NAME with wrappers stripped. Measured on the pinned wasm:
 *   method_declaration[receiver] -> parameter_list -> parameter_declaration
 *     -> { pointer_type | type_identifier | generic_type }
 * `func (h *Header) v7()` and `func (h Header) v7()` are ONE method-set entry
 * (Go forbids declaring both), so the pointer marker must not make two. */
function recvTypeLeaf(recv: any): string {
  if (!recv) return ""
  let cur: any = recv.type === "parameter_list"
    ? (recv.childForFieldName?.("type") ?? (recv.namedChildCount > 0 ? recv.namedChild(0) : undefined)?.childForFieldName?.("type"))
    : recv
  for (let g = 0; g < 8 && cur; g++) {
    if (cur.type === "pointer_type" || cur.type === "generic_type") {
      cur = cur.childForFieldName?.("type") ?? (cur.namedChildCount > 0 ? cur.namedChild(0) : undefined) ?? null
      if (!cur) return ""
      continue
    }
    break
  }
  if (!cur) return ""
  if (cur.type !== "type_identifier" && cur.type !== "qualified_type" && cur.type !== "generic_type") {
    const id = firstNamed(cur, ["type_identifier", "qualified_type"])
    return id ? leafOf(String(id.text ?? "")) : ""
  }
  return leafOf(String(cur.text ?? ""))
}

/** R7 endpoint integrity. A Go DECLARATION name is an identifier, so any other
 * character in an endpoint is either the `imports` label's own module-path
 * convention (counted and attributed, never excused) or debris. */
function isPlainIdent(s: string): boolean {
  if (s.length === 0) return false
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    const ok = (c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 95
    if (!ok) return false
  }
  return !(s.charCodeAt(0) >= 48 && s.charCodeAt(0) <= 57)
}
/** R7 placeholder literal, with the register's own discriminator: a placeholder
 * is convicted only when THE FILE DOES NOT WRITE IT. Go declares `Unknown`
 * (a `sql` sentinel; `crypto`, `x/net` have one), so a value-only rule
 * convicts real members. */
const PLACEHOLDER_LITERALS = new Set(["unknown", "undefined", "null", "n/a", "todo", "fixme", "?", "", "<name>", "unnamed", "anonymous", "symbol"])
const isPlaceholder = (v: string, declared: Set<string>): boolean => PLACEHOLDER_LITERALS.has(v.trim().toLowerCase()) && !declared.has(v)

// ── the accumulators (counters + bounded samples only) ────────────────────────
const out: Shard = {
  schema: "go-ontology-census/1", mode: MODE, repos: REPOS, corpusAdmitted: files.length, drawn: draw.length,
  parsedThroughProductionEntry: 0, parseFailures: 0, symbols: 0, relationships: 0, wallMs: 0,
  types: {}, resolutionFileScope: {}, integrity: {}, r7samples: [], probes: {}, grammarNodeTypes: {}, revisions,
  skippedForParseBudget: [...SKIP].sort(),
}
for (const t of ALL_TYPES) {
  out.types[t] = { edges: 0, files: {}, sampleFiles: [], confidence: {}, evidenceClass: {}, metadataKeySets: {} }
  out.resolutionFileScope[t] = { both: 0, sourceOnly: 0, targetOnly: 0, neither: 0 }
  out.integrity[t] = { emptySource: 0, emptyTarget: 0, placeholderSource: 0, placeholderTarget: 0, nonIdentSource: 0, nonIdentTarget: 0, dottedSource: 0, dottedTarget: 0 }
}
const bump = (m: Counter, k: string, by = 1) => { m[k] = (m[k] ?? 0) + by }
/** Sub-0.7 edges, with file and endpoints. Contract §4: below 0.7 is a heuristic,
 *  not a fact, and a heuristic nobody can point at is indistinguishable from a
 *  defect. */
const outlierSamples: string[] = []
/** R7 candidates, adjudicated after every file has contributed. A file-scope
 *  test is the WRONG discriminator for Go: `constant.Unknown`, `context.TODO`
 *  and `sql.ErrNoRows` are real exported members of OTHER packages, so a
 *  file-scope rule convicts every stdlib reference — which is exactly the
 *  failure `validation/m60/target-spelling-register.json` records ("the first
 *  two runs convicting 154 `Null` and 22 `Unknown`/`Anonymous` values were all
 *  real members of powershell and fsharp"). Three scopes are recorded instead,
 *  and only the third is a verdict. */
type R7Pending = { type: Type; fileLabel: string; endpoint: "source" | "target"; value: string; pkgDir: string; imports: Map<string, string> }
const r7Pending: R7Pending[] = []
/** Endpoints that bind to NO symbol this file declares, and endpoints that bind
 *  at one end only. Sampled, because a bucket count with no rows in it cannot
 *  be triaged. */
const neitherSamples: string[] = []
const targetOnlySamples: string[] = []
const probe = (kind: string, fileLabel: string, detail: string) => {
  const p = (out.probes[kind] ??= { occurrences: 0, files: {}, samples: [] })
  p.occurrences++
  bump(p.files, fileLabel)
  if (p.samples.length < SAMPLE_CAP * 2) p.samples.push(`${fileLabel}: ${detail}`)
}

// ── INSTRUMENT B — grammar inventory ──────────────────────────────────────────
const wall0 = Date.now()
for (const f of draw) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => {
    bump(out.grammarNodeTypes, n.type)
    for (let i = 0; i < n.childCount; i++) v(n.child(i))
  }
  v(t.rootNode)
  t.delete?.()
}

// ── per-file tree facts, used by BOTH the emission pass and the probes ────────
type TreeFacts = {
  file: File
  pkgName: string
  /** package-scope declaration name -> { kind, line, exported }. NOT methods:
   *  Go method names are scoped to a RECEIVER, not to the package, so keying
   *  them here would report every second receiver's `String` as a redeclaration
   *  of the first. Methods live in `methodsByRecv` and `pkgScopeMethods`. */
  pkgScopeDecls: Map<string, { kind: string; line: number; exported: boolean }>
  /** receiver -> the methods declared on it in this file, with line numbers */
  pkgScopeMethods: Map<string, Array<{ name: string; line: number }>>
  /** type -> embedded type leaves declared in THIS file */
  embedsByType: Map<string, string[]>
  /** type -> embedded leaf -> the SPELLED import qualifier (`io.Reader` -> `io`).
   *  Needed to resolve an EXTERNAL embed to its import path, which the leaf
   *  alone cannot do: `embed.Reader` and `os.File` are both bare leaves. */
  qualifiedEmbeds: Map<string, Map<string, string>>
  /** type -> union of promoted method names, resolved within THIS file */
  promoted: Map<string, Set<string>>
  /** type -> promoted methods WITH their declaring type, within THIS file */
  promotedOwners: Map<string, Map<string, Set<string>>>
  imports: Map<string, string>
  functionLocalTypeSpecs: number
}
const factsOf = (abs: string): TreeFacts | undefined => factsIndex.get(abs)

const factsIndex = new Map<string, TreeFacts>()
const buildFacts = (f: File): TreeFacts => {
  const info: TreeFacts = {
    file: f, pkgName: "", pkgScopeDecls: new Map(), pkgScopeMethods: new Map(), methodsByRecv: new Map(),
    embedsByType: new Map(), qualifiedEmbeds: new Map(),
    promoted: new Map(), promotedOwners: new Map(), imports: new Map(), functionLocalTypeSpecs: 0,
  }
  const t = parser.parse(f.text)
  if (!t) return info
  const root = t.rootNode
  const pc = firstNamed(root, ["package_clause"])
  info.pkgName = pc ? String((firstNamed(pc, ["package_identifier"]) ?? {}).text ?? "") : ""
  for (let i = 0; i < root.namedChildCount; i++) {
    const d = root.namedChild(i)
    if (!d) continue
    if (d.type === "import_declaration") {
      for (let j = 0; j < d.namedChildCount; j++) {
        const is = d.namedChild(j)
        if (!is || (is.type !== "import_spec" && is.type !== "import_spec_list")) continue
        const specs = is.type === "import_spec" ? [is] : Array.from({ length: is.namedChildCount }, (_, k) => is.namedChild(k)).filter((x: any) => x && x.type === "import_spec")
        for (const sp of specs) {
          const ipath = String(sp.childForFieldName?.("path")?.text ?? "").replace(/^["`]|["`]$/g, "")
          const nm = sp.childForFieldName?.("name")
          if (ipath) info.imports.set(nm ? String(nm.text) : leafOf(ipath), ipath)
        }
      }
      continue
    }
    if (d.type === "type_declaration") {
      for (let j = 0; j < d.namedChildCount; j++) {
        const ts = d.namedChild(j)
        if (!ts || (ts.type !== "type_spec" && ts.type !== "type_alias")) continue
        const nm = ts.childForFieldName?.("name")
        if (!nm) continue
        const name = String(nm.text)
        info.pkgScopeDecls.set(name, { kind: ts.type, line: nm.startPosition.row + 1, exported: name.charCodeAt(0) >= 65 && name.charCodeAt(0) <= 90 })
        const target = firstNamed(ts, ["struct_type", "interface_type"])
        if (!target) continue
        const embeds: string[] = []
        const qual = new Map<string, string>()
        const fdl = firstNamed(target, ["field_declaration_list"])
        if (fdl) {
          for (let k = 0; k < fdl.namedChildCount; k++) {
            const fd = fdl.namedChild(k)
            if (!fd || fd.type !== "field_declaration") continue
            if (fd.childForFieldName?.("name")) continue // named field — not embedding
            const tn = fd.childForFieldName?.("type")
            let cur: any = tn
            for (let g = 0; g < 8 && cur; g++) {
              if (cur.type === "pointer_type" || cur.type === "generic_type") { cur = cur.childForFieldName?.("type") ?? (cur.namedChildCount > 0 ? cur.namedChild(0) : undefined) ?? null; continue }
              break
            }
            if (cur && (cur.type === "type_identifier" || cur.type === "qualified_type")) {
              const raw = String(cur.text ?? "")
              const leaf = leafOf(raw)
              if (isPlainIdent(leaf)) { embeds.push(leaf); const dot = raw.lastIndexOf("."); if (dot > 0) qual.set(leaf, raw.slice(0, dot)) }
            }
          }
        }
        if (embeds.length) info.embedsByType.set(name, embeds)
        if (qual.size) info.qualifiedEmbeds.set(name, qual)
      }
      continue
    }
    if (d.type === "function_declaration" || d.type === "method_declaration") {
      const nm = d.childForFieldName?.("name")
      if (!nm) continue
      const name = String(nm.text)
      const line = nm.startPosition.row + 1
      const exported = name.charCodeAt(0) >= 65 && name.charCodeAt(0) <= 90
      if (d.type === "method_declaration") {
        const rl = recvTypeLeaf(d.childForFieldName?.("receiver"))
        if (rl) {
          const s = info.methodsByRecv.get(rl) ?? new Set<string>()
          s.add(name)
          info.methodsByRecv.set(rl, s)
          const arr = info.pkgScopeMethods.get(rl) ?? []
          arr.push({ name, line })
          info.pkgScopeMethods.set(rl, arr)
        }
      } else {
        info.pkgScopeDecls.set(name, { kind: d.type, line, exported })
      }
      continue
    }
    if (d.type === "var_declaration" || d.type === "const_declaration") {
      for (let j = 0; j < d.namedChildCount; j++) {
        const sp = d.namedChild(j)
        if (!sp || (sp.type !== "var_spec" && sp.type !== "const_spec")) continue
        for (let k = 0; k < sp.namedChildCount; k++) {
          const id = sp.namedChild(k)
          if (id && id.type === "identifier") {
            const name = String(id.text)
            if (!info.pkgScopeDecls.has(name)) info.pkgScopeDecls.set(name, { kind: sp.type, line: sp.startPosition.row + 1, exported: name.charCodeAt(0) >= 65 && name.charCodeAt(0) <= 90 })
          }
        }
      }
      continue
    }
    if (d.type === "type_alias") continue
  }
  // A `type` declared INSIDE a function body is not package scope. Measured
  // because the analyzer's PHASE-5 export predicate is `!s.ownerName`, and a
  // local `type_spec` would satisfy that while being unreachable from the
  // package — i.e. an `exports` edge the language cannot express.
  {
    const scan = (n: any, insideFn: boolean) => {
      if (n.type === "type_spec" || n.type === "type_alias") { if (insideFn) info.functionLocalTypeSpecs++; return }
      const inner = insideFn || n.type === "function_declaration" || n.type === "method_declaration" || n.type === "func_literal"
      for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) scan(c, inner) }
    }
    scan(root, false)
  }
  // promoted method names WITH declaring type, within this file, path-marked
  const promoted = (tname: string, depth: number, visiting: Set<string>): Map<string, Set<string>> => {
    const outm = new Map<string, Set<string>>()
    if (depth > 4) return outm
    visiting.add(tname)
    for (const et of info.embedsByType.get(tname) ?? []) {
      const own = info.methodsByRecv.get(et)
      if (own) for (const m of own) { const s = outm.get(m) ?? new Set<string>(); s.add(et); outm.set(m, s) }
      const deeper = visiting.has(et) ? new Map<string, Set<string>>() : promoted(et, depth + 1, new Set(visiting))
      for (const [m, owners] of deeper) { const s = outm.get(m) ?? new Set<string>(); for (const o of owners) s.add(o); outm.set(m, s) }
    }
    visiting.delete(tname)
    return outm
  }
  for (const tname of Array.from(info.embedsByType.keys())) {
    const m = promoted(tname, 0, new Set())
    info.promoted.set(tname, new Set(m.keys()))
    info.promotedOwners.set(tname, m)
  }
  t.delete?.()
  return info
}

// ── CORPUS-WIDE R7 ADJUDICATION ──────────────────────────────────────────────
// Run over the WHOLE corpus with no parseFile at all, re-resolving the R7
// candidates the shards exported. A shard-local answer is not a verdict here,
// and the reason is structural rather than incidental: `uses -> Unknown` in
// src/cmd/compile/internal/types2/const.go names `constant.Unknown`, declared in
// src/go/constant/value.go, and a shard drawing 1 of 4 files has usually seen
// only one of the two. This pass parses every admitted file's DECLARATIONS with
// web-tree-sitter (no analyzer, no engine pool) and re-resolves.
if (MODE === "adjudicate") {
  const PENDING = (argOf("--pending", "") ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
  const rows: Array<{ type: string; file: string; endpoint: string; value: string; imports: Array<[string, string]> }> = []
  for (const p of PENDING) {
    const j = JSON.parse(readFileSync(p, "utf8")) as Shard
    for (const r of j.r7PendingRows ?? []) rows.push(r)
  }
  const pkgNames = new Map<string, Set<string>>()   // package dir -> declared names
  const pathNames = new Map<string, Set<string>>()  // corpus import path -> declared names
  const fileNames = new Map<string, Set<string>>()  // abs path -> declared names
  for (const f of files) {
    const info = buildFacts(f)
    const own = new Set<string>()
    for (const n of info.pkgScopeDecls.keys()) own.add(n)
    for (const [, arr] of info.pkgScopeMethods) for (const m of arr) own.add(m.name)
    // Every identifier WRITTEN in the file, which is the honest file-scope
    // universe: a `uses`/`calls` target can name a package-level `var` the
    // analyzer drops from its symbol table, and a rule that only saw symbols
    // would convict it.
    const seenIdents = new Set<string>()
    {
      const t = parser.parse(f.text)
      if (t) {
        const v = (n: any) => {
          if (n.type === "identifier" || n.type === "type_identifier" || n.type === "field_identifier" || n.type === "package_identifier") seenIdents.add(String(n.text ?? ""))
          for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) v(c) }
        }
        v(t.rootNode)
        t.delete?.()
      }
    }
    for (const n of own) seenIdents.add(n)
    fileNames.set(f.abs, seenIdents)
    const ps = pkgNames.get(f.pkgDir) ?? new Set<string>()
    for (const n of own) ps.add(n)
    pkgNames.set(f.pkgDir, ps)
    if (f.repo === "go-stdlib") {
      const rel = f.rel.replace(/^src\//, "")
      const dir = rel.slice(0, rel.lastIndexOf("/"))
      const ss = pathNames.get(dir) ?? new Set<string>()
      for (const n of own) ss.add(n)
      // A vendored package's import path keeps its `vendor/` prefix stripped by
      // the compiler, so both spellings are registered.
      const v = rel.replace(/^vendor\//, "").replace(/^[^/]+\/vendor\//, "")
      const vdir = v.slice(0, v.lastIndexOf("/"))
      if (vdir !== dir) {
        const vs = pathNames.get(vdir) ?? new Set<string>()
        for (const n of own) vs.add(n)
        pathNames.set(vdir, vs)
      }
      pathNames.set(dir, ss)
    }
  }
  const buckets = { file: 0, package: 0, importedPackage: 0, noImportResolved: 0, unresolved: 0 }
  const unresolved: string[] = []
  const resolvedSamples: string[] = []
  for (const r of rows) {
    const abs = fileAbsOf(r.file)
    const dir = path.dirname(abs)
    const fn = fileNames.get(abs)
    if (fn?.has(r.value)) { buckets.file++; continue }
    if (pkgNames.get(dir)?.has(r.value)) { buckets.package++; continue }
    let hit = ""
    for (const [, ipath] of r.imports) {
      for (const key of [ipath, ipath.replace(/^vendor\//, ""), ipath.replace(/\/(internal|vendor)\/.*$/, "")]) {
        if (pathNames.get(key)?.has(r.value)) { hit = ipath; break }
      }
      if (hit) break
    }
    if (hit) {
      buckets.importedPackage++
      if (resolvedSamples.length < 30) resolvedSamples.push(`${r.type} ${r.endpoint}=${JSON.stringify(r.value)} ${r.file} -> declared in import ${hit}`)
      continue
    }
    // No import in the file resolves it. Either the file has no import of the
    // declaring package (a same-package reference the file's own package does
    // not declare — a cross-FILE reference inside a multi-file package the
    // universe knows about), or the value really is a placeholder.
    const anyPkgHit = [...pkgNames.values()].some((s) => s.has(r.value))
    if (anyPkgHit) { buckets.noImportResolved++; if (resolvedSamples.length < 30) resolvedSamples.push(`${r.type} ${r.endpoint}=${JSON.stringify(r.value)} ${r.file} -> declared in another measured package`) ; continue }
    buckets.unresolved++
    if (unresolved.length < 60) unresolved.push(`${r.type} ${r.endpoint}=${JSON.stringify(r.value)} ${r.file}`)
  }
  const report = {
    schema: "go-r7-adjudication/1",
    generatedFor: MODE,
    repos: REPOS,
    revisions,
    corpusAdmitted: files.length,
    packageDirsIndexed: pkgNames.size,
    importPathsIndexed: pathNames.size,
    candidateRows: rows.length,
    buckets,
    unresolved,
    resolvedSamples,
  }
  console.log(`\nR7 corpus-wide adjudication — ${files.length} files, ${pkgNames.size} package dirs, ${pathNames.size} import paths`)
  console.log(`candidate rows from the shard artifacts: ${rows.length}`)
  for (const [k, v] of Object.entries(buckets)) console.log(`  ${k.padEnd(20)} ${v}`)
  console.log(`\nRESOLVED (a real declaration, so the file-scope rule was the wrong test):`)
  for (const s2 of resolvedSamples) console.log(`    ${s2}`)
  console.log(`\nUNRESOLVED at every scope — the candidate R7 findings:`)
  for (const s2 of unresolved) console.log(`    ${s2}`)
  if (OUT) { writeFileSync(OUT, JSON.stringify(report, null, 2)); console.log(`\nwrote ${OUT}`) }
  process.exit(0)
}

// ── INSTRUMENT A — production emission + INSTRUMENT C probes, per file ────────
const typeFiles = new Map<Type, Set<string>>()
for (const t of ALL_TYPES) typeFiles.set(t, new Set())

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= draw.length) return
    const f = draw[i]
    const fileLabel = `${f.repo}/${f.rel}`
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { out.parseFailures++; continue }
    out.parsedThroughProductionEntry++
    // Tree facts FIRST: the R7 candidate rows need this file's import table, and
    // moving the build above the relationship loop is cheaper than a second
    // lookup table keyed by nothing.
    const info = buildFacts(f)
    factsIndex.set(f.abs, info)
    const symNames = new Set<string>()
    for (const s of r?.symbols ?? []) if (typeof s?.name === "string") symNames.add(s.name)
    out.symbols += (r?.symbols ?? []).length
    out.relationships += (r?.relationships ?? []).length

    for (const x of r?.relationships ?? []) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      const row = out.types[t]
      row.edges++
      typeFiles.get(t)!.add(fileLabel)
      if (row.sampleFiles.length < SAMPLE_CAP && !row.sampleFiles.includes(fileLabel)) row.sampleFiles.push(fileLabel)
      // The file SET -> Counter conversion. It was missing, so every artifact
      // reported `files: 0` beside an edge count in the hundreds of thousands,
      // and the workstream's EMITTED verdict needs BOTH numbers. Caught by
      // reading the merged artifact rather than by any gate.
      bump(row.files, fileLabel)
      const conf = String(x.confidence ?? "undefined")
      bump(row.confidence, conf)
      // A confidence OUTLIER is recorded with its file, because a spread the
      // source does not explain is a question and `0.5:1` in a 295,593-edge
      // census is exactly that.
      if (typeof x.confidence === "number" && x.confidence < 0.7 && outlierSamples.length < 40) {
        outlierSamples.push(`${t} conf=${x.confidence} ${fileLabel} ${JSON.stringify(String(x.source ?? ""))} -> ${JSON.stringify(String(x.target ?? ""))} md=${JSON.stringify(x.metadata ?? {})}`)
      }
      bump(row.evidenceClass, String(x.metadata?.evidenceClass ?? "(none)"))
      const mk = Object.keys(x.metadata ?? {}).filter((k) => k !== "evidenceClass").sort().join("+") || "(none)"
      bump(row.metadataKeySets, mk)
      const src = String(x.source ?? "")
      const tgt = String(x.target ?? "")
      const ig = out.integrity[t]
      if (src.length === 0) ig.emptySource++
      if (tgt.length === 0) ig.emptyTarget++
      if (isPlaceholder(src, symNames)) { ig.placeholderSource++; r7Pending.push({ type: t, fileLabel, endpoint: "source", value: src, pkgDir: f.pkgDir, imports: info.imports }) }
      if (isPlaceholder(tgt, symNames)) { ig.placeholderTarget++; r7Pending.push({ type: t, fileLabel, endpoint: "target", value: tgt, pkgDir: f.pkgDir, imports: info.imports }) }
      if (!isPlainIdent(src)) { ig.nonIdentSource++; if (src.includes(".")) ig.dottedSource++ }
      if (!isPlainIdent(tgt)) { ig.nonIdentTarget++; if (tgt.includes(".")) ig.dottedTarget++ }
      const res = out.resolutionFileScope[t]
      const sb = symNames.has(src)
      const tb = symNames.has(tgt)
      if (sb && tb) res.both++
      else if (sb) res.sourceOnly++
      else if (tb) res.targetOnly++
      else {
        res.neither++
        if (neitherSamples.length < 60) neitherSamples.push(`${t} ${fileLabel} ${JSON.stringify(src)} -> ${JSON.stringify(tgt)}`)
      }
      if (!tb && targetOnlySamples.length < 60) targetOnlySamples.push(`${t} ${fileLabel} tgt=${JSON.stringify(tgt)}`)
    }

    // ---- INSTRUMENT C, per-file probes
    // C1 — `exports`: the LANGUAGE's rule (spec, "Exported identifiers": the
    // first character of the name is an upper-case Unicode letter), measured
    // over every package-scope declaration this file writes. Independent of the
    // analyzer's predicate: it counts `var`/`const`/`type`/`func`/`method`
    // separately so the analyzer's narrower surface is visible as a DELTA, not
    // as a disagreement.
    for (const [name, d] of info.pkgScopeDecls) {
      if (d.exported) probe("C1:exports:pkg_scope_uppercase", fileLabel, `${name} (${d.kind})`)
    }
    // C1b — the sub-surface the analyzer's predicate deliberately drops: it
    // excludes `Variable` (kind) and `Method` (kind). Recorded so the doc can
    // state the excluded count instead of estimating it.
    for (const [name, d] of info.pkgScopeDecls) {
      if (!d.exported) continue
      if (d.kind === "var_spec") probe("C1b:exports:excluded_var_spec", fileLabel, name)
    }
    for (const [, arr] of info.pkgScopeMethods) {
      for (const m of arr) {
        const c = m.name.charCodeAt(0)
        if (c >= 65 && c <= 90) probe("C1b:exports:excluded_method", fileLabel, m.name)
      }
    }
    // C1c — a local `type` inside a function body: capitalized or not, it is
    // NOT package scope, so it must not become an `exports` edge.
    if (info.functionLocalTypeSpecs > 0) probe("C1c:exports:function_local_type_spec", fileLabel, `${info.functionLocalTypeSpecs} in this file`)

    // C2 — `overrides`, sub-surface 1: a method declared on T whose NAME also
    // exists in T's promoted method set. Go spec, selectors: the shallowest
    // depth wins, so `x.M` selects T's declaration and the promoted one is
    // displaced. Counted per (outer, embedder, method).
    for (const [tname, methods] of info.methodsByRecv) {
      const owners = info.promotedOwners.get(tname)
      if (!owners) continue
      for (const m of methods) {
        for (const et of owners.get(m) ?? []) {
          probe("C2:overrides:promotion_shadow_same_file", fileLabel, `${tname}.${m} shadows promoted ${et}.${m}`)
        }
      }
    }

    // C3 — the bash `overrides` instrument applied to Go: a SECOND declaration
    // of a name already declared in the same file. bash's ruling needed this
    // count because a redefinition is expressible in bash. In Go it is a
    // compile error, so the count is expected to be 0 — measured, because
    // "expected to be 0" is the prose the workstream refuses.
    {
      const seen = new Set<string>()
      for (const [name, d] of info.pkgScopeDecls) {
        const key = `${d.kind} ${name}`
        if (seen.has(key)) probe("C3:overrides:pkg_scope_redeclaration", fileLabel, key)
        seen.add(key)
      }
      // A method is keyed by RECEIVER + name: two receivers may both declare
      // `String`, and that is two methods, not one redeclared twice.
      for (const [recv, arr] of info.pkgScopeMethods) {
        for (const m of arr) {
          const key = `method ${recv}.${m.name}`
          if (seen.has(key)) probe("C3:overrides:pkg_scope_redeclaration", fileLabel, key)
          seen.add(key)
        }
      }
    }
  }
}
await Promise.all(Array.from({ length: Number(process.env.BB_GO_CENSUS_WORKERS ?? "6") }, () => worker()))
out.wallMs = Date.now() - wall0

// ── C6 — R7 endpoint adjudication across three scopes ────────────────────────
// Scope 1 FILE: does this file declare the name?
// Scope 2 PACKAGE: does any file of the same package directory declare it? (Go's
//   method sets, types and package-level vars/consts are package-scoped.)
// Scope 3 IMPORTED PACKAGE INSIDE THE CORPUS: does a declaration of that name
//   live in the directory an import path names? Only decidable for
//   corpus-internal imports, and only for a PACKAGE whose files were drawn —
//   so an import outside the draw is reported as UNRESOLVED, never as a verdict.
{
  const pkgDecls = new Map<string, Set<string>>()
  for (const info of factsIndex.values()) {
    const s2 = pkgDecls.get(info.file.pkgDir) ?? new Set<string>()
    for (const n of info.pkgScopeDecls.keys()) s2.add(n)
    for (const [, arr] of info.pkgScopeMethods) for (const m of arr) s2.add(m.name)
    pkgDecls.set(info.file.pkgDir, s2)
  }
  // corpus-internal import path -> the names declared in its directory
  const pathDecls = new Map<string, Set<string>>()
  for (const info of factsIndex.values()) {
    if (info.file.repo !== "go-stdlib") continue
    const rel = info.file.rel.replace(/^src\//, "")
    const dir = rel.slice(0, rel.lastIndexOf("/"))
    const s2 = pathDecls.get(dir) ?? new Set<string>()
    for (const n of info.pkgScopeDecls.keys()) s2.add(n)
    for (const [, arr] of info.pkgScopeMethods) for (const m of arr) s2.add(m.name)
    pathDecls.set(dir, s2)
  }
  const scope = { file: 0, package: 0, importedPackage: 0, unresolved: 0 }
  const unresolvedSamples: string[] = []
  const trueSamples: string[] = []
  for (const c of r7Pending) {
    const fi = factsIndex.get(fileAbsOf(c.fileLabel))
    if (fi && (fi.pkgScopeDecls.has(c.value) || Array.from(fi.pkgScopeMethods.values()).some((a) => a.some((m) => m.name === c.value)))) { scope.file++; continue }
    const pk = pkgDecls.get(c.pkgDir)
    if (pk?.has(c.value)) { scope.package++; continue }
    // imported package: the endpoint is a LEAF, so any import whose path's
    // directory declares that leaf resolves it.
    let hit = false
    for (const [, ipath] of fi?.imports ?? []) {
      const d = ipath.replace(/^vendor\//, "").replace(/\/(internal|vendor)\/.*$/, "")
      if (pathDecls.get(ipath)?.has(c.value) || pathDecls.get(d)?.has(c.value)) { hit = true; break }
    }
    if (hit) scope.importedPackage++
    else {
      scope.unresolved++
      if (unresolvedSamples.length < 40) unresolvedSamples.push(`${c.type} ${c.endpoint}=${JSON.stringify(c.value)} ${c.fileLabel}`)
    }
  }
  for (const c of r7Pending) {
    const fi = factsIndex.get(fileAbsOf(c.fileLabel))
    const inFile = fi ? fi.pkgScopeDecls.has(c.value) || Array.from(fi.pkgScopeMethods.values()).some((a) => a.some((m) => m.name === c.value)) : false
    const inPkg = pkgDecls.get(c.pkgDir)?.has(c.value) ?? false
    const inImport = Array.from(fi?.imports ?? []).some(([, ipath]) => pathDecls.get(ipath)?.has(c.value))
    if (!inFile && !inPkg && !inImport && trueSamples.length < 40) trueSamples.push(`${c.type} ${c.endpoint}=${JSON.stringify(c.value)} ${c.fileLabel}`)
  }
  probe("C6:r7_adjudicated_true_placeholder", "(all files)", `${trueSamples.length} of ${r7Pending.length}`)
  probe("C6:r7_resolved_by_package_or_import", "(all files)", `${scope.package + scope.importedPackage} of ${r7Pending.length}`)
  out.r7Adjudication = { pending: r7Pending.length, ...scope, trueSamples, unresolvedSamples }
  out.confidenceOutliers = outlierSamples
  out.neitherEndpointSamples = neitherSamples
  out.targetOnlyEndpointSamples = targetOnlySamples
  // The candidates themselves, so a SECOND pass can adjudicate them against the
  // whole corpus. The scope tables above are shard-local by construction — a
  // shard draws 1/n of the files, so `constant.Unknown` (declared in
  // src/go/constant/value.go) is invisible to the shard that reads it from
  // src/cmd/compile/internal/types2/const.go, and the shard-local answer is
  // "unresolved" for a name that IS declared. Reporting that as a finding
  // would be the instrument being wrong, so the rows are exported and
  // `--mode=adjudicate` re-resolves them with every file in scope.
  out.r7PendingRows = r7Pending.slice(0, 4000).map((c) => ({
    type: c.type,
    file: c.fileLabel,
    endpoint: c.endpoint,
    value: c.value,
    imports: [...c.imports.entries()],
  }))
  if (r7Pending.length > 4000) out.r7PendingTruncated = r7Pending.length - 4000
  for (const s2 of trueSamples) out.r7samples.push(`R7-UNRESOLVED ${s2}`)
}
/** `repo/rel` back to an absolute path, from the corpus walk. */
function fileAbsOf(fileLabel: string): string {
  const cut = fileLabel.indexOf("/")
  const repo = fileLabel.slice(0, cut)
  const rel = fileLabel.slice(cut + 1)
  return path.join(CR, repo, rel)
}

// ── cross-file mode: the probes a PER-FILE analyzer structurally cannot see ──
if (MODE === "crossfile") {
  const pkgIndex = new Map<string, TreeFacts[]>()
  for (const info of factsIndex.values()) {
    const arr = pkgIndex.get(info.file.pkgDir)
    if (arr) arr.push(info); else pkgIndex.set(info.file.pkgDir, [info])
  }
  // C4 — the embedded type's method set lives in ANOTHER FILE of the SAME
  // package. Go's method sets are package-scoped, so this shadowing is REAL and
  // a per-file analyzer cannot see it. A scope statement, measured separately.
  for (const infos of pkgIndex.values()) {
    const methodsByType = new Map<string, Set<string>>()  // type -> methods, package-wide
    const embeds = new Map<string, Set<string>>()         // type -> embedded leaves, package-wide
    for (const info of infos) {
      for (const [t, ms] of info.methodsByRecv) { const s = methodsByType.get(t) ?? new Set<string>(); for (const m of ms) s.add(m); methodsByType.set(t, s) }
      for (const [t, es] of info.embedsByType) { const s = embeds.get(t) ?? new Set<string>(); for (const e of es) s.add(e); embeds.set(t, s) }
    }
    const promotedPkg = (tname: string, depth: number, visiting: Set<string>): Map<string, Set<string>> => {
      const outm = new Map<string, Set<string>>()
      if (depth > 4) return outm
      visiting.add(tname)
      for (const et of embeds.get(tname) ?? []) {
        for (const m of methodsByType.get(et) ?? []) { const s = outm.get(m) ?? new Set<string>(); s.add(et); outm.set(m, s) }
        if (visiting.has(et)) continue
        for (const [m, os] of promotedPkg(et, depth + 1, new Set(visiting))) { const s = outm.get(m) ?? new Set<string>(); for (const o of os) s.add(o); outm.set(m, s) }
      }
      visiting.delete(tname)
      return outm
    }
    for (const info of infos) {
      for (const [tname, ms] of info.methodsByRecv) {
        const pm = promotedPkg(tname, 0, new Set())
        if (pm.size === 0) continue
        for (const m of ms) {
          for (const et of pm.get(m) ?? []) {
            if (et === tname) continue
            const sameFile = info.methodsByRecv.get(et)?.has(m) ?? false
            const key = sameFile ? "C4:overrides:promotion_shadow_same_file" : "C4:overrides:promotion_shadow_SIBLING_FILE"
            probe(key, `${info.file.repo}/${info.file.rel}`, `${tname}.${m} shadows package-level ${et}.${m}`)
          }
        }
      }
    }
  }
  // C5 — the embed is an EXTERNAL type. Resolvable only when the import path is
  // inside the measured corpus, so an unresolvable one is COUNTED as
  // unresolved rather than silently dropped.
  const stdlibMethods = new Map<string, Map<string, Set<string>>>()
  for (const info of factsIndex.values()) {
    if (info.file.repo !== "go-stdlib") continue
    const rel = info.file.rel.replace(/^src\//, "")
    const d = rel.slice(0, rel.lastIndexOf("/"))
    const m = stdlibMethods.get(d) ?? new Map<string, Set<string>>()
    for (const [t, ms] of info.methodsByRecv) for (const mm of ms) { const s = m.get(mm) ?? new Set<string>(); s.add(t); m.set(mm, s) }
    stdlibMethods.set(d, m)
  }
  for (const info of factsIndex.values()) {
    for (const [tname, embeds] of info.embedsByType) {
      const methods = info.methodsByRecv.get(tname)
      if (!methods || methods.size === 0) continue
      for (const leaf of embeds) {
        const q = (info.qualifiedEmbeds.get(tname) ?? new Map<string, string>()).get(leaf)
        if (!q) { probe("C5:overrides:external_embed_unresolved", `${info.file.repo}/${info.file.rel}`, `${tname} embeds local ${leaf}`); continue }
        const ipath = info.imports.get(q)
        if (!ipath) { probe("C5:overrides:external_embed_unresolved", `${info.file.repo}/${info.file.rel}`, `${tname} embeds ${q}.${leaf} (import not in file)`); continue }
        const owners = stdlibMethods.get(ipath)
        if (!owners) { probe("C5:overrides:external_embed_unresolved", `${info.file.repo}/${info.file.rel}`, `${tname} embeds ${ipath}.${leaf} (path outside corpus)`); continue }
        for (const m of methods) {
          if ((owners.get(m)?.size ?? 0) > 0) probe("C5:overrides:promotion_shadow_external_stdlib", `${info.file.repo}/${info.file.rel}`, `${tname}.${m} shadows ${ipath}.${leaf}.${m}`)
        }
      }
    }
  }
}
function printReport(s: Shard): void {
  console.log(`\nparseFile: ${s.parsedThroughProductionEntry} files, ${s.symbols.toLocaleString()} symbols, ${s.relationships.toLocaleString()} relationships, ${s.parseFailures} parse failures, ${s.wallMs} ms`)
  console.log(`\n${"type".padEnd(13)}${"edges".padStart(9)}${"files".padStart(7)}${"confidence".padStart(30)}${"evidenceClass".padStart(24)}files, e.g.`)
  console.log("-".repeat(160))
  for (const t of ALL_TYPES) {
    const row = s.types[t]
    const res = s.resolutionFileScope[t]
    const ig = s.integrity[t]
    const confStr = Object.entries(row.confidence).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k}:${v}`).join(" ")
    const evStr = Object.entries(row.evidenceClass).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k}:${v}`).join(" ")
    console.log(`${t.padEnd(13)}${String(row.edges).padStart(9)}${String(Object.keys(row.files).length).padStart(7)}  ${confStr.padEnd(30)}${evStr.padEnd(24)}${row.sampleFiles.slice(0, 2).join(", ")}`)
    console.log(`${" ".repeat(13)}both-ends ${res.both} (${row.edges === 0 ? "n/a" : ((res.both / row.edges) * 100).toFixed(1) + "%"}) src-only ${res.sourceOnly} tgt-only ${res.targetOnly} neither ${res.neither} | empty ${ig.emptySource}/${ig.emptyTarget} placeholder ${ig.placeholderSource}/${ig.placeholderTarget} non-ident ${ig.nonIdentSource}/${ig.nonIdentTarget} (dotted ${ig.dottedSource}/${ig.dottedTarget})`)
  }
  console.log(`\nconstruct probes (parse-tree counts):`)
  for (const k of Object.keys(s.probes).sort()) {
    const p = s.probes[k]
    console.log(`  ${k.padEnd(48)} ${String(p.occurrences).padStart(8)} in ${String(Object.keys(p.files).length).padStart(6)} files`)
  }
  if (s.skippedForParseBudget?.length) console.log(`  SKIPPED (engine 120s parse self-destruct): ${s.skippedForParseBudget.length} — ${s.skippedForParseBudget.join(", ")}`)
  console.log(`  grammar node types observed: ${Object.keys(s.grammarNodeTypes).length}`)
  for (const n of ["export_statement", "import_spec", "method_declaration", "method_spec", "type_spec", "struct_type", "interface_type", "qualified_type", "override_specifier", "class_declaration", "field_declaration"]) {
    console.log(`    ${n.padEnd(24)} ${s.grammarNodeTypes[n] ?? 0}`)
  }
  if (s.confidenceOutliers?.length) {
    console.log(`\nSUB-0.7 EDGES (contract §4: a heuristic, not a fact) — ${s.confidenceOutliers.length} sampled:`)
    for (const o of s.confidenceOutliers.slice(0, 10)) console.log(`    ${o}`)
  }
  if (s.neitherEndpointSamples?.length) {
    console.log(`\nEDGES RESOLVING AT NEITHER END (sample of ${s.neitherEndpointSamples.length}):`)
    for (const o of s.neitherEndpointSamples.slice(0, 10)) console.log(`    ${o}`)
  }
  const a7 = s.r7Adjudication
  if (a7) {
    console.log(`\nR7 ENDPOINT ADJUDICATION (three scopes, because a file-scope test convicts every stdlib reference):`)
    console.log(`  candidates flagged by the file-scope test: ${a7.pending}`)
    console.log(`  resolved at FILE scope:                       ${a7.file}`)
    console.log(`  resolved at PACKAGE scope:                     ${a7.package}`)
    console.log(`  resolved in an IMPORTED package in the corpus: ${a7.importedPackage}`)
    console.log(`  UNRESOLVED at every scope — the real findings:  ${a7.unresolved}`)
    for (const m of a7.unresolvedSamples.slice(0, 10)) console.log(`    ${m}`)
  }
  if (s.r7samples.length) {
    console.log(`\nR7 raw samples (${s.r7samples.length} recorded, capped):`)
    for (const r of s.r7samples.slice(0, 10)) console.log(`    ${r}`)
  }
}
printReport(out)
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }
process.exitCode = 0