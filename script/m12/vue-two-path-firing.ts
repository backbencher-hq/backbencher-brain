/**
 * VUE TWO-PATH FIRING — why a firing check can read 1/10 for a lane that emits 8.
 *
 * ## The observation that produced this instrument
 *
 * `script/m14/firing-check.mjs` (master-owned) drives each lane as
 *
 *     const parser = await getParser(lang)
 *     const pr = await parser.parse(content, f)
 *     const res = new RealVueAnalyzer().analyze(pr.rootNode, content, f)
 *
 * — three arguments. It reports, on the 11 `.vue` files in the corpus repo
 * `vuejs`:
 *
 *     VUE  1 types fired   instantiates:10
 *     SILENT: calls extends implements uses brain_import exports contains
 *             references overrides
 *
 * One type. That is NOT a statement about this analyzer, and the difference is
 * worth measuring rather than arguing: the SFC script pass is driven by the
 * ANALYZE CONTEXT, not by the tree. `analyze()` reads
 * `context?.sfcScriptTrees?.length ?? 0` and loops over that many blocks
 * (real-vue-analyzer.ts:331); with no context the loop body never executes, so
 * the whole delegated JS/TS half — calls, imports, references, exports, extends,
 * contains, the script half of uses — is unreachable. Only the template pass,
 * which walks the SFC tree it was handed, can produce anything.
 *
 * The context is built by `ASTEngine.parseFile`, which locates each `<script>`
 * block's `raw_text` byte range on the SFC tree, slices the source, and parses
 * that slice with the JavaScript/TypeScript grammar. So the two paths differ by
 * one engine-side step, and only one of them is production.
 *
 * ## What this measures
 *
 * For the same bytes, on the same files, in one process:
 *
 *   PATH A (the firing-check shape) — getParser -> parse -> analyze, no context
 *   PATH B (production)              — parseFile from src/ast/pool-worker
 *
 * per relationship type: rows, files, and the DELTA. Then the same census over
 * the whole admitted corpus, and a third column: what the shared instrument
 * would have reported had it been given the wider corpus rather than the 11-file
 * repo it is pointed at.
 *
 * It also names WHICH producer wrote each row, because "fired" and "fired for
 * the right reason" are different claims: a row the delegate wrote is not
 * evidence that the Vue lane can read that construct, and the two are counted
 * separately throughout the lane's document.
 *
 * NO REGEX. Files are selected by extension and by `detectLanguageFromPath`;
 * types are read off `relationshipType`/`type` and compared to the enum's own
 * values. READ-ONLY: writes one JSON report.
 *
 * USAGE
 *   npx tsx script/m12/vue-two-path-firing.ts [out.json]
 *   BB_VUE_LIMIT=200   cap the draw (0 = every admitted file)
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { getParser } from "../../src/ast/engine"
import { parseFile } from "../../src/ast/pool-worker"
import { RealVueAnalyzer } from "../../src/ast/real-vue-analyzer"
import { RelationshipType } from "../../src/ast/types"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const OUT = process.argv[2] ?? "/tmp/vue-two-path-firing.json"
const LIMIT = Number(process.env.BB_VUE_LIMIT ?? "0")

/** The ontology, in the order the gate prints it. Values come from the enum, not
 *  from a hand-written list, so this table cannot drift from `src/ast/types.ts`. */
const ALL_TYPES: string[] = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]
const enumValues = new Map<string, string>()
for (const [key, value] of Object.entries(RelationshipType as unknown as Record<string, string>)) {
  enumValues.set(value, key)
}
// The enum's own name for each ontology slot, e.g. Imports -> "brain_import".
// Recorded because an analyzer may emit the bare word where the enum holds a
// different string, and that divergence is invisible unless it is named.
const enumNameFor = new Map<string, string>(ALL_TYPES.map((t) => [t, enumValues.get(t) ?? `NO_ENUM_MEMBER(${t})`]))

type Row = { type: string; source?: string; target?: string; confidence?: number; evidenceClass?: string; metadata?: Record<string, unknown> }

function tally(rows: Row[] | undefined): Map<string, { n: number; files: Set<string>; conf: Map<string, number> }> {
  const out = new Map<string, { n: number; files: Set<string>; conf: Map<string, number> }>()
  for (const r of rows ?? []) {
    const t = String(r.type ?? r.relationshipType ?? "").toLowerCase()
    if (!t) continue
    const cur = out.get(t) ?? { n: 0, files: new Set<string>(), conf: new Map<string, number>() }
    cur.n++
    cur.files.add(r.source ?? "")
    const c = String(r.confidence ?? "")
    cur.conf.set(c, (cur.conf.get(c) ?? 0) + 1)
    out.set(t, cur)
  }
  return out
}

/**
 * Which producer wrote a row. Vue-owned rows carry one of the markers this lane
 * writes; anything else came from the JS/TS delegate. Read from metadata KEYS
 * (a fixed set of literals compared by equality) — never from a shape match on
 * the endpoint names, which would classify by accident.
 */
const VUE_OWNED_MARKERS: Record<string, string[]> = {
  instantiates: ["isComponentUsage"],
  uses: ["templateRead"],
  contains: ["ownerIsComponent"],
  extends: ["isVueHeritage"],
  references: ["isPropContract", "isEmitContract", "isProvideContract", "isInjectContract"],
  exports: ["isSfcDefaultExport"],
}
function producerOf(r: Row): "vue-owned" | "delegate" {
  const t = String(r.type ?? r.relationshipType ?? "").toLowerCase()
  const md = (r.metadata ?? {}) as Record<string, unknown>
  for (const key of Object.values(VUE_OWNED_MARKERS[t] ?? [])) {
    if (md[key] !== undefined) return "vue-owned"
  }
  // `uses` template rows predate their marker; a row whose source is the
  // component identity and whose line is inside the TEMPLATE is a template read
  // by construction. `componentName` is compared by equality, not by shape.
  if (t === "uses" && md.templateRead === undefined && md.fromDelegate !== true && md.identifierKind !== undefined) return "delegate"
  return "delegate"
}

// ---------------------------------------------------------------- corpus
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try { if (!statSync(dir).isDirectory()) continue; execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
  let tracked: string[]
  try { tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean) } catch { continue }
  for (const rel of tracked.sort()) {
    if (!rel.endsWith(".vue")) continue
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "vue") continue
    files.push({ repo: e, dir, rel, abs })
  }
}
const drawn = LIMIT > 0 ? files.slice(0, LIMIT) : files
console.log(`vue two-path firing — corpus ${files.length} admitted .vue files, drawing ${drawn.length}\n`)
console.log(`enum name for each ontology slot (values from src/ast/types.ts):`)
for (const t of ALL_TYPES) console.log(`   ${t.padEnd(12)} ${enumNameFor.get(t)}`)
console.log("")

// ---------------------------------------------------------------- PATH A + PATH B, per file
type Bucket = { n: number; files: Set<string>; owned: number }
const mk = (): Bucket => ({ n: 0, files: new Set<string>(), owned: 0 })
const A = new Map<string, Bucket>()
const B = new Map<string, Bucket>()
const add = (m: Map<string, Bucket>, t: string, label: string, owned: boolean) => {
  const cur = m.get(t) ?? mk()
  cur.n++
  cur.files.add(label)
  if (owned) cur.owned++
  m.set(t, cur)
}

const parser = await getParser("vue")
let pathAThrew = 0
let pathBThrew = 0
const perFile: { rel: string; repo: string; a: Record<string, number>; b: Record<string, number> }[] = []

for (const f of drawn) {
  let content: string
  try { content = readFileSync(f.abs, "utf8") } catch { continue }
  const label = `${f.repo}/${f.rel}`

  // PATH A — the firing-check shape: parse the SFC, call analyze with no context.
  const aCount: Record<string, number> = {}
  try {
    const pr = await parser.parse(content, f.abs)
    const res = new RealVueAnalyzer().analyze(pr.rootNode as any, content, f.abs)
    for (const r of (res.relationships ?? []) as Row[]) {
      const t = String(r.type ?? r.relationshipType ?? "").toLowerCase()
      if (!t) continue
      aCount[t] = (aCount[t] ?? 0) + 1
      add(A, t, label, producerOf(r) === "vue-owned")
    }
  } catch { pathAThrew++ }

  // PATH B — production: the pool worker, which runs the SFC pre-parse and
  // hands the analyzer its context.
  const bCount: Record<string, number> = {}
  try {
    const res: any = await parseFile(f.abs, f.dir)
    for (const r of (res.relationships ?? []) as Row[]) {
      const t = String(r.type ?? r.relationshipType ?? "").toLowerCase()
      if (!t) continue
      bCount[t] = (bCount[t] ?? 0) + 1
      add(B, t, label, producerOf(r) === "vue-owned")
    }
  } catch { pathBThrew++ }

  perFile.push({ repo: f.repo, rel: f.rel, a: aCount, b: bCount })
}

// ---------------------------------------------------------------- report
const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
const num = (n: number) => n.toLocaleString("en-US")

console.log(`${pad("type", 13)}${pad("A: no context", 26)}${pad("B: production", 30)}delta   A-owned / B-owned`)
console.log("-".repeat(110))
const table: Record<string, unknown>[] = []
for (const t of ALL_TYPES) {
  const a = A.get(t), b = B.get(t)
  const as = a ? `${num(a.n)} rows / ${a.files.size} files` : "0"
  const bs = b ? `${num(b.n)} rows / ${b.files.size} files` : "0"
  const d = (b?.n ?? 0) - (a?.n ?? 0)
  console.log(`${pad(t, 13)}${pad(as, 26)}${pad(bs, 30)}${d >= 0 ? "+" : ""}${num(d)}   ${a?.owned ?? 0} / ${b?.owned ?? 0}`)
  table.push({ type: t, enumName: enumNameFor.get(t), pathA: { rows: a?.n ?? 0, files: a?.files.size ?? 0, vueOwned: a?.owned ?? 0 }, pathB: { rows: b?.n ?? 0, files: b?.files.size ?? 0, vueOwned: b?.owned ?? 0 } })
}
const aFired = ALL_TYPES.filter((t) => (A.get(t)?.n ?? 0) > 0)
const bFired = ALL_TYPES.filter((t) => (B.get(t)?.n ?? 0) > 0)
console.log("-".repeat(110))
console.log(`PATH A (firing-check shape) fires ${aFired.length}/10: ${aFired.join(" ")}`)
console.log(`PATH B (production)         fires ${bFired.length}/10: ${bFired.join(" ")}`)
console.log(`\npathA threw on ${pathAThrew} files; pathB threw on ${pathBThrew} files`)
console.log(`\nEvery type PATH B fires and PATH A does not is a type whose producer is the`)
console.log(`AnalyzeContext script pass. The delta is the engine-side SFC pre-parse, which`)
console.log(`the firing-check shape omits by passing three arguments to analyze().`)

writeFileSync(OUT, JSON.stringify({
  corpusRoot: CR, admittedFiles: files.length, drawn: drawn.length,
  enumNames: Object.fromEntries(enumNameFor),
  pathA: { note: "getParser -> parse -> analyze(rootNode, content, filePath) — no context", threw: pathAThrew, fired: aFired.length },
  pathB: { note: "parseFile from src/ast/pool-worker — the production path", threw: pathBThrew, fired: bFired.length },
  table, perFile,
}, null, 2))
console.log(`\nwrote ${OUT}`)