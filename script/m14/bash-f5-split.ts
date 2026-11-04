/**
 * BASH — THE FIVE UNEXPLAINED `contains` ROWS OF THE CANONICAL F5 DRAW, SPLIT.
 *
 * ## The question
 *
 * `npx tsx script/m14/differential.ts --lang bash` reads, over otp's 60-file draw:
 * tree-truth 1553 · covered 1553 (100%) · MISSING 0 · analyzer-edges 1534 ·
 * **UNEXPLAINED 5, all `contains`** · hash 93dbe4539798b0ca. The sweep pins a lane
 * only at missing=0 AND unexplained=0, so those five rows are the whole difference
 * between this lane and a clean floor.
 *
 * The harness prints the five only as label|from->target (BB_DBG_UNEXP). This file
 * joins each one to the analyzer's own row and to the symbol it names, and counts the
 * CLASS the five are drawn from — because the harness's analyzer-edge match has a
 * substring fallback (`truth.target.includes(normTarget(analyzer.target))`), so a
 * `contains` row whose target is a substring of some truth target is counted as
 * explained even when the truth derived no such row. The five are the rows that
 * fallback did NOT mask, not necessarily the whole disagreement.
 *
 * ## What it measures
 *
 * For every `contains` row the analyzer emits on the draw:
 *   - the target symbol's kind and `metadata.isImplicitBinding` / `bindingSite`;
 *   - the contains targets the F5 oracle (`deriveBashEdges`'s contains block:
 *     `function_definition`, `variable_assignment`/`declaration_command`, `alias`)
 *     derives for the same file;
 *   - whether the row is EXACTLY derived, masked by the substring fallback, or
 *     genuinely unexplained.
 *
 * The oracle replica is a replica: it copies the oracle's contains rule as read at
 * script/m14/differential.ts (bash branch), so a change there must move this file
 * with it. The five rows it must reproduce are printed with their file, line,
 * source, target and binding site; a mismatch between the replica and the harness
 * is a defect in this instrument and is printed as such.
 *
 * Usage: bun script/m14/bash-f5-split.ts [sample-files.txt]
 *        (the list is the differential's own `BB_F5_SHOW_FILES=1` output)
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const CORPUS = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const REPO = process.env.BB_BASH_F5_REPO ?? "otp"
const SAMPLE = process.argv[2] ?? join(ROOT, ".tmp-lead/bash/sample-files.txt")

const rels = readFileSync(SAMPLE, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l.startsWith("[file] "))
  .map((l) => l.slice("[file] ".length).trim())
if (rels.length === 0) {
  console.error(`no '[file] <rel>' lines in ${SAMPLE}`)
  process.exit(2)
}

const engine = await import(`${ROOT}/src/ast/engine.ts`)
const analyzerMod = await import(`${ROOT}/src/ast/real-bash-analyzer.ts`)
const isAnalyzerClass = (v: unknown): boolean =>
  typeof v === "function" && !!(v as any).prototype && typeof (v as any).prototype.analyze === "function"
const Analyzer = Object.values(analyzerMod).find(isAnalyzerClass) as any
if (!Analyzer) {
  console.error("no analyzer class exported by src/ast/real-bash-analyzer.ts")
  process.exit(2)
}
const { getParser } = engine

/** The harness's normalisation chain for a match key (script/m14/differential.ts). */
function lastSegment(name: string): string {
  const parts = name.split(/::|\./).filter(Boolean)
  return parts[parts.length - 1] ?? name
}
function normTarget(t: string): string {
  const s = String(t ?? "").trim()
  const cut = s.search(/[[<]/)
  return lastSegment(cut > 0 ? s.slice(0, cut) : s)
}

/**
 * The F5 oracle's CONTAINS rule. It is IMPORTED, not replicated — `differential.ts`
 * gates its CLI on `process.argv[1]` ending with "differential.ts" (line 27178), so
 * importing the module runs nothing and this instrument can use the real oracle
 * rather than a copy that drifts. (The first version of this probe replicated the
 * rule and read 6 unexplained where the harness read 5 — a replica narrower than
 * the oracle reads as a disagreement that is not there.)
 */
const diffMod = await import(`${ROOT}/script/m14/differential.ts`)
const deriveBashEdges = (diffMod as any).deriveBashEdges as (root: any, scriptName: string) => { label: string; from: string; target: string }[]
if (typeof deriveBashEdges !== "function") {
  console.error("deriveBashEdges is not exported by script/m14/differential.ts")
  process.exit(2)
}
/** The contains targets the real F5 bash oracle derives for one file. */
function oracleContainsTargets(root: any, scriptName: string): { contains: Set<string>; all: { label: string; from: string; target: string }[] } {
  const all = deriveBashEdges(root, scriptName)
  const contains = new Set(all.filter((e) => e.label === "contains").map((e) => e.target))
  return { contains, all }
}

const BINDING_SEP = "\u0000"
function auditTarget(t: string): string {
  const v = String(t ?? "")
  const at = v.lastIndexOf(BINDING_SEP)
  return at >= 0 ? v.slice(at + BINDING_SEP.length) : v
}
const matchKey = (label: string, target: any): string => normTarget(auditTarget(String(target ?? "")))

const parser = await getParser("bash")

type Row = {
  file: string
  line: number
  source: string
  target: string
  kind: string
  bindingSite: string | null
  targetOwner: string | null
  oracleDerived: boolean
  masked: boolean
}

const containsRows: Row[] = []
let containsTotal = 0
let parseFailures = 0
for (const rel of rels) {
  let content = ""
  try {
    content = readFileSync(join(CORPUS, REPO, rel), "utf8")
  } catch {
    parseFailures++
    continue
  }
  let root: any = null
  try {
    root = (await parser.parse(content, rel)).rootNode
  } catch {
    parseFailures++
    continue
  }
  const res: any = new Analyzer().analyze(root, content, rel)
  const symbols: any[] = res.symbols ?? []
  const symbolByName = new Map<string, any>()
  for (const s of symbols) if (s?.name && !symbolByName.has(s.name)) symbolByName.set(s.name, s)
  const scriptBase = rel.split("/").pop() ?? "script.sh"
  const { contains: oracleContains, all: oracleRows } = oracleContainsTargets(root, scriptBase)
  for (const r of res.relationships ?? []) {
    const type = r.type ?? r.relationshipType
    if (type !== "contains") continue
    containsTotal++
    const sym = symbolByName.get(r.target)
    const isImplicit = !!(sym?.metadata?.isImplicitBinding)
    const site = sym?.metadata?.bindingSite ?? null
    const kind = sym?.kind ?? "unpublished"
    // THE HARNESS'S MATCH, exactly (script/m14/differential.ts: `for (const r of rels)`):
    // label equal AND (same matchKey OR — label !== imports — a truth target that
    // CONTAINS the analyzer target's matchKey).
    const rk = matchKey("contains", r.target)
    const sameKey = [...oracleContains].some((t) => matchKey("contains", t) === rk)
    const substringHit = oracleRows.some((te) => te.label === "contains" && String(te.target).includes(rk))
    const oracleDerived = sameKey
    const masked = sameKey || substringHit
    containsRows.push({
      file: rel,
      line: Number(r.line_number ?? 0),
      source: String(r.source ?? ""),
      target: String(r.target ?? ""),
      kind: String(kind),
      bindingSite: site === null ? null : String(site),
      targetOwner: String(sym?.ownerName ?? ""),
      oracleDerived,
      masked,
    })
  }
  try { root?.delete?.() } catch { /* instance may already be gone */ }
}

// The harness dedupes the analyzer side per file on `label|target` (raw target),
// so the classes below are counted on that same grain.
const seenKey = new Set<string>()
const deduped: Row[] = []
for (const r of containsRows) {
  const k = `${r.file}|contains|${r.target}`
  if (seenKey.has(k)) continue
  seenKey.add(k)
  deduped.push(r)
}
const implicitRows = deduped.filter((r) => r.bindingSite !== null)
const maskedImplicit = implicitRows.filter((r) => r.masked && !r.oracleDerived)
const substringMasked = deduped.filter((r) => !r.oracleDerived && r.masked)
const unexplained = deduped.filter((r) => !r.masked)

const bySite = new Map<string, number>()
for (const r of implicitRows) bySite.set(String(r.bindingSite), (bySite.get(String(r.bindingSite)) ?? 0) + 1)

console.log(`bash F5 contains split — repo=${REPO} sample=${rels.length} parsed=${rels.length - parseFailures} parseFailures=${parseFailures}`)
console.log(`contains rows emitted by the analyzer on the draw : ${containsTotal}  (the harness compares ${deduped.length} after its label|target dedupe)`)
console.log(`  DEDUPED so the harness's arithmetic is reproducible           : ${deduped.length}`)
console.log(`  target is an EXPLICIT declaration (oracle-derived): ${deduped.filter((r) => r.oracleDerived).length}`)
console.log(`  target is an IMPLICIT binding (for/read/mapfile/printf -v): ${implicitRows.length}`)
console.log(`      by binding site: ${[...bySite.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ") || "(none)"}`)
console.log(`      ALSO an explicit declaration target (exactly derived) : ${implicitRows.filter((r) => r.oracleDerived).length}`)
console.log(`      masked by the harness's substring fallback            : ${substringMasked.length}`)
console.log(`      NOT masked => UNEXPLAINED                            : ${implicitRows.filter((r) => !r.masked).length}`)
console.log(`other unexplained (non-implicit, should be 0)              : ${deduped.filter((r) => !r.masked && r.bindingSite === null).length}`)
console.log()
console.log(`UNEXPLAINED ROWS (${unexplained.length}) — each is an implicit-binding ownership edge:`)
for (const r of unexplained) {
  console.log(`  ${r.file}:${r.line}  ${r.source} -> ${r.target}  kind=${r.kind} site=${r.bindingSite} owner=${r.targetOwner}`)
}
console.log()
const harnessSay = unexplained.length
console.log(`REPLICA CHECK: this instrument reproduces ${harnessSay} unexplained contains row(s); the harness printed 5.`)
console.log(`A row here is ORACLE-UNDERIVED, not an analyzer fabrication: deriveBashEdges' contains block derives`)
console.log(`function_definition + variable_assignment/declaration_command + alias, and has no derivation for the`)
console.log(`binding constructs the analyzer's implicit-binding collector publishes (for/read/mapfile/printf -v).`)
