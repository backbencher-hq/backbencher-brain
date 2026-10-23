/**
 * THE SETTER-LEAF CENSUS — the shape test's `=` refusal, measured over the whole admitted population.
 *
 * ⇒ WHAT HAPPENED. The shared `filterNoiseRelationships` used to refuse a target whose leaf was
 * longer than 80 characters. THAT BUDGET WAS MEASURED AGAINST BY THIS LANE (the four
 * `ExecutionFinalizeTest.test_multiple_offenses_for_non_null_position_without_intersecting_…` rows,
 * leaf lengths 98/96/98/96, with a short-target control beside them) and the shared file REPLACED IT
 * with a shape test — which is right in its intent, a snippet is not an IDENTIFIER, it carries
 * characters an identifier cannot.
 *
 * ⇒ BUT THE REPLACEMENT'S CHARACTER SET INCLUDES `=`, AND IN RUBY `=` IS A LEGAL IDENTIFIER
 * CHARACTER: `attr_accessor :level` declares a writer named `level=`, and `def level=(v)` is an
 * ordinary setter definition. **⇒ EVERY RUBY SETTER NAME ENDS IN `=`, AND EVERY SETTER `contains`
 * EDGE IS THEREFORE SILENTLY EATEN BY THE NEW SHAPE TEST.** The loss is SILENT in the worst sense:
 * the edges are ABSENT from the graph rather than mis-bound, so no column and no count shows it.
 * The operator-name exemption (a leaf made SOLELY of operator characters) does not cover it —
 * `level=` mixes letters with the operator character.
 *
 * ⇒ THE MEASUREMENT. Over the whole admitted population: run the PRODUCTION path
 * (`pool-worker.parseFile`) and the DIRECT path (`analyze()`) on every file, diff the row sets by
 * key, and CLASSIFY every row the production path drops by the shape of its target leaf. Then hand
 * the dropped rows to `filterNoiseRelationships` directly, with a CONTROL beside them: the same row
 * with the `=` removed is KEPT, so the analyzer emitted it and the filter ate it — a measurement and
 * not a report.
 *
 * EXIT CODE: 0. The counts are the answer; a non-zero exit would be a claim, and this file makes
 * none.
 */
import { parseFile, filterNoiseRelationships } from "../../src/ast/pool-worker"
import { getParser } from "../../src/ast/engine"
import { RealRubyAnalyzer } from "../../src/ast/real-ruby-analyzer"
import { readFileSync, statSync, readdirSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import * as path from "node:path"

const CR = process.env.BB_CORPUS_ROOT ?? path.resolve(process.cwd(), ".corpus")
const MAX_BYTES = 1024 * 1024

// ── THE POPULATION: the corpus is MANY git repos under `.corpus/`, not one repo ──────────────────
const files: string[] = []
{
  let entries: string[] = []
  try { entries = readdirSync(CR) } catch { entries = [] }
  const seen = new Set<string>()
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try { if (!statSync(dir).isDirectory()) continue } catch { continue }
    try { execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" }) } catch { continue }
    let tracked: string[] = []
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 })
        .split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".rb")) continue
      const abs = path.join(dir, rel)
      try { if (statSync(abs).size > MAX_BYTES) continue } catch { continue }
      if (seen.has(abs)) continue
      seen.add(abs)
      files.push(abs)
    }
  }
}

const key = (r: any) => `${r.type}|${r.source}|${r.target}|${JSON.stringify(r.metadata ?? {})}`
const leafOf = (t: string) => {
  const s = String(t ?? "")
  const i = Math.max(s.lastIndexOf("."), s.lastIndexOf(":"), s.lastIndexOf("#"))
  return (i >= 0 ? s.slice(i + 1) : s).trim()
}

// ⇒ THE TWO ARMS RUN IN SEPARATE PROCESSES, AND THAT IS NOT COSMETIC.
// The tree-sitter WASM parser is a CACHED SINGLETON (`getParser`), and the PRODUCTION path parses
// through it too. Interleaving `parser.parse()` with `parseFile()` on the same instance corrupts
// the WASM heap — the first run of this instrument died with "Out of bounds memory access
// (evaluating 'C._ts_parser_parse_wasm…')" on 20 files. ⇒ SO EACH ARM WRITES ITS OWN ROW SET TO
// ITS OWN FILE, AND A THIRD PASS DIFFS THE TWO FILES. NO PROCESS EVER PARSES WITH BOTH ARMS.
const ARM = (process.argv.find(a => a.startsWith("--arm=")) ?? "--arm=direct").split("=")[1]
const OUT_DIR = path.join(CR, "..", "validation", "m14", "measurements")

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE ARM FILE'S PROVENANCE — AND WHY IT EXISTS, IN THE WORDS OF THE DEFECT IT PREVENTS.
//
// ⇒ WHAT HAPPENED. The Lead ran `--arm=diff` immediately after fixing the shared filter, and the
// pass printed "dropped by production: 7" — from arm files written BEFORE the fix — while the
// SAME OUTPUT's live half said "eaten by the filter when handed to it ALONE: false", because that
// half calls the LIVE filter. **⇒ THE OUTPUT CONTRADICTED ITSELF, AND THE STALE HALF WAS READ AS
// IF IT WERE A MEASUREMENT OF THE CURRENT CODE.** The arm files' mtimes were 1792649859 and
// 1792649882; the edited source was 1792650214. **⇒ THE ARTIFACTS WERE OLDER THAN THE CODE.**
//
// ⇒ AND THAT IS THE FLEET'S MOST COMMON FAILURE IN ITS OWN WORDS: A MEASUREMENT THAT CANNOT
// DISTINGUISH WHAT IT MEASURED FROM A COPY OF IT IS NOT A MEASURE. The same shape as the index
// cache that was keyed on a COUNT rather than on the file set's identity. **⇒ A COUNT IS NOT AN
// IDENTITY, AND AN MTIME IS NOT AN IDENTITY EITHER — THE IDENTITY IS THE CONTENT HASH.** So:
//
//   1. EVERY ARM FILE CARRIES THE SHA-256 OF EVERY SOURCE IT WAS PRODUCED FROM, and the arm
//      DECLARES which sources it depends on — the `direct` arm reads the analyzer, the
//      `production` arm reads the analyzer THROUGH the shared filter, so each declares its own.
//   2. THE DIFF PASS RE-READS THOSE SOURCES AND COMPARES THE HASHES. If any differ, the arms are
//      STALE and the diff **REFUSES** — loudly, with the table, and with a NON-ZERO exit.
//   3. AN ARM FILE WITH NO PROVENANCE BLOCK AT ALL IS ALSO REFUSED. A file that does not say
//      what it was produced from is not a measurement, and reading it as one is the defect.
//
// ⇒ AND THE GUARD IS PROVEN TO FIRE, not merely present: `--arm=provenance-self-test` writes a
// DELIBERATELY STALE arm file and shows the guard REFUSING it, and shows the real arm files
// PASSING. **⇒ A GUARD THAT CANNOT BE SEEN TO FIRE IS NOT A GUARD.**
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** THE REPO ROOT — derived from the corpus root, which is `<repo>/.corpus`, so this holds wherever the instrument is run from. */
const REPO = path.resolve(CR, "..")

/** THE SOURCES EACH ARM IS PRODUCED FROM. The `direct` arm reads the analyzer directly; the `production` arm reads it THROUGH the shared filter, so the filter is part of its identity too. */
const ARM_SOURCES: Record<string, string[]> = {
  direct: ["src/ast/real-ruby-analyzer.ts", "src/ast/engine.ts"],
  production: ["src/ast/real-ruby-analyzer.ts", "src/ast/engine.ts", "src/ast/pool-worker.ts"],
}

/** THE SHA-256 OF A FILE'S BYTES — the identity of what was measured. */
function sha256Of(abs: string): string {
  return createHash("sha256").update(readFileSync(abs)).digest("hex")
}

/** The mtime of a file, or -1 when it is unreadable. */
function mtimeOf(abs: string): number {
  try { return Math.floor(statSync(abs).mtimeMs) } catch { return -1 }
}

/** The identity block an arm file carries. */
function provenanceFor(arm: string): Record<string, any> {
  const sources: Record<string, { sha256: string; mtimeEpoch: number }> = {}
  for (const rel of ARM_SOURCES[arm] ?? []) {
    const abs = path.join(REPO, rel)
    sources[rel] = { sha256: sha256Of(abs), mtimeEpoch: mtimeOf(abs) }
  }
  return {
    instrument: "script/m14/ruby-setter-leaf-census.ts",
    arm,
    writtenAtEpoch: Date.now(),
    writtenAt: new Date().toISOString(),
    corpusRoot: CR,
    sources,
  }
}

/**
 * THE GUARD. Compare an arm file's recorded provenance against the CURRENT sources.
 * ⇒ Returns the list of mismatches. An empty list means the arm IS a measurement of the current
 * code; a non-empty list means it is a measurement of a COPY, and the diff must refuse.
 */
function stalenessOf(armFile: Record<string, any>): { arm: string; source: string; recorded: string; current: string; recordedMtime: number; currentMtime: number }[] {
  const out: { arm: string; source: string; recorded: string; current: string; recordedMtime: number; currentMtime: number }[] = []
  const prov = armFile?.provenance
  if (!prov) return out
  for (const [rel, rec] of Object.entries<any>(prov.sources ?? {})) {
    const abs = path.join(REPO, rel)
    let current = "MISSING"
    try { current = sha256Of(abs) } catch { current = "UNREADABLE" }
    if (current !== rec?.sha256) {
      out.push({ arm: String(prov.arm ?? "?"), source: rel, recorded: String(rec?.sha256 ?? "?"), current, recordedMtime: Number(rec?.mtimeEpoch ?? -1), currentMtime: mtimeOf(abs) })
    }
  }
  return out
}

type Dropped = {
  file: string
  type: string
  source: string
  target: string
  leaf: string
  leafLength: number
  shape: "hasEquals" | "noEquals"
  eatenByFilterAlone: boolean
  controlKept: boolean
}

const dropped: Dropped[] = []
let productionRows = 0
let directRows = 0
let parseFailures = 0

mkdirSync(OUT_DIR, { recursive: true })
const armFile = path.join(OUT_DIR, `ruby-setter-leaf-census-${ARM}.json`)

if (ARM === "direct" || ARM === "production") {
  const out: Record<string, any[]> = {}
  for (const abs of files) {
    const rel = path.relative(CR, abs)
    let rows: any[] = []
    try {
      if (ARM === "production") {
        const prod = await parseFile(abs, "ruby" as any)
        rows = (prod.relationships ?? []) as any[]
      } else {
        const content = readFileSync(abs, "utf8")
        const parser = await getParser("ruby" as any)
        const analyzer = new RealRubyAnalyzer()
        // ⇒ THE ROOT IS CHECKED, NOT ASSUMED. `parse()` returns `Tree | null`, and a null root
        // would be an EMPTY row set — which reads exactly like "this file has no relationships",
        // and would make the diff's missing-row count a count over an empty population. ⇒ THROW,
        // so the existing catch COUNTS it as a failure and the file is never silently empty.
        const root = parser.parse(content)?.rootNode
        if (!root) throw new Error("no root node")
        const direct = await analyzer.analyze(root, content, abs)
        rows = (direct.relationships ?? []) as any[]
      }
    } catch (e) { parseFailures++; continue }
    out[rel] = rows.map(r => ({ type: r.type, source: r.source, target: r.target, metadata: r.metadata ?? {} }))
  }
  writeFileSync(armFile, JSON.stringify({ provenance: provenanceFor(ARM), rows: out }))
  console.log(`RUBY — the ${ARM} arm wrote ${Object.keys(out).length} file(s) to ${armFile} · ${parseFailures} failure(s)`)
  console.log(`  the arm's PROVENANCE — the identity of what was measured:`)
  for (const [rel, rec] of Object.entries<any>(provenanceFor(ARM).sources)) {
    console.log(`      ${rel}  sha256 ${String(rec.sha256).slice(0, 16)}…  mtime ${rec.mtimeEpoch}`)
  }
  process.exit(0)
}

/**
 * READ AN ARM FILE, AND REFUSE A FILE THAT DOES NOT SAY WHAT IT WAS PRODUCED FROM.
 * ⇒ A file with no provenance block is refused rather than read, because the whole defect this
 * guard exists for was a stale arm read as a measurement of the current code — and a file with
 * no identity at all is the same failure with less evidence.
 */
function readArmFile(file: string): { rows: Record<string, any[]>; provenance: any } {
  const raw = JSON.parse(readFileSync(file, "utf8"))
  if (!raw || typeof raw !== "object" || !raw.provenance || !raw.rows) {
    console.error(`ARM FILE REFUSED — ${path.basename(file)} carries NO PROVENANCE BLOCK.`)
    console.error("  An arm file that does not say which sources it was produced from is not a measurement, and")
    console.error("  reading it as one IS the defect this guard exists for. ⇒ RE-RUN the arms:")
    console.error("      --arm=direct && --arm=production")
    process.exit(4)
  }
  return { rows: raw.rows as Record<string, any[]>, provenance: raw.provenance }
}

// ⇒ THE PROVENANCE SELF-TEST — THE GUARD IS PROVEN TO FIRE, NOT MERELY PRESENT.
if (ARM === "provenance-self-test") {
  const real = readArmFile(path.join(OUT_DIR, "ruby-setter-leaf-census-direct.json"))
  const realStale = stalenessOf(real)
  // A DELIBERATELY STALE ARM: the same rows, with ONE source's hash replaced by a wrong one.
  const staleCopy = {
    provenance: {
      ...real.provenance,
      arm: "direct",
      writtenAtEpoch: Date.now() - 3600_000,
      sources: { ...real.provenance.sources },
    },
    rows: real.rows,
  }
  const firstKey = Object.keys(staleCopy.provenance.sources)[0]
  staleCopy.provenance.sources[firstKey] = { ...staleCopy.provenance.sources[firstKey], sha256: "0".repeat(64) }
  const staleDetected = stalenessOf(staleCopy)
  const tmp = path.join(OUT_DIR, "ruby-setter-leaf-census-STALE-SELFTEST.json")
  writeFileSync(tmp, JSON.stringify(staleCopy))
  const onDisk = readArmFile(tmp)
  const onDiskDetected = stalenessOf(onDisk)
  const realArmsFresh = realStale.length === 0
  console.log("RUBY — THE PROVENANCE SELF-TEST (the guard, shown firing)")
  console.log(`  the real ${"direct"} arm against the CURRENT sources: ${realStale.length} mismatch(es) → ${realArmsFresh ? "FRESH" : "STALE"}`)
  console.log(`  a deliberately stale arm (one source hash replaced):   ${staleDetected.length} mismatch(es) → ${staleDetected.length > 0 ? "DETECTED" : "NOT DETECTED"}`)
  console.log(`  the same stale arm read back from DISK:                ${onDiskDetected.length} mismatch(es) → ${onDiskDetected.length > 0 ? "DETECTED" : "NOT DETECTED"}`)
  for (const s of onDiskDetected) console.log(`      ${s.arm}  ${s.source}  recorded ${s.recorded.slice(0, 16)}…  current ${s.current.slice(0, 16)}…`)
  const guardFires = staleDetected.length > 0 && onDiskDetected.length > 0
  console.log(`  ⇒ THE GUARD FIRES: ${guardFires}`)
  console.log(`  ⇒ AND THE REAL ARM IS FRESH: ${realArmsFresh}`)
  writeFileSync(path.join(OUT_DIR, "ruby-setter-leaf-provenance-self-test-2026-10-22.json"), JSON.stringify({
    realArmMismatches: realStale.length,
    deliberatelyStaleArmMismatches: staleDetected.length,
    staleArmReadBackFromDiskMismatches: onDiskDetected.length,
    theGuardFires: guardFires,
    theRealArmIsFresh: realArmsFresh,
    instrument: "script/m14/ruby-setter-leaf-census.ts --arm=provenance-self-test",
  }, null, 2) + "\n")
  try { require("node:fs").unlinkSync(tmp) } catch { /* the scratch file may stay; it is inside the measurements dir and is named STALE-SELFTEST */ }
  process.exit(guardFires ? 0 : 5)
}

const directArm = readArmFile(path.join(OUT_DIR, "ruby-setter-leaf-census-direct.json"))
const prodArm = readArmFile(path.join(OUT_DIR, "ruby-setter-leaf-census-production.json"))
const directMap = directArm.rows
const prodMap = prodArm.rows

// ⇒ THE STALE-ARM GUARD, IN THE DIFF PASS. The arms are compared against the CURRENT sources,
// and a mismatch is a REFUSAL, not a warning: a diff over a stale arm is a measurement of a copy.
const staleArms = [...stalenessOf(directArm), ...stalenessOf(prodArm)]
if (staleArms.length > 0) {
  console.log("RUBY — THE SETTER-LEAF CENSUS — THE DIFF REFUSES A STALE ARM")
  console.log("  ⇒ The arm files were produced from sources that have since CHANGED. A diff over them is a")
  console.log("    measurement of a COPY of the code, not of the code, and it CONTRADICTS this pass's own")
  console.log("    live half (which calls the CURRENT filter). ⇒ REFUSING.")
  for (const s of staleArms) {
    console.log(`      ${s.arm}  ${s.source}`)
    console.log(`         recorded sha256 ${s.recorded}  (mtime ${s.recordedMtime})`)
    console.log(`         current  sha256 ${s.current}  (mtime ${s.currentMtime})`)
  }
  console.log(`  ⇒ RE-RUN the arms and the diff, in this order:`)
  console.log(`      --arm=direct && --arm=production && --arm=diff`)
  process.exit(3)
}
console.log("RUBY — THE SETTER-LEAF CENSUS — the arms are FRESH against the current sources")
for (const [armName, arm] of [["direct", directArm], ["production", prodArm]] as const) {
  const p = arm.provenance
  console.log(`  ${armName}: written ${p.writtenAt} (epoch ${p.writtenAtEpoch})`)
  for (const [rel, rec] of Object.entries<any>(p.sources)) {
    console.log(`      ${rel}  sha256 ${String(rec.sha256).slice(0, 16)}…  mtime ${rec.mtimeEpoch}  — MATCHES the current file`)
  }
}
// ⇒ THE DIFF PASS. Both arm files exist and are FRESH (the guard above has already refused a
// stale one); nothing is parsed here, so no process touches the parser.
for (const rel of Object.keys(directMap)) {
  const dRows = directMap[rel] ?? []
  const pRows = prodMap[rel] ?? []
  productionRows += pRows.length
  directRows += dRows.length
  const pSet = new Set(pRows.map(key))
  for (const r of dRows) {
    if (pSet.has(key(r))) continue
    const leaf = leafOf(r.target)
    // ASK THE FILTER DIRECTLY, WITH A CONTROL BESIDE IT: the same row with the offending character
    // removed must be KEPT, or the "the filter ate it" claim has no control and is only a report.
    const alone = filterNoiseRelationships([{ ...r }] as any, "ruby" as any)
    const eaten = alone.length === 0
    const control = filterNoiseRelationships([{ ...r, target: leaf.replace(/=/g, "") }] as any, "ruby" as any)
    dropped.push({
      file: rel,
      type: r.type,
      source: String(r.source ?? ""),
      target: String(r.target ?? ""),
      leaf,
      leafLength: leaf.length,
      shape: leaf.includes("=") ? "hasEquals" : "noEquals",
      eatenByFilterAlone: eaten,
      controlKept: control.length > 0,
    })
  }
}

const withEquals = dropped.filter(d => d.shape === "hasEquals")
const withoutEquals = dropped.filter(d => d.shape === "noEquals")
const allEaten = dropped.length > 0 && dropped.every(d => d.eatenByFilterAlone)
const allControlled = dropped.length > 0 && dropped.every(d => d.controlKept)
const byType: Record<string, number> = {}
for (const d of dropped) byType[d.type] = (byType[d.type] ?? 0) + 1

// ⇒ THE PROPOSED FIX, MEASURED HERE RATHER THAN CLAIMED THERE. The Lead's file commits
// `0b86199f8` (the SETTER_NAME exemption) and its commit message states that "`[]=` — ruby's own
// index-setter — was already exempt as an operator name". **⇒ THAT CLAIM IS TRUE OF THE INTENT AND
// FALSE OF THE EFFECT: THE OPERATOR CHARACTER CLASS IS `/^[<>=!+\-*/%^&|~]+$/`, AND IT DOES NOT
// INCLUDE `[` OR `]`.** So `[]=` never matched it, and the 7 rows that survive the Lead's fix are
// all `[]=`. ⇒ THE PROPOSED CHANGE IS TO EXTEND THE OPERATOR CLASS WITH THE BRACKETS, which makes
// `[]` and `[]=` operator names — and `[]` IS ruby's index reader, a legal declared method name.
//
// ⇒ AND THIS ARM MEASURES THE PROPOSED RULE WITHOUT EDITING THE LEAD's FILE: it applies the
// extended class to the dropped rows AND to a CONTROL SET of the fragments the rule must keep
// refusing, so the proposal is judged on both sides.
if (ARM === "proposal") {
  // ⇒ THE SAME GUARDED READERS AS THE DIFF PASS. The proposal arm measures the dropped rows, and
  // the dropped rows come from the arm files — so the arm files must be FRESH here too, or the
  // proposal is measured against a copy of the code. The guard has already run by this point: a
  // stale arm exits 3 before this branch is reached.
  const missing: any[] = []
  for (const rel of Object.keys(directMap)) {
    const pSet = new Set((prodMap[rel] ?? []).map(key))
    for (const r of directMap[rel] ?? []) {
      if (!pSet.has(key(r))) missing.push({ file: rel, ...r })
    }
  }
  // THE PROPOSED OPERATOR CLASS: the current one PLUS the two bracket characters.
  const PROPOSED_OPERATOR = /^[<>=!+\-*/%^&|~\[\]]+$/
  const SETTER_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*=$/
  // THE PROPOSED SHAPE RULE, WRITTEN OUT IN FULL so the proposal is judged, not trusted.
  const proposedKeeps = (leaf: string) => {
    if (leaf.includes("\n")) return false
    if (/[\s'"(),=]/.test(leaf) && !PROPOSED_OPERATOR.test(leaf) && !SETTER_NAME.test(leaf)) return false
    if (!PROPOSED_OPERATOR.test(leaf) && /[{}`<>\n\r\t]/.test(leaf)) return false
    if (leaf.startsWith(" ") || leaf.includes("  ")) return false
    return true
  }
  const CONTROLS = [
    { leaf: "foo = bar", expectKept: false, why: "whitespace and `=` in the middle — a fragment" },
    { leaf: "foo=bar", expectKept: false, why: "`=` in the middle — a fragment, not a setter name" },
    { leaf: "a = b", expectKept: false, why: "whitespace — a fragment" },
    { leaf: "x==y", expectKept: false, why: "`=` inside, not an operator-only leaf" },
    { leaf: "level=", expectKept: true, why: "a SETTER NAME — identifier plus a trailing `=`" },
    { leaf: "[]", expectKept: true, why: "ruby's index READER — an operator name" },
    { leaf: "[]=", expectKept: true, why: "ruby's index WRITER — an operator name" },
    { leaf: "ast_nodes=", expectKept: true, why: "a SETTER NAME" },
  ]
  const rowsStillDropped = missing.filter(m => !proposedKeeps(leafOf(m.target)))
  const controlResults = CONTROLS.map(c => ({ ...c, kept: proposedKeeps(c.leaf) }))
  const controlsGreen = controlResults.every(c => c.kept === c.expectKept)
  console.log("RUBY — THE PROPOSED OPERATOR-CLASS CHANGE, MEASURED (not claimed)")
  console.log("  rows the PRODUCTION path still drops: " + missing.length)
  console.log("  of those, the PROPOSED rule would STILL refuse: " + rowsStillDropped.length)
  for (const r of rowsStillDropped.slice(0, 10)) console.log("      " + r.file + "  " + r.type + " " + r.source + " -> " + r.target + "  leaf=\"" + leafOf(r.target) + "\"")
  console.log("  the leaf classes still dropped: " + JSON.stringify([...new Set(missing.map(m => leafOf(m.target)))]))
  console.log("  ⇒ THE CONTROLS ARE GREEN: " + controlsGreen)
  for (const c of controlResults) console.log("      control leaf=\"" + c.leaf + "\" kept=" + c.kept + " expected=" + c.expectKept + " (" + c.why + ")")
  writeFileSync(path.join(OUT_DIR, "ruby-setter-leaf-proposal-2026-10-22.json"), JSON.stringify({
    rowsStillDroppedByProduction: missing.length,
    rowsTheProposedRuleWouldStillRefuse: rowsStillDropped.length,
    leafClassesStillDropped: [...new Set(missing.map(m => leafOf(m.target)))],
    controlsGreen,
    controlResults,
    theProposal:
      "Extend the shared filter's OPERATOR-NAME CHARACTER CLASS with `[` and `]`, so `[]` (ruby's index reader) and `[]=` (ruby's index writer) are operator names. The SETTER_NAME exemption added in 0b86199f8 stays as it is — it is correct — and the two rules do not overlap.",
  }, null, 2) + "\n")
}

const report = {
  population: { corpusRoot: CR, admitted: files.length, parseFailures },
  productionRows,
  directRows,
  productionMinusDirect: productionRows - directRows,
  droppedRows: dropped.length,
  droppedByType: byType,
  droppedWithEqualsInLeaf: withEquals.length,
  droppedWithoutEqualsInLeaf: withoutEquals.length,
  everyDroppedRowIsEatenByTheFilterAlone: allEaten,
  everyDroppedRowHasAControlThatIsKept: allControlled,
  theRoot:
    "The shared filter's replacement shape test refuses a leaf containing `=`. In ruby `=` is a LEGAL IDENTIFIER CHARACTER: `attr_accessor :level` declares a writer named `level=`, and `def level=(v)` is an ordinary setter. So every ruby setter's `contains` (and `overrides`) row is silently eaten.",
  theRemedy:
    "The shape test's character set must treat `=` as legal when it is a TRAILING setter marker — the same way the operator rule already exempts a leaf made SOLELY of operator characters. A leaf that ENDS in `=` and is otherwise an identifier is a setter name, not a snippet; a leaf that CONTAINS `=` in the middle is still a fragment and is still refused.",
  examples: dropped.slice(0, 14),
  instrument: "script/m14/ruby-setter-leaf-census.ts",
}
mkdirSync(path.join(CR, "..", "validation", "m14", "measurements"), { recursive: true })
writeFileSync(
  path.join(CR, "..", "validation", "m14", "measurements", "ruby-setter-leaf-census-2026-10-21.json"),
  JSON.stringify(report, null, 2) + "\n",
)

console.log("RUBY — THE SETTER-LEAF CENSUS (the `=` shape test)")
console.log(`  population ${files.length} admitted .rb · parse failures ${parseFailures}`)
console.log(`  production ${productionRows} rows · direct ${directRows} rows · Δ ${productionRows - directRows}`)
console.log(`  dropped by production: ${dropped.length}  (${JSON.stringify(byType)})`)
console.log("  => dropped WITH an '=' in the leaf: " + withEquals.length + " · WITHOUT: " + withoutEquals.length)
console.log(`  ⇒ every dropped row is eaten by the filter when handed to it ALONE: ${allEaten}`)
console.log("  => every dropped row has a CONTROL (the same row without '=') that is KEPT: " + allControlled)
for (const d of dropped.slice(0, 8)) {
  console.log(`      ${d.file}  ${d.type} ${d.source} -> ${d.target}  leaf="${d.leaf}" len=${d.leafLength} eaten=${d.eatenByFilterAlone} controlKept=${d.controlKept}`)
}
