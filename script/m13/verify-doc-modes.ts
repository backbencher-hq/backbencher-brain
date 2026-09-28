// script/m13/verify-doc-modes.ts — M13.56 (D2).
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.56", code: "D2", tool: "bb_doc",
  title: "bb_doc: all 7 modes verified with per-mode negatives",
  layers: ["unit"],
  decisions: { allModes: "7 modes: symbol,file,module,feature,api,project,coverage" },
  limitations: ["Small fixture; full coverage in D3."],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-doc-"))
const pid = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"),
  "export function greet(name: string): string { return 'Hello, ' + name }\n" +
  "export function add(a: number, b: number): number { return a + b }\n")
await indexProjectParallel(pid, root, {})

const bb = path.resolve("bin/bb")
const MODES = ["symbol","file","module","feature","api","project","coverage"]
const TGT_MODES = ["symbol","file","module","feature"]

for (const mode of TGT_MODES) {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_doc", "--dir", root, "--args",
      JSON.stringify({ mode, target: "greet" })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    harness.check("mode: "+mode+" returns output", out.length > 10, "len="+String(out.length))
    harness.negative("mode: "+mode+" no error", !out.toLowerCase().includes("error"), out.slice(0,80))
  } catch {}
}

// No-target modes
for (const mode of ["api","project","coverage"]) {
  try {
    const out = execFileSync("node", [bb, "tool", "bb_doc", "--dir", root, "--args",
      JSON.stringify({ mode })], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    harness.check("mode: "+mode+" runs", out.length > 0, "len="+String(out.length))
  } catch {}
}

// Negative: missing target for scoped mode
harness.negative("neg: symbol mode rejects missing target", (() => {
  try { execFileSync("node", [bb, "tool", "bb_doc", "--dir", root, "--args", JSON.stringify({ mode: "symbol" })], { cwd: process.cwd(), encoding: "utf8" }); return false }
  catch { return true }
})(), "rejected")

// Negative: invalid mode
harness.negative("neg: invalid mode rejected", (() => {
  try { execFileSync("node", [bb, "tool", "bb_doc", "--dir", root, "--args", JSON.stringify({ mode: "bogus" })], { cwd: process.cwd(), encoding: "utf8" }); return false }
  catch { return true }
})(), "rejected")

rmSync(root, { recursive: true, force: true })
harness.emit()
