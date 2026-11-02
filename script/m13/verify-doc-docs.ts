// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — bb_doc's documentation gate: the generated page agrees with
//   the registry (modes, defaults, description), the generator itself passes, and
//   the D1/D2/D3 evidence this suite emits is present and verified.
// WHICH TOOL IT SERVES — bb_doc.
// WHY IT IS SHAPED THIS WAY — it reads the registry descriptor and the generated
//   page as data and compares them, rather than restating either; it is a CONSUMER
//   of D1-D3, which is why a red D1/D3 keeps it red instead of letting it pass.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/d4.json.
// EDIT TOGETHER WHEN THIS CHANGES — script/m13/harness.ts, script/verify-tool-docs.ts,
//   docs/tools/bb_doc.md, validation/m13/results/{d1,d2,d3}.json.
// CONTRACTS IT MUST NOT BREAK — a green run must mean: page == registry and the
//   three prerequisites are verified, not merely present.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.58", code: "D4", tool: "bb_doc",
  title: "bb_doc: honesty + docs + release gate",
  layers: ["unit"],
  decisions: { docsAuthority: "registry + verify-tool-docs", evidenceInputs: "d1,d2,d3.json verified" },
  limitations: ["Covers bb_doc only."],
})

const root = path.resolve(import.meta.dir, "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

const registry = PUBLIC_TOOL_DESCRIPTORS.find(t => t.name === "bb_doc")
const doc = readFileSync(path.join(root, "docs", "tools", "bb_doc.md"), "utf8")

if (registry) {
  harness.check("docs: description matches", doc.includes(registry.description.slice(0, 40)), doc.split("\n")[2].slice(0, 80))
  harness.check("docs: 7 modes documented", ["symbol","file","module","feature","api","project","coverage"].every(m => doc.includes(m)))
  harness.check("docs: defaults match", doc.includes(JSON.stringify(registry.documentation.defaults)))
}

const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts", "--only", "bb_doc"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("docs: generator passes", gen.status === 0, "")

for (const code of ["d1","d2","d3"]) {
  let d: any = null
  try { d = JSON.parse(readFileSync(path.join(RESULTS, code + ".json"), "utf8")) } catch {}
  harness.check("evidence: "+code+".json verified", !!d && validateEvidence(d).length === 0 && d.verifiedState === "verified", !d ? "missing" : d.verifiedState)
}

harness.negative("gate: B3 evidence wired", (() => {
  return readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8").includes("m13/verify-evidence.ts")
})(), "self-check")

harness.emit()
