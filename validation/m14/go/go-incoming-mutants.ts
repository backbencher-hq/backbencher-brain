// LANE-OWNED MUTATION CHECK for the INCOMING/RESOLUTION ruling.
//
// WHAT IS BEING MUTATED. The lane's verdict is that an incoming edge is not a
// relationship type this analyzer can emit, and that emitting one would be a
// FABRICATION: `calls Describe -> ToUpper` read backwards is not a call, it is a
// caller. A fixture pins that as a FORBID set (see
// `validation/m14/fixtures/go/incoming-resolve-outgoing-only.expectation.json`).
// A forbid set that nothing can violate is not a contract, so the two mutants
// below have to die for the fixture to be evidence rather than decoration.
//
// WHY THIS FILE EXISTS RATHER THAN A REGISTRY ENTRY. `script/m14/mutate-analyzer.ts`
// and the per-lane registry `script/m14/go-mutants.ts` are MASTER-owned: the
// workstream doc's ownership table puts shared `script/m14/**` machinery outside a
// language lane's remit. `script/m14/mutate-analyzer.ts` also runs a sweep over
// EVERY language on import. Adding two rows there is a shared change and is
// REPORTED in the lane report, not made here. This does the same work locally:
// apply one defect at a time to the analyzer, run the lane's fixture runner
// against the mutated tree, and require the fixture that owns the behaviour to
// FAIL.
//
// MUTANT 1 is the one that matters. It is not a typo, it is the plausible
// "improvement" a future agent would make after reading this lane's finding that
// the incoming half is unbuilt: add a pass that emits each edge in both
// directions. Every forbid row in the fixture exists to catch exactly that.
//
// MUTANT 2 is the cheaper shape: swap the two endpoints of the ownerName
// contains pass, so `contains Label -> Wrapper` appears instead of
// `contains Wrapper -> Label`. Same fabrication, reached by a one-token edit.
//
// NO REGEX. Each mutation is an exact-string replacement, and each anchor is
// asserted to appear EXACTLY ONCE before it is applied -- an anchor that
// matches twice is a transform that will silently stop meaning what it says,
// which is the mutation harness's own recorded failure mode.

import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

// `import.meta.dir` is a bun extension and is UNDEFINED under tsx, which is how
// the sibling `go-new-mutants.ts` fails when it is run with the wrong loader:
// `resolve(import.meta.dir, ...)` throws ERR_INVALID_ARG_TYPE before a single
// mutant is applied. A harness that cannot start is not a harness, so both
// spellings are accepted here. (go-new-mutants.ts still has the one-loader
// assumption; reported, not changed.)
const HERE = (import.meta as any).dir ?? dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.GO_LANE_ROOT || resolve(HERE, "..", "..", "..")
const ANALYZER = resolve(ROOT, "src/ast/real-go-analyzer.ts")
const BACKUP = resolve(ROOT, "src/ast/real-go-analyzer.ts.incoming-mutant-backup")

interface Mutant {
  id: string
  expectFailFixture: string
  rationale: string
  from: string
  to: string
}

const CONTAINS_ANCHOR = `    for (const s of symbols) {
      const owner = s.ownerName
      if (owner && owner !== s.name) {
        relationships.push({
          source: owner,
          target: s.name,`

const PASS_ANCHOR = `    // 6. OwnerName contains pass (Rust M12.18 contract): every symbol with an`

const MUTANTS: Mutant[] = [
  {
    id: "go/incoming-reverse-edge-added",
    expectFailFixture: "go/incoming-resolve-outgoing-only",
    rationale:
      "Adds the incoming half: a pass that re-emits every relationship already pushed, with source and target SWAPPED. This is the fabrication the INCOMING/RESOLUTION ruling forbids -- it doubles the graph and every reversed row asserts a relationship that does not exist (`calls ToUpper -> Describe` is not a call, it is a caller). A differential would charge all of it as `unexplained`; bb_graph, bb_impact and bb_migrate would read a fake caller as a real dependency. 19 forbid rows in the fixture exist for this one mutant.",
    from: PASS_ANCHOR,
    to:
      `    for (const _rev of relationships.slice()) {\n` +
      `      if (typeof _rev.source === "string" && typeof _rev.target === "string" && _rev.source.length > 0 && _rev.target.length > 0) {\n` +
      `        relationships.push({ source: _rev.target, target: _rev.source, type: _rev.type, confidence: _rev.confidence, metadata: { relationshipType: "go_incoming_reverse_edge" } })\n` +
      `      }\n` +
      `    }\n` +
      PASS_ANCHOR,
  },
  {
    id: "go/incoming-contains-owner-swapped",
    expectFailFixture: "go/incoming-resolve-outgoing-only",
    rationale:
      "Swaps the two endpoints of the ownerName contains pass, so `contains Label -> Wrapper` is published instead of `contains Wrapper -> Label`. Reached by a one-token pair rather than a new pass: the same fabrication, and the FORBID half must catch it too. Without the forbid rows this mutant would pass the expect half silently, because `contains Wrapper -> Label` would simply be absent and the expect row for it would fail -- which is why both halves are asserted.",
    from: CONTAINS_ANCHOR,
    to: CONTAINS_ANCHOR.replace("          source: owner,\n          target: s.name,", "          source: s.name,\n          target: owner,"),
  },
]

function runFixtures(): { fail: string[]; pass: string[]; ran: boolean } {
  const r = spawnSync("bun", ["run", "script/m14/run-fixtures.ts", "--lang", "go"], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 900_000,
  })
  const out = `${r.stdout || ""}${r.stderr || ""}`
  const fail: string[] = []
  const pass: string[] = []
  let ran = false
  for (const raw of out.split("\n")) {
    const line = raw.replace("\r", "")
    if (line.startsWith("PASS  go/")) {
      pass.push(`go/${line.slice(9).trim()}`)
      ran = true
    } else if (line.startsWith("FAIL  go/")) {
      fail.push(`go/${line.slice(9).trim()}`)
      ran = true
    }
  }
  return { fail, pass, ran }
}

const original = readFileSync(ANALYZER, "utf8")
copyFileSync(ANALYZER, BACKUP)

let baseline
try {
  baseline = runFixtures()
} finally {
  writeFileSync(ANALYZER, original)
}
if (!baseline.ran) {
  console.error("baseline fixture run produced no go rows -- the runner did not execute; refusing to report")
  process.exit(2)
}
console.log(`baseline: ${baseline.pass.length} pass / ${baseline.fail.length} fail`)
if (baseline.fail.length > 0) {
  console.error(`baseline is not clean, so no mutant result is meaningful: ${baseline.fail.join(", ")}`)
  process.exit(2)
}

const results: Array<{ id: string; expected: string; killed: boolean; collateral: string[]; rationale: string }> = []
for (const m of MUTANTS) {
  const occurrences = original.split(m.from).length - 1
  if (occurrences !== 1) {
    console.error(`MUTANT ${m.id}: anchor appears ${occurrences} times, expected exactly 1. Refusing to apply.`)
    process.exit(2)
  }
  const mutated = original.replace(m.from, m.to)
  writeFileSync(ANALYZER, mutated)
  let run
  try {
    run = runFixtures()
  } finally {
    writeFileSync(ANALYZER, original)
  }
  const killed = run.fail.includes(m.expectFailFixture)
  const collateral = run.fail.filter((f) => f !== m.expectFailFixture)
  results.push({ id: m.id, expected: m.expectFailFixture, killed, collateral, rationale: m.rationale })
  console.log(
    `${killed ? "KILLED  " : "SURVIVED"} ${m.id.padEnd(42)} expected fail: ${m.expectFailFixture}` +
      (collateral.length ? `   collateral: ${collateral.join(", ")}` : ""),
  )
}

try {
  const now = readFileSync(ANALYZER, "utf8")
  if (now !== original) {
    console.error("ANALYZER NOT RESTORED -- the backup is kept at " + BACKUP)
    process.exit(2)
  }
} finally {
  spawnSync("rm", ["-f", BACKUP])
}

const survivors = results.filter((r) => !r.killed)
console.log("")
console.log(`${results.length} mutants, ${results.length - survivors.length} killed, ${survivors.length} survivors`)
for (const r of results) console.log(`  ${r.id}: ${r.rationale}`)
process.exit(survivors.length === 0 ? 0 : 1)
