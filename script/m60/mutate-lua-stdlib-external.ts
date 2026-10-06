/**
 * M60 LUA-54 regression mutants — the external-marking rule, and the fixture rows
 * that catch each of its three removable parts.
 *
 * WHY THREE MUTANTS AND NOT ONE. The mark is a CLAIM, so the way to break it is
 * three separate over-claims, and each one has to be caught by a DIFFERENT set of
 * rows. A single mutant that broke all three would be satisfied by a suite that
 * caught only one, which is the shape of a trivially-true check.
 *
 *   LUA-54a  GUARD REMOVED. Every candidate is marked, with no shadowing test.
 *            Caught by L82 and L83 (`local string` at L81, then `string.char` and
 *            `string.rep`), which is the only pair in the fixture where the
 *            receiver name is a documented table AND the file declares it. Corpus
 *            consequence measured: the mark covers every candidate, not the
 *            3,509 edges whose receiver is provably the standard library.
 *
 *   LUA-54b  RECEIVER TEST REMOVED — the mark fires on the NAME LIST instead,
 *            which is the rule this lane rejected on measurement (16,195 edges
 *            against 3,509, 4.1x). Caught by L59 `sub(2)`, a bare call with no
 *            receiver whose target happens to be a documented field name, and by
 *            L51 `mine.insert`, whose receiver is a file-local table and whose
 *            field name is documented. Those two rows are the name-list rule's
 *            specific lie and nothing else in the suite tests for them.
 *
 *   LUA-54c  GUARD MADE FILE-WIDE instead of ordered by declaration line. Caught
 *            by L35 alone: `string.format` at L35 reads the GLOBAL `string`
 *            because the file's `local string` is at L81 and Lua locals are not
 *            hoisted above their declaration. A file-wide guard withholds the mark
 *            from L35 — the same answer the mark gives for L82 — and the two rows
 *            are what tell the two guards apart.
 *
 * EACH MUTANT IS RE-DERIVED FROM THE FIXED SOURCE, never hardcoded, so it stays
 * valid as the surrounding code moves: the replacement is anchored on text that
 * exists only after the fix, and the script FAILS if that anchor is absent rather
 * than silently mutating nothing and reporting success.
 *
 * Usage: npx tsx script/m60/mutate-lua-stdlib-external.ts
 * Exits 0 only if ALL THREE mutants are caught and the source is restored.
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const ANALYZER = path.join(ROOT, "src", "ast", "real-lua-analyzer.ts")
const FIXTURES = path.join(ROOT, "script", "m60", "run-lua-fixtures.ts")

interface Mutant {
  id: string
  defect: string
  /** Present only after the fix. Its absence means the fix was reverted, and the
   * script must say so instead of reporting a pass. */
  anchor: string
  /** The statement that reinstates the defect. */
  reinstate: string
  consequence: string
  /** the fixture rows that must go red, named so the output shows WHICH caught it */
  mustCatch: string
}

const MUTANTS: Mutant[] = [
  {
    id: "LUA-54a",
    defect: "the shadowing GUARD removed — a file-local table is marked as the standard library",
    anchor: `      if (lines && lines.some(l => l <= 0 || (line > 0 && l <= line))) continue`,
    reinstate: `      // MUTANT LUA-54a: the shadowing guard removed. Every candidate is marked.`,
    consequence: "every member read whose receiver name is a documented table is called external, including the file's own",
    mustCatch: "expectUnmarkedRelationships calls -> char L92 and calls -> rep L93",
  },
  {
    id: "LUA-54b",
    defect: "the RECEIVER TEST replaced by the rejected name-list rule",
    anchor: `      if (!LUA54_TABLES.has(receiver)) continue`,
    reinstate: `      // MUTANT LUA-54b: the receiver test replaced by the rejected name-list rule.`,
    consequence: "measured at 16,195 edges against 3,509 — 4.1x — because a bare \`insert(x)\` is indistinguishable from \`table.insert(x)\` once the final segment is published. Caught ONLY by case K: cases D and E are excluded by the GUARD as well, so on the first version of this fixture this mutant SURVIVED and the fixture was not exercising the receiver test at all.",
    mustCatch: "expectUnmarkedRelationships calls -> count L85",
  },
  {
    id: "LUA-54c",
    defect: "the guard made FILE-WIDE — a name declared after the read withholds the mark",
    anchor: `      const line = Number(rel.line_number ?? 0)
      const lines = declaredAt.get(receiver)`,
    reinstate: `      const line = Number(rel.line_number ?? 0)
      const lines = declaredAt.get(receiver)
      // MUTANT LUA-54c: the guard made FILE-WIDE - any declaration anywhere.
      if (lines && lines.length > 0) continue`,
    consequence: "a name declared at the BOTTOM of a chunk withholds the mark from reads at the TOP, which read the global. Measured on the fixture as L35 losing a mark it must keep.",
    mustCatch: "expectRelationships calls -> format L35 (meta.external true) - and L92/L93 must still be UNMARKED, which is what distinguishes this from LUA-54a",
  },
]

function runFixtures(): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", FIXTURES], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 })
    return { code: 0, out }
  } catch (e: any) {
    return { code: typeof e?.status === "number" ? e.status : 1, out: `${e?.stdout ?? ""}${e?.stderr ?? ""}` }
  }
}

// ── 1. the suite must be green BEFORE any mutant, or nothing below means anything
const baseline = runFixtures()
console.log(`baseline (unmutated): exit ${baseline.code}`)
if (baseline.code !== 0) {
  console.error("FAIL: the suite is red before mutation, so a red suite after it proves nothing.")
  console.error(baseline.out)
  process.exit(1)
}

const results: { id: string; caught: boolean; rows: string[]; mustCatch: string }[] = []
for (const m of MUTANTS) {
  const original = readFileSync(ANALYZER, "utf8")
  if (!original.includes(m.anchor)) {
    console.error(`\nFAIL[${m.id}]: the fix's anchor text is not in the analyzer, so the mutant`)
    console.error(`  reinstates nothing and would report a meaningless result:\n  ${m.anchor}`)
    console.error("  Either the fix was reverted, or the source moved and this script needs updating.")
    process.exit(1)
  }
  writeFileSync(ANALYZER, original.replace(m.anchor, m.reinstate))
  let caught = false
  let rows: string[] = []
  try {
    const during = runFixtures()
    caught = during.code !== 0
    for (const line of during.out.split("\n")) {
      if (/^RED/.test(line) || /^\s{8}\S/.test(line)) rows.push(line.trim())
    }
    console.log(`\nmutant ${m.id} (${m.defect})`)
    console.log(`  exit ${during.code}  ${caught ? "CAUGHT" : "SURVIVED — the suite does not test this"}`)
    console.log(`  must be caught by: ${m.mustCatch}`)
    console.log(`  consequence if it shipped: ${m.consequence}`)
    for (const r of rows) console.log(`    ${r}`)
  } finally {
    writeFileSync(ANALYZER, original)
  }
  results.push({ id: m.id, caught, rows, mustCatch: m.mustCatch })
}

// ── 2. the restored source must be green again, or the restore did not take
const after = runFixtures()
console.log(`\nrestored: exit ${after.code}`)
if (after.code !== 0) {
  console.error("FAIL: the suite is red after restoring the source — a mutation was not reverted cleanly.")
  console.error(after.out)
  process.exit(1)
}

const survivors = results.filter((r) => !r.caught)
if (survivors.length) {
  console.error(`\nFAIL: ${survivors.length} of ${results.length} mutants SURVIVED: ${survivors.map((s) => s.id).join(", ")}.`)
  console.error("The fixture rows that name those cases are not being evaluated, so they")
  console.error("document an intention rather than a behaviour.")
  process.exit(1)
}
console.log(`\nPASS: ${results.length}/${results.length} mutants caught and the restore is clean.`)

const failingRows = results.reduce((a, r) => a + r.rows.length, 0)
console.log(`failing assertion rows observed under mutation: ${failingRows}`)