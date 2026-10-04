/**
 * M60 LUA-52 regression mutant — a 0.95 edge claiming `structural`.
 *
 * ## Why this defect is worth a mutant when it moves two edges
 *
 * The edge COUNT does not change. `overrides` is 67 edges before the fix and 67
 * after, so every count-based gate in this lane — the census, the truth oracle's set
 * diff, the arbiter's EMITTED row — reads identically. What changed is one field on
 * two of those edges, and that field is the machine-readable reason code the honesty
 * contract §4 requires beside every confidence below 1.0.
 *
 * The defect was live because the analyzer had already written the rule it was
 * breaking. `addFactorySupertypeEdges` states it at real-lua-analyzer.ts:1381:
 * `evidenceClassFor` derives the tier from the TYPE alone — anything that is not
 * imports/references/uses is `structural` — "and a 0.95 edge must not claim
 * `structural`". `lua_inherited_member` is the analyzer's OTHER 0.95 edge, it took the
 * same 0.95 for the same reason, and it took the derived `structural` anyway.
 *
 * `structural` is not a harmless default here. It asserts "both endpoints are nodes
 * this parse saw", which is TRUE for these two edges — and is not the claim being made.
 * The claim is that `Derived.run` SHADOWS `Base.run` through an `__index` chain, and
 * nothing in the tree says that link is meant as inheritance. That is the definition of
 * `usage_contextual`: a link resting on a name in a value position, which is what
 * LUA-51's two `extends` edges already carry at the same 0.95.
 *
 * ## WHY THE FIXTURE ROW IS A FORBID AND NOT ONLY AN EXPECT
 *
 * `run-lua-fixtures.ts` supports `expectEvidenceClasses` (the tier per TYPE), and
 * `overrides` emits at two tiers by design — 65 at 1.0/`structural` and 2 at
 * 0.95/`usage_contextual` — so a per-type assertion cannot express this and would be a
 * tautology either way. The tier is asserted per ROW through `meta.evidenceClass`, the
 * same way `extends-supertype` asserts its two tiers.
 *
 * The forbid half is the load-bearing row. An implementation that derives the tier from
 * the type alone satisfies every expect row in the fixture and fails exactly this one:
 *
 *   forbidRelationships overrides Derived -> Base
 *     meta.relationshipType=lua_inherited_member meta.evidenceClass=structural
 *
 * ## THE MUTANT
 *
 * Reinstates the pre-fix metadata by DELETING the `evidenceClass` key, which is
 * exactly what the code did before — `evidenceClassFor(Overrides)` then supplies
 * `structural`. Deleting the key rather than writing `structural` is deliberate: it
 * reproduces the original defect by the original mechanism, so a mutant that merely
 * overwrote the tier with the wrong word would not be testing the same thing.
 *
 * Usage: npx tsx script/m60/mutate-lua-evidence-tier.ts
 * Exits 0 only if the mutant is caught and the source is restored.
 */
import { readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const ANALYZER = path.join(ROOT, "src", "ast", "real-lua-analyzer.ts")
const FIXTURES = path.join(ROOT, "script", "m60", "run-lua-fixtures.ts")

const ANCHOR = `              memberPath: \`\${derived}.\${member} -> \${base}.\${member}\`,`
const REINSTATE = `              memberPath: \`\${derived}.\${member} -> \${base}.\${member}\`,`

function runFixtures(): { code: number; out: string } {
  try {
    const out = execFileSync("npx", ["tsx", FIXTURES], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024,
    })
    return { code: 0, out }
  } catch (e: any) {
    return { code: typeof e?.status === "number" ? e.status : 1, out: `${e?.stdout ?? ""}${e?.stderr ?? ""}` }
  }
}

// ── 1. the suite must be green BEFORE the mutant, or a red suite after it proves nothing
const baseline = runFixtures()
console.log(`baseline (unmutated): exit ${baseline.code}`)
if (baseline.code !== 0) {
  console.error("FAIL: the suite is red before mutation, so a red suite after it proves nothing.")
  console.error(baseline.out)
  process.exit(1)
}

// ── 2. the mutant: remove the explicit tier, so the TYPE-derived one applies again
const original = readFileSync(ANALYZER, "utf8")
if (!original.includes(ANCHOR)) {
  console.error("FAIL: the fix's anchor text is not in the analyzer, so the mutant reinstates nothing.")
  console.error(`  Either the fix was reverted, or the source moved and this script needs updating:\n  ${ANCHOR}`)
  process.exit(1)
}
// The tier line and its comment block sit immediately after `memberPath`. Removing the
// whole run from the comment's closing `*/` to the `evidenceClass` key is anchored on
// text that exists ONLY after the fix, so a reverted fix fails loudly here.
const TAIL = /\n {14}\/\/ M60 LUA-52:[\s\S]*?\n {14}evidenceClass: "usage_contextual",\n/
if (!TAIL.test(original)) {
  console.error("FAIL: the LUA-52 tier block is not in the analyzer, so the mutant reinstates nothing.")
  console.error("  Either the fix was reverted, or the comment was edited and this script needs updating.")
  process.exit(1)
}

let caught = false
const rows: string[] = []
try {
  writeFileSync(ANALYZER, original.replace(TAIL, "\n"))
  const during = runFixtures()
  caught = during.code !== 0
  for (const line of during.out.split("\n")) {
    if (/^RED/.test(line) || /^\s{8}\S/.test(line)) rows.push(line.trim())
  }
  console.log(`\nmutant LUA-52 (a 0.95 edge claiming \`structural\`)`)
  console.log(`  exit ${during.code}  ${caught ? "CAUGHT" : "SURVIVED — the suite does not test this"}`)
  console.log(`  consequence if it shipped: 2 of 67 \`overrides\` edges carry a reason code that`)
  console.log(`  contradicts their own confidence. The edge count is unchanged, so no count-based`)
  console.log(`  gate can see it — which is why the assertion is per row and not per type.`)
  for (const r of rows) console.log(`    ${r}`)
} finally {
  writeFileSync(ANALYZER, original)
}

// ── 3. the restored source must be green again, or the restore did not take
const after = runFixtures()
console.log(`\nrestored: exit ${after.code}`)
if (after.code !== 0) {
  console.error("FAIL: the suite is red after restoring the source — the mutation was not reverted cleanly.")
  console.error(after.out)
  process.exit(1)
}

if (!caught) {
  console.error("\nFAIL: the mutant SURVIVED. The fixture rows that name this case are not being")
  console.error("evaluated, so they document an intention rather than a behaviour.")
  process.exit(1)
}
console.log(`\nPASS: 1/1 mutant caught and the restore is clean.`)
console.log(`failing assertion rows observed under mutation: ${rows.length}`)