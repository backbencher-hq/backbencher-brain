// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — bb_doc's seven-mode + refusal gate at the CLI boundary:
//   every mode produces a DOCUMENT (not a refusal), and each documented refusal
//   (missing target, unmatched module, out-of-range limit/maxTokens, includeTests
//   on a mode without test evidence, invalid mode) produces a named error.
// WHICH TOOL IT SERVES — bb_doc.
// WHY IT IS SHAPED THIS WAY — it runs the built CLI (`bin/bb`) rather than the
//   source modules, so it proves the transport a caller actually uses; a refusal
//   is asserted POSITIVELY (non-zero exit + the accepted range/mode named).
// WHERE ITS EVIDENCE LIVES — validation/m13/results/d2.json.
// EDIT TOGETHER WHEN THIS CHANGES — src/mcp/tools/bb_doc/{descriptor,handler}.ts,
//   script/m13/harness.ts. Rebuild with `npm run build` before running: this gate
//   exercises dist/.
// CONTRACTS IT MUST NOT BREAK — a green run must mean: all seven modes answer and
//   every refusal row is a refusal, not a silently clamped success.
// ─────────────────────────────────────────────────────────────────────────────
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
  layers: ["e2e"],
  decisions: { allModes: "7 modes: symbol,file,module,feature,api,project,coverage" },
  limitations: ["Small fixture; real-repository coverage in D3."],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-doc-"))
const pid = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
writeFileSync(path.join(root, "src", "app.ts"),
  "export function greet(name: string): string { return 'Hello, ' + name }\n" +
  "export function add(a: number, b: number): number { return a + b }\n")
await indexProjectParallel(pid, root, {})

function cli(args: Record<string, unknown>): { out: string; status: number } {
  try {
    const out = execFileSync("node", [path.resolve("bin/bb"), "tool", "bb_doc", "--dir", root, "--args", JSON.stringify(args)], { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" })
    return { out, status: 0 }
  } catch (error: any) {
    const out = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`
    return { out: String(out), status: Number(error?.status ?? 1) }
  }
}

/** Is this text a bb_doc DOCUMENT, rather than a refusal or a thrown error? */
function isDocument(text: string): boolean {
  return text.trimStart().startsWith("# ") && text.includes("## Quality") && !/^Error:/m.test(text) && !/Traceback/i.test(text)
}
/** A refusal must exit non-zero AND name the thing that was refused. */
function isRefusal(result: { out: string; status: number }, mentions: string): boolean {
  return result.status !== 0 && result.out.includes(mentions)
}

const MODE_TARGETS: Array<[string, Record<string, unknown>]> = [
  ["symbol", { target: "greet" }],
  ["file", { target: "src/app.ts" }],
  ["module", { target: "src" }],
  ["feature", { target: "greet" }],
  ["api", {}],
  ["project", {}],
  ["coverage", {}],
]
for (const [mode, extra] of MODE_TARGETS) {
  const result = cli({ mode, ...extra })
  harness.check(`mode: ${mode} exits zero`, result.status === 0, `status=${result.status} ${result.out.slice(0, 100)}`)
  harness.check(`mode: ${mode} returns a document, not a refusal`, isDocument(result.out), "first line: " + JSON.stringify(result.out.slice(0, 60)))
}
harness.negative("the is-a-document predicate convicts a refusal", !isDocument("bb_doc symbol mode requires target"), "a prose refusal is rejected by isDocument")

// Refusals: each names the accepted values rather than silently adjusting.
harness.negative("neg: symbol mode rejects missing target", isRefusal(cli({ mode: "symbol" }), "requires target"), "rejected")
harness.negative("neg: invalid mode rejected", isRefusal(cli({ mode: "bogus" }), "must be one of:"), "rejected by the registry validator")
harness.negative("neg: unmatched module target refused with the forms tried", isRefusal(cli({ mode: "module", target: "no/such/module" }), "no indexed file matches the module"), "rejected")
harness.negative("neg: limit 101 refused, not clamped", isRefusal(cli({ mode: "project", limit: 101 }), "between 1 and 100"), "rejected")
harness.negative("neg: limit 0 refused", isRefusal(cli({ mode: "project", limit: 0 }), "between 1 and 100"), "rejected")
harness.negative("neg: maxTokens 0 refused", isRefusal(cli({ mode: "project", maxTokens: 0 }), "between 1 and 16000"), "rejected")
harness.negative("neg: maxTokens 20000 refused, not clamped", isRefusal(cli({ mode: "project", maxTokens: 20000 }), "between 1 and 16000"), "rejected")
harness.negative("neg: includeTests on a mode without test evidence refused", isRefusal(cli({ mode: "project", includeTests: true }), "includeTests is accepted for"), "rejected")
harness.check("pos: includeTests on symbol mode is accepted", cli({ mode: "symbol", target: "greet", includeTests: false }).status === 0, "symbol refuses nothing for includeTests")

rmSync(root, { recursive: true, force: true })
harness.emit()
