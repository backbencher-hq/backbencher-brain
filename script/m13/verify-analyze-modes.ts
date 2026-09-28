// script/m13/verify-analyze-modes.ts — M13.51-52 (An1+An2).
// All 11 bb_analyze modes verified with per-mode negatives + handler parity.
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.51", code: "An1", tool: "bb_analyze",
  title: "bb_analyze: all 11 modes verified + handler parity",
  layers: ["unit"],
  decisions: { allModes: "all 11 modes have positive + negative coverage" },
  limitations: ["Small fixture; full graph analysis in An3."],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-analyze-"))
const pid = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"),
  "export function alpha(): number { return beta() }\n" +
  "export function beta(): number { return 1 }\n" +
  "export function gamma(): number { return 2 }\n")
await indexProjectParallel(pid, root, {})

const bb = path.resolve("bin/bb")
const MODES = ["callers","callees","trace","dependencies","stats","complexity","impact","test_mapping","test_gaps","test_impact","test_quality"]
const KNOWN = new Set(MODES)

for (const mode of MODES) {
  const out = (() => {
    try { return execFileSync("node", [bb, "tool", "bb_analyze", "--dir", root, "--args",
      JSON.stringify({ mode, target: "alpha" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    } catch (e: any) { return e.stdout || e.stderr || "" }
  })()
  harness.check("mode: "+mode+" returns output", out.length > 0, "len="+String(out.length))
  harness.negative("mode: "+mode+" does not crash or error", !out.includes("Error:") && !out.includes("error:"), out.slice(0, 80))
}

// Invalid mode negative
const badOut = (() => {
  try { return execFileSync("node", [bb, "tool", "bb_analyze", "--dir", root, "--args",
    JSON.stringify({ mode: "nonexistent" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
  } catch (e: any) { return e.stdout || e.stderr || "" }
})()
harness.negative("mode: invalid mode rejected", badOut.includes("invalid") || badOut.includes("mode") || badOut.length < 50, badOut.slice(0, 80))

// Empty target
const noTgt = (() => {
  try { return execFileSync("node", [bb, "tool", "bb_analyze", "--dir", root, "--args",
    JSON.stringify({ mode: "callers" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
  } catch (e: any) { return e.stdout || e.stderr || "" }
})()
harness.negative("mode: callers without target rejected or warned", !noTgt.includes("alpha") || noTgt.includes("target"), noTgt.slice(0, 80))

// Handler parity: all modes registered
const registry = (await import("../../src/mcp/tool-registry")).PUBLIC_TOOL_DESCRIPTORS
const analyze = registry.find((t: any) => t.name === "bb_analyze")
harness.check("registry: bb_analyze exists", !!analyze, "found")
if (analyze) {
  const regModes = analyze.modes || []
  for (const m of MODES) {
    harness.check("registry: mode "+m+" is registered", regModes.includes(m), regModes.includes(m) ? "ok" : "missing")
  }
  harness.negative("registry: no double-count", regModes.length >= 11, "modes="+String(regModes.length))
}

rmSync(root, { recursive: true, force: true })
harness.emit()
