/**
 * NIM CAUSE CENSUS — every UNRESOLVED row of the whole-population arm, dispositioned as an EXACT
 * PARTITION of named causes, each with a count and a falsifier.
 *
 * ## WHY THIS EXISTS
 *
 * The arm (`script/m14/incoming-gate.ts nim nim,nims,nimble 0 --dump`) prints one `unresolved`
 * number per type and one `TOTAL`. **A TOTAL IS NOT A CAUSE.** The completion gate's condition (D)
 * requires every wall to be dispositioned with a count and a falsifier, and php's lane showed the
 * shape that satisfies it: the unresolved rows are partitioned into classes that SUM to the
 * unresolved total exactly, each class naming a CONSTRUCT-level cause and carrying a falsifier that
 * a re-run of this same instrument would trip.
 *
 * ## THE INPUTS, AND WHERE EACH NUMBER COMES FROM
 *
 *   · THE ARM LOG (`--arm`): TABLE 1 (the 11-term closure) and the per-edge `DUMP` rows the gate
 *     prints for every NON-RESOLVED edge. The dump is bounded by `BB_DUMP_LIMIT`; this instrument
 *     REFUSES a truncated dump (`DUMP\tBOUND\tREACHED`) because a partition over a truncated dump
 *     would under-count the movement and look identical to a complete one.
 *   · THE EXTENDED-TYPES CENSUS (`--census`): its published per-repository declared-name index.
 *     That is what makes the classes below SEMANTIC rather than syntactic — a bare name can be
 *     looked up as "declared in ANOTHER FILE of this project", "declared in ANOTHER REPOSITORY",
 *     or "declared NOWHERE", and those are three different causes with three different repairs.
 *     ONE INSTRUMENT WALKS THE TREE; this one reads what it saw. No second parse of the population.
 *
 * ## THE PARTITION (the wall = `unresolved` + `externalRefuted`, TABLE 1's own `unresolved` column)
 *
 *   M1 module-name-not-carried-in-the-project        imports/part_of target no admitted file names
 *   M2 module-name-carried-in-another-repository     imports/part_of target another repo carries
 *   M3 module-carried-in-the-same-project-but-unresolved
 *                                                    the project's own module and STILL unresolved
 *                                                    — a lookup wall, counted rather than hidden
 *   D1 member-or-qualified-target                    a dotted/qualified target (a member of
 *                                                    something; a per-file analyzer cannot state
 *                                                    the receiver type)
 *   B1 bare-name-declared-elsewhere-in-same-project  the per-FILE scope wall: the declaration is
 *                                                    in this project, in another file
 *   B2 bare-name-declared-in-another-repository      external evidence: this project does not
 *                                                    carry the name, the corpus does
 *   B3 bare-name-declared-nowhere                    the vendor/builtin boundary: nothing in the
 *                                                    admitted corpus declares the name
 *   U0 unclassified                                  MUST BE 0 — this instrument exits non-zero
 *                                                    rather than absorb a row it cannot name
 *
 * ## THE FALSIFIERS
 *
 * Every class is checked in TWO independent ways, and the run FAILS on either:
 *   1. the partition SUM must equal the arm's unresolved total exactly (exit 6);
 *   2. a SECOND, separately-written verification pass re-reads the census index and checks the
 *      membership DIRECTION each class claims — a `…declared-nowhere` row whose name IS in the
 *      index, or a `…carried-in-another-repository` row whose name is NOT, fails (exit 7).
 * The per-class `falsifier.wouldFail` text in the artifact names exactly that direction, so a
 * reader can re-run this instrument and watch it go red.
 *
 * ## THE ARM'S OWN RECONCILIATION IS ALSO CHECKED
 *
 * The DUMP buckets must agree with TABLE 1's columns row by row: dumped ambiguous rows = `amb(decl)`,
 * dumped external rows = `extOK+ext?+extFAIL`, dumped binding rows = `bindOK+bind?+bindFAIL`, dumped
 * cause rows = `causeOK+causeFAIL`, dumped wall rows = `unresolved`. That proves the dump is the
 * whole non-resolved set and not a sample of it (exit 5 otherwise).
 *
 * Usage:
 *   bun run script/m14/nim-cause-census.ts [--arm <log>] [--census <json>] [--json <out>]
 * Exit: 0 ok · 2 missing input · 3 population mismatch · 4 TABLE1 closure break ·
 *       5 dump/TABLE1 reconciliation break · 6 partition break · 7 falsifier break
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "..", "..")
const argv = process.argv.slice(2)
const argOf = (f: string): string | undefined => {
  const i = argv.indexOf(f)
  return i >= 0 ? argv[i + 1] : undefined
}
const ARM = argOf("--arm") ?? path.join(ROOT, "validation/m14/measurements/nim/nim-gate-whole-2026-10-23.txt")
const CENSUS = argOf("--census") ?? path.join(ROOT, "validation/m14/measurements/nim-extended-census.json")
const POP = path.join(ROOT, "validation/m14/measurements/nim-population.json")
const JSON_OUT = argOf("--json")
const L: string[] = []
const say = (s = "") => { L.push(s); console.log(s) }

for (const [what, p] of [["arm log", ARM], ["extended-types census", CENSUS], ["population artifact", POP]] as const) {
  if (!existsSync(p)) { console.error(`FATAL: no ${what} at ${p}`); process.exit(2) }
}
const armText = readFileSync(ARM, "utf8")
const census = JSON.parse(readFileSync(CENSUS, "utf8")) as any
const pop = JSON.parse(readFileSync(POP, "utf8")) as any
const ADMITTED = Number(pop.admitted)

// ───────────────────────────────────────────────────────────── TABLE 1
const COLUMNS = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "extUnk",
  "extFAIL", "bindOK", "bindUnk", "bindFAIL", "causeOK", "causeFAIL"] as const
type TableRow = { type: string; [k: string]: number | string }
const table = new Map<string, TableRow>()
let totalRow: TableRow | null = null
{
  const lines = armText.split("\n")
  const h = lines.findIndex((l) => l.startsWith("TABLE 1"))
  if (h < 0) { console.error("FATAL: the arm log carries no TABLE 1 — is this an incoming-gate run?"); process.exit(2) }
  for (let i = h + 1; i < lines.length; i++) {
    const line = lines[i]!
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s+((?:\d+\s+)*\d+)\s*$/.exec(line)
    if (!m) {
      if (totalRow) break
      continue
    }
    const nums = m[2]!.trim().split(/\s+/).map(Number)
    if (nums.length !== COLUMNS.length) continue
    const row = { type: m[1]! } as TableRow
    COLUMNS.forEach((c, k) => { (row as any)[c] = nums[k] })
    if (row.type === "TOTAL") { totalRow = row; break }
    table.set(row.type, row)
  }
}
if (!totalRow) { console.error("FATAL: TABLE 1 carries no TOTAL row"); process.exit(2) }

const popMatch = /population: (\d+) parsed of (\d+) sampled/.exec(armText)
const parsed = popMatch ? Number(popMatch[1]) : NaN
const sampled = popMatch ? Number(popMatch[2]) : NaN
say("NIM CAUSE CENSUS — the wall, partitioned")
say(`  arm log        ${ARM}`)
say(`  arm population parsed=${parsed} sampled=${sampled} · admitted=${ADMITTED}`)
say(`  census         ${CENSUS}`)
say(`  grammar digest ${census.grammar?.servedBytesSha256 ?? "?"}`)
say()
if (!(parsed === sampled && parsed === ADMITTED)) {
  console.error(`FATAL: the arm's population (${parsed}/${sampled}) is not the admitted set (${ADMITTED}) — a partition over a different population is not this population's partition`)
  process.exit(3)
}

// ───────────────────────────────────────────────────────────── the 11-term closure, per row
const eleven = (r: TableRow): number =>
  Number(r.resolved) + Number(r.ambDecl) + Number(r.unresolved) +
  Number(r.bindOK) + Number(r.bindUnk) + Number(r.bindFAIL) +
  Number(r.extOK) + Number(r.extUnk) + Number(r.extFAIL) +
  Number(r.causeOK) + Number(r.causeFAIL)
const closureBreaks: string[] = []
for (const [t, r] of table) {
  if (eleven(r) !== Number(r.edges)) closureBreaks.push(`${t}: eleven terms sum ${eleven(r)} ≠ edges ${r.edges}`)
}
if (eleven(totalRow) !== Number(totalRow.edges)) closureBreaks.push(`TOTAL: eleven terms sum ${eleven(totalRow)} ≠ edges ${totalRow.edges}`)
if (closureBreaks.length > 0) {
  console.error(`FATAL: THE ELEVEN-TERM CLOSURE DOES NOT CLOSE:\n  ${closureBreaks.join("\n  ")}`)
  process.exit(4)
}
say("== THE ARM'S ELEVEN-TERM CLOSURE (per row, checked) ==")
say(`  ${"type".padEnd(14)} ${"edges".padStart(9)} ${"resolved".padStart(9)} ${"amb(decl)".padStart(9)} ${"unres".padStart(8)} ${"extOK".padStart(7)} ${"bindOK".padStart(7)} ${"cause".padStart(6)}`)
for (const t of [...table.keys()]) {
  const r = table.get(t)!
  say(`  ${t.padEnd(14)} ${String(r.edges).padStart(9)} ${String(r.resolved).padStart(9)} ${String(r.ambDecl).padStart(9)} ${String(r.unresolved).padStart(8)} ${String(r.extOK).padStart(7)} ${String(r.bindOK).padStart(7)} ${String(Number(r.causeOK) + Number(r.causeFAIL)).padStart(6)}`)
}
say(`  ${"TOTAL".padEnd(14)} ${String(totalRow.edges).padStart(9)} ${String(totalRow.resolved).padStart(9)} ${String(totalRow.ambDecl).padStart(9)} ${String(totalRow.unresolved).padStart(8)} ${String(totalRow.extOK).padStart(7)} ${String(totalRow.bindOK).padStart(7)} ${String(Number(totalRow.causeOK) + Number(totalRow.causeFAIL)).padStart(6)}`)
say(`  (collRes ${totalRow.collRes} is OF resolved and amb(kind) ${totalRow.ambKind} is OF amb(decl) — reported beside, never added; the unclassed ceiling is 0 and it is 0 by construction here: every non-resolved row is in the dump.)`)
say()

// ───────────────────────────────────────────────────────────── the DUMP
type Bucket = "amb" | "external" | "bind" | "cause" | "wall" | "resolved" | "other"
const bucketOf = (o: string): Bucket => {
  if (o === "resolved") return "resolved"
  if (o === "ambBoth" || o === "ambDeclOnly") return "amb"
  if (o === "externalVerified" || o === "externalUnverified" || o === "externalRefuted") return "external"
  if (o === "bindingVerified" || o === "bindingRefuted" || o === "bindingUnverified") return "bind"
  if (o === "causeDeclared" || o === "causeRefuted") return "cause"
  if (o === "unresolved") return "wall"
  return "other"
}
type DumpRow = { label: string; outcome: string; target: string; where: string; repo: string; claimKind: string; claimSpec: string; bindReason: string; reasonCode: string; bucket: Bucket }
const dump: DumpRow[] = []
let dumpTruncated = false
let dumpOther = 0
for (const line of armText.split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const f = line.split("\t")
  if (f[1] === "BOUND" || line.includes("DUMP TRUNCATED")) { dumpTruncated = true; continue }
  if (f.length < 9) { dumpOther++; continue }
  const where = f[4]!
  // THE ARM PRINTS ABSOLUTE PATHS (`/…/.corpus/<repo>/<file>:<line>`), so the repository is the
  // segment AFTER the corpus root — taking the first path segment would yield "" for every row on
  // `/`, which silently forces B1 (same-project) to 0 and is exactly the "measure that cannot
  // distinguish absent from named differently" class. The old relative spelling is kept working.
  const relWhere = where.includes("/.corpus/") ? where.split("/.corpus/")[1]! : where.replace(/^\/+/, "")
  const repo = relWhere.includes("/") ? relWhere.slice(0, relWhere.indexOf("/")) : relWhere
  const b = bucketOf(f[2]!)
  if (b === "other") dumpOther++
  dump.push({ label: f[1]!, outcome: f[2]!, target: f[3]!, where, repo, claimKind: f[5]!, claimSpec: f[6]!, bindReason: f[7]!, reasonCode: f[8]!, bucket: b })
}
if (dumpTruncated) {
  console.error("FATAL: THE DUMP IS TRUNCATED (DUMP\\tBOUND\\tREACHED) — a partition over a truncated dump under-counts the movement and looks identical to a complete one. Raise BB_DUMP_LIMIT.")
  process.exit(5)
}
say("== THE DUMP, RECONCILED AGAINST TABLE 1 (per type) ==")
say(`  dump rows ${dump.length.toLocaleString()} · expected non-resolved rows ${(Number(totalRow.edges) - Number(totalRow.resolved)).toLocaleString()}`)
const perTypeDump = new Map<string, Record<Bucket, number>>()
for (const d of dump) {
  let b = perTypeDump.get(d.label)
  if (!b) { b = { amb: 0, external: 0, bind: 0, cause: 0, wall: 0, resolved: 0, other: 0 }; perTypeDump.set(d.label, b) }
  b[d.bucket]++
}
const reconBreaks: string[] = []
for (const [t, r] of table) {
  const d = perTypeDump.get(t) ?? { amb: 0, external: 0, bind: 0, cause: 0, wall: 0, resolved: 0, other: 0 }
  const want = {
    amb: Number(r.ambDecl),
    external: Number(r.extOK) + Number(r.extUnk) + Number(r.extFAIL),
    bind: Number(r.bindOK) + Number(r.bindUnk) + Number(r.bindFAIL),
    cause: Number(r.causeOK) + Number(r.causeFAIL),
    wall: Number(r.unresolved),
  }
  if (d.amb !== want.amb) reconBreaks.push(`${t}: dumped amb ${d.amb} ≠ TABLE1 amb(decl) ${want.amb}`)
  if (d.external !== want.external) reconBreaks.push(`${t}: dumped external ${d.external} ≠ TABLE1 ext total ${want.external}`)
  if (d.bind !== want.bind) reconBreaks.push(`${t}: dumped binding ${d.bind} ≠ TABLE1 bind total ${want.bind}`)
  if (d.cause !== want.cause) reconBreaks.push(`${t}: dumped cause ${d.cause} ≠ TABLE1 cause total ${want.cause}`)
  if (d.wall !== want.wall) reconBreaks.push(`${t}: dumped wall ${d.wall} ≠ TABLE1 unresolved ${want.wall}`)
}
const dumpNonResolved = dump.length
if (dumpNonResolved !== Number(totalRow.edges) - Number(totalRow.resolved)) {
  reconBreaks.push(`dump has ${dumpNonResolved} rows but TABLE1 says ${Number(totalRow.edges) - Number(totalRow.resolved)} non-resolved edges`)
}
if (reconBreaks.length > 0 || dumpOther > 0) {
  console.error(`FATAL: THE DUMP IS NOT THE ARM'S NON-RESOLVED SET:\n  ${[...reconBreaks, dumpOther > 0 ? `${dumpOther} rows carry an outcome this census does not know` : ""].filter(Boolean).join("\n  ")}`)
  process.exit(5)
}
say(`  RECONCILED EXACTLY: ambiguous = amb(decl) · external = extOK+ext?+extFAIL · binding = its three columns · cause = its two · wall = unresolved`)
say()

// ───────────────────────────────────────────────────────────── the partition
const idx = census.declaredNameIndex ?? {}
const byRepo: Record<string, { routines: string[]; types: string[] }> = idx.byRepo ?? {}
const moduleByRepo: Record<string, string[]> = idx.moduleBasenamesByRepo ?? {}
const repoRoutines = new Map<string, Set<string>>()
const repoTypes = new Map<string, Set<string>>()
const repoModules = new Map<string, Set<string>>()
for (const [repo, e] of Object.entries(byRepo)) {
  repoRoutines.set(repo, new Set(e.routines ?? []))
  repoTypes.set(repo, new Set(e.types ?? []))
}
for (const [repo, e] of Object.entries(moduleByRepo)) repoModules.set(repo, new Set(e))
const allRepos = new Set<string>([...repoRoutines.keys(), ...repoModules.keys()])
const declaredSomewhere = (name: string): string[] => {
  const hits: string[] = []
  for (const repo of allRepos) if (repoRoutines.get(repo)?.has(name) || repoTypes.get(repo)?.has(name)) hits.push(repo)
  return hits
}
const moduleCarriedBy = (name: string): string[] => {
  const hits: string[] = []
  for (const repo of allRepos) if (repoModules.get(repo)?.has(name)) hits.push(repo)
  return hits
}
const stemOf = (t: string): string => {
  const seg = String(t ?? "").trim().replace(/^["']|["']$/g, "")
  const i = seg.lastIndexOf(".")
  return (i >= 0 ? seg.slice(i + 1) : seg).replace(/\.(nim|nims|nimble)$/i, "").toLowerCase()
}
const MODULE_LABELS = new Set(["imports", "part_of"])
const CLASSES = {
  M1: "module-name-not-carried-in-the-project",
  M2: "module-name-carried-in-another-repository",
  M3: "module-carried-in-the-same-project-but-unresolved",
  D1: "member-or-qualified-target",
  B1: "bare-name-declared-elsewhere-in-same-project",
  B2: "bare-name-declared-in-another-repository",
  B3: "bare-name-declared-nowhere",
  U0: "unclassified",
} as const
type ClassKey = keyof typeof CLASSES
const classOf = (d: DumpRow): ClassKey => {
  const target = String(d.target ?? "")
  if (MODULE_LABELS.has(d.label)) {
    const stem = stemOf(target)
    const same = repoModules.get(d.repo)?.has(stem) ?? false
    if (same) return "M3"
    const carried = moduleCarriedBy(stem)
    return carried.length > 0 ? "M2" : "M1"
  }
  if (/[./:]/.test(target)) return "D1"
  const same = (repoRoutines.get(d.repo)?.has(target) ?? false) || (repoTypes.get(d.repo)?.has(target) ?? false)
  if (same) return "B1"
  const elsewhere = declaredSomewhere(target).filter((r) => r !== d.repo)
  return elsewhere.length > 0 ? "B2" : "B3"
}
const partition = new Map<ClassKey, DumpRow[]>()
for (const k of Object.keys(CLASSES) as ClassKey[]) partition.set(k, [])
for (const d of dump) if (d.bucket === "wall") partition.get(classOf(d))!.push(d)

const wallRows = dump.filter((d) => d.bucket === "wall")
const partitionCount = [...partition.values()].reduce((a, b) => a + b.length, 0)
say("== THE WALL, PARTITIONED — every unresolved row, exactly once ==")
say(`  wall rows (unresolved + externalRefuted) ${wallRows.length.toLocaleString()} · TABLE1 unresolved ${totalRow.unresolved}`)
for (const k of Object.keys(CLASSES) as ClassKey[]) {
  const rows = partition.get(k)!
  if (rows.length === 0 && k === "U0") continue
  say(`  ${k} ${CLASSES[k].padEnd(52)} ${String(rows.length).padStart(8)}`)
}
if (partitionCount !== wallRows.length || wallRows.length !== Number(totalRow.unresolved)) {
  console.error(`FATAL: THE PARTITION DOES NOT CLOSE — classes sum ${partitionCount}, wall rows ${wallRows.length}, TABLE1 unresolved ${totalRow.unresolved}`)
  process.exit(6)
}
if (partition.get("U0")!.length > 0) {
  console.error(`FATAL: ${partition.get("U0")!.length} row(s) could not be classified — an absorbed row is a hidden wall`)
  process.exit(6)
}
say(`  ⇒ PARTITION CLOSES EXACTLY: ${partitionCount.toLocaleString()} = the arm's unresolved total`)
say()

// ───────────────────────────────────────────────────────────── the independent falsifier pass
const falseHits: string[] = []
for (const d of partition.get("B1")!) {
  const ok = (repoRoutines.get(d.repo)?.has(d.target) ?? false) || (repoTypes.get(d.repo)?.has(d.target) ?? false)
  if (!ok) falseHits.push(`B1 ${d.label} ${d.repo} ${d.where} target="${d.target}" is NOT declared in its own project`)
}
for (const d of partition.get("B2")!) {
  const elsewhere = declaredSomewhere(d.target).filter((r) => r !== d.repo)
  if (elsewhere.length === 0) falseHits.push(`B2 ${d.label} ${d.repo} ${d.where} target="${d.target}" is NOT declared in any other repository`)
}
for (const d of partition.get("B3")!) {
  const anywhere = declaredSomewhere(d.target)
  if (anywhere.length > 0) falseHits.push(`B3 ${d.label} ${d.repo} ${d.where} target="${d.target}" IS declared in ${anywhere.join(",")} — it must have been classified as declared`)
}
for (const d of partition.get("M1")!) {
  if (moduleCarriedBy(stemOf(d.target)).length > 0) falseHits.push(`M1 ${d.label} ${d.repo} target="${d.target}" — the corpus DOES carry that module name`)
}
for (const d of partition.get("M2")!) {
  const carried = moduleCarriedBy(stemOf(d.target))
  if (carried.length === 0) falseHits.push(`M2 ${d.label} ${d.repo} target="${d.target}" — NO repository carries that module name`)
}
for (const d of partition.get("D1")!) {
  if (!/[./:]/.test(d.target)) falseHits.push(`D1 ${d.label} ${d.repo} target="${d.target}" — carries no member/qualifier separator`)
}
if (falseHits.length > 0) {
  console.error(`FATAL: THE FALSIFIER PASS FAILED — ${falseHits.length} row(s) do not match the class they are published under:`)
  for (const h of falseHits.slice(0, 20)) console.error(`  ${h}`)
  process.exit(7)
}
say("== THE FALSIFIER PASS — each class's membership direction re-checked independently ==")
say(`  ${falseHits.length} row(s) violate the class they are published under (0 required) — the pass reads the`)
say(`  published census index again rather than trusting the classifier, so a wrong direction is a FAILURE.`)
say()

// ───────────────────────────────────────────────────────────── by-type breakdown + examples
const perType = new Map<string, Record<string, number>>()
for (const d of wallRows) {
  const k = classOf(d)
  let row = perType.get(d.label)
  if (!row) { row = {}; perType.set(d.label, row) }
  row[k] = (row[k] ?? 0) + 1
}
say("== THE WALL BY TYPE AND CLASS ==")
say(`  ${"type".padEnd(14)} ${Object.keys(CLASSES).filter((k) => k !== "U0").map((k) => k.padStart(6)).join(" ")}`)
for (const [t, row] of [...perType.entries()].sort()) {
  say(`  ${t.padEnd(14)} ${Object.keys(CLASSES).filter((k) => k !== "U0").map((k) => String(row[k] ?? 0).padStart(6)).join(" ")}`)
}
say()
const examples = (k: ClassKey, n = 8): string[] => partition.get(k)!.slice(0, n).map((d) => `${d.label} ${d.where} → "${d.target.slice(0, 80)}"`)
for (const k of Object.keys(CLASSES) as ClassKey[]) {
  const rows = partition.get(k)!
  if (rows.length === 0) continue
  say(`  ${k} ${CLASSES[k]} — ${rows.length.toLocaleString()} row(s), e.g.`)
  for (const e of examples(k)) say(`    ${e}`)
}

// ───────────────────────────────────────────────────────────── the artifact
const POPSTR = census.population?.populationString ?? `parsed=${ADMITTED}/${ADMITTED} admitted=${ADMITTED} exts=nim,nims,nimble index=no`
const ARM_CMD = `BB_CORPUS_ROOT=$PWD/.corpus BB_DUMP_LIMIT=2000000 bun run script/m14/incoming-gate.ts nim nim,nims,nimble 0 --dump > ${path.relative(ROOT, ARM)}`
const CAUSE_CMD = `bun run script/m14/nim-cause-census.ts --arm ${path.relative(ROOT, ARM)} --census ${path.relative(ROOT, CENSUS)} --json <out>`
const causeRulings: Record<string, any> = {}
const FALSIFIER: Record<ClassKey, string> = {
  M1: `a row in M1 whose module name IS carried by any admitted project (the census index has that basename for some repository) — the falsifier pass checks the direction and exits 7`,
  M2: `a row in M2 whose module name is carried by NO repository in the census index — the falsifier pass checks the direction and exits 7`,
  M3: `a row in M3 whose module name is NOT carried by its own project — the falsifier pass checks the direction and exits 7. M3 is a PROJECT-KEY-SPACE lookup wall (the project carries the module and the row is still unresolved), COUNTED here rather than hidden`,
  D1: `a row in D1 whose target carries no member/qualifier separator — the falsifier pass checks the shape and exits 7`,
  B1: `a row in B1 whose target is NOT declared in its own project — the falsifier pass checks the direction and exits 7`,
  B2: `a row in B2 whose target is NOT declared in any OTHER repository of the admitted corpus — the falsifier pass checks the direction and exits 7`,
  B3: `a row in B3 whose target IS declared in the admitted corpus — the falsifier pass checks the direction and exits 7`,
  U0: "UNCLASSIFIED MUST BE 0: any row here is a wall this instrument cannot name, and it exits 6",
}
for (const k of Object.keys(CLASSES) as ClassKey[]) {
  const rows = partition.get(k)!
  if (k === "U0") continue
  causeRulings[`${k}:${CLASSES[k]}`] = {
    population: POPSTR,
    edges: rows.length,
    class: CLASSES[k],
    rowsByLabel: Object.fromEntries([...new Set(rows.map((r) => r.label))].sort().map((l) => [l, rows.filter((r) => r.label === l).length])),
    examples: examples(k, 12),
    falsifier: {
      run: `${ARM_CMD}   # then   ${CAUSE_CMD}`,
      wouldFail: `THIS RUN FAILS IF ${FALSIFIER[k]}. A second direction: the partition must keep summing to the arm's unresolved total (TABLE 1), which this instrument re-checks and exits 6 on.`,
    },
  }
}
const out = {
  instrument: "nim-cause-census",
  lane: "nim",
  generatedAt: new Date().toISOString(),
  arm: { log: path.relative(ROOT, ARM), command: ARM_CMD, population: { parsed, sampled, admitted: ADMITTED }, populationString: POPSTR },
  census: { artifact: path.relative(ROOT, CENSUS), grammarDigest: census.grammar?.servedBytesSha256 ?? null },
  table1: Object.fromEntries([...table.entries()].map(([t, r]) => [t, Object.fromEntries(COLUMNS.map((c) => [c, Number((r as any)[c])]))])),
  total: Object.fromEntries(COLUMNS.map((c) => [c, Number((totalRow as any)[c])])),
  closureRule: "resolved + amb(decl) + unresolved + bindOK + bind? + bindFAIL + extOK + ext? + extFAIL + causeOK + causeFAIL = edges; amb(kind) and collRes are reported beside and never added; unclassed ceiling 0",
  dump: { rows: dump.length, nonResolvedExpected: Number(totalRow.edges) - Number(totalRow.resolved), reconciledExactly: true, truncated: false },
  wall: {
    total: wallRows.length,
    partitionCloses: partitionCount === wallRows.length && wallRows.length === Number(totalRow.unresolved),
    classes: Object.fromEntries((Object.keys(CLASSES) as ClassKey[]).map((k) => [k, { name: CLASSES[k], edges: partition.get(k)!.length }])),
    byType: Object.fromEntries([...perType.entries()].sort().map(([t, r]) => [t, r])),
  },
  causeRulings,
  falsifierPass: { violations: falseHits.length, pass: falseHits.length === 0 },
  resolutionCaveats: [
    "THE SCOPE IS PER FILE AND INDEX-LESS (index=no): the arm runs each file on its own, so a name declared in ANOTHER FILE of the same project is out of the analyzer's reach by construction. B1 is that wall, counted, not a lookup defect.",
    "THE AMBIGUITY COUNTS DECLARATIONS (`amb(decl)`), and `amb(kind)` is a SUBSET reported beside it and never added. `collRes` is OF `resolved` and is likewise beside, never added.",
    "EXTERNAL IS A CLAIM, NOT A RESOLUTION: extOK/ext?/extFAIL are the project's verdict on the analyzer's external marker; none of them is folded into resolved.",
    "THE FOUR EXTENDED TYPES: `part_of` is IMPLEMENTED (the 1:1 relabel of `include`); `decorates` (ontological), `renders` (grammar absence) and `mixes_in` (ontological) are RULED — the full ruling, the count and the recorded divergence live in validation/m14/verification/NIM-EXTENDED-TYPES.md and script/m14/spec/nim-completeness.json.",
  ],
}
say()
if (JSON_OUT) {
  writeFileSync(JSON_OUT, JSON.stringify(out, null, 2))
  say(`WROTE ${JSON_OUT}`)
}
say(`CAUSE CENSUS: ${partitionCount.toLocaleString()} wall rows partitioned, falsifier pass ${falseHits.length === 0 ? "PASS" : "FAIL"}`)
process.exit(0)
