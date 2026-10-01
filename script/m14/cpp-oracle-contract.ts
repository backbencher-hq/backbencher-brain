#!/usr/bin/env bun
/**
 * The C++ oracle contract — the gate that stops a rule from dying unwired.
 *
 * THE FAILURE THIS EXISTS FOR. Eight rules in `real-cpp-analyzer.ts` are exported
 * with doc comments that name the F5 oracle as the reason they exist. Not one of
 * those comments was wrong, and for a long time not one of them was *wired*: the
 * oracle mirrored the analyzer's pre-D1 keyword set, then its pre-D2 extends
 * rule, then missed `destructor_name` in the shared `DECL_PARENT` set, then D1's
 * second gate position. Measured at full coverage over the three repos the lane
 * pins, that silence cost **387 MISSING rows** at 97.6-99.1% coverage, and in
 * every case the ANALYZER was right and TRUTH was wrong — so no analyzer gate
 * could ever have caught it, and no fixture either, because the fixtures never
 * consult the oracle.
 *
 * An export nothing calls reads as coverage and measures as nothing. A prose
 * convention ("remember to mirror this in the oracle") cannot hold that line
 * because nothing checks it. So the contract is declared in the analyzer as
 * `CPP_ORACLE_CONTRACT` and enforced HERE, from both directions:
 *
 *   1. COVERAGE — every export whose doc comment names the oracle must appear in
 *      the declared list. This is what stops the FIFTH rule from being written
 *      with that same careful comment and quietly never wired. It parses the
 *      analyzer's own source rather than trusting a hand-kept second list.
 *
 *   2. CONSUMPTION — every declared name must actually be referenced by the
 *      oracle. This is what would have caught all four. It is deliberately a
 *      reference check and not an import check: a rule can legitimately be
 *      consumed via a re-export or a namespace, and what matters is that the
 *      name is used, not how it got there.
 *
 * DIRECTION 2 IS CURRENTLY RED, and that is the point. `recoveredDeclaredName`,
 * `specifierDeclaredName` and `attributeDisplacedEnumName` are declared contracts
 * with no oracle consumer, which is the same dead-contract shape as the four this
 * gate was written for. The gate reports them rather than hiding them, and each
 * needs either a mirror in `deriveCppEdges` / `deriveCppBareUses` or a recorded
 * reason it does not apply to truth.
 *
 * USAGE
 *   bun run script/m14/cpp-oracle-contract.ts
 *   bun run script/m14/cpp-oracle-contract.ts --json
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.env.BB_M14_ROOT
  ? process.env.BB_M14_ROOT
  : join(import.meta.dir, "..", "..")
const ANALYZER = join(ROOT, "src/ast/real-cpp-analyzer.ts")
const ORACLE = join(ROOT, "script/m14/differential.ts")

const analyzerSrc = readFileSync(ANALYZER, "utf8")
const oracleSrc = readFileSync(ORACLE, "utf8")
const lines = analyzerSrc.split("\n")

/** Every `export function|const NAME`, with the doc block immediately above it. */
function analyzerExports(): { name: string; line: number; doc: string }[] {
  const out: { name: string; line: number; doc: string }[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^export (?:function|const) ([A-Za-z_]\w*)/.exec(lines[i])
    if (!m) continue
    const doc: string[] = []
    for (let j = i - 1; j >= 0; j--) {
      const s = lines[j].trim()
      if (s.startsWith("*") || s.startsWith("/*") || s.startsWith("//")) doc.unshift(lines[j])
      else break
    }
    out.push({ name: m[1], line: i + 1, doc: doc.join("\n") })
  }
  return out
}

/** The declared contract, read out of the analyzer rather than duplicated here. */
function declaredContract(): string[] {
  const m = /export const CPP_ORACLE_CONTRACT: readonly string\[\] = \[([\s\S]*?)\]/.exec(analyzerSrc)
  if (!m) return []
  return [...m[1].matchAll(/"([A-Za-z_]\w*)"/g)].map((x) => x[1])
}

// The registry itself is not a rule: its own doc comment names the oracle, so
// including it would make DIRECTION 1 flag the registry for containing the word
// it is required to contain.
const REGISTRY = "CPP_ORACLE_CONTRACT"
const exports = analyzerExports().filter((e) => e.name !== REGISTRY)
const contract = declaredContract()

// Direction 1 — a rule documented for the oracle must be declared.
const documented = exports.filter((e) => /\boracle\b/i.test(e.doc)).map((e) => e.name)
const undeclared = documented.filter((n) => !contract.includes(n))

// Direction 2 — a declared rule must have a consumer in the oracle.
const unconsumed = contract.filter((n) => {
  const uses = new RegExp(`\\b${n}\\b`).test(oracleSrc)
  return !uses
})

const asJson = process.argv.includes("--json")
const fail = undeclared.length > 0 || unconsumed.length > 0

if (asJson) {
  console.log(JSON.stringify({ documented, contract, undeclared, unconsumed, fail }, null, 2))
} else {
  console.log(`\ncpp oracle contract — declared rules and their consumers.\n`)
  console.log(`  ${contract.length} declared, ${documented.length} documented as oracle-facing\n`)
  console.log("  rule                             declared  documented  oracle consumer")
  for (const e of exports) {
    if (!contract.includes(e.name) && !documented.includes(e.name)) continue
    const d = contract.includes(e.name) ? "yes" : "NO"
    const doc = documented.includes(e.name) ? "yes" : "no"
    const used = unconsumed.includes(e.name) ? "NONE" : "yes"
    const flag = unconsumed.includes(e.name) ? "  <- dead contract" : ""
    console.log(`  ${e.name.padEnd(32)} ${d.padEnd(9)} ${doc.padEnd(11)} ${used}${flag}`)
  }
  if (undeclared.length > 0) {
    console.log(`\n  DIRECTION 1 (coverage) — exported as oracle-facing but NOT declared:`)
    for (const n of undeclared) console.log(`    ${n}   -> add it to CPP_ORACLE_CONTRACT`)
  }
  if (unconsumed.length > 0) {
    console.log(
      `\n  DIRECTION 2 (consumption) — ${unconsumed.length} declared rule(s) with NO oracle consumer:` +
        `\n  This is the shape that cost 387 MISSING rows. Each needs a mirror in`,
    )
    console.log(`  deriveCppEdges / deriveCppBareUses, or a recorded reason it does not apply to truth:`)
    for (const n of unconsumed) console.log(`    ${n}`)
  }
  if (!fail) console.log(`\n  every declared rule is wired and every documented rule is declared.`)
}

if (fail) process.exit(1)