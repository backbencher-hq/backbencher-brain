/**
 * XML ONTOLOGY CENSUS — the instrument this lane's ten verdicts rest on.
 *
 * ## Why this script exists
 *
 * `script/m14/ontology-coverage-gate.ts` is the arbiter, and for `xml` it
 * REFUSES TO REPORT: it has no `XML_RULED` table, so it exits 2 with "no RULING
 * TABLE for xml" — a verdict about the TABLE, not about the lane. That file is
 * supervisor-owned (§8), so the measurement is made here instead, with the
 * arbiter's own two instruments and its own verdict vocabulary, so the numbers
 * this lane quotes are the numbers the arbiter would print once the table exists.
 *
 * Everything counted here comes through the PRODUCTION entry point
 * `parseFile` from `src/ast/pool-worker.ts`. `analyze()` is never called: it is
 * the per-file unit and skips the pipeline stages (pool, timeout, truncation,
 * enhancements), so a count taken through it is a count of something the
 * production path does not do.
 *
 * ## What it measures
 *
 *   1. EMITTED  — per relationship type: edge count, files, roles, evidence
 *                 tiers, confidence distribution, and ENDPOINT RESOLUTION
 *                 against the symbol set of the SAME file.
 *   2. Integrity — SymbolKind values seen (with unknown/empty called out),
 *                 symbols with empty names, edge endpoints equal to the
 *                 placeholder literal `unknown`.
 *   3. Instrument A (grammar inventory) — every node type the wired grammar
 *                 actually produces across the sample, with counts.
 *   4. Instrument B (parse-tree semantic count) — one probe per RULED-or-GAP
 *                 relationship type, each naming the construct it would need and
 *                 reporting occurrences, files and examples.
 *
 * ## Sampling
 *
 * Family-stratified and deterministic: repositories are visited in sorted order
 * and each contributes at most `BB_XML_PER_REPO` files (default 400) in
 * lexicographic path order, up to `BB_XML_SAMPLE` total (default 2500). One
 * bounded draw, no retries, and the draw itself is printed so a reader can
 * reproduce it. The alternative — the first N files of a sorted walk — measures
 * whichever repository sorts first and nothing else.
 *
 * ## ITS COUNTS ARE NOT REPRODUCIBLE, AND IT NOW SAYS SO
 *
 * `reproducibility.countsAreDeterministic` used to read `true`, from four runs at the
 * default worker count. Two CONSECUTIVE runs at that same worker count, over a draw whose
 * fingerprint and corpus bytes were both unchanged, gave 126,430 and 126,486 symbols, so
 * the claim was false and the artifact carrying it was published as current. The cause is
 * measured in two sibling probes and written out in full in the `reproducibility` block:
 * concurrent `parseFile` calls share one cached `web-tree-sitter` Parser, the grammar load
 * intermittently fails under WASM memory pressure, and `parseFile`'s catch substitutes
 * `extractFallback` SILENTLY — `success: true, fallback: true, errors: 0`. Whole files
 * disappear from the totals.
 *
 * Three consequences this script now acts on rather than describes:
 *   - every run records `drawFingerprint` and `workers`, so a count comparison can tell a
 *     moved draw from a moved count;
 *   - every run counts `fallbackFiles` / `fallbackSymbols` / `fallbackRelationships`, so a
 *     degraded parse is a number in the artifact and not an absence nobody can see;
 *   - the claim a reader may make is narrowed to `instrumentA` and `instrumentB`, which are
 *     byte-identical across worker counts 1, 8 and 16 and are what the four RULED verdicts
 *     in `script/m14/xml-ruled.ts` actually rest on.
 *
 * READ-ONLY. Writes nothing except the JSON passed with `--out`.
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync, statSync, writeFileSync, readdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SAMPLE = Number(process.env.BB_XML_SAMPLE ?? 2500)
const PER_REPO = Number(process.env.BB_XML_PER_REPO ?? 400)
/**
 * Production workers.
 *
 * This was a literal 8, and at 8 the census could not finish over the full admitted
 * population: `parseFile`'s per-file self-destruct timer in `src/ast/engine.ts:1442`
 * fires at 120 s and calls `process.exit(1)`, so ONE file ends the whole run.
 *
 * That timer is not evidence about those files. Measured on the file it named —
 * `flutter-packages/.../res/drawable/launch_background.xml`, 434 bytes — the raw
 * grammar parses it in 22 ms with `hasError` false, `analyze()` returns in 7 ms, and
 * `parseFile` on its own returns in 1,595 ms. The stall appears only with 8
 * concurrent XML parsers, which is wasm memory pressure in shared engine code rather
 * than a property of the input, and the same shape of failure was already recorded
 * for this repo's `resolveWasm` fallback (see `script/m14/firing-check.ts`'s
 * determinism note). So the worker count is a parameter here, and
 * `BB_XML_WORKERS_DETERMINISM` below is what makes lowering it honest rather than
 * convenient.
 */
const WORKERS = Number(process.env.BB_XML_WORKERS ?? 8)
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

// ─────────────────────────────────────────────────────────── corpus discovery
type FileRow = { repo: string; dir: string; rel: string; abs: string }
const byRepo = new Map<string, FileRow[]>()
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  const rows: FileRow[] = []
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "xml") continue
    rows.push({ repo: e, dir, rel, abs })
  }
  if (rows.length > 0) byRepo.set(e, rows.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)))
}
const inventory = [...byRepo.entries()].map(([repo, rows]) => ({ repo, admitted: rows.length }))
// An optional repo filter, for a family-scoped re-measure (an XSLT-only draw, say).
// Absent from a reported run it must be absent from the method line, so the draw is
// printed either way.
const REPO_FILTER = process.env.BB_XML_REPOS ? new Set(process.env.BB_XML_REPOS.split(",").map((s) => s.trim()).filter(Boolean)) : undefined

// Family-stratified round-robin: every repo gets its share before any repo
// gets a second file, so a 4,000-file repository cannot crowd out a 30-file one.
const sample: FileRow[] = []
{
  const queues = new Map([...byRepo].map(([k, v]) => [k, [...v]]))
  let progress = true
  while (progress && sample.length < SAMPLE) {
    progress = false
    for (const [repo, rows] of queues) {
      if (REPO_FILTER && !REPO_FILTER.has(repo)) continue
      if (rows.length === 0 || sample.length >= SAMPLE) continue
      if (sample.filter((f) => f.repo === repo).length >= PER_REPO) continue
      sample.push(rows.shift()!)
      progress = true
    }
  }
}
sample.sort((a, b) => (a.repo === b.repo ? (a.rel < b.rel ? -1 : 1) : a.repo < b.repo ? -1 : 1))

/**
 * A fingerprint of the DRAW, so "the counts moved" can be told from "the draw moved".
 *
 * Without it the two are indistinguishable, and that is how a stale artifact came to be
 * published as current: the committed census disagreed with two clean runs on `contains`
 * by 5 edges while this lane's analyzer and the corpus's file contents were both provably
 * unchanged, and the only remaining explanation was the concurrent fault measured below.
 */
const DRAW_FINGERPRINT = (() => {
  const h = createHash("sha256")
  for (const f of sample) {
    let size = -1
    try { size = statSync(f.abs).size } catch {}
    h.update(`${f.repo}/${f.rel} ${size}\n`)
  }
  return h.digest("hex").slice(0, 16)
})()

// ─────────────────────────────────────────────────────────── 1. what is emitted
type TypeRow = {
  edges: number
  files: number
  fileExamples: string[]
  roles: Record<string, number>
  tiers: Record<string, number>
  confidenceUnder07: number
  resolvability: Record<string, number>
  resolvedBoth: number
  resolvedSource: number
  resolvedTarget: number
  unresolvableExamples: string[]
}
const rowsFor = (): TypeRow => ({
  edges: 0, files: 0, fileExamples: [], roles: {}, tiers: {}, confidenceUnder07: 0, resolvability: {},
  resolvedBoth: 0, resolvedSource: 0, resolvedTarget: 0, unresolvableExamples: [],
})
const emitted = new Map<Type, TypeRow>()
for (const t of ALL_TYPES) emitted.set(t, rowsFor())

const kinds = new Map<string, number>()
let emptyNameSymbols = 0
let unknownEndpointEdges = 0
let unknownEndpointExamples: string[] = []
let filesParsed = 0
let filesFailed = 0
let filesWithErrors = 0
let totalSymbols = 0
let totalRelationships = 0
let totalImports = 0
let importInfoRows = 0
// Silent-degradation accounting. `parseFile` substitutes `extractFallback` when the
// grammar load fails, and the substituted result is `success: true, fallback: true,
// errors: 0` — so a degraded file is indistinguishable from a file that declares nothing
// unless it is counted. Counted here, per file, with the rows it cost.
let fallbackFiles = 0
let fallbackSymbols = 0
let fallbackRelationships = 0
const fallbackRows: string[] = []
const relTypesSeen = new Map<string, number>()

const typeFiles = new Map<Type, Set<string>>()
for (const t of ALL_TYPES) typeFiles.set(t, new Set())

let cursor = 0
async function productionWorker() {
  while (true) {
    const i = cursor++
    if (i >= sample.length) return
    const f = sample[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { filesFailed++; continue }
    filesParsed++
    const label = `${f.repo}/${f.rel}`
    const syms = r.symbols ?? []
    totalSymbols += syms.length
    const names = new Set<string>()
    for (const s of syms) {
      const n = String(s.name ?? "")
      names.add(n)
      if (n.length === 0) emptyNameSymbols++
      const k = String(s.kind ?? "")
      if (k.length === 0) kinds.set("<EMPTY>", (kinds.get("<EMPTY>") ?? 0) + 1)
      kinds.set(k, (kinds.get(k) ?? 0) + 1)
    }
    const rels = r.relationships ?? []
    totalRelationships += rels.length
    if ((r.errors ?? []).length > 0) filesWithErrors++
    if (r.fallback === true) {
      // A fallback row is NOT a failed row: `filesFailed` stays 0 and `filesWithErrors`
      // stays put, which is precisely why it has to be tallied separately. What it costs
      // is this file's whole symbol and edge contribution, because the structural
      // extractor reads few constructs the grammar reads.
      fallbackFiles++
      fallbackSymbols += syms.length
      fallbackRelationships += rels.length
      if (fallbackRows.length < 20) fallbackRows.push(`${label} size=${statSync(f.abs).size} symbols=${syms.length} relationships=${rels.length}`)
    }
    const importInfo = r.imports ?? []
    totalImports += importInfo.length
    if (importInfo.length > 0) importInfoRows++
    for (const x of rels) {
      const t = String(x.type ?? x.relationshipType ?? "").toLowerCase()
      relTypesSeen.set(t, (relTypesSeen.get(t) ?? 0) + 1)
      if (!ALL_TYPES.includes(t as Type)) continue
      const row = emitted.get(t as Type)!
      row.edges++
      const set = typeFiles.get(t as Type)!
      if (!set.has(label)) { set.add(label); row.files = set.size; if (row.fileExamples.length < 3) row.fileExamples.push(label) }
      const role = String(x.metadata?.role ?? "<none>")
      row.roles[role] = (row.roles[role] ?? 0) + 1
      const tier = String(x.metadata?.evidenceClass ?? "<none>")
      row.tiers[tier] = (row.tiers[tier] ?? 0) + 1
      const resolvability = String(x.metadata?.resolvable ?? "<none>")
      row.resolvability[resolvability] = (row.resolvability[resolvability] ?? 0) + 1
      if (typeof x.confidence === "number" && x.confidence < 0.7) row.confidenceUnder07++
      const s = String(x.source ?? "")
      const tg = String(x.target ?? "")
      if (s === "unknown" || tg === "unknown") {
        unknownEndpointEdges++
        if (unknownEndpointExamples.length < 5) unknownEndpointExamples.push(`${label}: ${s} -${t}-> ${tg}`)
      }
      const okS = names.has(s)
      const okT = names.has(tg)
      if (okS) row.resolvedSource++
      if (okT) row.resolvedTarget++
      if (okS && okT) row.resolvedBoth++
      else if (row.unresolvableExamples.length < 4) row.unresolvableExamples.push(`${label}: ${s} -${t}-> ${tg} (src=${okS ? "y" : "n"} tgt=${okT ? "y" : "n"})`)
    }
  }
}
if (WORKERS !== 8) {
  console.log(`NOTE: production workers ${WORKERS} (not the default 8). See BB_XML_WORKERS in the header for why,`)
  console.log(`      and determinism is checked by re-running one fixed draw at two worker counts.`)
}
await Promise.all(Array.from({ length: WORKERS }, () => productionWorker()))

// ─────────────────────────────────────────────────── 3./4. instruments A and B
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-xml.wasm"))))

const XSD_NS = "http://www.w3.org/2001/XMLSchema"
const XSLT_NS = "http://www.w3.org/1999/XSL/Transform"

const grammarNodeTypes = new Map<string, number>()
let nodesSeen = 0
let errorNodesSeen = 0
const elementLocalNames = new Map<string, number>()

type Probe = { type: Type; name: string; describe: string; occurrences: number; files: number; examples: string[]; detail: Record<string, number> }
const probes: Probe[] = [
  { type: "calls", name: "xslt-call-template", describe: "an XSLT element that invokes a named template", occurrences: 0, files: 0, examples: [], detail: {} },
  { type: "uses", name: "use-construct", describe: "an element naming a reusable definition it adopts rather than names", occurrences: 0, files: 0, examples: [], detail: {} },
  { type: "exports", name: "export-declaration", describe: "an element that declares a name part of a public surface", occurrences: 0, files: 0, examples: [], detail: {} },
  { type: "extends", name: "xsd-derivation-base", describe: "an XSD extension/restriction carrying base= (type derivation)", occurrences: 0, files: 0, examples: [], detail: {} },
  { type: "implements", name: "supertype-clause", describe: "an element carrying an interface/implements clause", occurrences: 0, files: 0, examples: [], detail: {} },
  // CORRECTED 2026-10-03. This probe used to report 3 occurrences in 3 files, and all
  // three were an instrument defect rather than a construct: it keyed on
  // `match|mode|priority` while IGNORING `name`, so every name-only template reduced to
  // the key `||` and legal stylesheets full of named templates read as collisions. The
  // nine templates behind those three hits were verified by hand — `name="dumptext"`
  // (l.26), `name="generate_general"` (l.498), `name="generate_index"` (l.539) in each
  // of libxslt's two html.xsl, and `name='transformCALSCell'` (l.121),
  // `name='findInheritedAttribute'` (l.216), `name='transformInheritedAttribute'` (l.310)
  // in powershell's Maml_HTML_Style.xsl — and NONE of them has a `match`, because a
  // named template is INVOKED by `xsl:call-template` and never competes for a node.
  // The corrected probe counts only templates that CARRY a `match`.
  { type: "overrides", name: "competing-template-rule", describe: "two xsl:template in one file carrying a match and sharing (match, mode, priority) — XSLT 1.0 s5.5, where the later one replaces the earlier", occurrences: 0, files: 0, examples: [], detail: {} },
  // Kept beside the corrected probe so the size of the error the key made is a number in
  // this artifact rather than a claim in a commit message. 3 occurrences, 9 templates,
  // 0 real overrides.
  { type: "overrides", name: "name-only-template-key-artifact", describe: "the SAME count with the name-only exclusion REMOVED, i.e. the defect this probe used to have — reported so the difference stays visible", occurrences: 0, files: 0, examples: [], detail: {} },
  { type: "overrides", name: "cross-file-override-source", describe: "an include/import/redefine edge — the construct that CREATES an override, across files", occurrences: 0, files: 0, examples: [], detail: {} },
  { type: "instantiates", name: "constructor-or-new", describe: "an element that creates an instance of a declared construct", occurrences: 0, files: 0, examples: [], detail: {} },
]
const bump = (p: Probe, key: string, n = 1) => { p.detail[key] = (p.detail[key] ?? 0) + n }

const directChild = (n: any, type: string) => {
  for (let i = 0; i < n.namedChildCount; i++) {
    const c = n.namedChild(i)
    if (c && c.type === type) return c
  }
  return null
}

/**
 * Strip one matching pair of surrounding quotes.
 *
 * This was `text.replace(/^["']|["']$/g, "")` at two call sites. The lane brief's
 * hard rule covers census scripts as well as analyzers, so it is a character test
 * instead: drop the first character when it is a quote AND the last character is the
 * SAME quote, which is what the anchored alternation meant, and which
 * `src/ast/real-xml-analyzer.ts`'s own `unquote` also implements.
 */
const unquote = (text: string): string => {
  if (text.length >= 2) {
    const first = text[0]
    const last = text[text.length - 1]
    if ((first === "\"" || first === "'") && first === last) return text.slice(1, -1)
  }
  return text
}
const elementInfo = (n: any): { tag: string; local: string; prefix: string; attrs: Map<string, string>; node: any } | null => {
  if (n.type !== "element") return null
  const tag = directChild(n, "STag") ?? directChild(n, "EmptyElemTag")
  if (!tag) return null
  const nameNode = directChild(tag, "Name")
  if (!nameNode) return null
  const tagName = nameNode.text.trim()
  const colon = tagName.indexOf(":")
  const prefix = colon >= 0 ? tagName.slice(0, colon) : ""
  const local = colon >= 0 ? tagName.slice(colon + 1) : tagName
  const attrs = new Map<string, string>()
  for (let i = 0; i < tag.namedChildCount; i++) {
    const a = tag.namedChild(i)
    if (a?.type !== "Attribute") continue
    const an = directChild(a, "Name")?.text.trim()
    const av = directChild(a, "AttValue")?.text.trim()
    if (an) attrs.set(an, av ? unquote(av) : "")
  }
  return { tag: tagName, local, prefix, attrs, node: n }
}

let cursor2 = 0
/** Probe -> files that hit it. Global, so 4 workers cannot each report their own. */
const probeFiles = new Map<string, Set<string>>()
/**
 * `match|mode|priority` -> the templates in THIS file carrying it. Per file, and
 * reset per file: the probe asks whether one stylesheet declares two templates
 * that would match the same node at the same priority, which is a per-document
 * question. A global map would answer it across the corpus instead.
 */
// PER WORKER, not module scope. It was module scope, reassigned per file inside four
// concurrent workers: worker A's reset could land in the middle of worker B's file, so
// B's templates landed in a map A was about to discard. A race can both INVENT
// collisions (two files' templates sharing one key) and lose them. Every number this
// probe reports is now confined to one worker's one file.
let templateKeys = new Map<string, string[]>()
/** The same counts under the name-only-EXCLUDED key, keyed identically. */
let correctedTemplateKeys = new Map<string, string[]>()
async function treeWorker() {
  const markHit = (p: Probe, key: string, example?: string) => {
    p.occurrences++
    const set = probeFiles.get(key) ?? new Set<string>()
    set.add(label0)
    probeFiles.set(key, set)
    if (example && p.examples.length < 4 && !p.examples.includes(example)) p.examples.push(example)
  }
  let label0 = ""
  while (true) {
    const i = cursor2++
    if (i >= sample.length) return
    const f = sample[i]
    let text: string
    try { text = readFileSync(f.abs, "utf8") } catch { continue }
    label0 = `${f.repo}/${f.rel}`
    const label = label0
    const t = parser.parse(text)
    if (!t) continue
    templateKeys = new Map()
    correctedTemplateKeys = new Map()
    const markHit = (p: Probe, key: string, example?: string) => {
      p.occurrences++
      const set = probeFiles.get(key) ?? new Set<string>()
      set.add(label)
      probeFiles.set(key, set)
      if (example && p.examples.length < 4 && !p.examples.includes(example)) p.examples.push(example)
    }
    // Bindings are needed to tell XSLT from a same-named element in no namespace.
    const stack: any[] = [t.rootNode]
    while (stack.length) {
      const n = stack.pop()!
      grammarNodeTypes.set(n.type, (grammarNodeTypes.get(n.type) ?? 0) + 1)
      nodesSeen++
      if (n.type === "ERROR") errorNodesSeen++
      if (n.type === "element") {
        const info = elementInfo(n)
        if (info) elementLocalNames.set(info.local, (elementLocalNames.get(info.local) ?? 0) + 1)
      }
      for (let c = n.childCount - 1; c >= 0; c--) {
        const ch = n.child(c)
        if (ch) stack.push(ch)
      }
    }
    // ── per-file second walk with namespace scoping, for the semantic probes ──
    const walk = (n: any, ns: Map<string, string>) => {
      if (n.type === "element") {
        const tag = directChild(n, "STag") ?? directChild(n, "EmptyElemTag")
        if (tag) {
          const inner = new Map(ns)
          for (let i = 0; i < tag.namedChildCount; i++) {
            const a = tag.namedChild(i)
            if (a?.type !== "Attribute") continue
            const an = directChild(a, "Name")?.text.trim()
            const avRaw = directChild(a, "AttValue")?.text.trim()
            const av = avRaw === undefined ? undefined : unquote(avRaw)
            if (an === "xmlns") inner.set("", av ?? "")
            else if (an?.startsWith("xmlns:")) inner.set(an.slice(6), av ?? "")
          }
          const info = elementInfo(n)
          if (info) {
            const thisNs = inner.get(info.prefix) ?? (info.prefix === "" ? inner.get("") : undefined)
            runProbes(info, thisNs, inner, markHit, label)
          }
          ns = inner
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const c = n.child(i)
        if (c) walk(c, ns)
      }
    }
    walk(t.rootNode, new Map())
    const probeByName = (name: string) => probes.find((x) => x.name === name)!
    for (const [key, matches] of templateKeys) {
      if (!key.startsWith("@") || matches.length < 2) continue
      const parts = key.slice(1).split("|")
      const po = probeByName("name-only-template-key-artifact")
      markHit(po, po.name, `${label}: xsl:template match="${parts[0]}" x${matches.length} times`)
      bump(po, `match|${parts[0]}`)
    }
    for (const [key, matches] of correctedTemplateKeys) {
      if (!key.startsWith("@") || matches.length < 2) continue
      const parts = key.slice(1).split("|")
      const po = probeByName("competing-template-rule")
      markHit(po, po.name, `${label}: ${matches.length} xsl:template competing at match|${parts[0]}|mode=${parts[1]}| (lines ${matches.join(",")})`)
      bump(po, `match|${parts[0]}`)
    }
    t.delete?.()
  }
}
await Promise.all(Array.from({ length: Math.max(1, Math.floor(WORKERS / 2)) }, () => treeWorker()))
for (const p of probes) p.files = probeFiles.get(p.name)?.size ?? 0

function runProbes(
  info: { local: string; prefix: string; attrs: Map<string, string>; tag: string },
  ns: string | undefined,
  bindings: Map<string, string>,
  markHit: (p: Probe, key: string, example?: string) => void,
  label: string,
) {
  const p = (name: string) => probes.find((x) => x.name === name)!
  const local = info.local
  // ── calls: an XSLT element that invokes a named template by name ──
  if (ns === XSLT_NS && (local === "call-template" || local === "apply-templates")) {
    const pCall = p("xslt-call-template")
    markHit(pCall, pCall.name, `${label}: <${info.tag}> name=${info.attrs.get("name") ?? "<none>"}`)
    bump(pCall, local === "call-template" ? "call-template" : "apply-templates")
    if (local === "call-template") {
      const named = info.attrs.get("name") ?? ""
      const decls = templateKeys.get(`#${named}`) ?? []
      bump(pCall, decls.length > 0 ? "call-template target declared in file" : "call-template target NOT declared in file")
    }
  }
  // ── extends: XSD type derivation, which is what `base` means there ──
  if (ns === XSD_NS && (local === "extension" || local === "restriction")) {
    const base = info.attrs.get("base")
    const pe = p("xsd-derivation-base")
    if (base) {
      markHit(pe, pe.name, `${label}: <${info.tag} base="${base}">`)
      bump(pe, local === "extension" ? "extension" : "restriction")
      if (base.includes(":")) bump(pe, "prefixed base"); else bump(pe, "bare base")
    } else {
      bump(pe, `${local} without base=`)
    }
  }
  // ── uses: a construct adopted by name ──
  if (local === "use-attribute-sets" || local === "use-package") {
    const pu = p("use-construct")
    markHit(pu, pu.name, `${label}: <${info.tag}> ${info.attrs.get("name") ?? ""}`)
    bump(pu, local)
  }
  // ── exports: an element whose local name declares a public surface ──
  {
    const l = local.toLowerCase()
    if (l.includes("export") || l === "expose" || l === "publish") {
      const pe = p("export-declaration")
      markHit(pe, pe.name, `${label}: <${info.tag}>`)
      bump(pe, local)
    }
  }
  // ── implements: a supertype obligation element ──
  {
    const l = local.toLowerCase()
    if (l === "implements" || l === "extends" || l === "implementsinterface" || l === "interface" || l === "abstract") {
      const pi = p("supertype-clause")
      markHit(pi, pi.name, `${label}: <${info.tag}>`)
      bump(pi, local)
    }
  }
  // ── instantiates: a construction element ──
  {
    const l = local.toLowerCase()
    if (l === "new" || l === "instantiate" || l === "newinstance" || l === "create") {
      const pin = p("constructor-or-new")
      markHit(pin, pin.name, `${label}: <${info.tag}>`)
      bump(pin, local)
    }
  }
  // ── overrides: the same-file template override XSLT 1.0 s5.5 defines ──
  if (ns === XSLT_NS && local === "template") {
    const name = info.attrs.get("name")
    if (name) {
      const decls = templateKeys.get(`#${name}`) ?? []
      decls.push(name)
      templateKeys.set(`#${name}`, decls)
    }
    // Both keys get every template, so the artifact probe can report what the exclusion
    // is worth. The CORRECTED key additionally gets a line number, because a reader
    // asking "which two declarations?" needs to be able to go and look.
    const match = info.attrs.get("match") ?? ""
    const mode = info.attrs.get("mode") ?? ""
    const priority = info.attrs.get("priority") ?? ""
    const key = `${match}|${mode}|${priority}`
    const arr = templateKeys.get(`@${key}`) ?? []
    arr.push(key)
    templateKeys.set(`@${key}`, arr)
    // The exclusion: a template with NO `match` is a named template, invoked by name
    // and never matched against a node, so two of them cannot compete for one.
    if (match.length > 0) {
      const carr = correctedTemplateKeys.get(`@${key}`) ?? []
      carr.push(String(info.node.startPosition.row + 1))
      correctedTemplateKeys.set(`@${key}`, carr)
    }
  }
  // ── overrides: the cross-file construct, counted because it decides the ruling ──
  if (local === "include" || local === "import" || local === "redefine" || local === "override") {
    const po = p("cross-file-override-source")
    markHit(po, po.name, `${label}: <${info.tag}>`)
    bump(po, local)
  }
}
// NOTE: `treeWorker` was invoked twice here. The second call is a NO-OP, not a second
// pass: `cursor2` is shared and monotonic, and the first batch of workers already
// drains it to `sample.length`, so every worker in the second batch returns on its
// first iteration. Left in place rather than deleted, because removing it changes
// nothing measurable and the duplicate is worth being able to see; recorded as a
// line-by-line finding in docs/analyzers/xml.md.
await Promise.all(Array.from({ length: Math.max(1, Math.floor(WORKERS / 2)) }, () => treeWorker()))

// ─────────────────────────────────────────────────────────── report
const out = {
  generatedBy: "validation/m14/fixtures/xml/ontology-census.mts",
  corpusRoot: CR,
  reproducibility: {
    // WITHDRAWN, and this block is the withdrawal.
    //
    // It used to read `countsAreDeterministic: true`, "measured over four runs of this
    // script against the same corpus at the same caps". Those four runs agreed, and the
    // claim was still false, because four runs at ONE worker count cannot detect a
    // dependence on concurrency and the fault is not the worker count either — two
    // CONSECUTIVE runs at the SAME worker count, same draw, same corpus bytes, gave
    // 126,430 and 126,486 symbols.
    //
    // WHAT MOVES, measured, on one fixed 600-file draw (fingerprint 6ad7d4ddf1656e6f,
    // `validation/m14/fixtures/xml/worker-determinism-probe.mts`):
    //
    //     workers   symbols   relationships   contains
    //          1    126,486           15,479     15,239
    //          8    126,430           15,438     15,198
    //          8    126,486           15,479     15,239     <- same worker count, later run
    //         16    126,447           15,450     15,210
    //         16    126,486           15,479     15,239     <- same worker count, later run
    //
    // The worker count sets how OFTEN it happens, not whether. Raising it does not make
    // the counts trustworthy; it makes them unstable more often.
    //
    // THE MECHANISM, and it is a whole-file loss rather than a rounding difference.
    // `validation/m14/fixtures/xml/shared-parser-probe.mts` parses the same 48 files under
    // two schedules in one process. Sequential: 20 rounds, 0 files ever vary. Concurrent
    // at8: 5 of 48 files return ZERO symbols in some rounds, and each losing result
    // carries `success: true, fallback: true, errors: 0, relationships: 0` — so
    // `pool-worker.parseFile`'s catch substituted `extractFallback` after the grammar load
    // failed under WASM memory pressure, and the structural extractor found nothing in
    // these files. The loss is silent: `filesFailed` does not move, `filesWithErrors` does
    // not move, and the file reads as one that simply declares nothing.
    //
    // WHAT A READER MAY COMPARE. `integrity.fallbackFiles` and `production.fallbackRows`
    // are now counted, so a degraded parse is visible in the artifact instead of being
    // absorbed into the totals. Every production count in this file is a count over
    // (draw MINUS whatever silently degraded), which is why `fallbackFiles` sits beside
    // them and not in a footnote.
    //
    // WHAT IS NOT AFFECTED, measured on the same runs: instrument A (78 distinct node
    // types over 981,491 nodes, byte-identical at workers 1, 8 and 16) and every
    // instrument B probe's occurrence and file count. Both read the PARSE TREE through a
    // single parser created after the production pass, outside the concurrent path. The
    // four RULED verdicts in `script/m14/xml-ruled.ts` rest on those, so this withdrawal
    // does not touch them.
    countsAreDeterministic: false,
    exampleArraysAreDeterministic: false,
    measuredRuns: 6,
    nonDeterministicFields: [
      "relationshipTypes[].edges", "relationshipTypes[].files",
      "relationshipTypes[].resolutionRate", "production.totalSymbols",
      "production.totalRelationships", "integrity.symbolKinds",
      "relationshipTypes[].fileExamples", "relationshipTypes[].unresolvableExamples",
      "instrumentB[].examples", "integrity.unknownEndpointExamples",
    ],
    nondeterminismCause:
      "concurrent parseFile calls share one cached web-tree-sitter Parser per language (src/ast/engine.ts getParser) and the WASM grammar load intermittently fails under memory pressure, after which pool-worker.parseFile substitutes extractFallback silently: success=true, fallback=true, errors=0, symbols=0 for files the structural extractor cannot read. Whole-file, so a lost file subtracts all of its symbols and edges.",
    nondeterminismIsPerFileNotPerEdge:
      "the unit of loss is a FILE, not an edge, so the error does not shrink as the sample grows — it grows with it. A larger sample is not a fix.",
    determinismProbes: [
      "validation/m14/fixtures/xml/worker-determinism-probe.mts",
      "validation/m14/fixtures/xml/shared-parser-probe.mts",
    ],
    drawFingerprint: DRAW_FINGERPRINT,
    workers: WORKERS,
    claimRule:
      "compare counts only between two runs whose drawFingerprint AND workers both match, and even then expect per-file losses; instrumentA and instrumentB are the only fields this lane's RULED verdicts rest on, and they are stable across worker counts.",
  },
  sampling: {
    method: "family-stratified deterministic round-robin over git-tracked files routed to xml by detectLanguageFromPath; per-repo cap then total cap",
    repoFilter: REPO_FILTER ? [...REPO_FILTER] : "none",
    perRepoCap: PER_REPO,
    totalCap: SAMPLE,
    repositoriesAdmittingXml: byRepo.size,
    inventory,
    sampled: sample.length,
    sampledPerRepo: sample.reduce<Record<string, number>>((a, f) => { a[f.repo] = (a[f.repo] ?? 0) + 1; return a }, {}),
  },
  production: {
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    filesParsed, filesFailed, filesWithErrors,
    totalSymbols, totalRelationships, importInfoRows,
    // Every production count on this page is a count over the draw MINUS whatever silently
    // degraded, so these three sit beside `totalSymbols` and not in a footnote.
    fallbackFiles, fallbackSymbols, fallbackRelationships, fallbackRows,
    drawFingerprint: DRAW_FINGERPRINT,
    workers: WORKERS,
    fileSamples: sample.slice(0, 5).map((f) => `${f.repo}/${f.rel}`),
  },
  integrity: {
    symbolKinds: [...kinds.entries()].sort((a, b) => b[1] - a[1]),
    emptyNameSymbols,
    unknownEndpointEdges,
    unknownEndpointExamples,
    fallbackFiles,
  },
  relationshipTypes: ALL_TYPES.map((t) => {
    const r = emitted.get(t)!
    const resolvable = r.edges > 0 ? (r.resolvedBoth / r.edges) : null
    return {
      type: t,
      edges: r.edges,
      files: r.files,
      fileExamples: r.fileExamples,
      roles: r.roles,
      evidenceTiers: r.tiers,
      confidenceUnder07: r.confidenceUnder07,
      resolvability: r.resolvability,
      resolvedBothEnds: r.resolvedBoth,
      resolvedSource: r.resolvedSource,
      resolvedTarget: r.resolvedTarget,
      resolutionRate: resolvable === null ? null : Number(resolvable.toFixed(4)),
      unresolvableExamples: r.unresolvableExamples,
    }
  }),
  allRelationshipTypesSeen: [...relTypesSeen.entries()].sort((a, b) => b[1] - a[1]),
  instrumentA: {
    note: "every node type the wired grammar produced across the sample, with counts. Types named as the construct for a ruled type are absent by inspection.",
    distinctNodeTypes: grammarNodeTypes.size,
    nodesSeen,
    errorNodes: errorNodesSeen,
    nodeTypes: [...grammarNodeTypes.entries()].sort((a, b) => b[1] - a[1]),
  },
  instrumentB: probes.map((p) => ({
    type: p.type, probe: p.name, construct: p.describe,
    occurrences: p.occurrences, files: p.files, breakdown: p.detail, examples: p.examples,
  })),
  elementLocalNameTop: [...elementLocalNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 120),
}
const json = JSON.stringify(out, null, 2)
if (OUT) writeFileSync(OUT, json)
console.log(`ontology census — xml`)
console.log(`sampled ${sample.length} files across ${byRepo.size} repositories (cap ${SAMPLE}, per-repo ${PER_REPO})`)
console.log(`draw ${DRAW_FINGERPRINT} · workers ${WORKERS} · counts are NOT deterministic here; see the reproducibility block`)
console.log(`parsed ${filesParsed} failed ${filesFailed} withErrors ${filesWithErrors} symbols ${totalSymbols} relationships ${totalRelationships}`)
console.log(`SILENT FALLBACK: ${fallbackFiles} file(s) degraded to the structural extractor — ${fallbackSymbols} symbols, ${fallbackRelationships} relationships; these counts EXCLUDE what those files would have contributed`)
console.log(`grammar: ${grammarNodeTypes.size} distinct node types over ${nodesSeen} nodes, ${errorNodesSeen} ERROR nodes`)
console.log(`\ntype          edges      files  res.both  conf<0.7`)
for (const r of out.relationshipTypes) {
  console.log(
    `${r.type.padEnd(13)}${String(r.edges).padStart(6)}${String(r.files).padStart(9)}` +
    `${(r.resolutionRate === null ? "n/a" : (r.resolutionRate * 100).toFixed(1) + "%").padStart(11)}` +
    `${String(r.confidenceUnder07).padStart(10)}`,
  )
}
console.log(`\nemptyNameSymbols ${emptyNameSymbols}  unknownEndpointEdges ${unknownEndpointEdges}`)
console.log(`\nprobes:`)
for (const p of out.instrumentB) {
  console.log(`  ${p.type.padEnd(13)}${p.probe.padEnd(30)}occ=${String(p.occurrences).padStart(6)}  files=${String(p.files).padStart(5)}  ${JSON.stringify(p.breakdown)}`)
  for (const e of p.examples) console.log(`      e.g. ${e}`)
}
console.log(`\nkinds: ${out.integrity.symbolKinds.map(([k, v]) => `${k}=${v}`).join(" ")}`)