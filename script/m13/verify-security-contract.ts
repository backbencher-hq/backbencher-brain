// script/m13/verify-security-contract.ts — M13.40 (Sec1).
//
// Resolve mode drift: executable modes = ["findings"] only. Flow/summary/
// hotspots must live in plannedModes and must never be advertised as
// executable — not in the registry, not in the handler, not in docs, not
// in any contract.
//
// Before M13.01, bb_security advertised flow/summary/hotspots as executable
// modes that the runtime could not deliver. M13.01 moved them to plannedModes.
// This verifier proves the fix is complete and permanent.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { Harness } from "./harness"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"

const harness = new Harness({
  issue: "M13.40",
  code: "Sec1",
  tool: "bb_security",
  title: "bb_security: contract + mode resolution (findings only)",
  layers: ["unit"],
  decisions: {
    executableModes: "exactly [\"findings\"] — flow/summary/hotspots are planned, not executable",
    modeDrift: "no code path anywhere in the handler, registry, or docs routes flow/summary/hotspots as executable",
    plannedModes: "flow, summary, hotspots must be in plannedModes (advertised honestly) not in executable modes",
  },
  limitations: [
    "This verifier enforces the contract boundary only; the security findings themselves are verified in later Sec issues.",
    "The docs/tools/bb_security.md byte-freshness is proven by the generator verify mode.",
  ],
})

const root = path.resolve(import.meta.dir, "..", "..")

// ── 1. Registry: executable modes are exactly ["findings"] ─────────────────
const registry = PUBLIC_TOOL_DESCRIPTORS.find((t) => t.name === "bb_security")
harness.check("sec: bb_security is in the tool registry", !!registry, "missing from PUBLIC_TOOL_DESCRIPTORS")

if (registry) {
  harness.equals("sec: executable modes are exactly [findings]", registry.modes, ["findings"])
  harness.check("sec: plannedModes includes flow", (registry.plannedModes ?? []).includes("flow"), `plannedModes=${JSON.stringify(registry.plannedModes)}`)
  harness.check("sec: plannedModes includes summary", (registry.plannedModes ?? []).includes("summary"), `plannedModes=${JSON.stringify(registry.plannedModes)}`)
  harness.check("sec: plannedModes includes hotspots", (registry.plannedModes ?? []).includes("hotspots"), `plannedModes=${JSON.stringify(registry.plannedModes)}`)
  harness.negative("sec: flow is NOT in executable modes", !(registry.modes ?? []).includes("flow"), `modes=${JSON.stringify(registry.modes)}`)
  harness.negative("sec: summary is NOT in executable modes", !(registry.modes ?? []).includes("summary"), `modes=${JSON.stringify(registry.modes)}`)
  harness.negative("sec: hotspots is NOT in executable modes", !(registry.modes ?? []).includes("hotspots"), `modes=${JSON.stringify(registry.modes)}`)
  harness.check("sec: description does not claim flow/summary/hotspots as capabilities", !registry.description.includes("flow") && !registry.description.includes("summary") && !registry.description.includes("hotspots"), `desc=${registry.description.slice(0, 80)}`)
}

// ── 2. Handler: no mode routing for flow/summary/hotspots ──────────────────
const handlerSrc = readFileSync(path.join(root, "src", "mcp", "tool-handlers.ts"), "utf8")
const secSection = handlerSrc.slice(handlerSrc.indexOf("bb_security:"), handlerSrc.indexOf("bb_visualize:"))
harness.negative("sec: handler does not route flow", !secSection.includes('"flow"'), "flow found in handler")
harness.negative("sec: handler does not route summary", !secSection.includes('"summary"'), "summary found in handler")
harness.negative("sec: handler does not route hotspots", !secSection.includes('"hotspots"'), "hotspots found in handler")
harness.check("sec: handler routes findings (the only executable mode)", secSection.includes("analyzeSecurityAcrossLanguages"), "missing main engine call")

// ── 3. Docs: bb_security.md matches the executable contract ─────────────────
const docPath = path.join(root, "docs", "tools", "bb_security.md")
let doc = ""
try { doc = readFileSync(docPath, "utf8") } catch {}
harness.check("sec: docs/bb_security.md exists", doc.length > 0, "missing")

if (doc && registry) {
  const docLines = doc.split("\n")
  const descLine = docLines.length > 2 ? docLines[2] : ""
  harness.check("sec: doc description matches registry", descLine === registry.description, `"${descLine.slice(0, 80)}"`)
  harness.check("sec: doc modes = findings only", doc.includes("- Modes: `findings`"), "mode line mismatch")
  harness.check("sec: doc planned modes labeled honestly", doc.includes("Planned modes (roadmap, not executable): `flow`, `summary`, `hotspots`"), "planned modes mislabeled")
  harness.check("sec: doc does not mention flow/summary/hotspots as executable", !doc.toLowerCase().includes("flow mode") && !doc.toLowerCase().includes("summary mode") && !doc.toLowerCase().includes("hotspot mode"), "aspirational mode mentioned as executable")
  harness.check("sec: doc category matches registry", doc.includes(`- Category: \`${registry.documentation.category}\``))
  harness.check("sec: doc mutability = read", doc.includes("- Mutability: `read`"))
}

// Generator verify mode
const gen = spawnSync("bun", ["run", "script/verify-tool-docs.ts"], { cwd: root, encoding: "utf8", timeout: 120_000 })
harness.check("sec: generator verify mode passes (bb_security.md byte-fresh)", gen.status === 0, gen.status === 0 ? "" : (gen.stderr || gen.stdout || "").slice(0, 200))

// ── 4. Contracts file: no stale claims ─────────────────────────────────────
const contractsSrc = readFileSync(path.join(root, "src", "contracts", "tool-contracts.ts"), "utf8")
harness.check("sec: contracts file documents the mode-move to plannedModes", contractsSrc.includes("bb_security flow/summary/hotspots"), "contract comment missing")
harness.negative("sec: contracts file has NO hardcoded flow/summary/hotspots as executable modes", !contractsSrc.includes('"flow"') && !contractsSrc.includes('"summary"') && !contractsSrc.includes('"hotspots"'), "stale mode claim found")

// ── 5. Gate wired ──────────────────────────────────────────────────────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""

// Pre-wire check: the verifier itself doesn't exist in the gate yet (it will be added after this runs).
// We verify the gate includes bb_security-awareness.
const existingGateCheck = gateSrc.includes("verify-security.ts") && verifyScript.includes("script/verify-security.ts")
harness.check("sec: legacy verify-security.ts is still in the gate (M13 will extend later)", existingGateCheck, existingGateCheck ? "present" : "missing")

harness.emit()