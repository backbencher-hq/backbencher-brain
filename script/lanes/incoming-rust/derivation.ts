/**
 * INCOMING_RUST — DERIVATION check for this lane, using the MASTER'S OWN
 * instrument (read-only).
 *
 * ## WHY THIS FILE EXISTS
 *
 * The workstream's standing debt list names 100 DERIVATION findings: a type an
 * analyzer *emits* that the differential never *audits*, i.e. stored and compared
 * against nothing. Two of the recorded findings are rust's
 * (`validation/m60/rel-type-coverage-baseline.json`:
 * `DERIVATION|rust|emits 'contains' …` and `DERIVATION|rust|emits 'exports' …`).
 * The gate that computes them (`script/m60/rel-type-coverage-gate.ts`) also
 * WRITES `validation/m60/results/rel-type-coverage.json` when it runs from the
 * CLI, and that file is the master's. So this script imports the gate's exported
 * `runGate()` and prints the rust lane's rows — the same computation, the same
 * inputs, nothing written.
 *
 * The audited set is read by EVALUATING `differential.ts`'s own filter
 * expression, so this row cannot drift from the harness the way a copied constant
 * would.
 *
 * Usage: bun script/lanes/incoming-rust/derivation.ts
 */
import * as path from "node:path"

const REPO_ROOT = path.resolve(path.join(import.meta.dir, "..", "..", ".."))
const gate: any = await import(path.join(REPO_ROOT, "script", "m60", "rel-type-coverage-gate.ts"))

const run = gate.runGate(["rust"])
const lane = run.lanes.find((l: any) => l.lang === "rust")
const pad = (s: string | number, n: number): string => (String(s) + " ".repeat(n)).slice(0, n)

console.log(`rel-type-coverage gate — rust lane, evaluated live from differential.ts's own filter`)
console.log(`graph traversal default: ${run.graphDefault.join(" ")}`)
if (run.inputErrors.length) {
  console.log(`\nINPUT ERRORS (the gate could not read something, which is NOT a lane verdict):`)
  for (const e of run.inputErrors) console.log(`  ${e.lang}: ${e.reason}`)
}
if (!lane) {
  console.log(`\nNO RUST LANE ROW — the gate could not read rust's emitted set.`)
  process.exit(2)
}
console.log(`\nemitted by src/ast/real-rust-analyzer.ts: ${lane.emitted.join(" ")}`)
console.log(`audited by the differential:            ${lane.audited.join(" ")}`)

const emittedSet = new Set(lane.emitted)
const auditedSet = new Set(lane.audited)
console.log(`\n${pad("type", 14)}${pad("emitted", 10)}${pad("audited", 10)}verdict`)
console.log("-".repeat(64))
for (const t of [...new Set([...lane.emitted, ...lane.audited])].sort()) {
  const em = emittedSet.has(t)
  const au = auditedSet.has(t)
  const verdict = em && au ? "audited" : em && !au ? "DERIVATION GAP — emitted, compared against nothing" : "audited, not emitted"
  console.log(`${pad(t, 14)}${pad(em ? "yes" : "-", 10)}${pad(au ? "yes" : "-", 10)}${verdict}`)
}

const findings = run.findings.filter((f: any) => f.lang === "rust")
console.log(`\nfindings the gate records for rust: ${findings.length}`)
for (const f of findings) console.log(`  [${f.check}] ${f.detail}`)