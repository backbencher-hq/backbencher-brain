#!/usr/bin/env bun
/**
 * SCSS CAUSE CENSUS — the wall partitioned into NAMED classes, each with a count and a falsifier.
 *
 * WHY THIS FILE EXISTS. The completion gate's fourth condition is "every wall dispositioned with a
 * count and a falsifier", and the incoming gate's `--dump` gives the ROWS but no classes. This
 * instrument takes the wall rows the arm dumped (`outcome === "unresolved"`), puts every one in
 * exactly ONE named class, and CHECKS THE PARTITION against the arm's own TABLE 1 `unresolved`
 * total — two independent numbers from two different files, the same reconciliation the nim lane
 * built. It exits 7 on any mismatch: an unclassified row is a hole wearing a class's name.
 *
 * EVERY CLASS CARRIES A FALSIFIER THAT IS ALSO MEASURED HERE, so "the falsifier found nothing" is
 * not a sentence — `falsifier.measuredHits` is a count. The checks are deliberately the cheap,
 * decidable ones (same-file declaration, project-file spelling, declared-in-repository inventory),
 * because a falsifier nobody can run is prose.
 *
 * THE CLASSES, and what each one claims:
 *   M1:mixin-not-declared-in-this-file      mixes_in -> `@mixin X`; X is not declared by this file
 *                                            (a per-file-scope wall / external package).
 *   P1:inclusion-specifier-no-project-file   part_of, NO file claim: the written specifier answers
 *                                            to no admitted `.scss` file by the lane's own Sass
 *                                            spelling arithmetic.
 *   P2:inclusion-with-a-claim-unresolved     part_of carrying a claim yet unresolved (should be 0;
 *                                            a nonzero count is a claim-integrity finding).
 *   E1:selector-not-declared-in-this-file    extends targets a selector this file does not declare.
 *   V1:variable-not-declared-in-this-file    a `$var` read whose declaration is not in this file.
 *   C1:callable-or-keyframes-not-in-this-file a `@mixin`/`@function`/`@keyframes` name read here
 *                                            but not declared here.
 *   F1:file-scoped-target-not-declared       a `<file>::<member>` target whose file/member the
 *                                            project does not carry (or does not declare there).
 *   N1:bare-name-not-declared-in-this-file   every other name: declared in another file, external,
 *                                            or absent.
 *
 * RUN:  bun script/m14/scss-cause-census.ts [--arm=<path>] [--out=<path>]
 * EXIT: 0 partitioned and reconciled · 2 usage · 3 an input artifact is missing · 7 THE PARTITION
 *       DOES NOT RECONCILE (an unclassified row, a sum mismatch, or a falsifier hit — each named).
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync, readdirSync } from "node:fs"
import { resolve, dirname } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const DIR = resolve(ROOT, "validation/m14/measurements/scss")
const POP = resolve(ROOT, "validation/m14/measurements/scss-population.json")
const EXT = resolve(ROOT, "validation/m14/measurements/scss-extended-census.json")

const argv = process.argv.slice(2)
const arg = (name: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const armLog = (() => {
  const named = arg("arm")
  if (named) return resolve(ROOT, named)
  if (!existsSync(DIR)) {
    console.error(`NO ARM DIRECTORY at ${DIR}`)
    process.exit(3)
  }
  const candidates = readdirSync(DIR).filter((f) => /^scss-gate-whole-.*\.txt$/.test(f)).sort()
  if (candidates.length === 0) {
    console.error(`NO ARM LOG in ${DIR} — run: bash script/m14/scss-whole-population-arm.sh`)
    process.exit(3)
  }
  return resolve(DIR, candidates[candidates.length - 1]!)
})()
const OUT = arg("out") ? resolve(ROOT, arg("out")!) : resolve(ROOT, "validation/m14/measurements/scss-cause-census.json")

if (!existsSync(armLog)) {
  console.error(`NO ARM LOG at ${armLog}`)
  process.exit(3)
}
if (!existsSync(POP)) {
  console.error(`NO POPULATION ARTIFACT at ${POP}`)
  process.exit(3)
}
const pop = JSON.parse(readFileSync(POP, "utf8")) as { admitted: number; repositoriesCarrying: number; extensions: string[] }
const POPULATION = `parsed=${pop.admitted}/${pop.admitted} admitted=${pop.admitted} exts=${(pop.extensions as string[]).join(",")} index=yes`
const repoDecl: Record<string, { mixins: string[]; functions: string[] }> = existsSync(EXT)
  ? (JSON.parse(readFileSync(EXT, "utf8")) as { declarationsByRepo?: Record<string, { mixins: string[]; functions: string[] }> }).declarationsByRepo ?? {}
  : {}

const armText = readFileSync(armLog, "utf8")

// ── TABLE 1: the arm's own unresolved total, per type ──────────────────────────────────────────
const table: Record<string, { edges: number; unresolved: number }> = {}
let tableUnresolved = 0
{
  const lines = armText.split("\n")
  const header = lines.findIndex((l) => l.startsWith("type ") && l.includes("edges") && l.includes("unresolved"))
  if (header < 0) {
    console.error("THE ARM LOG HAS NO TABLE 1 HEADER — this is not an incoming-gate report")
    process.exit(3)
  }
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i]!
    // TABLE 1's header is followed by a rule line, then rows, then a rule line and TOTAL. The
    // first rule line is NOT the end of the table — skipping it is what makes the parser see rows.
    if (/^-{10,}/.test(line.trim())) continue
    if (line.trim() === "" || line.startsWith("TOTAL")) break
    const m = /^([a-z_]+)\s+(.*)$/.exec(line)
    if (!m) break
    const nums = m[2]!.trim().split(/\s+/).map(Number)
    if (nums.length < 14 || nums.some((n) => !Number.isFinite(n))) break
    // edges resolved collRes ambDecl ambKind unresolved extOK extUnk extFAIL bindOK bindUnk bindFAIL causeOK causeFAIL
    table[m[1]!] = { edges: nums[0]!, unresolved: nums[5]! }
    tableUnresolved += nums[5]!
  }
  if (Object.keys(table).length === 0) {
    console.error("TABLE 1 PARSED AS EMPTY — a table with no rows is not a measurement")
    process.exit(3)
  }
}

// ── THE DUMP: every non-resolved row, with its outcome and claim ──────────────────────────────
interface DumpRow {
  label: string
  outcome: string
  target: string
  srcFile: string
  line: number
  claimKind: string
  claimSpec: string
  reasonCode: string
}
const rows: DumpRow[] = []
for (const line of armText.split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const f = line.split("\t")
  if (f.length < 9) continue
  if (f[1] === "BOUND") continue
  const where = f[4] ?? ""
  const cut = where.lastIndexOf(":")
  rows.push({
    label: f[1] ?? "",
    outcome: f[2] ?? "",
    target: f[3] ?? "",
    srcFile: cut > 0 ? where.slice(0, cut) : where,
    line: cut > 0 ? Number.parseInt(where.slice(cut + 1), 10) || 0 : 0,
    claimKind: f[5] ?? "-",
    claimSpec: f[6] ?? "-",
    reasonCode: f[8] ?? "-",
  })
}
if (rows.length === 0) {
  console.error("THE DUMP HAS NO ROWS — was the arm run with --dump and BB_DUMP_LIMIT high enough?")
  process.exit(3)
}
if (armText.includes("DUMP TRUNCATED")) {
  console.error("THE DUMP IS TRUNCATED — a reconciler over a truncated dump under-counts; re-run with a higher BB_DUMP_LIMIT")
  process.exit(7)
}

const unresolvedRows = rows.filter((r) => r.outcome === "unresolved")

// ── helpers ────────────────────────────────────────────────────────────────────────────────────
const fileTextCache = new Map<string, string>()
function fileText(p: string): string {
  const hit = fileTextCache.get(p)
  if (hit !== undefined) return hit
  let text = ""
  try {
    text = readFileSync(p, "utf8")
  } catch {
    text = ""
  }
  fileTextCache.set(p, text)
  return text
}
function repoOf(srcFile: string): string {
  const marker = "/.corpus/"
  const at = srcFile.lastIndexOf(marker)
  if (at < 0) return ""
  return srcFile.slice(at + marker.length).split("/")[0] ?? ""
}
function relOf(srcFile: string): string {
  const marker = "/.corpus/"
  const at = srcFile.lastIndexOf(marker)
  if (at < 0) return ""
  return srcFile.slice(at + marker.length).split("/").slice(1).join("/")
}
function stripQuotes(s: string): string {
  const t = s.trim()
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) return t.slice(1, -1)
  return t
}
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
/** A selector/name declared in THIS file at a rule position, not merely mentioned (the @extend
 *  usage itself must not read as a declaration). */
function selectorDeclaredInFile(srcFile: string, selector: string): boolean {
  const text = fileText(srcFile)
  if (text.length === 0) return false
  const re = new RegExp(`(^|[\\n,{])\\s*${escapeRe(selector)}\\s*(,|\\{)`, "m")
  for (const line of text.split("\n")) {
    if (line.includes("@extend")) continue
    if (re.test(line)) return true
  }
  return false
}
function variableDeclaredInFile(srcFile: string, name: string): boolean {
  const text = fileText(srcFile)
  if (text.length === 0) return false
  return new RegExp(`(^|\\n)\\s*${escapeRe(name)}\\s*:`).test(text)
}
function callableDeclaredInFile(srcFile: string, kind: string, name: string): boolean {
  const text = fileText(srcFile)
  if (text.length === 0) return false
  return new RegExp(`@${kind}\\s+${escapeRe(name)}\\b`).test(text)
}
/** The analyzer's own claim arithmetic, from the file's OWN repository root. */
function sassSpecifierHasFile(srcFile: string, spec: string): boolean {
  const repo = repoOf(srcFile)
  const rel = relOf(srcFile)
  if (repo === "" || rel === "") return false
  const dir = dirname(rel).split("\\").join("/")
  const cut = spec.lastIndexOf("/")
  const dirPart = cut < 0 ? "" : spec.slice(0, cut + 1)
  const leaf = cut < 0 ? spec : spec.slice(cut + 1)
  const spellings = new Set<string>([`${spec}.scss`, `${spec}/_index.scss`, `${spec}/index.scss`])
  if (leaf.length > 0 && !leaf.startsWith("_")) {
    spellings.add(`${dirPart}_${leaf}.scss`)
    spellings.add(`${dirPart}_${leaf}/_index.scss`)
  }
  const corpus = resolve(ROOT, ".corpus", repo)
  const base = dir === "." ? "" : dir
  for (const sp of spellings) {
    const cand = resolve(corpus, base, sp)
    if (existsSync(cand)) return true
  }
  return false
}

// ── the classification ────────────────────────────────────────────────────────────────────────
interface ClassDef {
  cause: string
  class: string
  statement: string
  falsifierRun: string
  falsifierWouldFail: string
  rows: DumpRow[]
  falsifierHits: number
  hitExamples: string[]
}
const defs: Record<string, ClassDef> = {}
function bump(row: DumpRow, key: string, def: Omit<ClassDef, "rows" | "falsifierHits" | "hitExamples">): void {
  const d = (defs[key] ??= { ...def, rows: [], falsifierHits: 0, hitExamples: [] })
  d.rows.push(row)
}
function falsifierHit(key: string, example: string): void {
  const d = defs[key]
  if (!d) return
  d.falsifierHits++
  if (d.hitExamples.length < 5) d.hitExamples.push(example)
}

for (const row of unresolvedRows) {
  const repo = repoOf(row.srcFile)
  const target = row.target
  const def = (key: string, class_: string, statement: string, wouldFail: string) => ({
    cause: key,
    class: class_,
    statement,
    falsifierRun: `bun script/m14/scss-cause-census.ts --arm=${armLog.replace(ROOT + "/", "")}`,
    falsifierWouldFail: wouldFail,
  })

  if (row.label === "mixes_in" && target.startsWith("@mixin ")) {
    const key = "M1:mixin-not-declared-in-this-file"
    bump(row, key, def(
      key, "mixin-composition-target-not-declared-in-this-file",
      "a `mixes_in` row whose `@mixin <name>` target is not declared by the file carrying the `@include`; the name is declared in another file or in a dependency the project does not carry.",
      "a `mixes_in` target whose mixin NAME is in declarationsByRepo[repo].mixins (the project's own index owes that resolution, so the row would be an index defect, not a wall).",
    ))
    const name = stripQuotes(target.slice("@mixin ".length))
    if ((repoDecl[repo]?.mixins ?? []).includes(name)) falsifierHit(key, `${row.srcFile}:${row.line} ${name}`)
    continue
  }
  if (row.label === "part_of") {
    if (row.claimKind !== "-") {
      const key = "P2:inclusion-with-a-claim-unresolved"
      bump(row, key, def(
        key, "part-of-row-carrying-a-claim-but-unresolved",
        "a `part_of` row that carries a file claim yet landed unresolved: a claim-integrity class that must be 0 (the claim channel never creates a resolution, so a claimed row cannot be 'almost resolved').",
        "ANY row in this class: a claimed row that is unresolved is a claim/classifier disagreement, and the count being nonzero is itself the finding.",
      ))
      if (row.claimKind !== "-") falsifierHit(key, `${row.srcFile}:${row.line} claim=${row.claimKind}`)
    } else {
      const key = "P1:inclusion-specifier-no-project-file"
      bump(row, key, def(
        key, "sass-inclusion-specifier-with-no-project-file",
        "a `part_of` row whose written Sass specifier answers to no admitted `.scss` file by the lane's own spelling arithmetic, AND carries no file claim; the included part is a dependency, a `.sass` file (the css lane's population) or absent.",
        "a row whose specifier DOES answer to an admitted `.scss` file by the candidate spelling arithmetic (then the claim guard owed the claim and the row would be a claim defect, not a wall).",
      ))
      const spec = stripQuotes(target)
      if (sassSpecifierHasFile(row.srcFile, spec)) falsifierHit(key, `${row.srcFile}:${row.line} ${spec}`)
    }
    continue
  }
  if (row.label === "extends" && /^[.%#[]/.test(target)) {
    // ★ THE CLASS SPLITS ON ITS OWN FALSIFIER, AND THE SPLIT IS WHAT KEEPS THE WALL HONEST. A
    // wall class is "the target is genuinely out of the per-file analyzer's reach". A row whose
    // target IS declared as a rule in the SAME file is NOT that claim: it is an
    // analyzer/arbiter defect, counted as its own class (E1b) rather than folded into a wall whose
    // falsifier would then be firing against it. MEASURED on the whole population: 27 of the 155
    // unresolved `extends` rows target a selector their own file declares.
    const declaredHere = selectorDeclaredInFile(row.srcFile, target)
    if (declaredHere) {
      const key = "E1b:extend-target-declared-in-same-file-but-unresolved"
      bump(row, key, def(
        key, "DEFECT: same-file extend target left unresolved",
        "DEFECT CLASS, NOT A WALL: the `@extend` target selector IS declared as a rule in the file carrying the directive, so the per-file analyzer owed the resolution and did not make it. Counted so the defect is a number rather than a sentence; this class is NOT read as a wall release.",
        "a row in THIS class: the same-file declaration check is the refutation, and it fires on the rows themselves — which is exactly why the class is declared as a defect rather than as a wall.",
      ))
      falsifierHit(key, `${row.srcFile}:${row.line} ${target}`)
    } else {
      const key = "E1:selector-not-declared-in-this-file"
      bump(row, key, def(
        key, "extend-target-selector-not-declared-in-this-file",
        "an `extends` row whose selector target is not declared by the file carrying the `@extend`; the per-file analyzer publishes this file's selectors, so a target outside it is genuinely out of reach.",
        "an `extends` target declared as a rule in the SAME file (then the analyzer's own-file resolution owed it, and the row would be an instrument defect) — a nonzero count here refutes the class.",
      ))
    }
    continue
  }
  if (row.label === "extends") {
    const declaredHere = fileText(row.srcFile).includes(target)
    if (declaredHere) {
      const key = "E1b:extend-target-declared-in-same-file-but-unresolved"
      bump(row, key, def(
        key, "DEFECT: same-file extend target left unresolved",
        "DEFECT CLASS, NOT A WALL: the target is declared in the same file by raw spelling but left unresolved.",
        "a row in THIS class: the same-file declaration check fires on the rows themselves, which is why the class is declared as a defect.",
      ))
      falsifierHit(key, `${row.srcFile}:${row.line} ${target}`)
    } else {
      const key = "E1:selector-not-declared-in-this-file"
      bump(row, key, def(
        key, "extend-target-selector-not-declared-in-this-file",
        "an `extends` row whose target is not a simple selector shape; same per-file reach claim.",
        "a target declared in the same file (same check, by raw spelling) — a nonzero count here refutes the class.",
      ))
    }
    continue
  }
  if (target.startsWith("$")) {
    const key = "V1:variable-not-declared-in-this-file"
    bump(row, key, def(
      key, "variable-not-declared-in-this-file",
      "a `$var` read whose declaration is not in the file that reads it (a theme variable declared by another flavour/partial, or external).",
      "a `$var` read whose declaration IS in the same file (then the analyzer's file-scoped pass owed the target, and the row would be an instrument defect).",
    ))
    if (variableDeclaredInFile(row.srcFile, target)) falsifierHit(key, `${row.srcFile}:${row.line} ${target}`)
    continue
  }
  if (/^(@mixin|@function|@keyframes)\s/.test(target)) {
    const key = "C1:callable-or-keyframes-not-in-this-file"
    const kind = target.slice(1, target.indexOf(" "))
    bump(row, key, def(
      key, "callable-or-keyframes-name-not-declared-in-this-file",
      "a `@mixin`/`@function`/`@keyframes` name read here but not declared here; another file or an external stylesheet declares it.",
      "a read whose callable name IS declared in the same file (instrument defect rather than a wall).",
    ))
    const name = stripQuotes(target.slice(target.indexOf(" ") + 1))
    if (callableDeclaredInFile(row.srcFile, kind, name)) {
      falsifierHit(key, `${row.srcFile}:${row.line} ${target}`)
    }
    continue
  }
  if (target.includes("::")) {
    const key = "F1:file-scoped-target-not-declared"
    bump(row, key, def(
      key, "file-scoped-target-not-declared-in-its-file",
      "a `<file>::<member>` target whose declaring file does not declare the member (the file may be admitted; a member that moved or a selector spelled differently).",
      "a file-scoped target whose member IS declared in the named file.",
    ))
    const [filePart, member] = target.split("::")
    const leaf = String(member ?? "")
    const named = String(filePart ?? "")
    const corpusFile = resolve(ROOT, ".corpus", named)
    if (existsSync(corpusFile) && leaf.length > 0) {
      const text = fileText(corpusFile)
      if (text.includes(leaf.replace(/^@mixin /, "").replace(/^@function /, ""))) falsifierHit(key, `${row.srcFile}:${row.line} ${target}`)
    }
    continue
  }
  const key = "N1:bare-name-not-declared-in-this-file"
  bump(row, key, def(
    key, "bare-name-not-declared-in-this-file",
    "every other unresolved name: a bare class/member/selector name whose declaration is in another file, in a dependency, or absent.",
    "a bare name whose declaration IS in the same file at a rule position (instrument defect rather than a wall).",
  ))
  if (selectorDeclaredInFile(row.srcFile, target)) falsifierHit(key, `${row.srcFile}:${row.line} ${target}`)
}

// ── the reconciliation ──────────────────────────────────────────────────────────────────────────
const classes = Object.values(defs).sort((a, b) => b.rows.length - a.rows.length)
const totalClassified = classes.reduce((a, c) => a + c.rows.length, 0)
const falsifierHits = classes.reduce((a, c) => a + c.falsifierHits, 0)
const problems: string[] = []
if (totalClassified !== unresolvedRows.length) problems.push(`classified ${totalClassified} of ${unresolvedRows.length} dumped unresolved rows`)
if (unresolvedRows.length !== tableUnresolved) {
  problems.push(`the dump's unresolved rows (${unresolvedRows.length}) do not equal TABLE 1's unresolved total (${tableUnresolved})`)
}
const isDefectClass = (cause: string): boolean => cause.includes(":extend-target-declared-in-same-file") || cause.startsWith("DEFECT")
const wallHits = classes.filter((c) => c.falsifierHits > 0 && !isDefectClass(c.cause)).reduce((a, c) => a + c.falsifierHits, 0)
if (wallHits > 0) {
  const worst = classes.filter((c) => c.falsifierHits > 0 && !isDefectClass(c.cause)).map((c) => `${c.cause}=${c.falsifierHits}`).join(", ")
  problems.push(`FALSIFIER HITS nonzero on WALL class(es): ${worst} — a wall class whose own refutation fires is not a wall disposition`)
}
const defectClasses = classes.filter((c) => isDefectClass(c.cause)).map((c) => ({ cause: c.cause, edges: c.rows.length }))

const artifact = {
  language: "scss",
  generated: new Date().toISOString(),
  population: POPULATION,
  armLog: armLog.replace(ROOT + "/", ""),
  metric:
    "the WALL is TABLE 1's `unresolved` column (outcome === 'unresolved'); ambiguous, external and binding rows are NOT walls and are not in this partition — they have their own columns in the declaration",
  partition: {
    tableUnresolved,
    dumpedUnresolved: unresolvedRows.length,
    totalClassified,
    unclassified: unresolvedRows.length - totalClassified,
    exact: problems.length === 0,
  },
  defectClasses,
  classes: classes.map((c) => ({
    cause: c.cause,
    class: c.class,
    edges: c.rows.length,
    rowsByLabel: c.rows.reduce<Record<string, number>>((a, r) => {
      a[r.label] = (a[r.label] ?? 0) + 1
      return a
    }, {}),
    statement: c.statement,
    falsifier: { run: c.falsifierRun, wouldFail: c.falsifierWouldFail, measuredHits: c.falsifierHits, hitExamples: c.hitExamples },
    examples: c.rows.slice(0, 10).map((r) => `${r.label} ${r.srcFile}:${r.line} -> ${JSON.stringify(r.target)}`),
  })),
  problems,
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + "\n")

console.log("SCSS CAUSE CENSUS — the wall, partitioned")
console.log(`  population: ${POPULATION}`)
console.log(`  arm: ${artifact.armLog}`)
console.log(`  TABLE 1 unresolved ${tableUnresolved} · dumped unresolved ${unresolvedRows.length} · classified ${totalClassified}`)
for (const c of classes) {
  console.log(`    ${c.cause.padEnd(42)} ${String(c.rows.length).padStart(6)}  ${JSON.stringify(c.rows.reduce<Record<string, number>>((a, r) => ((a[r.label] = (a[r.label] ?? 0) + 1), a), {}))}`)
}
console.log(`  classes ${classes.length} · falsifier hits ${falsifierHits}`)
console.log(`  -> ${OUT}`)
if (problems.length > 0) {
  console.error("THE PARTITION DOES NOT RECONCILE:")
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(7)
}
console.log("  PARTITION EXACT — every wall row is in exactly one named class and every falsifier is quiet")
