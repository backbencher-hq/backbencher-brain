// script/m13/verify-evidence.ts — M13.02 (B2) + M13.03 (B3).
//
// B2: validates every committed M13 evidence document structurally and enforces
//     the shared schema (schemaVersion/milestone/issue/layers/checks/summary/…).
// B3: enforces the anti-false-confidence invariant — a document may claim
//     `verified` only when summary.failed === 0 AND negativeCases >= 1. A
//     positive-only suite can never be `verified`.
//
// Emits two evidence documents: validation/m13/results/b2.json and b3.json.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { Harness } from "./harness"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS_DIR = resolve(root, "validation", "m13", "results")

type Evidence = Record<string, any>

/** Structural validator. Returns a list of errors; empty means valid. */
export function validateEvidence(doc: Evidence): string[] {
  const errors: string[] = []
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["evidence must be a JSON object"]
  const required = [
    "schemaVersion", "milestone", "issue", "code", "tool", "title",
    "verifiedState", "layers", "checks", "negativeCases", "summary",
    "decisions", "limitations", "generatedAt",
  ]
  for (const k of required) if (doc[k] === undefined) errors.push(`missing required field: ${k}`)
  if (doc.schemaVersion !== 1) errors.push("schemaVersion must be 1")
  if (doc.milestone !== "M13") errors.push("milestone must be M13")
  if (typeof doc.issue !== "string" || !/^M13\.\d+$/.test(doc.issue)) errors.push("issue must match M13.NN")
  if (!doc.code || typeof doc.code !== "string" || !doc.tool || typeof doc.tool !== "string" || !doc.title || typeof doc.title !== "string") {
    errors.push("code/tool/title must be non-empty strings")
  }
  if (!["verified", "partial", "known-gap", "untested"].includes(doc.verifiedState)) errors.push("verifiedState must be a valid state")
  if (!Array.isArray(doc.layers) || doc.layers.length < 1 || !doc.layers.every((l: any) => ["unit", "integration", "e2e", "corpus"].includes(l))) {
    errors.push("layers must be a non-empty array of valid layers")
  }
  if (!Array.isArray(doc.checks) || doc.checks.length < 1) {
    errors.push("checks must be a non-empty array")
  } else {
    for (const c of doc.checks) {
      if (!c || typeof c !== "object" || typeof c.name !== "string" || c.name.length < 1) errors.push("every check must have a non-empty name")
      if (typeof c.pass !== "boolean") errors.push("every check must have a boolean pass")
    }
  }
  if (typeof doc.negativeCases !== "number" || doc.negativeCases < 0 || !Number.isInteger(doc.negativeCases)) {
    errors.push("negativeCases must be a non-negative integer")
  }
  if (!doc.summary || typeof doc.summary !== "object") {
    errors.push("summary required")
  } else {
    const total = doc.checks.length
    const passed = doc.checks.filter((c: any) => c.pass === true).length
    const failed = doc.checks.filter((c: any) => c.pass === false).length
    if (doc.summary.total !== total) errors.push(`summary.total ${doc.summary.total} != checks.length ${total}`)
    if (doc.summary.passed !== passed) errors.push(`summary.passed ${doc.summary.passed} != actual ${passed}`)
    if (doc.summary.failed !== failed) errors.push(`summary.failed ${doc.summary.failed} != actual ${failed}`)
  }
  if (!Array.isArray(doc.limitations) || !doc.limitations.every((l: any) => typeof l === "string")) errors.push("limitations must be a string array")
  if (typeof doc.generatedAt !== "string" || doc.generatedAt.length < 1) errors.push("generatedAt must be a non-empty string")
  const negMarked = (doc.checks ?? []).filter((c: any) => c.negative === true).length
  if (typeof doc.negativeCases === "number" && negMarked > doc.negativeCases) {
    errors.push(`negativeCases ${doc.negativeCases} is less than ${negMarked} checks marked negative`)
  }
  // B3 invariant.
  if (doc.verifiedState === "verified") {
    if (doc.summary?.failed !== 0) errors.push("verified claim has failed>0")
    if ((doc.negativeCases ?? 0) < 1) errors.push("verified claim has zero negative cases")
  }
  return errors
}

function loadRealEvidence(): Array<{ file: string; doc: Evidence }> {
  let names: string[] = []
  try {
    names = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json"))
  } catch {
    return []
  }
  return names.map((f) => ({ file: f, doc: JSON.parse(readFileSync(resolve(RESULTS_DIR, f), "utf8")) }))
}

// The B2/B3 main body runs only when this file is executed directly, so other
// verifiers can import validateEvidence() without triggering process.exit.
if (import.meta.main) {

// ── B2 harness: schema + validator ──────────────────────────────────────
const b2 = new Harness({
  issue: "M13.02",
  code: "B2",
  tool: "baseline",
  title: "Shared machine-readable evidence schema + harness",
  layers: ["unit"],
  decisions: {
    authority: "script/m13/harness.ts (Harness) + validation/m13/schemas/evidence.schema.json",
    enforcement: "script/m13/verify-evidence.ts validates every validation/m13/results/*.json",
    verifiedDefinition: "all checks pass AND >=1 negative case AND evidence is schema-valid",
  },
  limitations: [
    "Per-tool verifiers adopt the Harness in their own M13 issue (E7/S1/A3/…); the legacy M10-M12 verifiers are migrated as each tool is rebuilt.",
    "The JSON Schema file documents the shape; verify-evidence.ts is the executable enforcement (no external JSON Schema engine dependency).",
  ],
})

const real = loadRealEvidence()
if (real.length === 0) {
  b2.check("at least one committed evidence document exists", false, "expected b1.json (M13.01) to exist")
} else {
  for (const { file, doc } of real) {
    const errors = validateEvidence(doc)
    b2.check(`${file} is schema-valid`, errors.length === 0, errors.join("; "))
  }
}

// Negative: malformed / missing-field / bad-state / false-verified documents are rejected.
// validateEvidence RETURNS an error list (it does not throw), so assert on the
// returned list rather than expecting an exception.
function expectErrors(h: Harness, name: string, doc: any, fragment: string): void {
  const errors = validateEvidence(doc)
  h.negative(name, errors.some((e) => e.includes(fragment)), errors.length ? errors.join("; ") : "no errors returned")
}
expectErrors(b2, "non-object evidence rejected", null, "must be a JSON object")
expectErrors(b2, "missing required field rejected", { schemaVersion: 1 }, "missing required field")
expectErrors(b2, "bad issue format rejected", { ...b2.document(), issue: "M12.1" }, "issue must match M13")
expectErrors(b2, "bad verifiedState rejected", { ...b2.document(), verifiedState: "done" }, "verifiedState must be a valid state")
expectErrors(b2, "verified with failed>0 rejected", { ...b2.document(), checks: [{ name: "x", pass: false }], summary: { total: 1, passed: 0, failed: 1 } }, "verified claim has failed>0")

b2.write()

// ── B3 harness: adversarial enforcement ──────────────────────────────────
const b3 = new Harness({
  issue: "M13.03",
  code: "B3",
  tool: "baseline",
  title: "Shared adversarial test harness (unit/integration/e2e, negative fixtures)",
  layers: ["unit"],
  decisions: {
    invariant: "verifiedState=verified requires summary.failed===0 AND negativeCases>=1",
    positiveOnly: "a suite with zero negative cases is capped at partial, never verified",
  },
  limitations: [
    "The e2e layer (real MCP stdio + compiled CLI) is exercised by each tool's own e2e issue (E9/S2/…), not by the harness itself.",
  ],
})

// Invariant: a Harness with only positive checks must report partial, not verified.
{
  const positiveOnly = new Harness({ issue: "M13.99", code: "x", tool: "baseline", title: "t", layers: ["unit"] }, true)
  positiveOnly.check("only positive", true)
  b3.check("positive-only harness is capped at partial", positiveOnly.state() === "partial", positiveOnly.state())
}

// Invariant: a Harness with a negative case and all passing checks reports verified.
{
  const withNegative = new Harness({ issue: "M13.99", code: "x", tool: "baseline", title: "t", layers: ["unit"] }, true)
  withNegative.check("positive", true)
  withNegative.rejects("negative", () => { throw new Error("boom") }, "boom")
  b3.check("harness with a negative case reaches verified", withNegative.state() === "verified", withNegative.state())
}

// Invariant: a failing check reports known-gap.
{
  const failing = new Harness({ issue: "M13.99", code: "x", tool: "baseline", title: "t", layers: ["unit"] }, true)
  failing.check("broken", false)
  failing.rejects("neg", () => { throw new Error("x") }, "x")
  b3.check("failing harness reports known-gap", failing.state() === "known-gap", failing.state())
}

// Negative: a forged "verified" document with zero negatives is rejected by the validator.
expectErrors(b3, "verified with zero negatives rejected", { ...b3.document(), verifiedState: "verified", negativeCases: 0, summary: { total: 1, passed: 1, failed: 0 }, checks: [{ name: "x", pass: true }] }, "verified claim has zero negative cases")

b3.write()

const failures = b2.document().summary.failed + b3.document().summary.failed
console.log(`\nEVIDENCE GOVERNANCE: ${failures === 0 ? "PASS" : `${failures} FAILURES`}`)
process.exit(failures === 0 ? 0 : 1)
}
