// script/m13/verify-doc-docs.ts — M13.58 (D4).
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

const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
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
