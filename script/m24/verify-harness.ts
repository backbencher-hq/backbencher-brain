// script/m24/verify-harness.ts — M24.V1 verifier (the I1 gate).
//
// Runs the reference LSP client harness (script/m24/lsp_harness.ts) against
// every available runtime and asserts:
//   G1 harness:   every executed leg drives lifecycle + all L1-L5 features
//                 with positive and negative cases, and reports 0 failures
//   G2 budgets:   every measured warm p95 meets the contract §3 budget —
//                 a budget miss is a failed gate, not a footnote
//   G3 runtimes:  node-source and node-dist must verify; bun-source is
//                 attempted and, when the runtime is missing, recorded as
//                 blocked WITH reason — never a silent skip (silence is
//                 guilt)
//   G4 mutation:  the budget gate can FAIL — a hidden budget violation in
//                 the output is caught (the gate is not hollow)
//   G5 machine:   the machine facts §3 requires every measured number to
//                 carry are MEASUREMENTS, not artifacts of a failed platform
//                 read: `ramGb: 0` and `cpu: ""` are rejected, every value
//                 is cross-checked against a live reading taken by this gate,
//                 every value names its source, and a value that genuinely
//                 cannot be determined must be a DECLARED ABSENCE WITH A
//                 REASON (absence is legal; a plausible-looking zero is not)
//   G6 mutation:  the machine-facts owner can FAIL this gate — the /proc read
//                 planted back, a forced ramGb:0, a forced cpu:"" and a
//                 reasonless absence are each caught, and a declared absence
//                 WITH its reason is still accepted (the rule bans the lie,
//                 not the absence)
//
// G5/G6 exist because of what this gate published for months: three sealed V1
// runs carried `machine: {"cpu": "", "ramGb": 0}` under a VERIFIED verdict.
// `sh -c "grep … /proc/cpuinfo | …"` returns normally on macOS (a pipeline
// exits with its LAST stage), so the harness's `catch {}` never fired, `""`
// overwrote its own "unknown" fallback, and `Number("")` rounded to 0. A
// measurement that was never taken, published as if it had been.
//
// Run: npx tsx script/m24/verify-harness.ts
// Evidence: validation/m24/results/V1.json (machine-emitted)

import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import os, { tmpdir } from "node:os"
import { machineFacts, runHarness, type HarnessRun, type MachineFacts } from "./lsp_harness"
import { writeSealed } from "../lib/evidence.ts"
import { fingerprintFields } from "../m61/claim_fingerprints.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const EVIDENCE_PATH = join(ROOT, "validation", "m24", "results", "V1.json")
const HARNESS_PATH = join(ROOT, "script", "m24", "lsp_harness.ts")

let passed = 0
let failed = 0
const failures: string[] = []
let negativeCases = 0

function check(name: string, ok: boolean, detail = ""): void {
  if (ok) {
    passed++
    console.log(`  ok: ${name}`)
  } else {
    failed++
    failures.push(name)
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`)
  }
}

function negative(name: string, ok: boolean, detail = ""): void {
  negativeCases++
  check(`${name} [negative]`, ok, detail)
}

/** Contract §3 warm budgets (ms, p95). A miss is a failed gate. */
export const WARM_BUDGETS: Record<string, number> = {
  hover: 50,
  definition: 50,
  references: 50,
  documentSymbol: 50,
  workspaceSymbol: 150,
  prepareCallHierarchy: 100,
  callHierarchyExpand: 100,
}

/** The budget gate: returns the list of violations (empty = pass). */
export function budgetViolations(run: HarnessRun): string[] {
  const violations: string[] = []
  for (const m of run.features) {
    const budget = WARM_BUDGETS[m.op]
    if (budget === undefined) {
      violations.push(`${m.op}:no-budget-declared`)
      continue
    }
    if (m.p95WarmMs >= budget) {
      violations.push(`${m.op}:${m.p95WarmMs.toFixed(1)}ms>=${budget}ms`)
    }
  }
  return violations
}

// ---------------------------------------------------------------------------
// G5/G6 — the machine-facts rule (contract §3 + §8.7)
//
// The oracle lives HERE, in the gate, and measures the record against a
// reading this gate takes ITSELF with node:os. It deliberately does not call
// the harness's own machine-facts function for the reference: an oracle that
// shares an implementation with the thing it audits cannot catch that thing
// being wrong (contract §8.7, "the oracle sharing a bug with the
// implementation").
// ---------------------------------------------------------------------------

export type MachineReference = { kernel: string; cpu: string | null; ramGb: number | null }

/** A live reading of this machine, taken by the gate. */
export function liveMachineReference(): MachineReference {
  const total = os.totalmem()
  return {
    kernel: `${os.type()} ${os.release()}`,
    cpu: os.cpus()[0]?.model?.trim() ? os.cpus()[0]!.model.trim() : null,
    ramGb: Number.isFinite(total) && total > 0 ? Math.round((total / 1e9) * 10) / 10 : null,
  }
}

/** Placeholders that read like a value but are not one. */
const PLACEHOLDERS = new Set(["unknown", "n/a", "na", "null", "undefined", "none", "-", "?", "0"])

/**
 * Everything that would make this machine record a lie. Empty = honest.
 *
 * Pure over (record, reference) so the mutation suite can feed it doctored
 * records and a doctored reference.
 */
export function machineFactProblems(record: unknown, reference: MachineReference = liveMachineReference()): string[] {
  const problems: string[] = []
  if (record === null || typeof record !== "object") return ["the machine record is missing or not an object"]
  const m = record as Record<string, unknown>

  // --- kernel: always determinable, never empty, must match this host -------
  if (typeof m.kernel !== "string" || m.kernel.trim() === "") {
    problems.push("kernel is empty: an empty string in a machine record reads as a kernel fact")
  } else if (PLACEHOLDERS.has(m.kernel.trim().toLowerCase())) {
    problems.push(`kernel ${JSON.stringify(m.kernel)} is a placeholder, not a measurement`)
  } else if (m.kernel !== reference.kernel) {
    problems.push(`kernel ${JSON.stringify(m.kernel)} does not match this host's live reading ${JSON.stringify(reference.kernel)}`)
  }
  if (typeof m.kernelSource !== "string" || m.kernelSource.trim() === "") {
    problems.push("kernelSource is missing: a machine value with no declared provenance is not a measurement")
  }

  // --- cpu: null is a DECLARED ABSENCE and needs a reason; "" never is ------
  if (m.cpu === null) {
    if (typeof m.cpuReason !== "string" || m.cpuReason.trim() === "") {
      problems.push("cpu is a declared absence (null) with NO reason — silence is guilt (§8.3)")
    }
  } else if (typeof m.cpu !== "string") {
    problems.push(`cpu is ${typeof m.cpu}, expected a string or a declared absence (null)`)
  } else if (m.cpu.trim() === "" || PLACEHOLDERS.has(m.cpu.trim().toLowerCase())) {
    problems.push(`cpu ${JSON.stringify(m.cpu)} is empty/a placeholder dressed as a CPU fact — this is exactly what a failed /proc read yields`)
  } else if (reference.cpu !== null && m.cpu !== reference.cpu) {
    problems.push(`cpu ${JSON.stringify(m.cpu)} does not match this host's live reading ${JSON.stringify(reference.cpu)}`)
  }
  if (typeof m.cpuSource !== "string" || m.cpuSource.trim() === "") {
    problems.push("cpuSource is missing: a machine value with no declared provenance is not a measurement")
  }

  // --- ramGb: 0 is THE artifact of a failed read; null needs a reason -------
  if (m.ramGb === null) {
    if (typeof m.ramReason !== "string" || m.ramReason.trim() === "") {
      problems.push("ramGb is a declared absence (null) with NO reason — silence is guilt (§8.3)")
    }
  } else if (typeof m.ramGb !== "number" || !Number.isFinite(m.ramGb)) {
    problems.push(`ramGb is ${JSON.stringify(m.ramGb)}, expected a finite number or a declared absence (null)`)
  } else if (m.ramGb <= 0) {
    problems.push(`ramGb ${m.ramGb} is not a measurement: a zero RAM is what Number(\"\")/1e6 rounds to when the platform read fails`)
  } else if (reference.ramGb !== null && m.ramGb !== reference.ramGb) {
    problems.push(`ramGb ${m.ramGb} does not match this host's live reading ${reference.ramGb}`)
  }
  if (typeof m.ramSource !== "string" || m.ramSource.trim() === "") {
    problems.push("ramSource is missing: a machine value with no declared provenance is not a measurement")
  }
  return problems
}

/** Replace a top-level function (header needle → the `\n}` that closes it). */
function replaceTopLevelFunction(src: string, headerNeedle: string, replacement: string): string {
  const start = src.indexOf(headerNeedle)
  if (start < 0) return src
  const end = src.indexOf("\n}\n", start)
  if (end < 0) return src
  return src.slice(0, start) + replacement + src.slice(end + 3)
}

const MACHINE_MUTANTS: Array<{ name: string; apply: (src: string) => string; expectCaught: boolean }> = [
  {
    // The historical defect, verbatim: `sh -c` pipelines exit with their last
    // stage, so this returns "" and 0 on any OS without /proc, silently.
    name: "the /proc read planted back (the historical defect)",
    apply: (src) =>
      replaceTopLevelFunction(
        src,
        "export function machineFacts(runtime: string): MachineFacts {",
        `export function machineFacts(runtime: string): MachineFacts {
  const kernel = execFileSync("uname", ["-sr"], { encoding: "utf8" }).trim()
  let cpu = "unknown"
  try {
    cpu = execFileSync("sh", ["-c", "grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs"], { encoding: "utf8" }).trim()
  } catch {}
  const ramGb = Math.round((Number(execFileSync("sh", ["-c", "grep MemTotal /proc/meminfo | awk '{print $2}'"], { encoding: "utf8" }).trim()) / 1e6) * 10) / 10
  return { kernel, kernelSource: "uname -sr", cpu, cpuSource: "/proc/cpuinfo", ramGb, ramSource: "/proc/meminfo", node: process.version, runtime }
}`,
      ),
    expectCaught: true,
  },
  {
    name: "ramGb forced to 0",
    apply: (src) => src.replace("Math.round((totalBytes / 1e9) * 10) / 10 : null", "0 : null"),
    expectCaught: true,
  },
  {
    name: "cpu forced to \"\" (the value the /proc read produced)",
    apply: (src) => src.replace('cpu: cpuModel === "" ? null : cpuModel,', 'cpu: "",'),
    expectCaught: true,
  },
  {
    name: "declared absence with NO reason (silence is guilt)",
    // Force the absence AND suppress the reason the implementation writes for
    // it: an implementation that can produce a reasonless null must be caught.
    apply: (src) =>
      src.replace('const cpuModel = os.cpus()[0]?.model?.trim() ?? ""', 'const cpuModel = ""').replace("if (facts.cpu === null) {", "if (false) {"),
    expectCaught: true,
  },
  {
    name: "PRECISION: a genuine declared absence WITH its reason is accepted (the rule bans the lie, not the absence)",
    apply: (src) => src.replace('const cpuModel = os.cpus()[0]?.model?.trim() ?? ""', 'const cpuModel = ""').replace("const totalBytes = os.totalmem()", "const totalBytes = 0"),
    expectCaught: false,
  },
]

async function main(): Promise<void> {
  console.log("M24.V1 verifier — reference LSP client harness + latency-budget gate\n")

  const runs: HarnessRun[] = []

  // --- G3: every runtime leg is attempted; missing runtime = blocked ---
  for (const runtime of ["node-source", "node-dist", "bun-source"] as const) {
    const run = await runHarness({ runtime })
    runs.push(run)
    if (run.status === "blocked") {
      // Blocked is a legitimate recorded state (contract: missing dependency
      // = blocked with reason, never silently skipped) — but the harness
      // must have EXPLICITLY reported it, which runHarness always does.
      check(`G3: ${runtime} leg reported explicitly`, run.reason !== undefined && run.reason !== "", run.reason)
      console.log(`      ${runtime}: BLOCKED — ${run.reason}`)
      continue
    }
    check(`G3: ${runtime} leg verified (all harness checks pass)`, run.status === "verified", run.reason)
    const harnessFails = run.checks.filter((c) => !c.ok)
    check(`G3: ${runtime} harness reports 0 failures`, harnessFails.length === 0, harnessFails.map((f) => f.name).join(", "))
  }

  // --- G2: budget gate on every executed leg ---
  for (const run of runs) {
    if (run.status !== "verified") continue
    const violations = budgetViolations(run)
    check(
      `G2: ${run.runtime} meets all warm budgets (${run.features.length} ops)`,
      violations.length === 0,
      violations.join(", "),
    )
  }

  // --- G4: the gate can FAIL (mutation: hidden budget violation) ---
  // Plant a budget violation directly into a verified run's measurements and
  // prove the gate rejects it — the gate is not hollow.
  const verified = runs.find((r) => r.status === "verified")
  if (verified) {
    const fakeRun: HarnessRun = {
      ...verified,
      features: verified.features.map((f) =>
        f.op === "hover" ? { ...f, p95WarmMs: WARM_BUDGETS.hover! * 2 } : f,
      ),
    }
    const violations = budgetViolations(fakeRun)
    negative(
      "G4: gate rejects a hidden hover budget violation (2x budget)",
      violations.length === 1 && violations[0]!.startsWith("hover:"),
      violations.join(", "),
    )

    // Mutation proof: a mutated gate that HIDES the violation (comparison
    // always false — never flags anything) must produce a different verdict
    // from the real gate. This is the can-fail property: if the suite could
    // not tell the real gate from an always-pass gate, the gate would be
    // hollow and V1 could never close.
    const mutantGate = (run: HarnessRun): string[] => {
      // Mutant: budget check inverted to never flag (violation hidden).
      void run
      return []
    }
    const realVerdict = budgetViolations(fakeRun).length
    const mutantVerdict = mutantGate(fakeRun).length
    check(
      "G4: real gate and mutant (hidden-violation) gate produce different verdicts",
      realVerdict === 1 && mutantVerdict === 0 && realVerdict !== mutantVerdict,
      `real=${realVerdict} mutant=${mutantVerdict}`,
    )
  } else {
    check("G4: at least one leg verified to run the mutation probe", false, "no verified leg")
  }

  // --- G5: the machine facts are MEASUREMENTS (contract §3, §8.7) -----------
  // Every leg publishes them, including the BLOCKED ones: a leg that could not
  // run still reports the machine it did not run on, and that record is sealed.
  const reference = liveMachineReference()
  for (const run of runs) {
    const problems = machineFactProblems(run.machine, reference)
    check(
      `G5: ${run.runtime} machine facts are measurements with declared provenance (kernel/cpu/ram cross-checked against a live reading)`,
      problems.length === 0,
      problems.join("; "),
    )
  }
  // The rule must not be a rule that flags everything: a real measurement,
  // taken by the real implementation, must be clean.
  check(
    "G5: the machine-facts rule accepts a real measurement (it is not a rule that rejects everything)",
    machineFactProblems(machineFacts("gate-self-test"), reference).length === 0,
    machineFactProblems(machineFacts("gate-self-test"), reference).join("; "),
  )
  // And the three shapes this defect class takes, proven on synthetic records
  // so the rule is pinned even on a host where the portable APIs do answer.
  const syntheticGood: MachineFacts = machineFacts("synthetic")
  negative(
    "G5: a record with ramGb:0 is rejected (the /proc read's artifact)",
    machineFactProblems({ ...syntheticGood, ramGb: 0 }, reference).some((p) => /ramGb 0/.test(p)),
    machineFactProblems({ ...syntheticGood, ramGb: 0 }, reference).join("; "),
  )
  negative(
    `G5: a record with cpu:"" is rejected (empty dressed as a CPU fact)`,
    machineFactProblems({ ...syntheticGood, cpu: "" }, reference).some((p) => /cpu ""/.test(p)),
    machineFactProblems({ ...syntheticGood, cpu: "" }, reference).join("; "),
  )
  negative(
    "G5: a declared absence with no reason is rejected; the same absence WITH a reason is accepted",
    machineFactProblems({ ...syntheticGood, cpu: null, cpuReason: undefined }, reference).some((p) => /NO reason/.test(p)) &&
      machineFactProblems({ ...syntheticGood, cpu: null, cpuReason: "os.cpus()[0].model was empty on this host" }, reference).length === 0,
    machineFactProblems({ ...syntheticGood, cpu: null, cpuReason: undefined }, reference).join("; "),
  )
  negative(
    "G5: a machine value whose provenance is undeclared is rejected",
    machineFactProblems({ ...syntheticGood, ramSource: "" }, reference).some((p) => /ramSource is missing/.test(p)),
    machineFactProblems({ ...syntheticGood, ramSource: "" }, reference).join("; "),
  )
  negative(
    "G5: a kernel that disagrees with this host is rejected (a machine record from another box, pasted in)",
    machineFactProblems({ ...syntheticGood, kernel: "Linux 4.4.0-1-amd64" }, reference).some((p) => /does not match this host/.test(p)),
    machineFactProblems({ ...syntheticGood, kernel: "Linux 4.4.0-1-amd64" }, reference).join("; "),
  )

  // --- G6: the machine-facts owner can FAIL this gate ----------------------
  // Each mutant is a planted defect in a COPY of lsp_harness.ts; the copy is
  // imported and its own machineFacts() output is judged by the rule above.
  // The /proc mutant is the historical defect, so this suite can reproduce the
  // published lie on any future run.
  const harnessSource = readFileSync(HARNESS_PATH, "utf8")
  const MUTANT_PATH = join(ROOT, "script", "m24", ".machine-mutant.ts")
  const machineMutantResults: Array<{ name: string; caught: boolean; detail: string }> = []
  for (const [i, mut] of MACHINE_MUTANTS.entries()) {
    const mutated = mut.apply(harnessSource)
    if (mutated === harnessSource) {
      machineMutantResults.push({ name: mut.name, caught: false, detail: "mutation produced no change — fix the mutant definition" })
      negative(`G6: planted machine-facts defect [${mut.name}] is defined`, false, "no change")
      continue
    }
    writeFileSync(MUTANT_PATH, mutated)
    let facts: unknown
    try {
      const mod: any = await import(`${MUTANT_PATH}?m=${i}&t=${Date.now()}`)
      facts = mod.machineFacts(`mutant:${mut.name}`)
    } catch (e: any) {
      machineMutantResults.push({ name: mut.name, caught: false, detail: `mutant module failed to load: ${e.message}` })
      negative(`G6: planted machine-facts defect [${mut.name}] loads`, false, e.message)
      continue
    } finally {
      if (existsSync(MUTANT_PATH)) rmSync(MUTANT_PATH, { force: true })
    }
    const problems = machineFactProblems(facts, reference)
    const caught = mut.expectCaught ? problems.length > 0 : problems.length === 0
    machineMutantResults.push({
      name: mut.name,
      caught,
      detail: caught
        ? mut.expectCaught
          ? `judged a lie: ${problems[0]}`
          : "judged clean (a declared absence with a reason is not a lie)"
        : mut.expectCaught
          ? `SURVIVED: the rule found nothing in ${JSON.stringify(facts)}`
          : `FALSE POSITIVE: ${problems.join("; ")}`,
    })
    check(
      `G6: planted machine-facts defect [${mut.name}] ${mut.expectCaught ? "is caught" : "is NOT flagged"}`,
      caught,
      caught ? "" : (problems.length ? problems.join("; ") : JSON.stringify(facts)),
    )
  }
  check(
    "G6: every planted machine-facts defect was caught and every precision proof held",
    machineMutantResults.every((r) => r.caught),
    machineMutantResults.filter((r) => !r.caught).map((r) => r.name).join("; "),
  )

  // --- Persist evidence -----------------------------------------------------
  const currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  const sourceFingerprint = createHash("sha256").update(harnessSource).digest("hex")
  const ok = failed === 0

  const evidence = {
    issue: "495",
    code: "V1",
    status: ok ? "verified" : "known-gap",
    currentCommit,
    ...fingerprintFields(["m24.V1"], ROOT),
    verifierCommand: "npx tsx script/m24/verify-harness.ts",
    evidenceFile: "V1.json",
    generatedAt: new Date().toISOString(),
    passed,
    failed,
    failures,
    negativeCases,
    verdict: {
      realComponentFailures: failed,
      ok,
      note: "`failed` counts real gate failures only; blocked runtime legs are recorded with reason, never silently skipped.",
    },
    runs: runs.map((r) => ({
      runtime: r.runtime,
      status: r.status,
      reason: r.reason,
      commit: r.commit,
      machine: r.machine,
      machineFactsAudit: machineFactProblems(r.machine),
      fixtureStats: r.fixtureStats,
      features: r.features,
    })),
    machineFacts: {
      rule: "every §3 machine fact is a measurement with declared provenance; a fact that cannot be determined is a DECLARED ABSENCE (null) WITH a reason — never 0, never \"\"",
      owner: "script/m24/lsp_harness.ts machineFacts() — node:os only (os.type/os.release, os.cpus, os.totalmem), no uname, no /proc, no shell",
      liveReference: liveMachineReference(),
      measuredOs: { platform: os.platform(), release: os.release(), arch: os.arch() },
      declaredAbsentOses: ["win32"],
      plantedDefectsCaught: machineMutantResults.filter((r) => r.caught).length,
      plantedDefectsTotal: machineMutantResults.length,
      plantedDefects: machineMutantResults,
      superseded: {
        what: "these records previously carried machine.cpu === \"\" and machine.ramGb === 0",
        why: "the previous owner read /proc/cpuinfo and /proc/meminfo through `sh -c` PIPELINES; a pipeline exits with its LAST stage, so on any OS without /proc the read returned \"\" with exit status 0 — the harness's catch never fired, the empty string overwrote its own \"unknown\" fallback, and Number(\"\")/1e6 rounded to 0. Both values were published under a VERIFIED verdict.",
        severity: "a measurement that was never taken, published as if it had been (contract §8.7)",
        fixedIn: "script/m24/lsp_harness.ts machineFacts() + gated by G5/G6 in this verifier",
      },
    },
    budgets: WARM_BUDGETS,
    limitations: [
      "bun-source leg is blocked in this environment (bun not installed); the harness attempts it every run and records the reason — never a silent skip",
      "latency measured on this machine only (kernel/CPU/RAM recorded per run, each with its source and cross-checked against a live reading by G5); cross-platform budgets are M25 scope",
      "fixture workspace is a single TypeScript file; per-language fixtures follow in M25",
      "cold-start latency not measured in this issue (warm regime only, per contract §3 definition)",
      "CORRECTION to M24 lane-1 wave 1: that report stated lsp_harness.ts:80 was 'unguarded and throws on macOS' and that 'every M24 harness that calls machineInfo() (L1-L5, V1) dies there'. BOTH halves were wrong. (a) It does not throw — a `sh -c` pipeline exits with its last stage, so grep failing and awk succeeding returns normally with an empty string, and the sibling line's catch never fires either. (b) The blast radius was overstated: only verify-harness.ts (V1) publishes machine facts from this harness. The narrower truth is WORSE in one respect and better in another: nothing crashed, so the bad values were sealed silently under a VERIFIED verdict instead of failing loudly. Superseded by this record's machineFacts.superseded and by G5/G6.",
      "CORRECTION to the correction: runHarness has more consumers than V1 — script/m27/verify-zed.ts:187, script/m27/verify-lsp4ij.ts:188, script/m27/verify-helix.ts:163 and script/m48/l1-hub-smoke.ts:29 all call it. They do not copy `.machine` into their evidence (checked), so only V1 published the bad values; but the defect was reachable from four more gates, and m48's L1-smoke.json WOULD carry cpu:\"/\"ramGb:0 if regenerated on a non-/proc host (the committed copy was measured on Linux).",
      "G5's cross-check compares the record against a live reading taken in the same process on the same host. It proves the record is this machine's truth; it cannot detect a host that reports a wrong value through node:os itself — that would need a second, independent source and is declared unverified.",
    ],
  }

  writeSealed(EVIDENCE_PATH, evidence)
  console.log(`\nV1: ${evidence.status.toUpperCase()} (${passed}/${passed + failed} passed, ${negativeCases} negative)`)
  console.log(`Evidence: ${EVIDENCE_PATH}`)
  if (!ok) process.exitCode = 1
}

// Execute-only. The oracle above (`machineFactProblems`, `liveMachineReference`,
// `budgetViolations`) is meant to be importable by a REVIEWER — separation of
// duties (§8.6) needs a second pair of eyes to be able to run the rule against
// a record without launching the whole gate. That was not possible while this
// file called main() at import: a reviewer importing the rule silently spawned
// three LSP servers and rewrote V1.json. (Found by lane 1 wave 2, doing exactly
// that: the import ran the gate and the gate's own node-source leg failed under
// the double run.)
if (/(^|[\\/])verify-harness\.(ts|mts|cts|js|mjs|cjs)$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error("verifier crashed:", error)
    process.exit(1)
  })
}
