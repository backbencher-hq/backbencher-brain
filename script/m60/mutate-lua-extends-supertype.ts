/**
 * M60 LUA-50 / LUA-51 regression mutants — the two `extends` defects, and the fixture
 * rows that catch them.
 *
 * WHY THIS FILE IS TWO MUTANTS AND NOT ONE. They are independent in the way that
 * matters: LUA-50 publishes an edge that does not exist, LUA-51 fails to publish one
 * that does. A single mutant reinstating both would be satisfied by a suite that
 * caught only one, which is the shape of a trivially-true check — the defect
 * mutate-lua-read-classes.ts exists to avoid, and the reason it is two mutants there
 * for the same reason.
 *
 *   LUA-50  a FABRICATED edge. The `extends` reader guarded the metatable node's
 *           TYPE but never compared its two argument NAMES, so `setmetatable(M, M)`
 *           published `extends M -> M`. That construct is the lazy `__index` idiom:
 *           lazy.nvim/lua/lazy/state.lua:45 `return setmetatable(M, M)` and
 *           trouble.nvim/lua/trouble/cache.lua:59 `local ret = setmetatable(M, M)`,
 *           both preceded by `function M.__index(_, key)`. M inherits from nothing. A
 *           self-edge on a TYPE relation is not expressible in Lua at all, so this is
 *           the most expensive defect class in this codebase: a fake caller becomes
 *           wrong refactoring advice in bb_graph, bb_impact and bb_migrate.
 *
 *   LUA-51  a MISSED edge. `local Command = class({...}, {...}, Parser)` states a
 *           supertype in the THIRD argument because luarocks declares
 *           `class(prototype, properties, parent)` at :38, while middleclass's own
 *           form is `class("Name", Super)` in the SECOND. The reader read only
 *           `setmetatable` and the `class` branch read only the class's own NAME, so
 *           both of argparse's clauses — `Command extends Parser` at :277 and
 *           `Option extends Argument` at :328 — were invisible. Measured by
 *           script/m60/lua-supertype-arg-probe.ts: 7 written supertype arguments
 *           across 5 files, of which the positional guess would have counted 0.
 *
 * EACH MUTANT IS RE-DERIVED FROM THE FIXED SOURCE, never hardcoded, so it stays valid
 * as the surrounding code moves: the replacement is anchored on text that exists only
 * after the fix, and the script FAILS if that anchor is absent rather than silently
 * mutating nothing and reporting success.
 *
 * Usage: npx tsx script/m60/mutate-lua-extends-supertype.ts
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
    id: "LUA-50",
    defect: "a SELF `extends` edge from `setmetatable(M, M)` — a fabricated type relation",
    anchor: `!this.isTableNode(target) && srcName && mtName && srcName !== mtName`,
    reinstate: `!this.isTableNode(target) && srcName && mtName`,
    consequence:
      "2 corpus edges assert that a table extends itself, on the lazy `__index` idiom. A self-edge on a type relation is inexpressible in Lua.",
  },
  {
    id: "LUA-51",
    defect: "the factory supertype clause dropped — `class(prototype, properties, parent)` unread",
    // The narrowing that makes the read safe: only a factory whose body folds the role
    // parameter into a metamethod counts. Reinstating the bare name test admits the
    // five tree-traversal `parent` parameters the corpus actually contains.
    anchor: `if (ps.some((p) => SUPERTYPE_ROLES.has(p.toLowerCase()) && foldsIntoMetamethod(node, p))) {`,
    reinstate: `if (ps.some((p) => SUPERTYPE_ROLES.has(p.toLowerCase()))) {`,
    consequence:
      "4 fabricated `extends` edges in the fixture and 5 in the corpus: `_each(widget, parent)` and `add(result, parent)` are tree traversal, and publishing them claims a widget's parent is a supertype.",
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

const failingRows = results.reduce((a, r) => a + r.rows.length, 0)
console.log(`failing assertion rows observed under mutation: ${failingRows}`)