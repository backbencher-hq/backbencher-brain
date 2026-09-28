// script/m13/verify-patterns-rules.ts — M13.36 (P2).
//
// scope=all must return REAL, evidence-bearing framework/anti-pattern rules —
// never zero-confidence stubs. Proves:
//   1. no stub type is emitted anywhere in the engine or handler,
//   2. every finding carries confidence > 0 and evidence,
//   3. real rules fire on fixtures that genuinely match (god class,
//      long parameter list, high complexity),
//   4. handler and engine agree on what scope=all returns.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { PatternBrainTools } from "../../src/ast/tools"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.36",
  code: "P2",
  tool: "bb_patterns",
  title: "bb_patterns: remove or implement framework/anti-pattern stubs",
  layers: ["unit", "integration"],
  decisions: {
    noStubs: "framework_pattern_stub / anti_pattern_stub are removed from the engine; a zero-confidence finding is a recorded failure",
    realRules: "rules are computed from indexed data (complexity, parameters JSON, owner member counts, framework_type) with evidence",
    agreement: "the handler (scope=all) and the engine (detectPatterns) return the same finding types",
  },
  limitations: [
    "Rules fire only when indexed data matches; fixtures are constructed to genuinely match.",
  ],
})

// ── 1. Static: no stubs anywhere ───────────────────────────────────────────
const toolsSrc = readFileSync(path.resolve("src/ast/tools.ts"), "utf8")
const rulesSrc = readFileSync(path.resolve("src/intelligence/patterns/rules.ts"), "utf8")
harness.negative("static: no framework_pattern_stub anywhere in the engine", !toolsSrc.includes("framework_pattern_stub") && !rulesSrc.includes("framework_pattern_stub"), "stub present")
harness.negative("static: no anti_pattern_stub anywhere in the engine", !toolsSrc.includes("anti_pattern_stub") && !rulesSrc.includes("anti_pattern_stub"), "stub present")
harness.check("static: rules engine computes from indexed tables", rulesSrc.includes("brain_symbol") && rulesSrc.includes("framework_type"), "not index-backed")
harness.check("static: every rule emits confidence > 0", !/confidence: 0\.0/.test(rulesSrc), "zero-confidence rule present")

// ── 2. Runtime: real rules fire on genuinely matching fixtures ────────────
const root = mkdtempSync(path.join(tmpdir(), "bb-patterns-rules-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src"), { recursive: true })
// god class (12 members) + long parameter list (9 params) + high complexity (20 nested ifs)
const classMembers = Array.from({ length: 12 }, (_, i) => `  m${i}() { return ${i} }`).join("\n")
const params = Array.from({ length: 9 }, (_, i) => `p${i}: number`).join(", ")
let deep = "export function deepFn(): number {\n"
for (let i = 0; i < 20; i++) deep += " ".repeat(i) + "if (true) {\n"
deep += " ".repeat(20) + "return 1\n"
for (let i = 19; i >= 0; i--) deep += " ".repeat(i) + "}\n"
deep += "  return 2\n}\n"
writeFileSync(path.join(root, "src", "a.ts"), `class GodService {\n${classMembers}\n}\nexport function longParams(${params}): number { return p0 }\n${deep}`)
await indexProjectParallel(projectId, root, {})

{
  const engine = await PatternBrainTools.detectPatterns(projectId as any, { includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0.4, maxResults: 200 })
  const types = (engine.patterns ?? []).map((p) => p.type)
  harness.check("runtime: god-class rule fires on a 12-member class", types.includes("god-class"), types.join(","))
  harness.check("runtime: long-parameter-list rule fires on 9 params", types.includes("long-parameter-list"), types.join(","))
  harness.check("runtime: high-complexity rule fires on 20 nested ifs", types.includes("high-complexity-function"), types.join(","))
  harness.negative("runtime: no finding has zero confidence", (engine.patterns ?? []).every((p) => p.confidence > 0), `zero-conf: ${types.filter((_, i) => (engine.patterns ?? [])[i].confidence === 0).join(",")}`)
  harness.check("runtime: every finding carries evidence or a real location", (engine.patterns ?? []).every((p) => (p.evidence?.length ?? 0) > 0 || (p.location?.file?.length ?? 0) > 0), "evidence-less finding")
  harness.check("runtime: statistics match the emitted patterns", engine.statistics?.totalFound === (engine.patterns ?? []).length, `stats=${engine.statistics?.totalFound} emitted=${(engine.patterns ?? []).length}`)
}

// ── 3. Handler and engine agree on scope=all ──────────────────────────────
{
  const { createToolHandlers } = await import("../../src/mcp/tool-handlers")
  const patternsHandler = createToolHandlers().bb_patterns
  const out = await patternsHandler({ scope: "all", limit: 200 }, { projectId, projectPath: root } as any)
  const text = (out.content ?? []).map((c: any) => c.text ?? "").join("\n")
  const engine = await PatternBrainTools.detectPatterns(projectId as any, { includeOrphaned: true, includeFramework: true, includeAntiPatterns: true, confidenceThreshold: 0.6, maxResults: 200 })
  const engineTypes = (engine.patterns ?? []).map((p) => p.type)
  for (const t of engineTypes) harness.check(`agreement: handler scope=all surfaces engine finding '${t}'`, text.includes(t), text.slice(0, 200))
  harness.negative("agreement: handler scope=all never surfaces a stub type", !text.includes("_stub"), "stub in handler output")
}

rmSync(root, { recursive: true, force: true })
harness.emit()
