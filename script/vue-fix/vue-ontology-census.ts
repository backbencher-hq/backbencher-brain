/**
 * VUE ONTOLOGY CENSUS — JOB 1's instrument for the VUE_FIX lane.
 *
 * READ-ONLY. Writes nothing except the JSON passed with --out.
 *
 * WHY THIS EXISTS ALONGSIDE script/m14/firing-check-v2.mjs
 * -------------------------------------------------------
 * `firing-check-v2.mjs` measures a lane by constructing the analyzer directly:
 *
 *     const pr = await parser.parse(content, f)
 *     const res = new Cls().analyze(pr.rootNode, content, f)   // NO context
 *
 * For every other lane that is the production path. For vue/svelte it is NOT:
 * `ASTEngine.parseFile` (src/ast/engine.ts:1562-1593) pre-parses each <script>
 * block body with the JS/TS grammar and hands the trees over on the analyze
 * context (`sfcScriptTrees`, `sfcScriptLines`, `sfcScriptCols`,
 * `sfcScriptStartIndex`, `sfcScriptLangs`). `RealVueAnalyzer.analyze` reads
 * nothing else: with `context === undefined` the script loop runs zero times
 * (`scriptTreeCount = context?.sfcScriptTrees?.length ?? 0`,
 * real-vue-analyzer.ts:331), so EVERY script-side artifact — imports[], calls,
 * uses, contains, exports, extends — is absent BY CONSTRUCTION, not by defect.
 *
 * `--mode` selects the path so the difference is a number rather than an
 * argument:
 *   prod      src/ast/pool-worker.ts parseFile  (what the indexer calls)
 *   engine    ASTEngine.parseFile               (the same, one layer up)
 *   direct    getParser + new Analyzer().analyze(root, content, file)
 *             — the shape firing-check-v2 uses, i.e. the SFC seam BYPASSED
 *
 * PER TYPE it reports the six Part-1 quantities:
 *   EMITTED   count + the files it came from
 *   RESOLVED  both endpoints bound to a symbol THIS analyzer emitted for this
 *             file (ids and bare names both tried; a path to "resolves" that
 *             only matches on appearance would be a tautology)
 *   LABELLED  the full label histogram per emission site is NOT derivable here;
 *             what IS reported is the label histogram overall plus examples, so
 *             a neighbour label is visible as a count
 *   CONFIDENT evidenceClass + confidence histograms (honesty contract §4:
 *             anything under 0.7 is a heuristic, not a fact)
 *   R7        empty endpoints and placeholder-literal endpoints
 *
 * Plus the SEPARATE channels ParseResult carries (src/ast/types.ts:206-216):
 * `imports[]` (which parallel-indexer writes to the brain_import TABLE) and
 * `exports[]`.
 *
 * NO REGEX. Every classification below is a Set membership test or a string
 * comparison over node types and names.
 *
 * Usage:
 *   bun script/vue-fix/vue-ontology-census.ts --repo vuejs [--mode prod] [--limit 0] [--out x.json]
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

// The ten ontology types. Spelled as the enum's VALUES, which are what the
// relationship channel actually carries (types.ts RelationshipType).
// MEASURED 2026-10-04, and this list was wrong until now: this entry read
// "brain_import", which is the NAME OF A TABLE. src/ast/types.ts:84 now reads
// `Imports = "imports"` — the same string engine.ts:454 and graph.ts emit — so
// "brain_import" is produced by no emitter in the fleet and a table tallied
// against it reported `imports ABSENT 0` on a corpus where this same run
// counted 25 `imports` rows. Reproduced on vuejs through production parseFile
// on 2026-10-05: the pre-fix instrument printed `brain_import ABSENT 0` and
// simultaneously printed `imports 25 ... OFF-ENUM`. A table and its own raw
// histogram disagreeing in the same printout is the defect REVIEW-2026-10-04
// §1 describes; the fix is the enum value, and the raw histogram is retained
// precisely so a future divergence of this kind is visible in one place.
const ALL_TYPES = [
  "calls", "extends", "implements", "uses", "imports", "exports",
  "contains", "references", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const REPO = argOf("--repo") ?? "vuejs"
const MODE = argOf("--mode") ?? "prod"
const LIMIT = Number(argOf("--limit") ?? "0")
const OUT = argOf("--out")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const MAX_BYTES = Number(argOf("--max-bytes") ?? String(1024 * 1024))

/**
 * Standing rule R7: a placeholder literal is not a name.
 *
 * TWO classes, because collapsing them would overstate the finding. `HARD` is
 * the set of strings that cannot be a real program identifier anywhere — the
 * analyzer admitting one of these as an edge endpoint is an R7 defect whatever
 * the language. `GENERIC` is a set of ordinary words that are ALSO the name of
 * a ubiquitous global (`String`, `document`, `Object`) or a generic term
 * (`name`, `value`, `module`): counting them as placeholders would report a
 * defect on `initChart -[uses]-> String`, which is a true edge. They are counted
 * separately as `genericEndpoint` so the number is visible without being a claim.
 */
const PLACEHOLDER_LITERALS = new Set([
  "", "?", "unknown", "unknown_symbol", "unknownsymbol", "<unknown>", "undefined", "null",
  "todo", "tbd", "n/a", "na", "none", "anonymous", "<anonymous>", "placeholder",
  "lambda", "<lambda>", "func", "fn", "symbol", "unknown1", "objectliteral", "root",
  "this", "self", "super",
])
const GENERIC_ENDPOINT_LITERALS = new Set([
  "name", "value", "target", "source", "object", "string", "number", "any", "module",
  "default", "type", "key", "item", "data", "result",
])

type Rel = {
  type?: string; relationshipType?: string
  source?: string; target?: string
  from?: string; to?: string; fromSymbol?: string; toSymbol?: string
  confidence?: number; line_number?: number
  metadata?: Record<string, any>
  [k: string]: any
}
const typeOf = (r: Rel): string => String(r.type ?? r.relationshipType ?? "").toLowerCase()
const endpointsOf = (r: Rel): [string, string] => [
  String(r.source ?? r.from ?? r.fromSymbol ?? ""),
  String(r.target ?? r.to ?? r.toSymbol ?? ""),
]
const isPlaceholder = (x: string): boolean => PLACEHOLDER_LITERALS.has(x.trim().toLowerCase())
const isGeneric = (x: string): boolean => GENERIC_ENDPOINT_LITERALS.has(x.trim().toLowerCase())

// ---------------------------------------------------------------- corpus
const dir = path.join(CR, REPO)
if (!statSync(dir).isDirectory()) { console.error(`no corpus repo at ${dir}`); process.exit(2) }
const files: { rel: string; abs: string }[] = []
{
  let tracked: string[] = []
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
      .split("\0").filter(Boolean)
  } catch (e) {
    console.error(`git ls-files failed in ${dir}: ${String(e)}`); process.exit(2)
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    try {
      if (statSync(abs).size > MAX_BYTES) continue
      if (detectLanguageFromPath(abs) !== "vue") continue
      files.push({ rel, abs })
    } catch { continue }
  }
}
const admitted = LIMIT ? files.slice(0, LIMIT) : files

// ---------------------------------------------------------------- tallies
type Stat = {
  count: number
  files: number
  fileExamples: string[]
  examples: string[]
  bothResolve: number; srcResolve: number; tgtResolve: number
  corpusTgtResolve: number
  emptyEndpoint: number; placeholderEndpoint: number; genericEndpoint: number; selfLoop: number
  delegated: number; undelegated: number
  confidence: Record<string, number>
  evidenceClass: Record<string, number>
  lines: { withLine: number; withoutLine: number }
  bySourceKind: Record<string, number>
}
const stat = (): Stat => ({
  count: 0, files: 0, fileExamples: [], examples: [],
  bothResolve: 0, srcResolve: 0, tgtResolve: 0, corpusTgtResolve: 0,
  emptyEndpoint: 0, placeholderEndpoint: 0, genericEndpoint: 0, selfLoop: 0,
  delegated: 0, undelegated: 0,
  confidence: {}, evidenceClass: {},
  lines: { withLine: 0, withoutLine: 0 },
  bySourceKind: {},
})
const rows = new Map<Type, Stat>()
for (const t of ALL_TYPES) rows.set(t, stat())
const filesPerType = new Map<Type, Set<string>>()
for (const t of ALL_TYPES) filesPerType.set(t, new Set())
const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] ?? 0) + 1 }

// Payload + latency, because an edge added downstream is not free: bb_graph's
// un-narrowed default is measured at 2.5-4.8x a filtered answer
// (ONTOLOGY-WORKSTREAM "Adding edges is not free downstream"). The payload
// figure here is the JSON byte size of the relationship array plus the symbol
// array for the whole draw — the two things every consumer of ParseResult pays
// for — so a before/after comparison is a byte count, not an adjective.
let payloadRelBytes = 0, payloadSymBytes = 0, payloadImpBytes = 0
const wallStart = Date.now()
let parsed = 0, failed = 0, emptySymbols = 0
let totalSymbols = 0, totalRels = 0, totalImports = 0, totalExports = 0
let filesWithScriptWork = 0
const parseFailures: string[] = []
const importExamples: string[] = []
const importByRepoChannel: Record<string, number> = {}
/**
 * EVERY label the relationship channel carried, enum member or not.
 *
 * This is the measurement REVIEW-2026-10-04 §1 turns on: the JS/TS delegates
 * emit the OFF-ENUM literal `"imports"`, while `RelationshipType.Imports` is the
 * string `"brain_import"`, which no emitter in the fleet produces. An instrument
 * that tallies the ten enum values therefore cannot see a single import edge —
 * on any lane — while the edges exist. Ten-row tables built from the enum alone
 * inherit that blindness, so the raw histogram is reported beside them.
 */
const rawLabels = new Map<string, { n: number; files: Set<string>; example: string }>()
/** Every (label, file, source, target) the draw produced, for the corpus-level pass. */
const EDGE_LEDGER: { label: string; file: string; src: string; tgt: string }[] = []
const corpusSymbols = new Set<string>()

async function analyzeOne(abs: string, src: string): Promise<any> {
  if (MODE === "prod") return await parseFile(abs, path.dirname(abs))
  if (MODE === "engine") {
    const { ASTEngine } = await import("../../src/ast/engine")
    return await ASTEngine.parseFile(abs, src)
  }
  // direct: the firing-check-v2 shape — parser + analyzer, no analyze context.
  const { getParser } = await import("../../src/ast/engine")
  const { RealVueAnalyzer } = await import("../../src/ast/real-vue-analyzer")
  const parser = await getParser("vue")
  const pr = await parser.parse(src)
  return new RealVueAnalyzer().analyze(pr.rootNode, src, abs)
}

let idx = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let src: string
    try { src = readFileSync(f.abs, "utf8") } catch { failed++; continue }
    let r: any
    try { r = await analyzeOne(f.abs, src) } catch (e) {
      failed++; if (parseFailures.length < 8) parseFailures.push(`${f.rel}: ${String(e).slice(0, 80)}`); continue
    }
    parsed++
    const symbols: any[] = r?.symbols ?? []
    totalSymbols += symbols.length
    if (symbols.length === 0) emptySymbols++
    const rels: Rel[] = r?.relationships ?? []
    totalRels += rels.length
    payloadRelBytes += Buffer.byteLength(JSON.stringify(rels))
    payloadSymBytes += Buffer.byteLength(JSON.stringify(symbols))
    payloadImpBytes += Buffer.byteLength(JSON.stringify(r?.imports ?? []))
    // "did the SFC seam run?" — the component symbol exists either way, but a
    // delegated row is the observable difference.
    const sfcDelegated = rels.some((x) => (x.metadata as any)?.sfcDelegated === true)
    if (sfcDelegated) filesWithScriptWork++
    // Resolution set: every name/id this file's symbol list publishes.
    const names = new Set<string>()
    const ids = new Set<string>()
    for (const s of symbols) {
      if (s?.name) names.add(String(s.name))
      if (s?.id) ids.add(String(s.id))
      const owner = s?.metadata?.ownerName
      if (owner && s?.name) { names.add(`${owner}::${s.name}`); ids.add(`${owner}::${s.name}`) }
      if (s?.ownerName && s?.name) { names.add(`${s.ownerName}::${s.name}`) }
    }
    // Corpus-wide symbol table. PER-FILE resolution answers "does this edge
    // close inside the file that made it", which is the wrong question for
    // `instantiates` (a `<Card/>` usage names a component declared in ANOTHER
    // file by definition) and for `imports`/`exports` module edges. Both ends
    // are therefore ALSO resolved against every symbol the draw publishes, and
    // the two numbers are reported side by side rather than one standing in for
    // the other.
    for (const s of symbols) {
      if (s?.name) corpusSymbols.add(String(s.name))
      if (s?.id) corpusSymbols.add(String(s.id))
    }
    if (EDGE_LEDGER.length < 400_000) {
      for (const rel of rels) {
        const [a, b] = endpointsOf(rel)
        EDGE_LEDGER.push({ label: typeOf(rel), file: f.rel, src: a, tgt: b })
      }
    }
    for (const rel of rels) {
      const raw = typeOf(rel)
      const rl = rawLabels.get(raw) ?? { n: 0, files: new Set<string>(), example: "" }
      rl.n++
      if (rl.files.size < 4) rl.files.add(f.rel)
      if (!rl.example) rl.example = `${endpointsOf(rel)[0]} -[${raw}]-> ${endpointsOf(rel)[1]}`
      rawLabels.set(raw, rl)
      const t = raw as Type
      const s = rows.get(t)
      if (!s) continue
      const [src2, tgt] = endpointsOf(rel)
      s.count++
      const fs = filesPerType.get(t)!
      fs.add(f.rel)
      s.files = fs.size
      if (s.fileExamples.length < 4) s.fileExamples.push(f.rel)
      if (s.examples.length < 6) s.examples.push(`${src2} -[${t}]-> ${tgt}`)
      const sr = src2 !== "" && (names.has(src2) || ids.has(src2))
      const tr = tgt !== "" && (names.has(tgt) || ids.has(tgt))
      if (sr) s.srcResolve++
      if (tr) s.tgtResolve++
      if (sr && tr) s.bothResolve++
      if (src2 === "" || tgt === "") s.emptyEndpoint++
      if (isPlaceholder(src2) || isPlaceholder(tgt)) s.placeholderEndpoint++
      if (isGeneric(src2) || isGeneric(tgt)) s.genericEndpoint++
      if (src2 !== "" && src2 === tgt) s.selfLoop++
      const delegated = (rel.metadata as any)?.sfcDelegated === true
      if (delegated) s.delegated++; else s.undelegated++
      // Which SYMBOL CLASS the source is: this is the "labelled to its real
      // source" question — a delegated row must source the component, not the
      // JS module name the sub-analyzer used.
      const isComponent = names.has(src2) && !src2.includes("::")
      bump(s.bySourceKind, delegated ? (isComponent ? "delegated:component" : "delegated:other") : "vue-own")
      bump(s.confidence, typeof rel.confidence === "number" ? String(rel.confidence) : "absent")
      const ec = (rel.metadata as any)?.evidenceClass ?? (rel as any).evidenceClass
      bump(s.evidenceClass, ec === undefined ? "absent" : String(ec))
      if (typeof rel.line_number === "number") s.lines.withLine++; else s.lines.withoutLine++
    }
    // SEPARATE channels.
    const imps: any[] = r?.imports ?? []
    totalImports += imps.length
    if (imps.length && importExamples.length < 8) {
      importExamples.push(`${f.rel}: ${imps.slice(0, 3).map((i: any) => `${i.module ?? i.moduleName ?? "?"}:${i.name ?? i.item ?? i.importedName ?? "?"}`).join(", ")}`)
    }
    for (const i of imps) {
      const key = String(i.type ?? i.kind ?? (i.module || i.moduleName ? "module" : "unspecified"))
      bump(importByRepoChannel, key)
    }
    totalExports += (r?.exports ?? []).length
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ---------------------------------------------------------------- corpus-level resolution
for (const e of EDGE_LEDGER) {
  const s = rows.get(e.label as Type)
  if (!s) continue
  if (e.tgt !== "" && corpusSymbols.has(e.tgt)) s.corpusTgtResolve++
}

// ---------------------------------------------------------------- report
const out: any = {
  at: new Date().toISOString(),
  lane: process.env.BB_LANE ?? "VUE_MERGE2",
  mode: MODE,
  corpus: { root: CR, repo: REPO, tracked: files.length, admitted: admitted.length, limit: LIMIT },
  files: { parsed, failed, emptySymbols, totalSymbols, totalRelationships: totalRels, filesWithDelegatedRows: filesWithScriptWork, corpusSymbolNames: corpusSymbols.size },
  payload: { relationshipBytes: payloadRelBytes, symbolBytes: payloadSymBytes, importBytes: payloadImpBytes, totalBytes: payloadRelBytes + payloadSymBytes + payloadImpBytes, wallMs: Date.now() - wallStart, filesPerSec: 0, relationshipsPerSec: 0 },
  channels: {
    imports: { count: totalImports, kinds: importByRepoChannel, examples: importExamples },
    exports: { count: totalExports },
  },
  rawLabels: [...rawLabels.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([label, v]) => ({ label, count: v.n, files: v.files.size, example: v.example })),
  types: {} as Record<string, unknown>,
  parseFailures,
}
for (const t of ALL_TYPES) {
  const s = rows.get(t)!
  out.types[t] = {
    verdict: s.count > 0 ? "EMITTED" : "ABSENT",
    count: s.count,
    files: s.files,
    fileExamples: s.fileExamples,
    examples: s.examples,
    resolved: {
      both: s.bothResolve, src: s.srcResolve, tgt: s.tgtResolve,
      pctBoth: s.count ? Number(((100 * s.bothResolve) / s.count).toFixed(1)) : 0,
      corpusTgt: s.corpusTgtResolve,
      pctCorpusTgt: s.count ? Number(((100 * s.corpusTgtResolve) / s.count).toFixed(1)) : 0,
    },
    r7: { emptyEndpoint: s.emptyEndpoint, placeholderEndpoint: s.placeholderEndpoint, genericEndpoint: s.genericEndpoint, selfLoop: s.selfLoop },
    seam: { delegated: s.delegated, vueOwn: s.undelegated },
    sourceKind: s.bySourceKind,
    confidence: s.confidence,
    evidenceClass: s.evidenceClass,
    line: s.lines,
  }
}

const width = 44
const line = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\nvue ontology census — mode=${MODE} corpus=${REPO} admitted=${admitted.length} parsed=${parsed} failed=${failed}`)
console.log(`symbols=${totalSymbols} (${corpusSymbols.size} distinct names) relationships=${totalRels} imports[]=${totalImports} exports[]=${totalExports}`)
console.log(`files with a delegated (SFC-seam) row: ${filesWithScriptWork}`)
console.log(`\n${line("type", 15)}${line("verdict", 9)}${line("count", 9)}${line("files", 7)}${line("both%", 7)}${line("corpTgt%", 10)}${line("deleg/vueOwn", 14)}confidence`)
console.log("-".repeat(width + 78))
for (const t of ALL_TYPES) {
  const s = out.types[t] as any
  console.log(
    line(t, 15) + line(s.verdict, 9) + line(String(s.count), 9) + line(String(s.files), 7) +
    line(s.count ? `${s.resolved.pctBoth}%` : "-", 7) +
    line(s.count ? `${s.resolved.pctCorpusTgt}%` : "-", 10) +
    line(`${s.seam.delegated}/${s.seam.vueOwn}`, 14) +
    Object.entries(s.confidence as Record<string, number>).map(([k, v]) => `${k}:${v}`).join(" "),
  )
  if (s.r7.emptyEndpoint || s.r7.placeholderEndpoint) {
    console.log(`   R7: empty=${s.r7.emptyEndpoint} placeholder=${s.r7.placeholderEndpoint} selfLoop=${s.r7.selfLoop}`)
  } else if (s.r7.genericEndpoint) {
    console.log(`   R7: 0 placeholder · ${s.r7.genericEndpoint} generic-word endpoints (reported, not a finding) · selfLoop=${s.r7.selfLoop}`)
  }
}
console.log(`\nRAW relationship labels seen (enum member or not) — ${rawLabels.size} distinct:`)
for (const r of out.rawLabels as { label: string; count: number; files: number; example: string }[]) {
  const isEnum = (ALL_TYPES as readonly string[]).includes(r.label)
  console.log(`   ${line(r.label, 16)}${line(String(r.count), 9)}${line(`${r.files} files`, 12)}${isEnum ? "enum    " : "OFF-ENUM"} ${r.example}`)
}
console.log(`\nimports[] channel: ${totalImports}  kinds=${JSON.stringify(out.channels.imports.kinds)}`)
for (const e of importExamples) console.log(`   ${e}`)
console.log(`exports[] channel: ${totalExports}`)
if (parseFailures.length) { console.log(`\nparse failures (first 8):`); for (const p of parseFailures) console.log(`   ${p}`) }
if (OUT) { writeFileSync(OUT, JSON.stringify(out, null, 2)); console.log(`\nwrote ${OUT}`) }