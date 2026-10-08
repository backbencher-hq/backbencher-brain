#!/usr/bin/env bun
/**
 * INCOMING_PY — the lane's OWN mutation check for the four behaviours this branch adds.
 *
 * WHY A LANE-LOCAL INSTRUMENT. `script/m14/mutate-analyzer.ts` is shared harness and
 * carries mutants with ids prefixed `python/`, and adding to it is the master's file,
 * not this lane's. This script therefore does the same thing in the lane's own
 * directory: for each behaviour INCOMING_PY introduced, revert exactly that
 * behaviour, re-run the python fixture lane, and record whether the lane went red.
 *
 * A mutant that SURVIVES is not a near miss — it means the fixture asserting that
 * behaviour cannot fail, which is M14 §5.4's "silence is guilt" and the honesty
 * contract's lie-catcher #3. Both directions fail this script:
 *
 *   survives > 0  -> a fixture claims to pin a behaviour that nothing can catch
 *   reverts that leave the lane GREEN -> the behaviour was never reachable
 *
 * It also verifies the negative channel for one row per fixture, because the cheapest
 * way to write a fixture that passes forever is a `forbid` whose matcher cannot
 * discriminate — so each mutant below targets a forbid row too, not only an expect row.
 *
 * The source is edited and restored in place; the file is written to a temp copy and
 * moved, so an interrupted run cannot leave the analyzer mutated.
 */
import { readFileSync, writeFileSync, copyFileSync, unlinkSync, existsSync } from "node:fs"
import * as path from "node:path"
import { execFileSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const SRC = path.join(ROOT, "src/ast/real-python-analyzer.ts")
const BACKUP = path.join("/tmp", `real-python-analyzer.mutant-backup.${process.pid}.ts`)
const FIXTURES = path.join(ROOT, "validation/m14/fixtures/python")

type Mutant = {
  id: string
  /** What the mutant removes or breaks. Read as a claim about the FIXTURE. */
  breaks: string
  from: string
  to: string
}

const MUTANTS: Mutant[] = [
  {
    id: "python-1: dunder-all expression_list spelling dropped",
    breaks: "python/dunder-all-expression-list",
    from: `const dunderAllContainer = right
        ? (right.type === "list" || right.type === "tuple" || right.type === "expression_list") ? right : undefined
        : undefined`,
    to: `const dunderAllContainer = right
        ? (right.type === "list" || right.type === "tuple") ? right : undefined
        : undefined`,
  },
  {
    id: "python-2: assignment target with no name is published again",
    breaks: "python/nameless-assignment-target-is-no-symbol",
    from: `    if (left.text.length === 0) return

    // Instance attribute write`,
    to: `    // Instance attribute write`,
  },
  {
    id: "python-3: empty type-identifier is collected again (empty edge TARGET)",
    breaks: "python/nameless-assignment-target-is-no-symbol",
    from: `        if (n.text.length === 0) return
        if (!PRIMITIVES.has(n.text) && !out.some((x) => x.text === n.text)) out.push(n)`,
    to: `        if (!PRIMITIVES.has(n.text) && !out.some((x) => x.text === n.text)) out.push(n)`,
  },
  {
    id: "python-4: calls reasonCode removed",
    breaks: "python/dispatch-reason-codes",
    from: `      qualified: fullCallee,
      reasonCode: dispatchClass,`,
    to: `      qualified: fullCallee,`,
  },
  {
    id: "python-5: the three dispatch classes collapse into one",
    breaks: "python/dispatch-reason-codes",
    from: `          : ctx.importRoots.has(fullCallee.split(".")[0]!) ? "external-member-call" : "dispatch-on-receiver")`,
    to: `          : "dispatch-on-receiver")`,
  },
  {
    id: "python-6: instantiates reasonCode removed",
    breaks: "python/dispatch-reason-codes",
    from: `        reasonCode: "in-file-class-constructor",`,
    to: `        // removed`,
  },
  {
    id: "python-7: uses reasonCode + receiver spelling removed",
    breaks: "python/qualified-endpoint-spellings",
    from: `              reasonCode: "member-read",
              ...(receiver ? { qualified: \`\${receiver.text}.\${leaf.text}\` } : {}),`,
    to: `              isMemberReadOnly: true,`,
  },
  {
    id: "python-8: extends qualified spelling removed",
    breaks: "python/qualified-endpoint-spellings",
    from: `            ...(arg.type === "attribute" ? { qualified: arg.text } : {}),`,
    to: ``,
  },
  {
    id: "python-9: a bare-identifier base invents a qualified spelling",
    breaks: "python/qualified-endpoint-spellings",
    from: `            ...(arg.type === "attribute" ? { qualified: arg.text } : {}),`,
    // A rule that spells EVERY base would satisfy the positive row and fabricate the
    // negative one. Only the forbid channel separates them.
    to: `            qualified: baseLeaf,`,
  },
  {
    id: "python-10: annotation qualifier dropped (references qualified)",
    breaks: "python/qualified-endpoint-spellings",
    from: `              ...(qualifier ? { qualified: qualifier } : {}),`,
    to: ``,
  },
  {
    id: "python-11: a verified override loses its reason code",
    breaks: "python/dispatch-reason-codes",
    from: `ASTEngine.RelationshipType.Overrides, 0.95, { reasonCode: "mro-base-declares-method" }`,
    to: `ASTEngine.RelationshipType.Overrides, 0.95, {}`,
  },
  {
    id: "python-12: references reasonCode removed",
    breaks: "python/qualified-endpoint-spellings",
    from: `              reasonCode: PY_REFERENCE_REASON[relType] ?? "declared-type",`,
    to: ``,
  },
]

function runFixtures(): { pass: number; fail: number; failedIds: string[] } {
  let out = ""
  try {
    out = execFileSync("bun", [path.join(ROOT, "script/m14/run-fixtures.ts"), "--lang", "python"], {
      cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 256 * 1024 * 1024,
    })
  } catch (e: any) {
    out = `${e.stdout ?? ""}${e.stderr ?? ""}`
  }
  let pass = 0
  let fail = 0
  const failedIds: string[] = []
  for (const line of out.split("\n")) {
    const m = /^FAIL\s+python\/(\S+)/.exec(line)
    if (m) { fail++; failedIds.push(`python/${m[1]}`); continue }
    const p = /^PASS\s+python\/(\S+)/.exec(line)
    if (p) pass++
  }
  return { pass, fail, failedIds }
}

const original = readFileSync(SRC, "utf8")
copyFileSync(SRC, BACKUP)
const rows: { id: string; declared: string; outcome: string; fail: number }[] = []
let survived = 0
let unapplied = 0

try {
  // BASELINE first: a fixture lane that is already red makes every row below
  // meaningless, and reporting that is the whole point of running it.
  const base = runFixtures()
  console.log(`baseline: pass=${base.pass} fail=${base.fail}${base.fail ? ` (${base.failedIds.join(", ")})` : ""}\n`)
  if (base.fail > 0) {
    console.log(">>> REFUSING TO SCORE. The lane is already red, so a mutant 'caught' here proves nothing.")
    process.exit(2)
  }

  for (const m of MUTANTS) {
    const occurrences = original.split(m.from).length - 1
    if (occurrences !== 1) {
      unapplied++
      rows.push({ id: m.id, declared: m.breaks, outcome: `NOT APPLIED — anchor found ${occurrences}x (needs exactly 1)`, fail: -1 })
      continue
    }
    writeFileSync(SRC, original.replace(m.from, m.to))
    const r = runFixtures()
    const caught = r.fail > 0
    const rightFixture = r.failedIds.includes(m.breaks)
    if (!caught || !rightFixture) survived++
    rows.push({
      id: m.id,
      declared: m.breaks,
      outcome: !caught ? "SURVIVED — the fixture lane stayed green"
        : !rightFixture ? `CAUGHT by the WRONG fixture (${r.failedIds.join(", ")})`
        : `caught by ${m.breaks} (${r.fail} fixture(s) red)`,
      fail: r.fail,
    })
  }
} finally {
  if (existsSync(BACKUP)) { copyFileSync(BACKUP, SRC); unlinkSync(BACKUP) }
  if (readFileSync(SRC, "utf8") !== original) writeFileSync(SRC, original)
}

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`${w("mutant", 58)}${w("declared fixture", 46)}outcome`)
console.log("-".repeat(140))
for (const r of rows) console.log(`${w(r.id, 58)}${w(r.declared, 46)}${r.outcome}`)
console.log("-".repeat(140))
console.log(`mutants ${rows.length}   unapplied ${unapplied}   surviving ${survived}`)
if (survived > 0 || unapplied > 0) {
  console.log(`\n>>> THIS CHECK FAILS. ${survived} mutant(s) survived and ${unapplied} could not be applied.`)
  console.log(`>>> A fixture that cannot fail is not evidence; neither is a mutant whose anchor moved.`)
}
process.exitCode = survived + unapplied === 0 ? 0 : 1