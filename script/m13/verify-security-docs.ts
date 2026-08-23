// script/m13/verify-security-docs.ts — M13.43 (Sec4).
//
// Docs + evidence + release gate for bb_security.
//
// 1. DOCS ACCURACY: docs/tools/bb_security.md must be byte-identical to
//    fresh render from executable registry.
// 2. EVIDENCE COMMITTED: sec1..sec3.json must all exist, validate, verified.
// 3. RELEASE GATE: tamper test proves gate blocks non-passing doc.
// 4. HONESTY: regex heuristics documented; no claimed modes not executable.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.43",
  code: "Sec4",
  tool: "bb_security",
  title: "bb_security: honesty + docs + release gate",
  layers: ["unit", "e2e"],
  decisions: {
    docsAuthority: "src/mcp/tool-registry.ts + script/verify-tool-docs.ts",
    releaseGate: "verify-quality-gate.ts (Sec1-Sec3) + verify-evidence.ts B3",
    evidenceInputs: "validation/m13/results/sec1..sec3.json all verified",
    regexHonesty: "regex-based taint detection documented as heuristic in docs/BB_SECURITY.md",
  },
  limitations: ["Docs freshness proven by generator verify mode.", "Gate covers bb_security only."],
})

const root = path.resolve(import.meta.dir, "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

// ── 1. Docs accuracy ───────────────────────────────────────────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_security")
const docPath = path.join(root, "docs", "tools", "bb_security.md")
let doc = ""
try { doc = readFileSync(docPath, "utf8") } catch {}

harness.check("docs: bb_security.md exists", doc.length > 0, "missing")

if (registry && doc) {
  const docLines = doc.split("\n")
  const descLine = docLines.length > 2 ? docLines[2] : ""
  harness.check("docs: description matches registry", descLine === registry.description, `"${descLine.slice(0, 80)}"`)
  harness.check("docs: modes = findings only", doc.includes("- Modes: `findings`"))
  harness.check("docs: planned modes labeled", doc.includes("Planned modes (roadmap, not executable): `flow`, `summary`, `hotspots`"))
  harness.check("docs: defaults match registry", doc.includes(`- Defaults: \`${JSON.stringify(registry.documentation.defaults)}\``))
  harness.check("docs: category matches registry", doc.includes(`- Category: \`${registry.documentation.category}\``))
  harness.check("docs: mutability = read", doc.includes("- Mutability: `read`"))
  const props = Object.keys((registry.inputSchema as any).properties ?? {})
  const missing = props.filter((p) => !doc.includes(`"${p}"`))
  harness.check("docs: every input property documented", missing.length === 0, missing.length ? `missing: ${missing.join(",")}` : `${props.length} props`)
}

const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("docs: generator verify mode passes", gen.status === 0, gen.status === 0 ? "" : (gen.stderr || gen.stdout || "").slice(0, 200))

// ── 2. Honesty: regex documented, no mode drift ────────────────────────────
const secDoc = readFileSync(path.join(root, "docs", "BB_SECURITY.md"), "utf8")
harness.check("honesty: docs/BB_SECURITY.md says 'indexer heuristics'", secDoc.includes("indexer heuristics"))
harness.check("honesty: docs say flows are heuristics, not AST", secDoc.includes("Flows are **indexer heuristics**"))

const taintSrc = readFileSync(path.join(root, "src", "ast", "taint-analyzer.ts"), "utf8")
const regexCount = (taintSrc.match(/\.test\(/g) || []).length
harness.check("honesty: taint-analyzer.ts uses .test() for regex heuristics (documented)", regexCount > 0, `${regexCount} .test() calls`)

const contractsSrc = readFileSync(path.join(root, "src", "contracts", "tool-contracts.ts"), "utf8")
harness.check("honesty: contracts file documents planned modes correctly", contractsSrc.includes("bb_security flow/summary/hotspots"), "missing contract note")
harness.negative("honesty: no stale executable claim for flow/summary/hotspots", !contractsSrc.includes('"flow"') && !contractsSrc.includes('"summary"') && !contractsSrc.includes('"hotspots"'), "stale claim found")

// ── 3. Evidence committed ─────────────────────────────────────────────────
const SEC_FILES = ["sec1", "sec2", "sec3"]
const evDocs: any[] = []
for (const code of SEC_FILES) {
  let d: any = null
  try { d = JSON.parse(readFileSync(path.join(RESULTS, `${code}.json`), "utf8")) } catch {}
  const exists = !!d
  const valid = exists && validateEvidence(d).length === 0
  const verified = valid && d.verifiedState === "verified"
  harness.check(`evidence: ${code}.json exists, validates, verified`, exists && valid && verified, !exists ? "missing" : !valid ? validateEvidence(d).join("; ").slice(0, 120) : d.verifiedState)
  if (d) evDocs.push(d)
}
harness.check("evidence: all 3 Sec issues verified with negatives", evDocs.length === 3 && evDocs.every((d) => d.negativeCases >= 1), evDocs.map((d) => `${d.code}:${d.negativeCases}neg`).join(" "))

// ── 4. Release gate ────────────────────────────────────────────────────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
const S_VERIFIERS = ["verify-security-contract", "verify-security-handler", "verify-security-adversarial"]
for (const v of S_VERIFIERS) {
  harness.check(`gate: ${v}.ts wired`, gateSrc.includes(`m13/${v}.ts`) && verifyScript.includes(`script/m13/${v}.ts`))
}
harness.check("gate: evidence validator (B3) is in gate", gateSrc.includes("m13/verify-evidence.ts"))

if (evDocs.length > 0) {
  const tampered = JSON.parse(JSON.stringify(evDocs[0]))
  tampered.verifiedState = "verified"
  tampered.negativeCases = 0
  tampered.summary.failed = 5
  const tamperErrors = validateEvidence(tampered)
  harness.negative("gate: tampered doc (failed>0, no negatives) cannot claim verified", tamperErrors.length > 0, tamperErrors.join("; ").slice(0, 160))
}

harness.emit()