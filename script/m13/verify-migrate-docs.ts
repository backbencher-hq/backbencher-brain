// script/m13/verify-migrate-docs.ts — M13.50 (M3).
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const RESULTS = path.join(root, "validation", "m13", "results")

const registry = PUBLIC_TOOL_DESCRIPTORS.find(t => t.name === "bb_migrate")
const doc = readFileSync(path.join(root, "docs", "tools", "bb_migrate.md"), "utf8")

if (registry) {
  // The generated page starts with the author header, then the tool heading, then
  // the description. Anchoring on a line NUMBER was stale the moment the header
  // was added; anchor on the heading and read the paragraph under it.
  const lines = doc.split("\n")
  const heading = lines.findIndex((line) => line.trim() === "# `bb_migrate`")
  const descriptionLine = heading >= 0 ? (lines[heading + 2] ?? "").trim() : ""
  harness.check("docs: description matches the registry", descriptionLine === registry.description, descriptionLine.slice(0, 80))
  harness.check("docs: modes = plan", doc.includes("- Modes: `plan`"))
  harness.check("docs: format separate", doc.includes('"format"'))
  harness.check("docs: defaults match", doc.includes(JSON.stringify(registry.documentation.defaults)))
  // Runtime truth for this tool: it never reindexes on a read and has no `refresh`
  // option, so the generated staleness section must not promise either. The page is
  // regenerated from the generator; while the generator still emits the generic
  // read-tool wording this check is the gate that says so out loud.
  const staleness = doc.slice(doc.indexOf("## Staleness"))
  harness.check("docs: staleness section does not promise auto-refresh", !staleness.includes("reads auto-refresh stale files"), staleness.split("\n").slice(0, 2).join(" ").slice(0, 120))
  harness.check("docs: staleness section does not offer a refresh=false option", !staleness.includes("refresh=false"), "no refresh option exists")
}

// The generator is checked for THIS tool only: a full-tree run is red while other
// lanes regenerate their pages, and a gate that fails for someone else's page
// cannot tell a bb_migrate regression from ambient drift.
const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts", "--only", "bb_migrate"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("docs: single-page generator passes", gen.status === 0, gen.status === 0 ? "" : (gen.stderr || gen.stdout || "fail").slice(0, 200))

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
