/**
 * M60 LUA-46 / LUA-47 regression mutants — the two read-class defects, and the
 * fixture rows that catch them.
 *
 * WHY THIS FILE IS TWO MUTANTS AND NOT ONE. Wave 1 shipped `uses` and
 * `references` and shipped lua/name-reads to pin them, and that suite was GREEN
 * over both defects. It stayed green because its forbid rows named `config` and
 * `helper` — both RECEIVERS — while both defects live on the FIELD and on the
 * WRITE:
 *
 *   LUA-46  `emitMemberRead` excluded an assignment target with
 *             `pt === "assignment_statement" && isSameNode(parent.namedChild(0), node)`
 *           but the wired grammar puts every target inside a `variable_list`
 *           (measured: `a = 1` is assignment_statement > variable_list >
 *           identifier), so the target's parent is `variable_list`, the test could
 *           never match, and the exclusion was DEAD CODE on every write in the
 *           language. 14,833 qualified targets across 3,252 corpus files each
 *           published a `references` edge for a member that was written and never
 *           read — `memberlist_protocol.fields = 1` at
 *           docker/contrib/wireshark/memberlist.lua:41.
 *
 *   LUA-47  `emitNameRead` excluded only `namedChild(0)` of a dot/method index,
 *           which is the RECEIVER. The FIELD is `namedChild(1)` and also reached
 *           `uses`, while `references`/`calls` published the same member. 8,041
 *           member edges over 400 corpus files carried both labels for the same
 *           member on the same line — 26.07% of the corpus's member edges.
 *
 * So each mutant reinstates ONE defect and the suite must go red for each
 * separately. A single mutant that reinstated both would be satisfied by a suite
 * that caught only one, which is the shape of a trivially-true check.
 *
 * EACH MUTANT IS RE-DERIVED FROM THE FIXED SOURCE, never hardcoded, so it stays
 * valid as the surrounding code moves: the replacement is anchored on text that
 * exists only after the fix, and the script FAILS if that anchor is absent rather
 * than silently mutating nothing and reporting success.
 *
 * Usage: npx tsx script/m60/mutate-lua-read-classes.ts
 * Exits 0 only if BOTH mutants are caught and the source is restored.
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
  /** The pre-fix statement, reinstated verbatim. */
  reinstate: string
  consequence: string
}

const MUTANTS: Mutant[] = [
  {
    id: "LUA-46",
    defect: "an assignment TARGET published as a `references` READ",
    anchor: `      if (pt === "variable_list") return`,
    reinstate: `      if (pt === "assignment_statement" && this.isSameNode(parent.namedChild(0), node)) return`,
    consequence: "14,833 qualified writes corpus-wide publish `references` for a member never read",
  },
  {
    id: "LUA-47",
    defect: "a qualified access's FIELD published as BOTH `uses` and `references`/`calls`",
    anchor: `      if (this.isSameNode(parent.namedChild(parent.namedChildCount - 1), node)) return`,
    reinstate: `      // MUTANT: the field exclusion removed, restoring the receiver-only rule.`,
    consequence: "8,041 member edges over 400 files carry two labels for one access",
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

const results: { id: string; caught: boolean; rows: string[] }[] = []
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
    console.log(`  consequence if it shipped: ${m.consequence}`)
    for (const r of rows) console.log(`    ${r}`)
  } finally {
    writeFileSync(ANALYZER, original)
  }
  results.push({ id: m.id, caught, rows })
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

// The count is printed so a later run that loses a mutant cannot read as a pass.
const failingRows = results.reduce((a, r) => a + r.rows.length, 0)
console.log(`failing assertion rows observed under mutation: ${failingRows}`)