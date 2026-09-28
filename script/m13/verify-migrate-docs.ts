// script/m13/verify-migrate-docs.ts — M13.50 (M3).
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { validateEvidence } from "./verify-evidence"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.50", code: "M3", tool: "bb_migrate",
  title: "bb_migrate: honesty + docs + release gate",
  layers: ["unit"],
  decisions: { docsAuthority: "registry + verify-tool-docs", evidenceInputs: "m1,m2.json verified" },
  limitations: ["Covers bb_migrate only."],
})

const root = path.resolve(import.meta.dir, "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

const registry = PUBLIC_TOOL_DESCRIPTORS.find(t => t.name === "bb_migrate")
const doc = readFileSync(path.join(root, "docs", "tools", "bb_migrate.md"), "utf8")

if (registry) {
  harness.check("docs: description matches", doc.split("\n")[2] === registry.description, doc.split("\n")[2].slice(0, 80))
  harness.check("docs: modes = plan", doc.includes("- Modes: `plan`"))
  harness.check("docs: format separate", doc.includes('"format"'))
  harness.check("docs: defaults match", doc.includes(JSON.stringify(registry.documentation.defaults)))
}

const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("docs: generator passes", gen.status === 0, gen.status === 0 ? "" : "fail")

for (const code of ["m1","m2"]) {
  let d: any = null
  try { d = JSON.parse(readFileSync(path.join(RESULTS, code + ".json"), "utf8")) } catch {}
  harness.check("evidence: "+code+".json verified", !!d && validateEvidence(d).length === 0 && d.verifiedState === "verified", !d ? "missing" : d.verifiedState)
}

const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
harness.check("gate: M1 wired", gateSrc.includes("m13/verify-migrate-accuracy.ts"))
harness.check("gate: B3 evidence wired", gateSrc.includes("m13/verify-evidence.ts"))
harness.negative("gate: M3 not in gate before own wiring", gateSrc.includes("m13/verify-migrate-docs.ts"), "self-check")

harness.emit()
