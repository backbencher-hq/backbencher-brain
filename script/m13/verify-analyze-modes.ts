// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the behavioural gate for every bb_analyze mode. It builds
//   a real fixture, indexes it, and calls each of the eleven modes through the
//   SAME validate -> handler path the MCP door uses, asserting the fields that
//   mode exists to produce plus the refusals the contract declares.
// WHICH TOOL IT SERVES — bb_analyze (read, requiresIndex, 11 modes).
// WHY IT IS SHAPED THIS WAY — the previous gate called every mode with
//   {mode, target:"alpha"} and scored a NEGATIVE as "output does not contain
//   'Error:'". Five modes refuse `target` outright, so their refusal text
//   ("irrelevant options: target") passed the negative and five of eleven
//   "verified" modes were never exercised. Every check here asserts the ANSWER
//   (a field only that mode can produce), not the absence of a string, so a
//   missing dispatch path or an unexpected refusal turns the row red.
// WHERE ITS EVIDENCE LIVES — validation/m13/results/an1.json; fixture and
//   data dir are temporary and removed at the end.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_analyze/{descriptor,
//   handler}.ts, src/mcp/tool-validation.ts.
// CONTRACTS IT MUST NOT BREAK — a green run must mean: all 11 modes answer with
//   their own fields, every refusal is isError, and every success carries the
//   freshness envelope.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.51",
  code: "An1",
  tool: "bb_analyze",
  title: "bb_analyze: all 11 modes answer with their own fields, and every declared refusal refuses",
  layers: ["unit", "behaviour"],
  decisions: {
    perMode: "each mode is asked for an argument IT accepts and must return a field only that mode produces",
    refusals: "refusals are asserted as isError:true plus a message that names the rule",
  },
  limitations: ["Synthetic fixture; the reference-index latency leg lives in validation/tools/bb_analyze/LATENCY.json."],
})

// Tool-local data dir: never the shared workspace index.
if (!process.env.BB_DATA_DIR) process.env.BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-analyze-an1-data-"))
process.env.BB_NO_AUTO_REFRESH = "1"

const root = mkdtempSync(path.join(tmpdir(), "bb-analyze-an1-"))
const descriptor = PUBLIC_TOOL_DESCRIPTORS.find((tool) => tool.name === "bb_analyze")!
const handler = createToolHandlers()["bb_analyze"]
const projectId = getProjectId(root)

function write(rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true })
  writeFileSync(path.join(root, rel), content)
}
write("src/leaf.ts", "export function leaf(): number { return 1 }\n")
write("src/mid.ts", "import { leaf } from './leaf'\nexport function mid(): number { return leaf() }\nexport class Box { open(): number { return mid() } }\n")
write("src/top.ts", "import { mid } from './mid'\nexport function top(): number { return mid() }\n")
write("src/util/format.ts", "export function formatName(v: string): string { return v.trim() }\n")
write("src/util/deep/extra.ts", "export function extra(): number { return 2 }\n")
write("test/unit/mid.test.ts", "import { mid } from '../../src/mid'\ntest('mid', () => { expect(mid()).toBe(1) })\n")
write("spec/top.spec.ts", "import { top } from '../src/top'\ntest('top', () => { try { expect(top()).toBe(1) } catch (e) { throw e } })\n")

await indexProjectParallel(projectId, root, {})

type Call = { isError: boolean; text: string; json: any }
async function call(args: Record<string, unknown>): Promise<Call> {
  try {
    const validated = validateToolArguments(descriptor, args)
    const res = await handler(validated, { projectPath: root, projectId })
    const text = res.content.map((item) => item.text).join("\n")
    let json: any = null
    try { json = JSON.parse(text) } catch { json = null }
    return { isError: res.isError === true, text, json }
  } catch (error: any) {
    return { isError: true, text: `threw: ${error?.message ?? String(error)}`, json: null }
  }
}

async function expectRefusal(label: string, args: Record<string, unknown>, mustMention: string): Promise<void> {
  const r = await call(args)
  harness.negative(`${label} is refused`, r.isError, r.text.slice(0, 120))
  harness.negative(`${label} names the rule (${mustMention})`, r.text.includes(mustMention), r.text.slice(0, 160))
}

// ── every mode, with arguments THAT MODE accepts, asserting its own fields ──
const modes: Array<[string, Record<string, unknown>, (json: any) => boolean]> = [
  ["callers", { mode: "callers", target: "mid" }, (j) => j?.found === true && Array.isArray(j.callers) && j.summary?.pageEdgeLimit === 25],
  ["callees", { mode: "callees", target: "mid" }, (j) => j?.found === true && Array.isArray(j.callees) && (j.callees as any[]).some((e) => e.to)],
  ["trace", { mode: "trace", target: "mid" }, (j) => j?.found === true && Array.isArray(j.callers) && Array.isArray(j.callees)],
  ["dependencies", { mode: "dependencies", filePath: "src" }, (j) => j?.summary?.scope === "src" && j.summary.returned >= 1 && j.summary.totalFiles >= j.summary.returned],
  ["stats", { mode: "stats" }, (j) => j?.files >= 5 && Array.isArray(j.languages) && typeof j.callEdges === "number"],
  ["complexity", { mode: "complexity", target: "src" }, (j) => j?.scopeMatch === "directory-prefix" && j.breakdownReturned === j.breakdown.length && typeof j.breakdownTruncated === "boolean"],
  ["impact", { mode: "impact", target: "leaf" }, (j) => j?.found === true && typeof j.depthCap === "number" && (j.totalSymbolsIfKnown === null || typeof j.totalSymbolsIfKnown === "number")],
  ["test_mapping", { mode: "test_mapping" }, (j) => j?.summary?.productionSymbols >= 1 && j.summary.returned === j.entries.length],
  ["test_gaps", { mode: "test_gaps" }, (j) => j?.summary?.productionSymbols >= 1 && j.summary.returned === j.gaps.length],
  ["test_impact", { mode: "test_impact", target: "leaf" }, (j) => j?.found === true && !!j.summary && typeof j.summary.timeBudgetMs === "number" && j.summary.returned === (j.directTests.length + j.indirectTests.length)],
  ["test_quality", { mode: "test_quality" }, (j) => Array.isArray(j?.files) && j.summary.returned === j.files.length && j.summary.totalFiles >= j.summary.returned],
]

for (const [mode, args, predicate] of modes) {
  const r = await call(args)
  harness.check(`${mode}: is not an error`, r.isError === false, r.text.slice(0, 140))
  harness.check(`${mode}: JSON answer`, r.json !== null, r.text.slice(0, 120))
  // A refusal text can never satisfy the per-mode field predicate — that is the
  // property the previous gate lacked.
  harness.check(`${mode}: returns the fields it exists to return`, !!r.json && predicate(r.json), JSON.stringify(r.json)?.slice(0, 200) ?? "noJSON")
  harness.check(`${mode}: carries the freshness envelope`, !!r.json?.freshness && typeof r.json.freshness.mode === "string", JSON.stringify(r.json?.freshness)?.slice(0, 120) ?? "none")
}

// The terminal "requires mode" line must be unreachable: validation refuses the
// call before the handler's dispatch fallback can answer it.
const noMode = await call({})
harness.negative("missing mode refused by validation, not by the dispatch fallback", noMode.isError && /missing required option: mode/.test(noMode.text), noMode.text.slice(0, 120))

// ── the declared refusals ──────────────────────────────────────────────────
await expectRefusal("unknown option", { mode: "stats", verbose: true }, "unknown or irrelevant options")
await expectRefusal("unknown mode", { mode: "coupling" }, "mode must be one of")
await expectRefusal("blank mode", { mode: "" }, "mode must be one of")
await expectRefusal("limit: 0", { mode: "dependencies", limit: 0 }, "limit must be at least 1")
await expectRefusal("limit over the graph ceiling", { mode: "callers", target: "mid", limit: 5001 }, "limit must be between 1 and 5000")
await expectRefusal("limit over the collection ceiling", { mode: "dependencies", limit: 2001 }, "limit must be between 1 and 2000")
await expectRefusal("limit on a mode it does not bound", { mode: "stats", limit: 5 }, "limit does not apply to this mode")
await expectRefusal("target on a mode that has no target", { mode: "stats", target: "mid" }, "irrelevant options: target")
await expectRefusal("filePath on a mode that has no file scope", { mode: "callers", target: "mid", filePath: "src" }, "irrelevant options: filePath")
await expectRefusal("blank target for a target mode", { mode: "callers", target: "   " }, "requires a non-empty target")
await expectRefusal("complexity refuses a symbol name", { mode: "complexity", target: "mid" }, "no indexed file matches")
await expectRefusal("negative limit", { mode: "dependencies", limit: -1 }, "non-negative")
await expectRefusal("fractional limit", { mode: "dependencies", limit: 2.5 }, "whole number")

// ── aliases resolve to the same answer ────────────────────────────────────
const viaTarget = await call({ mode: "callers", target: "mid" })
const viaAlias = await call({ mode: "callers", symbol: "mid" })
harness.check("alias symbol= is accepted and identical", viaAlias.isError === false && viaAlias.text === viaTarget.text, viaAlias.text.slice(0, 100))

// ── registry agreement ────────────────────────────────────────────────────
harness.check("descriptor lists 11 modes", descriptor.modes.length === 11, String(descriptor.modes.length))
for (const [mode] of modes) harness.check(`descriptor registers mode ${mode}`, descriptor.modes.includes(mode), "missing")

rmSync(root, { recursive: true, force: true })
try { rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true }) } catch {}
harness.emit()
