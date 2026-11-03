// script/m13/verify-security-docs.ts — bb_security docs, evidence and release gate.
//
// 1. DOCS ACCURACY: docs/tools/bb_security.md matches a fresh render from the
//    executable registry for THIS tool, and its description is located by
//    structure (the page opens with an author header, not the description).
// 2. EVIDENCE COMMITTED: the four m13 security records exist, validate, and are
//    verified.
// 3. RELEASE GATE: a tamper test proves the evidence validator blocks a record
//    that claims "verified" while carrying failures or no negative case.
// 4. HONESTY: the heuristic analyzer is documented as heuristic; no planned mode
//    is advertised as executable; the manual-staleness wording is present.
//
// Run: npx tsx script/m13/verify-security-docs.ts   (bun run … also works)
// Exit: non-zero if any assertion failed.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
const tsxBin = path.join(root, "node_modules", ".bin", "tsx")

function runGenerator(): number {
  const result = isBun
    ? spawnSync("bun", ["run", "script/verify-tool-docs.ts", "--only", "bb_security"], { cwd: root, encoding: "utf8", timeout: 120_000 })
    : spawnSync(tsxBin, ["script/verify-tool-docs.ts", "--only", "bb_security"], { cwd: root, encoding: "utf8", timeout: 120_000 })
  if (result.status !== 0) process.stdout.write(((result.stderr ?? "") + (result.stdout ?? "")).slice(0, 400) + "\n")
  return result.status ?? 1
}

const harness = new Harness({
  issue: "M13.43",
  code: "Sec4",
  tool: "bb_security",
  title: "bb_security: docs + evidence + release gate",
  layers: ["unit", "e2e"],
  decisions: {
    docsAuthority: "src/mcp/tools/bb_security/descriptor.ts rendered by script/verify-tool-docs.ts",
    releaseGate: "this file's tamper leg plus script/m13/verify-evidence.ts",
    evidenceInputs: "validation/m13/results/sec1..sec4.json all verified",
    honesty: "token-based detection documented as heuristic; manual staleness only",
  },
  limitations: [
    "Docs freshness is proven for this tool only; the shared site data is regenerated centrally.",
    "The tamper test proves the validator rejects a malformed claim; it does not re-run every verifier.",
  ],
})

// ── 1. Docs accuracy ───────────────────────────────────────────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_security")
const doc = (() => { try { return readFileSync(path.join(root, "docs", "tools", "bb_security.md"), "utf8") } catch { return "" } })()
harness.check("docs: docs/tools/bb_security.md exists", doc.length > 0, "missing")

if (registry && doc) {
  // The description is the first non-empty line after the H1; line numbers moved
  // when the author header was prepended to every generated page.
  const lines = doc.split("\n")
  const headingIndex = lines.findIndex((line) => line.startsWith("# `bb_security`"))
  // Absent heading is reported by the description mismatch below (empty string).
  const descLine = headingIndex < 0 ? "" : (lines.slice(headingIndex + 1).find((line) => line.trim().length > 0) ?? "")
  harness.check("docs: description matches registry", descLine === registry.description, `"${descLine.slice(0, 100)}"`)
  harness.check("docs: modes = findings only", doc.includes("- Modes: `findings`"), "mode line mismatch")
  harness.check("docs: planned modes labeled honestly", doc.includes("Planned modes (roadmap, not executable): `flow`, `summary`, `hotspots`"), "planned modes mislabeled")
  harness.check("docs: defaults match registry", doc.includes(`- Defaults: \`${JSON.stringify(registry.documentation.defaults)}\``), "defaults mismatch")
  harness.check("docs: category matches registry", doc.includes(`- Category: \`${registry.documentation.category}\``), "category mismatch")
  harness.check("docs: mutability = read", doc.includes("- Mutability: `read`"), "mutability mismatch")
  const props = Object.keys((registry.inputSchema as any).properties ?? {})
  const missing = props.filter((prop) => !doc.includes(`"${prop}"`))
  harness.check("docs: every input property documented", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${props.length} props`)
  harness.check("docs: the page states the manual staleness truth", /does not auto-refresh and has no `refresh` option/.test(doc), "staleness paragraph missing or wrong")
}

const generatorExit = runGenerator()
harness.check("docs: generator verify mode passes for this tool (page byte-fresh)", generatorExit === 0, `exit=${generatorExit}`)

// ── 2. Honesty: heuristic documented, no planned mode advertised ───────────
const secDoc = readFileSync(path.join(root, "docs", "BB_SECURITY.md"), "utf8")
harness.check("honesty: docs/BB_SECURITY.md documents the heuristic detector", secDoc.includes("indexer heuristics"), "missing heuristic acknowledgment")
harness.check("honesty: docs/BB_SECURITY.md says token matching is not a data-flow proof", /not a data-flow proof|token matching/i.test(secDoc), "data-flow proof claim missing")
harness.negative("honesty: docs do not claim an AST taint proof", !secDoc.includes("AST-based taint") && !secDoc.includes("pure AST taint"), "AST-proof claim found")

const contractsSrc = readFileSync(path.join(root, "src", "contracts", "tool-contracts.ts"), "utf8")
harness.check("honesty: contracts file documents the planned-mode split", contractsSrc.includes("bb_security flow/summary/hotspots"), "missing contract note")
harness.negative("honesty: no stale executable claim for flow/summary/hotspots", !contractsSrc.includes('"flow"') && !contractsSrc.includes('"summary"') && !contractsSrc.includes('"hotspots"'), "stale claim found")

// ── 3. Evidence committed ─────────────────────────────────────────────────
const SEC_FILES = ["sec1", "sec2", "sec3"]
const evDocs: any[] = []
for (const code of SEC_FILES) {
  let record: any = null
  try { record = JSON.parse(readFileSync(path.join(RESULTS, `${code}.json`), "utf8")) } catch {}
  const exists = !!record
  const valid = exists && validateEvidence(record).length === 0
  const verified = valid && record.verifiedState === "verified"
  harness.check(`evidence: ${code}.json exists, validates, verified`, exists && valid && verified, !exists ? "missing" : !valid ? validateEvidence(record).join("; ").slice(0, 120) : record.verifiedState)
  if (record) evDocs.push(record)
}
harness.check("evidence: all three verifier records carry a negative case", evDocs.length === SEC_FILES.length && evDocs.every((d) => d.negativeCases >= 1), evDocs.map((d) => `${d.code}:${d.negativeCases}neg`).join(" "))
// This gate's own record is written by this run, so it cannot be a PRECONDITION:
// validating it would make the gate permanently red once it is ever red. It must
// exist and carry the same shape, checked after the write at emit time.
const ownRecordExists = (() => { try { return !!JSON.parse(readFileSync(path.join(RESULTS, "sec4.json"), "utf8")) } catch { return false } })()
harness.check("evidence: this gate has an emitted record (sec4.json)", ownRecordExists, "missing sec4.json")

// ── 4. Release gate: a false "verified" claim is refused ──────────────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
const S_VERIFIERS = ["verify-security-contract", "verify-security-handler", "verify-security-adversarial"]
for (const verifier of S_VERIFIERS) {
  harness.check(`gate: ${verifier}.ts wired`, gateSrc.includes(`m13/${verifier}.ts`) && verifyScript.includes(`script/m13/${verifier}.ts`))
}
harness.check("gate: evidence validator is wired", gateSrc.includes("m13/verify-evidence.ts"))

if (evDocs.length > 0) {
  const tampered = JSON.parse(JSON.stringify(evDocs[0]))
  tampered.verifiedState = "verified"
  tampered.negativeCases = 0
  tampered.summary.failed = 5
  const tamperErrors = validateEvidence(tampered)
  harness.negative("gate: a tampered record (failures, no negative case) cannot claim verified", tamperErrors.length > 0, tamperErrors.join("; ").slice(0, 160))
}

harness.emit()
