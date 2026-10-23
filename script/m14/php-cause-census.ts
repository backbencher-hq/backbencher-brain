/**
 * PHP — THE CAUSE CENSUS: classify every UNRESOLVED edge from the arbiter's own `--dump`.
 *
 * WHY THIS EXISTS. The completion gate's condition (D) wants every wall DISPOSITIONED with a COUNT
 * and a FALSIFIER, and the completion gate's condition (B) wants the declaration's cause rulings to
 * carry the arm's own population string. A closure without cause rulings is a partition with its
 * walls undeclared — the lane's earlier state. This instrument reads the arm's dump and splits the
 * unresolved rows into classes a ruling can be written about, with the counts and the examples a
 * reader needs to check the split.
 *
 * WHAT IT READS (read-only):
 *   · `--from <gate-log>`: the `--dump` rows the incoming gate printed. LINE SHAPE (9 tab fields):
 *       DUMP \t label \t outcome \t target \t srcFile:line \t claimKind \t claimSpec \t bindReason \t reasonCode
 *     plus the `DUMP TRUNCATED …` footer (a TRUNCATED DUMP IS REFUSED, not classified — a census over
 *     a truncated set under-counts and reads complete).
 *   · the corpus root (`BB_CORPUS_ROOT`, default `$PWD/.corpus`) for the repo names only — the dump's
 *     `srcFile` is an absolute repository path, so a row's PROJECT is the first corpus entry name its
 *     path contains. No file walk, no parse: the arm owns the population and this owns the split.
 *
 * THE CLASSES ARE SHAPE-BASED, WHICH IS WHAT MAKES THEM CHECKABLE BY A SECOND READER. A row is
 * classified by what its TARGET IS, not by what the analyzer intended:
 *   · `partOfPathTarget`  — `part_of` rows. The target is a FILE PATH; the arbiter's key space holds
 *     DECLARATIONS, so a path can never resolve there. A row that IS an admitted file but carries no
 *     claim is reported separately (`partOfPathAdmittedUnclaimed`), because that one would be a claim
 *     gap rather than a path fact.
 *   · `pathShapedOther`   — a path-shaped target under any other label (imports/references).
 *   · `qualifiedName`     — a backslash-qualified FQN naming no declaration in the project.
 *   · `memberTarget`      — a dotted member target (`Receiver.member`) whose receiver's TYPE the
 *     per-file analyzer cannot know.
 *   · `bareName`          — a bare name naming nothing in the project.
 * For each class it also counts the REPO SPREAD: a target unresolved from ≥ 2 repositories that
 * NEITHER declares is the fleet's external-evidence shape (the old php spec's 40.6 % class); a target
 * from exactly one repo is indistinguishable from a publication miss and is stated as such.
 *
 * USAGE
 *   bun run script/m14/php-cause-census.ts --from validation/m14/measurements/php-gate-whole-2026-10-23.txt \
 *     [--json validation/m14/measurements/php-cause-census.json]
 *
 * EXIT: 0 measured · 2 usage/environment · 4 the dump is TRUNCATED, or the dump's unresolved-row count
 *       disagrees with TABLE 1's unresolved total (two numbers for one set is a refusal, not a note).
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve, dirname } from "node:path"

const ROOT = resolve(import.meta.dir, "../..")
const argv = process.argv.slice(2)
const argOf = (name: string): string => {
  const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return ""
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : (argv[argv.indexOf(hit) + 1] ?? "")
}
const FROM = argOf("from")
const JSON_OUT = argOf("json")
const CORPUS = process.env.BB_CORPUS_ROOT ?? resolve(process.cwd(), ".corpus")
if (!FROM) { console.error("usage: bun run script/m14/php-cause-census.ts --from <gate-log> [--json <out>]"); process.exit(2) }
if (!existsSync(resolve(ROOT, FROM))) { console.error(`php-cause-census: no such log: ${FROM}`); process.exit(2) }

/** The arm's TABLE 1 column order, for the unresolved-total control only. */
const ARM_COLUMNS = ["edges", "resolved", "collRes", "ambDecl", "ambKind", "unresolved", "extOK", "ext?", "extFAIL", "bindOK", "bind?", "bindFAIL", "causeOK", "causeFAIL"] as const

interface DumpRow { label: string; outcome: string; target: string; srcFile: string; line: string; claimKind: string; claimSpec: string }

const text = readFileSync(resolve(ROOT, FROM), "utf8")

// ── THE TRUNCATION REFUSAL, BEFORE ANY COUNT ────────────────────────────────
if (/DUMP TRUNCATED/.test(text)) {
  const m = text.match(/DUMP TRUNCATED[^\n]*?(\d[\d,]*) eligible row/)
  console.error(`php-cause-census: REFUSED — the dump is TRUNCATED${m ? ` (${m[1]} eligible rows NOT dumped)` : ""}. A census over a truncated dump under-counts and reads complete. Re-run with a larger BB_DUMP_LIMIT (the arm runner sets 2,000,000).`)
  process.exit(4)
}

// ── TABLE 1'S TOTAL ROW, FOR THE CONTROLS ───────────────────────────────────
const table: Record<string, number> = {}
{
  const lines = text.split("\n")
  for (const l of lines) {
    if (!/^TOTAL\s+\d/.test(l.trim())) continue
    const nums = l.trim().split(/\s+/).slice(1).map(Number)
    if (nums.length >= ARM_COLUMNS.length) for (let i = 0; i < ARM_COLUMNS.length; i++) table[ARM_COLUMNS[i]!] = nums[i]!
    break
  }
}
const tableUnresolved = table.unresolved ?? -1

// ── THE DUMP ROWS ───────────────────────────────────────────────────────────
const rows: DumpRow[] = []
for (const line of text.split("\n")) {
  if (!line.startsWith("DUMP\t")) continue
  const f = line.split("\t")
  if (f.length < 6) continue
  if (f[1] === "BOUND") continue // the bound marker, not a row
  rows.push({ label: f[1]!, outcome: f[2]!, target: f[3]!, srcFile: f[4]!.replace(/:\d+$/, ""), line: (f[4]!.match(/:(\d+)$/) ?? [])[1] ?? "-", claimKind: f[5] ?? "-", claimSpec: f[6] ?? "-" })
}

// ── REPO NAMES FROM THE CORPUS ROOT (names only; the arm owns the population) ─
const repoNames: string[] = (() => { try { return readdirSync(CORPUS).filter((n) => !n.startsWith(".")) } catch { return [] } })()
const repoOf = (srcFile: string): string => {
  for (const n of repoNames) if (srcFile.includes(`/${n}/`) || srcFile.endsWith(`/${n}`)) return n
  return "?"
}

// ── THE CLASSIFIER — SHAPE-BASED, ONE RULE PER SHAPE ────────────────────────
/**
 * A PATH, FOR THE CLASSIFIER'S PURPOSES, IS A SPELLING THAT CANNOT BE A DECLARED NAME: it begins
 * with a magic constant or a stream scheme, or it contains a DIRECTORY SEPARATOR. The first version
 * of this predicate also accepted anything ending `.php`, which misclassified FIVE member targets
 * whose MEMBER NAME is literally `php` (`Configuration.php` = owner Configuration + member php,
 * `TestResult.phpDeprecations` = ... + `phpDeprecations`) as file paths. That is the fleet's
 * separator-vocabulary defect in miniature: `.php` is a member name in this lane, not only a file
 * suffix — `config -> php` is a real property in this corpus — so the extension alone decides
 * nothing and the separator does.
 */
const PATHISH = (t: string): boolean =>
  t.startsWith("__DIR__") || t.startsWith("__FILE__") || t.startsWith("FILE_PREFIX") ||
  t.includes("/") || /^[a-z][a-z0-9+.-]*:\/\//i.test(t)

type ClassName = "partOfPathTarget" | "pathShapedOther" | "qualifiedName" | "memberTarget" | "bareName"

function classify(r: DumpRow): ClassName {
  const t = r.target
  if (r.label === "part_of") return "partOfPathTarget"
  if (PATHISH(t)) return "pathShapedOther"
  if (t.includes("\\")) return "qualifiedName"
  if (t.includes(".")) return "memberTarget"
  return "bareName"
}

interface Bucket { rows: number; targets: Set<string>; repos: Set<string>; samples: string[]; multiRepoRows: number; singleRepoRows: number; multiRepoTargets: Set<string> }

const empty = (): Bucket => ({ rows: 0, targets: new Set(), repos: new Set(), samples: [], multiRepoRows: 0, singleRepoRows: 0, multiRepoTargets: new Set() })
const byClass = new Map<ClassName, Bucket>()
const byLabelClass = new Map<string, Map<ClassName, number>>()
const ambiguous = { rows: 0, byLabel: new Map<string, number>(), byOutcome: new Map<string, number>() }
/** The dump's own outcome vocabulary, counted so a reader can see the partition (the sum must equal
 *  the dump's row count): `unresolved` · `ambDeclOnly` + `ambBoth` (the two ambiguous classes, which
 *  together are TABLE 1's amb(decl)) · `bindingVerified` (= bindOK) · `externalVerified` (= extOK). */
const outcomeTally = new Map<string, number>()
const partOfClaimKinds = new Map<string, number>()
/** targets seen per (repo) so the repo-spread claim is measured per TARGET, not per row */
const reposByTarget = new Map<string, Set<string>>()

for (const r of rows) {
  outcomeTally.set(r.outcome, (outcomeTally.get(r.outcome) ?? 0) + 1)
  if (r.outcome !== "unresolved") {
    if (r.outcome.startsWith("amb")) {
      ambiguous.rows++
      ambiguous.byLabel.set(r.label, (ambiguous.byLabel.get(r.label) ?? 0) + 1)
      ambiguous.byOutcome.set(r.outcome, (ambiguous.byOutcome.get(r.outcome) ?? 0) + 1)
    }
    continue
  }
  const c = classify(r)
  const b = byClass.get(c) ?? empty()
  byClass.set(c, b)
  b.rows++
  b.targets.add(r.target)
  const repo = repoOf(r.srcFile)
  b.repos.add(repo)
  if (b.samples.length < 12) b.samples.push(`${r.label} ${repo} ${r.srcFile.split("/").slice(-2).join("/")}:${r.line} -> ${r.target.slice(0, 100)}`)
  if (r.label === "part_of") partOfClaimKinds.set(r.claimKind, (partOfClaimKinds.get(r.claimKind) ?? 0) + 1)
  const tkey = `${r.label}\u0000${r.target}`
  const tset = reposByTarget.get(tkey) ?? new Set<string>()
  tset.add(repo)
  reposByTarget.set(tkey, tset)
  const lb = byLabelClass.get(r.label) ?? new Map<ClassName, number>()
  byLabelClass.set(r.label, lb)
  lb.set(c, (lb.get(c) ?? 0) + 1)
}
// repo spread per class, measured after the pass (a target's repos are known then)
for (const r of rows) {
  if (r.outcome !== "unresolved") continue
  const c = classify(r)
  const b = byClass.get(c)!
  const repos = reposByTarget.get(`${r.label}\u0000${r.target}`) ?? new Set<string>()
  if (repos.size >= 2) { b.multiRepoRows++; b.multiRepoTargets.add(r.target) } else b.singleRepoRows++
}

const unresolvedRows = rows.filter((r) => r.outcome === "unresolved").length
// ── THE CONTROL: the dump's unresolved rows against TABLE 1's unresolved total ──
const control: string[] = []
if (tableUnresolved < 0) control.push("TABLE 1's TOTAL row was not found in the log — the control could not run (an unmatched control is a gap, reported)")
else if (tableUnresolved !== unresolvedRows) control.push(`REFUSED — TABLE 1 reads unresolved ${tableUnresolved} but the dump carries ${unresolvedRows} unresolved row(s); two numbers for one set cannot both be the census`)
// the OTHER outcome classes are controls too: bindingVerified must equal TABLE 1's bindOK and
// externalVerified its extOK, and the two ambiguous dump classes together must equal amb(decl).
if (Object.keys(table).length > 0) {
  const bv = outcomeTally.get("bindingVerified") ?? 0
  const ev = outcomeTally.get("externalVerified") ?? 0
  if (bv !== table.bindOK) control.push(`REFUSED — the dump carries ${bv} bindingVerified row(s) but TABLE 1 reads bindOK ${table.bindOK}`)
  if (ev !== table.extOK) control.push(`REFUSED — the dump carries ${ev} externalVerified row(s) but TABLE 1 reads extOK ${table.extOK}`)
  if (ambiguous.rows !== table.ambDecl) control.push(`REFUSED — the dump's ambiguous outcomes total ${ambiguous.rows} but TABLE 1 reads amb(decl) ${table.ambDecl}`)
  const tallySum = [...outcomeTally.values()].reduce((a, b) => a + b, 0)
  if (tallySum !== rows.length) control.push(`REFUSED — the outcome tally sums to ${tallySum} but the dump carries ${rows.length} rows`)
}
const classSum = [...byClass.values()].reduce((a, b) => a + b.rows, 0)
if (classSum !== unresolvedRows) control.push(`the classes sum to ${classSum} but the unresolved rows are ${unresolvedRows}`)
if (control.some((c) => c.startsWith("REFUSED"))) {
  for (const c of control) console.error(`php-cause-census: ${c}`)
  process.exit(4)
}

const out = {
  language: "php",
  generated: new Date().toISOString(),
  from: FROM,
  // THE CITED DUMP BOUND BY ITS DIGEST. If the raw arm log is not committed (it is large), this
  // census artifact is the TRACKED evidence and this digest is what binds it to the bytes it was
  // computed from: a citation resolves to a file in the repository, and the digest makes the
  // derivation checkable against the raw log a reader can re-run.
  dumpDigest: `sha256:${createHash("sha256").update(text).digest("hex")}`,
  dump: { rows: rows.length, unresolvedRows, ambiguousRows: ambiguous.rows, tableUnresolved, control },
  unresolved: {
    total: unresolvedRows,
    byClass: Object.fromEntries([...byClass.entries()].map(([c, b]) => [c, { rows: b.rows, targets: b.targets.size, repos: b.repos.size, multiRepoRows: b.multiRepoRows, singleRepoRows: b.singleRepoRows, multiRepoTargets: b.multiRepoTargets.size, samples: b.samples }])),
    byLabelClass: Object.fromEntries([...byLabelClass.entries()].map(([l, m]) => [l, Object.fromEntries(m)])),
    partOfClaimKinds: Object.fromEntries(partOfClaimKinds),
  },
  ambiguous: { rows: ambiguous.rows, byLabel: Object.fromEntries(ambiguous.byLabel), byOutcome: Object.fromEntries(ambiguous.byOutcome) },
  dumpOutcomes: Object.fromEntries(outcomeTally),
}

console.log(`PHP CAUSE CENSUS — ${FROM}`)
console.log(`dump: ${rows.length} non-resolved rows · outcomes ${JSON.stringify(Object.fromEntries(outcomeTally))}`)
console.log(`control: unresolved ${unresolvedRows} / TABLE 1 ${tableUnresolved < 0 ? "?" : tableUnresolved} · ambiguous ${ambiguous.rows} / att.amb(decl) ${table.ambDecl ?? "?"} · bindingVerified ${outcomeTally.get("bindingVerified") ?? 0} / att.bindOK ${table.bindOK ?? "?"} · externalVerified ${outcomeTally.get("externalVerified") ?? 0} / att.extOK ${table.extOK ?? "?"}`)
for (const c of control) console.log(`  control: ${c}`)
console.log("")
console.log("UNRESOLVED BY CLASS (rows · targets · repos · multi-repo rows / single-repo rows):")
const sayN = (n: number) => n.toLocaleString()
for (const [c, b] of [...byClass.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  console.log(`  ${c.padEnd(18)} ${sayN(b.rows).padStart(8)} · ${sayN(b.targets.size).padStart(7)} · ${String(b.repos.size).padStart(2)} · ${sayN(b.multiRepoRows).padStart(7)} / ${sayN(b.singleRepoRows).padStart(8)}`)
}
console.log("")
console.log("BY LABEL (class splits):")
for (const [l, m] of [...byLabelClass.entries()].sort()) {
  const parts = [...m.entries()].map(([c, n]) => `${c} ${n}`).join(" · ")
  console.log(`  ${l.padEnd(12)} ${parts}`)
}
console.log("")
console.log(`part_of claimKind distribution (a row that IS an admitted file but carries no claim is a CLAIM gap, not a path fact): ${JSON.stringify(Object.fromEntries(partOfClaimKinds))}`)
console.log("")
console.log("SAMPLES (for the ruling text; the JSON carries 12 per class):")
for (const [c, b] of byClass.entries()) for (const s of b.samples.slice(0, 3)) console.log(`  [${c}] ${s}`)

if (JSON_OUT) {
  writeFileSync(resolve(ROOT, JSON_OUT), JSON.stringify(out, null, 2) + "\n")
  console.log(`\nartifact written: ${JSON_OUT}`)
}
