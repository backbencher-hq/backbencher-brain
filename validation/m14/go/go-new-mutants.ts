// LANE-OWNED MUTATION CHECK for the three behaviours this lane added.
//
// WHY THIS FILE EXISTS RATHER THAN A REGISTRY ENTRY. The repo's mutation
// harness is `script/m14/mutate-analyzer.ts`, which is MASTER-owned: the
// workstream doc's ownership table puts shared `script/m14/**` machinery and the
// mutant registry outside a language lane's remit. Adding three rows there is a
// shared change and is REPORTED in the lane report, not made here. A lane that
// cannot register its own mutants still has to prove its fixtures can fail, so
// this does the same thing locally: apply one defect at a time to a COPY of the
// analyzer, run the lane's fixture runner against the mutated tree, and require
// the fixture that owns the behaviour to FAIL.
//
// Each mutant is a DELETION or a FORCING of one guard, not a semantic rewrite,
// so the expectation is precise: exactly the named fixture must fail, and no
// other. A mutant that kills an unrelated fixture is recorded too — a fixture
// that dies for the wrong reason is not evidence.
//
// NO REGEX. Each mutation is an exact-string replacement, asserted present
// exactly once before it is applied.

import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { resolve } from "node:path"

const ROOT = process.env.GO_LANE_ROOT || resolve(import.meta.dir, "..", "..", "..")
const ANALYZER = resolve(ROOT, "src/ast/real-go-analyzer.ts")
const BACKUP = resolve(ROOT, "src/ast/real-go-analyzer.ts.mutant-backup")

interface Mutant {
  id: string
  expectFailFixture: string
  rationale: string
  from: string
  to: string
}

const MUTANTS: Mutant[] = [
  {
    id: "go/exports-scope-gate-removed",
    expectFailFixture: "go/exports-package-scope",
    rationale:
      "Removes the package-scope gate on the `exports` edge. The pre-fix state, exactly: a capitalized name declared inside a function body is published as `exports` with exportForm `capitalized_package_scope_name`. Measured 11 such edges in a 500-file stride sample of go-stdlib before the fix, 0 after.",
    from: "        if (!packageScopeNames.has(e.name)) continue\n",
    to: "        void packageScopeNames\n",
  },
  {
    id: "go/exports-alias-dropped-from-scope-set",
    expectFailFixture: "go/exports-contract",
    rationale:
      "Drops `type_alias` from the package-scope name collector. `type_declaration` holds a CHOICE of `type_spec` and `type_alias`, so this silently loses every exported alias — the bug this lane's own first cut of the gate had, caught by the pre-existing `exports-contract` fixture on its first run.",
    from: 'if (spec.type === "type_spec" || spec.type === "type_alias") {',
    to: 'if (spec.type === "type_spec") {',
  },
  {
    id: "go/instantiates-in-function-callee-guard-forced-true",
    expectFailFixture: "go/instantiates-callee-shape",
    rationale:
      "Forces the in-function `instantiates` callee guard to true. `bufio.NewReader(r)` in a file declaring its own `NewReader` then publishes `instantiates -> NewReader`, naming a symbol in a different package. Measured 8 such edges in a 500-file stride sample before the fix, 0 after.",
    from: "this.isGoTopLevelFunctionCallee(calleeNode, ownPackageName) &&",
    to: "true &&",
  },
  {
    id: "go/instantiates-package-scope-callee-guard-removed",
    expectFailFixture: "go/instantiates-callee-shape",
    rationale:
      "Removes the callee guard from the PACKAGE-SCOPE instantiation site. Same defect class as the row above through the second push site; both matched the callee leaf by NAME.",
    from: "if (isCtor && ctorFns.has(leaf) && this.isGoTopLevelFunctionCallee(fn, ownPackageName) && !emitted.has(\"inst:\" + leaf)) {",
    to: "if (isCtor && ctorFns.has(leaf) && !emitted.has(\"inst:\" + leaf)) {",
  },
  {
    id: "go/references-bare-result-guard-removed",
    expectFailFixture: "go/return-type-shapes",
    rationale:
      "Removes the bare-result case from the declared-type walk, restoring the state where `func f() *T` publishes no return-type reference. Measured over a 200-file stride sample: 262 bare-result sites in 46 files, 265 expected edges, 1 published (0.4%) before; 257 of 267 (96.3%) after.",
    from: 'if (result && result.type !== "parameter_list") emit(resolveSource(result), [result], "return_type")',
    to: "if (result && result.type === \"parameter_list\") emit(resolveSource(result), [result], \"return_type\")",
  },
  {
    id: "go/references-bare-result-sourced-to-global",
    expectFailFixture: "go/return-type-shapes",
    rationale:
      "Passes the DECLARATION to resolveSource instead of the result node. resolveSource starts at `start.parent`, so the walk begins one level too high and every bare result is attributed to the `global` pseudo-source. A pseudo-source is a dangling source: it names no graph node. The corpus would not catch this — `global` still counts as an emitted edge — only the fixture does.",
    from: 'if (result && result.type !== "parameter_list") emit(resolveSource(result), [result], "return_type")',
    to: 'if (result && result.type !== "parameter_list") emit(resolveSource(n), [result], "return_type")',
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
  console.error("baseline fixture run produced no go rows — the runner did not execute; refusing to report")
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
    `${killed ? "KILLED  " : "SURVIVED"} ${m.id.padEnd(52)} expected fail: ${m.expectFailFixture}` +
      (collateral.length ? `   collateral: ${collateral.join(", ")}` : ""),
  )
}

try {
  // The backup is removed only after the analyzer is byte-identical again.
  const now = readFileSync(ANALYZER, "utf8")
  if (now !== original) {
    console.error("ANALYZER NOT RESTORED — the backup is kept at " + BACKUP)
    process.exit(2)
  }
} finally {
  spawnSync("rm", ["-f", BACKUP])
}

const survivors = results.filter((r) => !r.killed)
console.log("")
console.log(`${results.length} mutants, ${results.length - survivors.length} killed, ${survivors.length} survivors`)
for (const r of results) {
  console.log(`  ${r.id}: ${r.rationale}`)
}
process.exit(survivors.length === 0 ? 0 : 1)