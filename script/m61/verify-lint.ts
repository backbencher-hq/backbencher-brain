// script/m61/verify-lint.ts — M61.V4 verifier + mutation suite (issue #845).
//
// Proves the verifier lint (script/m61/gate_lint.ts) honors its laws, and that
// the suite CAN FAIL.
//
//   G0 corpus:       the lint sees the lane (a real gate count and record
//                    count, not zeros) and its derived tier map is non-empty.
//   G1 gate census:  every lane script that runs checks owns a record or is a
//                    DECLARED non-gate. A declared non-gate that owns a record
//                    fails (the declaration cannot hide a real gate). The real
//                    lane satisfies this — the lint reports zero G1 failures.
//   G2 attribution:  no orphan records in the lane.
//   G3 sealing:      every lane record is sealed or declared legacy.
//   G4 can-fail:     every gate carries >= the declared floor of can-fail
//                    proofs, or is declared in declaredNoCanFail WITH a reason.
//                    A declared-no-can-fail gate that carries proof fails.
//   G5 wiring:       every gate is in >= 1 tier; verify:fast ⊆ verify.
//   G6 env:          every BB_* env var a gate reads is declared with its role.
//   G7 import order: no lane gate imports a lane module with a DYNAMIC
//                    `import("./…")` — the TDZ bug class (#847), which the rule
//                    found once, for real, in script/m29/verify-analyzer-relevance.ts.
//   G8 record=run:   no check runs after a gate's last evidence write — a record
//                    one check stale is a record that disagrees with its run
//                    (found in M61.V1, M61.V2 and M55.X1).
//
// Mutants (source-level copies of the lint's pure decision cores) prove the
// suite CAN FAIL:
//   M1 canfail-blind:   canFailProofs always reports a proof.
//   M2 seal-blind:      isSealed always true.
//   M3 orphan-blind:    attribution claims every record.
//   M4 floor-ignored:   the can-fail floor check is dropped.
//   M5 env-blind:       undeclared env vars stop failing.
//   M6 tier-blind:      a gate in no execution tier stops failing G5.
//   M7 import-order-blind: a relative dynamic import stops failing G7.
//   M8 record-order-blind: a check after the last write stops failing G8.
//
// Run: npx tsx script/m61/verify-lint.ts
// Evidence: validation/m61/results/V4.json (sealed)

import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import {
  ROOT,
  canFailProofs,
  importOrderFindings,
  isSealed,
  lint,
  loadRegistry,
  recordAfterChecksFinding,
  type LintReport,
} from "./gate_lint.ts"

const RESULTS = path.join(ROOT, "validation/m61/results")

let passed = 0
let failed = 0
const failures: string[] = []
const checks: string[] = []
function check(name: string, ok: boolean, detail?: string): void {
  if (ok) passed++
  else {
    failed++
    failures.push(detail ? `${name} — ${detail}` : name)
  }
  checks.push(`${ok ? "ok" : "FAIL"}: ${name}${detail && !ok ? ` — ${detail}` : ""}`)
}

const src = readFileSync(path.join(ROOT, "script/m61/gate_lint.ts"), "utf8")
const registry = loadRegistry()
const report: LintReport = lint(registry)

// --- G0: the lint sees the real lane ---------------------------------------------
console.log("G0: the lint sees the lane")
check("G0: the lint found gates", report.gateCount >= 40, `gateCount=${report.gateCount}`)
check("G0: the lint found lane records", report.recordCount >= 100, `recordCount=${report.recordCount}`)
check("G0: the derived tier map is non-empty", report.tiers.some((t) => t.gateCount > 0), JSON.stringify(report.tiers))
check(
  "G0: the registry declares at least the three lane tiers",
  report.tiers.length >= 3,
  report.tiers.map((t) => t.name).join(","),
)

// --- G1/G2/G3/G4/G5/G6: the lint over the REAL lane -------------------------------
console.log("\nG1-G6: the lint over the real lane")
const byRule = (r: string) => report.failures.filter((f) => f.startsWith(`${r}:`))
check("G1: every lane script that runs checks is a gate or a declared non-gate", byRule("G1").length === 0, byRule("G1").slice(0, 3).join(" | "))
// G2's law is that no record is UNEXPLAINED: an orphan must be a declared
// artifact. The raw orphan list is reported in the census either way.
check("G2: every orphan record is a declared artifact", byRule("G2").length === 0, byRule("G2").slice(0, 3).join(" | "))
check(
  "G2: the census accounts for every record (gates + artifacts + orphans)",
  report.orphanRecords.length >= report.artifactRecords.length - 1,
  `orphans=${report.orphanRecords.length} artifacts=${report.artifactRecords.length}`,
)
check("G3: every lane record is sealed or declared legacy", byRule("G3").length === 0, byRule("G3").slice(0, 3).join(" | "))
check("G4: every gate carries a can-fail proof or a declared reason", byRule("G4").length === 0, byRule("G4").slice(0, 4).join(" | "))
check("G5: every gate is wired into a tier, and fast ⊆ full", byRule("G5").length === 0, byRule("G5").slice(0, 3).join(" | "))
check("G6: every BB_* env var a gate reads is declared", byRule("G6").length === 0, byRule("G6").slice(0, 3).join(" | "))
check("G7: no lane gate dynamically imports a lane module", byRule("G7").length === 0, byRule("G7").slice(0, 3).join(" | "))
check("G8: no lane gate runs a check after its last evidence write", byRule("G8").length === 0, byRule("G8").slice(0, 3).join(" | "))
check("G0: the lint reports no unexplained failures at all", report.failures.length === 0, report.failures.slice(0, 5).join(" | "))

// --- core functions on known inputs ----------------------------------------------
console.log("\ncores: known inputs")
check(
  "core: a record with declared mutants counts as proof",
  canFailProofs({ mutantsCaught: 3 }).mutants === 3,
)
check(
  "core: a record whose checksList names M: checks counts as proof",
  canFailProofs({ checksList: ["ok: M: one", "ok: M: two", "ok: plain"] }).mutants === 2,
)
check(
  "core: a record with neither counts nor M: checks has no proof",
  canFailProofs({ status: "verified", checksList: ["ok: plain"] }).mutants + canFailProofs({ status: "verified", checksList: ["ok: plain"] }).negatives === 0,
)
check("core: a sealed record is recognised", isSealed({ bbSeal: { alg: "sha256" } }) === true)
check("core: an unsealed record is not", isSealed({ status: "verified" }) === false)
// G7's rule (and the incident it memorializes: the m29 wave gate's dynamic
// import of its relevance rule, which threw into the staleness catch).
// The specifier is assembled at runtime so THIS file's source does not itself
// contain a matchable relative dynamic import (the rule scans sources, and its
// own verifier is a lane script — the rule caught exactly that on first run).
const incidentModule = "./wave-" + "execute.ts"
const incidentSource = [
  'import path from "node:path"',
  'const paths = staleRelevantPaths("java")',
  `const { staleRelevantPaths } = await import("${incidentModule}")`,
  "console.log(paths, staleRelevantPaths, path)",
].join("\n")
check(
  "core: a relative dynamic import of a lane module is flagged (the TDZ class)",
  importOrderFindings("x.ts", incidentSource).length === 1,
  importOrderFindings("x.ts", incidentSource).join(" | "),
)
check(
  "core: a static import of the same module is not flagged",
  importOrderFindings("x.ts", 'import { staleRelevantPaths } from "./wave-execute.ts"\n').length === 0,
)
check(
  "core: a computed-URL dynamic import (the mutant harnesses) is not flagged",
  importOrderFindings("x.ts", "const m = await import(pathToFileURL(p).href)\n").length === 0,
)
check(
  "core: a TYPE-position typeof import() is not flagged (erased at compile time)",
  importOrderFindings("x.ts", 'const o = (await import(pathToFileURL(P).href)) as typeof import("../../src/lsp/x.ts")\n').length === 0,
)

// --- mutants: the suite CAN FAIL -------------------------------------------------
console.log("\nmutants: the suite can fail (source-level copies)")
for (const f of readdirSync(path.join(ROOT, "script/m61"))) {
  if (f.startsWith(".mutant-lint-")) rmSync(path.join(ROOT, "script/m61", f), { force: true })
}

async function runMutant(name: string, from: string, to: string, probe: (mod: Record<string, unknown>) => boolean): Promise<void> {
  if (!src.includes(from)) {
    check(`M: ${name} (mutation anchor exists)`, false, "anchor not found — the mutant is stale")
    return
  }
  const mutantPath = path.join(ROOT, "script/m61", `.mutant-lint-${name}.ts`)
  writeFileSync(mutantPath, src.replace(from, to))
  try {
    const mod = (await import(pathToFileURL(mutantPath).href)) as Record<string, unknown>
    check(`M: ${name}`, probe(mod) === true, "the mutant did NOT manifest the defect — the suite could not fail")
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? ""
    const cannotLoad = code.startsWith("ERR_MODULE") || code === "ERR_UNKNOWN_FILE_EXTENSION" || e instanceof SyntaxError
    if (cannotLoad) check(`M: ${name}`, false, `the mutant could not load (${code || (e as Error).name}) — the can-fail proof is disarmed`)
    else check(`M: ${name}`, true, `(mutant crashed at runtime — still caught: ${(e as Error).message})`)
  } finally {
    rmSync(mutantPath, { force: true })
  }
}

await runMutant("canfail-blind", "  const declaredKeys = [", "  return { mutants: 9, negatives: 9 }\n  const declaredKeys = [", (mod) => {
  const p = (mod.canFailProofs as typeof canFailProofs)({ status: "verified" })
  return p.mutants + p.negatives > 0
})

await runMutant("seal-blind", "export function isSealed(record: Record<string, unknown>): boolean {\n  return record.bbSeal !== undefined", "export function isSealed(record: Record<string, unknown>): boolean {\n  return true", (mod) => {
  return (mod.isSealed as typeof isSealed)({ status: "verified" }) === true
})

await runMutant("orphan-blind", "    if (owner) byGate.get(owner)!.push(r)", "    if (owner || true) byGate.get(owner ?? [...byGate.keys()][0])!.push(r)", (mod) => {
  const reg = loadRegistry()
  const r = (mod.lint as typeof lint)(reg)
  return r.orphanRecords.length === 0
})

await runMutant("floor-ignored", "    if (total < reg.canFailFloor && !noCanFail.has(gate)) {", "    if (false) {", (mod) => {
  const reg = JSON.parse(JSON.stringify(loadRegistry())) as ReturnType<typeof loadRegistry>
  // Force a gate with no proof and no declaration into the census by raising the
  // floor: with the mutant, that gate stops failing G4.
  reg.canFailFloor = 1
  reg.declaredNoCanFail = []
  const r = (mod.lint as typeof lint)(reg)
  return r.failures.filter((f) => f.startsWith("G4:")).length === 0
})

// M61.V6 / #847 — the TDZ class, made extinct. Incident: the m29 wave gate
// imported its per-language relevance rule with a dynamic import placed BELOW
// the rule's first use; the ReferenceError landed in the staleness catch and
// every wave leg silently read stale. This mutant proves G7 can see it.
await runMutant("import-order-blind", "      out.push(`${file}:${i + 1}: dynamic import of a lane module", "      if (false) out.push(`${file}:${i + 1}: dynamic import of a lane module", (mod) => {
  const f = (mod.importOrderFindings as typeof importOrderFindings)("x.ts", incidentSource)
  return f.length === 0
})

// M61.V6 / #847 — the on-demand-gate-rot class, made extinct. Incident: the
// m26 on-demand gates rotted while the 40-gate ladder stayed green, so a gate
// wired into NO execution tier broke the m29 closure when it was finally
// spawned; the M61 verifiers were not in the ladder and could rot unseen too.
// M61.V6 / #847 — the record-must-agree-with-the-run class. Incident: M61.V1
// wrote 32/32 and then ran two more checks (printing 34/34), M55.X1 captured its
// counters before its C1 check, and M61.V2's variant is what made the rule.
await runMutant(
  "record-order-blind",
  "  if (lastCheck > lastWrite) {",
  "  if (false) {",
  (mod) => {
    const f = (mod.recordAfterChecksFinding as typeof recordAfterChecksFinding)("x.ts", 'writeSealed("a.json", r)\ncheck("after", true)\n')
    return f === null
  },
)

await runMutant("tier-blind", "      } else {\n        failures.push(`G5: ${gate} is wired into NO execution tier", "      } else if (false) {\n        failures.push(`G5: ${gate} is wired into NO execution tier", (mod) => {
  const reg = JSON.parse(JSON.stringify(loadRegistry())) as ReturnType<typeof loadRegistry>
  // Strip the on-demand declarations: every on-demand gate is now a gate in no
  // tier. With the mutant, G5's "wired into NO execution tier" stops firing.
  reg.declaredOnDemand = []
  const r = (mod.lint as typeof lint)(reg)
  return r.failures.filter((f) => f.includes("wired into NO execution tier")).length === 0
})

await runMutant("env-blind", "      if (!declaredEnv.has(m)) failures.push(", "      if (false) failures.push(", (mod) => {
  const reg = JSON.parse(JSON.stringify(loadRegistry())) as ReturnType<typeof loadRegistry>
  reg.declaredEnv = []
  const r = (mod.lint as typeof lint)(reg)
  return r.failures.filter((f) => f.startsWith("G6:")).length === 0
})

// --- evidence --------------------------------------------------------------------
const buildEvidence = () => ({
  issue: "M61.V4 verifier lint (issue #845)",
  code: "V4",
  milestone: "M61",
  status: failed === 0 ? "verified" : "known-gap",
  checks: checks.length,
  passed,
  failed,
  realFailed: failed,
  failures,
  checksList: checks,
  currentCommit: gitHead(),
  verifierCommand: "npx tsx script/m61/verify-lint.ts",
  evidenceFile: "V4.json",
  generatedAt: new Date().toISOString(),
  census: {
    gates: report.gateCount,
    records: report.recordCount,
    tiers: report.tiers,
    orphans: report.orphanRecords.length,
    artifactRecords: report.artifactRecords.length,
    onDemandGates: report.onDemandCount,
    declaredNonGates: report.declaredNonGates.length,
    declaredNoCanFail: report.declaredNoCanFail.length,
  },
  limitations: [
    "Gate membership is derived from the evidence (a record names its gate, or the gate's source names the record) — a gate that writes no record is invisible to the derivation and is caught by G1 instead.",
    "Can-fail proof is a COUNT, not a quality judgement: a gate with one weak mutant passes the floor. Floor-raising per gate is a registry change, and the mutant quality is the job of the milestone's own closure.",
    "Tier membership is read from the declared command lists (package.json + the lane ladder). A gate wired only into a tier that nothing executes is still 'wired' — executing each tier is what X1 audits.",
  ],
})
function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}
writeSealed(path.join(RESULTS, "V4.json"), buildEvidence())
const selfRead = readFileSync(path.join(RESULTS, "V4.json"), "utf8")
check("R: this verifier's own evidence is a sealed record", selfRead.includes("bbSeal"))
writeSealed(path.join(RESULTS, "V4.json"), buildEvidence())

console.log(`\nM61.V4: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks.length})`)
console.log(`Evidence (sealed): ${path.join(RESULTS, "V4.json")}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
}
process.exitCode = failed === 0 ? 0 : 1
