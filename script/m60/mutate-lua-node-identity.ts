/**
 * M60 LUA-45 regression mutant — the node-identity bug, and the fixture that
 * catches it.
 *
 * WHY THIS MUTANT EXISTS. `web-tree-sitter` returns a FRESH wrapper object on
 * every access, so `parent.namedChild(0) === node` is false even when both name
 * the same span. The `uses`/`references` rules (LUA-40/LUA-41) were first written
 * with `===`, every receiver and callee exclusion silently never fired, and the
 * analyzer published edges that state one qualified access twice under two labels
 * — measured at 3 such edges on the 15-line fixture lua/name-reads.lua
 * (`apply -> config` L22, `apply -> helper` L24, `never -> helper` L29) and, by
 * the same mechanism, 26 -> 19 edges on that fixture and 25 -> 16 on
 * lua/export-shapes.
 *
 * Nothing else in this lane's suite caught it. The six fixtures that existed
 * before this wave asserted only `contains`/`calls`/`exports`/`imports`, none of
 * which the identity comparison participates in, so a defect that removed a third
 * of the new type's edges passed every pre-existing gate. That is the argument for
 * a fixture whose negative half is a line where a name is PRESENT and must not be
 * published: no positive assertion can see a missing exclusion.
 *
 * THE MUTANT is the original defect, re-derived from the fixed source rather than
 * hardcoded, so it stays valid as the surrounding code moves: it rewrites
 * `isSameNode`'s body from a SPAN comparison to an IDENTITY comparison, which is
 * exactly the pre-fix semantics. If the suite stays green under this mutant, the
 * suite is not testing the thing it claims to test and this script fails.
 *
 * Usage: npx tsx script/m60/mutate-lua-node-identity.ts
 * Exits 0 only if the mutant is CAUGHT (suite goes red) and the source is
 * restored afterwards.
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const ANALYZER = path.join(ROOT, "src", "ast", "real-lua-analyzer.ts")
const FIXTURES = path.join(ROOT, "script", "m60", "run-lua-fixtures.ts")

const original = readFileSync(ANALYZER, "utf8")

/** The fixed body, matched by its distinguishing span comparison. */
const FIXED = `    return a.type === b.type && a.startIndex === b.startIndex && a.endIndex === b.endIndex`
/** The pre-fix semantics: web-tree-sitter hands back a new wrapper per access, so
 * this is false even for the same span, which is the whole defect. */
const MUTANT = `    return a === b`

function runFixtures(): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", FIXTURES], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 })
    return { code: 0, out }
  } catch (e: any) {
    return { code: typeof e?.status === "number" ? e.status : 1, out: `${e?.stdout ?? ""}${e?.stderr ?? ""}` }
  }
}

// ── 1. the suite must be green BEFORE the mutant, or nothing below means anything
const before = runFixtures()
console.log(`baseline (unmutated): exit ${before.code}`)
if (before.code !== 0) {
  console.error("FAIL: the suite is red before mutation, so a red suite after it proves nothing.")
  console.error(before.out)
  process.exit(1)
}

// ── 2. apply the mutant
if (!original.includes(FIXED)) {
  console.error(`FAIL: could not find the fixed span comparison in the analyzer:\n  ${FIXED}`)
  process.exit(1)
}
writeFileSync(ANALYZER, original.replace(FIXED, MUTANT))

let caught = false
let out = ""
try {
  const during = runFixtures()
  out = during.out
  caught = during.code !== 0
  console.log(`\nmutated (isSameNode -> a === b): exit ${during.code}  ${caught ? "CAUGHT" : "SURVIVED — the suite does not test this"}`)
  for (const line of out.split("\n")) if (/^RED|^ {8}/.test(line)) console.log(`  ${line.trim()}`)
} finally {
  // ── 3. restore, always, even if the mutant crashed the runner
  writeFileSync(ANALYZER, original)
  console.log("\nsource restored")
}

if (!caught) {
  console.error("\nFAIL: the mutant SURVIVED. lua/name-reads.lua asserts the receiver and")
  console.error("callee exclusions in its FORBID half, so a survivor means that half is not")
  console.error("being evaluated.")
  process.exit(1)
}

// ── 4. the restored source must be green again, or the restore did not take
const after = runFixtures()
console.log(`restored: exit ${after.code}`)
if (after.code !== 0) {
  console.error("FAIL: the suite is red after restoring the source — the mutation was not reverted cleanly.")
  console.error(after.out)
  process.exit(1)
}
console.log("\nPASS: the mutant is caught and the restore is clean.")
