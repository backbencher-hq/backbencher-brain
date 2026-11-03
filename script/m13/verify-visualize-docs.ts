// script/m13/verify-visualize-docs.ts — M13.47 (V4).
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.47", code: "V4", tool: "bb_visualize",
  title: "bb_visualize: honesty + docs + release gate",
  layers: ["unit"],
  decisions: {
    docsAuthority: "src/mcp/tool-registry.ts + script/verify-tool-docs.ts",
    releaseGate: "V1-V7 verifiers wired + B3 evidence validator",
  },
  limitations: ["Covers bb_visualize only."],
})

const root = path.resolve((import.meta as any).dirname ?? (import.meta as any).dir ?? ".", "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_visualize")
const doc = readFileSync(path.join(root, "docs", "tools", "bb_visualize.md"), "utf8")

if (registry) {
  // The generated page carries the §8 author header, so the description is the first
  // non-empty line AFTER the `# \`bb_visualize\`` heading, not a fixed line index.
  const docLines = doc.split("\n")
  const heading = docLines.findIndex((line) => line.trim() === "# `bb_visualize`")
  const descriptionLine = heading >= 0 ? (docLines.slice(heading + 1).find((line) => line.trim().length > 0) ?? "") : ""
  harness.check("docs: description matches", descriptionLine === registry.description, descriptionLine.slice(0, 80))
  harness.check("docs: modes = scopes only", doc.includes("- Modes: `project`, `file`, `module`, `symbol`, `feature`"))
  harness.check("docs: format separate from modes", doc.includes('"format"'))
  harness.check("docs: defaults match", doc.includes(JSON.stringify(registry.documentation.defaults)))
  harness.check("docs: category = analysis", doc.includes("- Category: `analysis`"))
  harness.check("docs: mutability = read", doc.includes("- Mutability: `read`"))
  harness.check("docs: requiresIndex = true", doc.includes("- Requires index: `true`"))
}

const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts", "--only", "bb_visualize"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("docs: generator verify passes", gen.status === 0, gen.status === 0 ? "" : (gen.stderr || gen.stdout || "").slice(0, 200))

// Evidence
for (const code of ["v1", "v2", "v3", "v5", "v6", "v7", "v8", "v9"]) {
  let d: any = null
  try { d = JSON.parse(readFileSync(path.join(RESULTS, code + ".json"), "utf8")) } catch {}
  const exists = !!d
  const valid = exists && validateEvidence(d).length === 0
  const verified = valid && d.verifiedState === "verified"
  harness.check("evidence: " + code + ".json verified", exists && valid && verified, !exists ? "missing" : !valid ? "invalid" : d.verifiedState)
}

// Gate
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
for (const v of ["verify-visualize-contract", "verify-visualize-fidelity", "verify-visualize-e2e-corpus", "verify-visualize-options", "verify-visualize-target-literals", "verify-visualize-views", "verify-visualize-owner-fold", "verify-visualize-honesty"]) {
  harness.check("gate: " + v + " wired", gateSrc.includes("m13/" + v + ".ts") && verifyScript.includes("script/m13/" + v + ".ts"))
}

// Tamper test
const evPath = path.join(RESULTS, "v1.json")
let d: any = null
try { d = JSON.parse(readFileSync(evPath, "utf8")) } catch {}
if (d) {
  const t = JSON.parse(JSON.stringify(d))
  t.verifiedState = "verified"
  t.negativeCases = 0
  t.summary.failed = 3
  harness.negative("gate: tampered doc rejected", validateEvidence(t).length > 0, "tampered but accepted")
}

harness.emit()
