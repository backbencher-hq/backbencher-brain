// script/m13/verify-security-contract.ts — bb_security contract boundary.
//
// The tool has exactly one executable mode (`findings`); flow/summary/hotspots
// are roadmap entries and must stay in `plannedModes`, never in `modes`, never
// routed by the handler, never advertised as executable by the generated page.
// The handler body lives in src/mcp/tools/bb_security/handler.ts after the
// per-tool split, so the source assertions read THAT module, not the assembler
// that merely maps the name to the function.
//
// Run: npx tsx script/m13/verify-security-contract.ts   (bun run … also works)
// Exit: non-zero if any assertion failed.

import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Harness } from "./harness"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { readToolSource } from "../lib/tool-sources.ts"

const harness = new Harness({
  issue: "M13.40",
  code: "Sec1",
  tool: "bb_security",
  title: "bb_security: contract + mode resolution (findings only)",
  layers: ["unit"],
  decisions: {
    executableModes: "exactly [\"findings\"] — flow/summary/hotspots are planned, not executable",
    modeDrift: "no code path in the handler module, registry, or generated page routes flow/summary/hotspots as executable",
    plannedModes: "flow, summary, hotspots must be in plannedModes (advertised honestly) not in executable modes",
  },
  limitations: [
    "This verifier enforces the contract boundary only; the security findings themselves are verified by the m15/m20 security suites.",
    "The docs/tools/bb_security.md byte-freshness is proven by the generator verify mode for THIS tool.",
  ],
})

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

/** Run a repo script through the runtime this gate is executing on. */
function runScript(rel: string, args: string[] = []): number {
  const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
  const tsx = path.join(root, "node_modules", ".bin", "tsx")
  const result = isBun
    ? spawnSync("bun", ["run", rel, ...args], { cwd: root, encoding: "utf8", timeout: 120_000 })
    : spawnSync(tsx, [rel, ...args], { cwd: root, encoding: "utf8", timeout: 120_000 })
  if (result.status !== 0) {
    process.stdout.write(((result.stderr ?? "") + (result.stdout ?? "")).slice(0, 400) + "\n")
  }
  return result.status ?? 1
}

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
  // A capability claim is a mode advertised as executable ("flow mode", or a
  // mode list naming it). Matching the bare word "flow" flagged the honest
  // description text "Taint-flow security scan", which is prose, not a promise.
  const claimsMode = (mode: string) => new RegExp(`\\b${mode}\\s+mode\\b|modes?\\s*[:=]\\s*\\[[^\\]]*["']${mode}["']`, "i").test(registry.description)
  harness.check(
    "sec: description does not advertise a planned mode as executable",
    !claimsMode("flow") && !claimsMode("summary") && !claimsMode("hotspots"),
    `desc=${registry.description.slice(0, 100)}`,
  )
}

// ── 2. Handler module: findings is the only routed mode ────────────────────
const handlerSrc = readToolSource("src/mcp/tools/bb_security/handler.ts")
harness.negative("sec: handler does not route a flow command", !/mode\s*===?\s*["']flow["']/.test(handlerSrc), "flow routing found in handler.ts")
harness.negative("sec: handler does not route a summary command", !/mode\s*===?\s*["']summary["']/.test(handlerSrc), "summary routing found in handler.ts")
harness.negative("sec: handler does not route a hotspots command", !/mode\s*===?\s*["']hotspots["']/.test(handlerSrc), "hotspots routing found in handler.ts")
harness.check("sec: handler routes findings (the only executable mode)", handlerSrc.includes("analyzeSecurityAcrossLanguages"), "missing engine call")

// ── 2b. The read path is read-only ────────────────────────────────────────
// A read tool that opens the index read-write runs the open-path migrations and
// moves the WAL, so "read" would be a lie in the filesystem sense.
const openCalls = handlerSrc.match(/getRawInstance\([^)]*\)/g) ?? []
harness.check("sec: the handler opens the index at all", openCalls.length > 0, "no getRawInstance call")
harness.negative(
  "sec: every handler open is read-only",
  openCalls.every((call) => call.includes("readonly: true")),
  openCalls.filter((call) => !call.includes("readonly: true")).join(" | "),
)
const engineSrc = readToolSource("src/intelligence/security/taint.ts")
const engineOpens = engineSrc.match(/getRawInstance\([^)]*\)/g) ?? []
harness.check("sec: the taint engine opens the index at all", engineOpens.length > 0, "no getRawInstance call in taint.ts")
harness.negative(
  "sec: every engine open is read-only",
  engineOpens.every((call) => call.includes("readonly: true")),
  engineOpens.filter((call) => !call.includes("readonly: true")).join(" | "),
)

// ── 3. Docs: the generated page matches the executable contract ────────────
const doc = (() => { try { return readFileSync(path.join(root, "docs", "tools", "bb_security.md"), "utf8") } catch { return "" } })()
harness.check("sec: docs/tools/bb_security.md exists", doc.length > 0, "missing")

if (doc && registry) {
  // Locate the description by structure, not by line index: the page opens with
  // the author header, so line 2 is a comment now.
  const lines = doc.split("\n")
  const headingIndex = lines.findIndex((line) => line.startsWith("# `bb_security`"))
  // Absent heading is reported by the description mismatch below (empty string).
  const descLine = headingIndex < 0 ? "" : (lines.slice(headingIndex + 1).find((line) => line.trim().length > 0) ?? "")
  harness.check("sec: doc description matches registry", descLine === registry.description, `"${descLine.slice(0, 100)}"`)
  harness.check("sec: doc modes = findings only", doc.includes("- Modes: `findings`"), "mode line mismatch")
  harness.check("sec: doc planned modes labeled honestly", doc.includes("Planned modes (roadmap, not executable): `flow`, `summary`, `hotspots`"), "planned modes mislabeled")
  harness.check("sec: doc does not mention a planned mode as executable", !doc.toLowerCase().includes("flow mode") && !doc.toLowerCase().includes("summary mode") && !doc.toLowerCase().includes("hotspot mode"), "aspirational mode mentioned as executable")
  harness.check("sec: doc category matches registry", doc.includes(`- Category: \`${registry.documentation.category}\``))
  harness.check("sec: doc mutability = read", doc.includes("- Mutability: `read`"))
}

// Generator verify mode, scoped to this tool: the shared artifacts are
// regenerated centrally, so a mid-campaign full-tree verify is expected red for
// reasons that are not this tool's contract.
const genExit = runScript("script/verify-tool-docs.ts", ["--only", "bb_security"])
harness.check("sec: generator verify mode passes (bb_security page byte-fresh)", genExit === 0, `exit=${genExit}`)

// ── 4. Contracts file: planned modes documented, none advertised ───────────
const contractsSrc = readFileSync(path.join(root, "src", "contracts", "tool-contracts.ts"), "utf8")
harness.check("sec: contracts file documents the planned-mode split", contractsSrc.includes("bb_security flow/summary/hotspots"), "contract note missing")
harness.negative("sec: contracts file has NO hardcoded executable mode list for flow/summary/hotspots", !contractsSrc.includes('"flow"') && !contractsSrc.includes('"summary"') && !contractsSrc.includes('"hotspots"'), "stale mode claim found")

// ── 5. The gate itself is wired into the verification chain ────────────────
const gateSrc = readFileSync(path.join(root, "script", "verify-quality-gate.ts"), "utf8")
const verifyScript = (JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as any).scripts.verify ?? ""
const wired = gateSrc.includes("m13/verify-security-contract.ts") && verifyScript.includes("script/m13/verify-security-contract.ts")
harness.check("sec: this contract gate is wired into the verify chain", wired, wired ? "present" : "missing from verify-quality-gate.ts or package.json verify")

harness.emit()
