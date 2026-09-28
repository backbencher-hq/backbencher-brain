// script/m61/verify-extinction.ts — M61.V6 verifier + mutation suite (issue
// #847). Drafted off-repo; moved in after the lane ladder at 3b724644.
//
// D-6: every verifier-bug class this program hit was fixed locally and the
// CLASS was never made extinct. This gate is the extinction record: for each
// declared class it proves the class is dead, not merely quiet.
//
//   E0 manifest:   the class list is structurally valid, lane-scoped, and
//                  carries every required id (a removed class is a finding).
//   E1 presence:   each class's mutant literal is present in the gate that
//                  memorializes it, and a comment within 8 lines names the
//                  incident — an untraceable mutant is folklore.
//   E2 wiring:     the gate that RUNS the mutant is in an automated tier, and
//                  that gate's sealed record declares can-fail proof and is
//                  green — a mutant nobody runs is not extinction.
//   E3 rules:      the pure core DOES flag a missing mutant, an untraced
//                  mutant, an unwired mutant gate, and a proof-less record
//                  (the mutants below exist to make those checks able to fail).
//
// Mutants (source-level copies of the core's decision lines, script/m61):
//   M1 presence-blind / M2 trace-blind / M3 wiring-blind / M4 record-blind.
//
// Run: npx tsx script/m61/verify-extinction.ts
// Evidence: validation/m61/results/V6.json (sealed)

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { writeSealed } from "../lib/evidence.ts"
import { ROOT, canFailProofs, commandGate, loadRegistry, readTiers } from "./gate_lint.ts"
import { NEAR_LINES, REQUIRED_IDS, auditClass, validateClass, type ClassFacts, type ClassSpec } from "./extinction_core.ts"

const RESULTS = path.join(ROOT, "validation/m61/results")
const MANIFEST = path.join(ROOT, "script/m61/extinction-classes.json")
const CORE = path.join(ROOT, "script/m61/extinction_core.ts")

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

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

// --- E0: the manifest itself -----------------------------------------------------
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
  schemaVersion?: number
  milestone?: string
  issue?: number
  classes?: Partial<ClassSpec>[]
}
check("E0: manifest declares schemaVersion 1", manifest.schemaVersion === 1)
check("E0: manifest is the M61 annex (issue #847)", manifest.milestone === "M61" && manifest.issue === 847)

const classes = Array.isArray(manifest.classes) ? (manifest.classes as ClassSpec[]) : []
const seenIds = new Set<string>()
const structural: string[] = []
for (const c of classes) structural.push(...validateClass(c, seenIds))
check("E0: every class entry is structurally valid and lane-scoped", structural.length === 0, structural.join(" | "))

const missingIds = REQUIRED_IDS.filter((id) => !seenIds.has(id))
check("E0: every required class id is declared", missingIds.length === 0, `missing: ${missingIds.join(", ")}`)

// --- fact gathering (the impure half) --------------------------------------------
/** Where a mutant label sits in a gate source, and whether its incident is named nearby. */
function memorialization(file: string, label: string, tag: string): { present: boolean; near: boolean } {
  if (!existsSync(file)) return { present: false, near: false }
  const lines = readFileSync(file, "utf8").split("\n")
  // A label usually appears twice: once in the file's header summary and once
  // at the mutant itself. EVERY occurrence is examined — a header summary with
  // no incident name must not mask the memorial that sits at the mutant.
  let present = false
  for (let at = 0; at < lines.length; at++) {
    if (!lines[at]!.includes(label)) continue
    present = true
    const from = Math.max(0, at - NEAR_LINES)
    const to = Math.min(lines.length - 1, at + NEAR_LINES)
    for (let i = from; i <= to; i++) {
      const l = lines[i]!
      const isComment = /^\s*(\/\/|--|\*|\/\*)/.test(l)
      if (isComment && l.toLowerCase().includes(tag.toLowerCase())) return { present: true, near: true }
    }
  }
  return { present, near: false }
}

const registry = loadRegistry()
const tieredGates = new Set(
  readTiers(registry)
    .flatMap((t) => t.commands.map(commandGate))
    .filter((g): g is string => !!g),
)

/** The record a gate owns — the one whose verifierCommand names it. */
function recordForGate(gate: string): Record<string, unknown> | null {
  for (const lane of registry.lanes) {
    const dir = path.join(ROOT, "validation", lane, "results")
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue
      let data: Record<string, unknown>
      try {
        data = JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Record<string, unknown>
      } catch {
        continue
      }
      const cmd = typeof data.verifierCommand === "string" ? data.verifierCommand : ""
      if (cmd.includes(gate)) return data
    }
  }
  return null
}

const demo: ClassSpec = {
  id: "demo",
  title: "demo",
  incident: "a demo class used to prove the core can fail",
  incidentTag: "demo",
  owner: "script/m61/extinction_core.ts",
  rule: "n/a",
  mutant: "script/m61/extinction_core.ts",
  mutantLabel: "demo",
  memorial: "script/m61/extinction_core.ts",
  publicProbe: "n/a",
}

// --- E1/E2: is each class extinct? ----------------------------------------------
console.log("the pack: every declared class, decided from live facts")
for (const c of classes) {
  const files = [c.owner, c.mutant, c.memorial]
  const filesExist = files.every((p) => existsSync(path.join(ROOT, p)))
  // The mutant lives in the gate that RUNS it; that is where its incident
  // comment must sit. `memorial` names the rule's own home (which may be a
  // different file — the lint carries the rule, the verifier carries the proof).
  const mem = memorialization(path.join(ROOT, c.mutant), c.mutantLabel, c.incidentTag)
  const rec = recordForGate(c.mutant)
  const proof = rec ? canFailProofs(rec) : { mutants: 0, negatives: 0 }
  const facts: ClassFacts = {
    filesExist,
    labelPresent: mem.present,
    incidentNearLabel: mem.near,
    mutantGateTiered: tieredGates.has(c.mutant),
    recordSealed: !!rec && rec.bbSeal !== undefined,
    recordProofs: proof.mutants + proof.negatives,
    recordFailed: !!rec && (Number(rec.failed ?? 0) > 0 || Number(rec.realFailed ?? 0) > 0),
  }
  const findings = auditClass(c, facts)
  check(`E1: ${c.id} is extinct (mutant present, traced, wired, proven)`, findings.length === 0, findings.join(" | "))
}

// --- E3: the core can fail (the rule itself is exercised, not just applied) -----
const base: ClassFacts = {
  filesExist: true,
  labelPresent: true,
  incidentNearLabel: true,
  mutantGateTiered: true,
  recordSealed: true,
  recordProofs: 4,
  recordFailed: false,
}
check("E3: an extinct class produces no findings", auditClass(demo, base).length === 0)
check("E3: the core flags a MISSING mutant", auditClass(demo, { ...base, labelPresent: false }).length === 1)
check("E3: the core flags an UNTRACED mutant", auditClass(demo, { ...base, incidentNearLabel: false }).length === 1)
check("E3: the core flags an UNWIRED mutant gate", auditClass(demo, { ...base, mutantGateTiered: false }).length === 1)
check("E3: the core flags a proof-less record", auditClass(demo, { ...base, recordProofs: 0 }).length === 1)
check("E3: the core flags an UNSIGNED (unsealed) record", auditClass(demo, { ...base, recordSealed: false }).length === 1)
check("E3: the core flags a RED mutant gate", auditClass(demo, { ...base, recordFailed: true }).length === 1)

// --- mutants: the suite CAN FAIL -------------------------------------------------
console.log("\nmutants: the suite can fail (source-level copies of the core)")
const coreSource = readFileSync(CORE, "utf8")
for (const f of readdirSync(path.join(ROOT, "script/m61"))) {
  if (f.startsWith(".mutant-extinction-")) rmSync(path.join(ROOT, "script/m61", f), { force: true })
}

async function runMutant(name: string, from: string, to: string, probe: (mod: Record<string, unknown>) => boolean): Promise<void> {
  if (!coreSource.includes(from)) {
    check(`M: ${name} (mutation anchor exists)`, false, "anchor not found — the mutant is stale")
    return
  }
  const mutantPath = path.join(ROOT, "script/m61", `.mutant-extinction-${name}.ts`)
  writeFileSync(mutantPath, coreSource.replace(from, to))
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

const coreAudit = (mod: Record<string, unknown>, facts: ClassFacts): string[] =>
  (mod.auditClass as typeof auditClass)(demo, facts)

await runMutant("presence-blind", "  if (!facts.labelPresent) out.push(", "  if (false && !facts.labelPresent) out.push(", (mod) => {
  return coreAudit(mod, { ...base, labelPresent: false }).length === 0
})

await runMutant("trace-blind", "  if (!facts.incidentNearLabel) out.push(", "  if (false && !facts.incidentNearLabel) out.push(", (mod) => {
  return coreAudit(mod, { ...base, incidentNearLabel: false }).length === 0
})

await runMutant("wiring-blind", "  if (!facts.mutantGateTiered) out.push(", "  if (false && !facts.mutantGateTiered) out.push(", (mod) => {
  return coreAudit(mod, { ...base, mutantGateTiered: false }).length === 0
})

await runMutant("record-blind", "  if (facts.recordProofs < 1) out.push(", "  if (false) out.push(", (mod) => {
  return coreAudit(mod, { ...base, recordProofs: 0 }).length === 0
})

// --- evidence --------------------------------------------------------------------
const byId = classes.map((c) => c.id)
const buildEvidence = () => ({
  issue: "M61.V6 bug-class extinction pack (issue #847)",
  code: "V6",
  milestone: "M61",
  status: failed === 0 ? "verified" : "known-gap",
  checks: checks.length,
  passed,
  failed,
  realFailed: failed,
  failures,
  checksList: checks,
  currentCommit: gitHead(),
  verifierCommand: "npx tsx script/m61/verify-extinction.ts",
  evidenceFile: "V6.json",
  generatedAt: new Date().toISOString(),
  classes: byId,
  requiredClasses: REQUIRED_IDS,
  limitations: [
    "Presence is a source fact: this gate proves the mutant exists, is traced, is wired, and that its owner's sealed record shows it ran. It does not re-execute every owner (two of them are heavy measurement gates) — re-execution is the lane ladder's and X1's job.",
    "The pack is a census of DECLARED classes. A verifier bug class nobody declared is invisible here; the declaration is reviewed at the milestone gate (G1).",
    "Tier membership is read from the declared command lists, not from a run — a tier that nothing executes is caught by G1's closure audit, not here.",
  ],
})
writeSealed(path.join(RESULTS, "V6.json"), buildEvidence())
const selfRead = readFileSync(path.join(RESULTS, "V6.json"), "utf8")
check("R: this verifier's own evidence is a sealed record", selfRead.includes("bbSeal"))
writeSealed(path.join(RESULTS, "V6.json"), buildEvidence())

console.log(`\nM61.V6: ${failed === 0 ? "VERIFIED" : "KNOWN-GAP"} (${passed}/${checks.length})`)
console.log(`Evidence (sealed): ${path.join(RESULTS, "V6.json")}`)
if (failures.length > 0) {
  console.log("Failures:")
  for (const f of failures) console.log(`  - ${f}`)
}
process.exitCode = failed === 0 ? 0 : 1
