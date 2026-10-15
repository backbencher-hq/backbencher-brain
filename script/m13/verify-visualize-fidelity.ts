// script/m13/verify-visualize-fidelity.ts — M13.45 (V2).
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { visualizeProject, formatVisualization } from "../../src/intelligence/visualization/visualization-engine"
import { Harness } from "./harness"

const harness = new Harness({
  issue: "M13.45", code: "V2", tool: "bb_visualize",
  title: "bb_visualize: node/link fidelity + no dropped edges + truncation",
  layers: ["unit", "integration"],
  decisions: {
    noDangling: "no link references a missing node",
    budgets: "maxNodes/maxLinks enforced, truncation truthful",
    scopes: "module/symbol/feature/file filter correctly",
  },
  limitations: ["Small fixture; large graphs bounded by LIMIT queries."],
})

const root = mkdtempSync(path.join(tmpdir(), "bb-viz-v2-"))
const projectId = getProjectId(root)
mkdirSync(path.join(root, "src", "api"), { recursive: true })
mkdirSync(path.join(root, "src", "core"), { recursive: true })
writeFileSync(path.join(root, "src", "api", "handlers.ts"),
  "export function handleRequest(): string { return format(parse()) }\n" +
  "export function parse(): string { return 'x' }\n" +
  "export function format(s: string): string { return s.toUpperCase() }\n" +
  "export function unusedHelper(): string { return 'unused' }\n")
writeFileSync(path.join(root, "src", "core", "engine.ts"),
  "import { parse } from '../api/handlers'\n" +
  "export function run(): string { return parse() }\n" +
  "export function helper(): number { return 42 }\n")
await indexProjectParallel(projectId, root, {})

// 1. No dangling links
{
  const r = await visualizeProject(projectId, { scope: "project", maxNodes: 100, maxLinks: 500 })
  const ids = new Set(r.nodes.map((n: any) => n.id))
  const d = r.links.filter((l: any) => !ids.has(l.source) || !ids.has(l.target))
  harness.check("fidelity: no dangling links", d.length === 0, String(d.length))
  harness.check("fidelity: provenance = canonical-graph-engine", r.provenance.source === "canonical-graph-engine", r.provenance.source)
  // M13.F9 (#701): the one counter that was called `omittedDanglingLinks` measured the NODE CUT,
  // and the text then blamed `maxLinks` for it. The two reasons an edge can be absent are now
  // counted apart, and the old name is gone rather than kept as an alias — a field whose name
  // describes a different event than it measures is how this was missed in the first place.
  harness.check(
    "fidelity: the node cut and the budget cut are separate counters",
    typeof r.provenance.linksOmittedWithNodeCut === "number" && typeof r.provenance.linksOmittedByBudget === "number",
    JSON.stringify(r.provenance),
  )
  harness.negative("fidelity: the misleading `omittedDanglingLinks` name is gone", !("omittedDanglingLinks" in r.provenance), Object.keys(r.provenance).join(","))
  harness.negative(
    "fidelity: nothing is cut when every node is retained",
    r.provenance.linksOmittedWithNodeCut === 0 && r.provenance.linksOmittedByBudget === 0,
    JSON.stringify(r.provenance),
  )
}

// 2. Truncation
{
  const r = await visualizeProject(projectId, { scope: "project", maxNodes: 2, maxLinks: 2 })
  harness.check("truncation: nodes bounded", r.nodes.length <= 2, String(r.nodes.length))
  harness.check("truncation: links bounded", r.links.length <= 2, String(r.links.length))
  harness.check("truncation: truncated=true", r.truncation.truncated === true)
  harness.check("truncation: reason=output limits", r.truncation.reason === "output limits", r.truncation.reason ?? "null")
  harness.check("truncation: orig>=shown", r.truncation.originalNodes >= r.nodes.length, String(r.truncation.originalNodes))
}

// 3. No truncation when budget exceeds
{
  const r = await visualizeProject(projectId, { scope: "project", maxNodes: 1000, maxLinks: 10000 })
  harness.check("truncation: not truncated with large budget", r.truncation.truncated === false)
  harness.negative("truncation: never truncated when budget sufficient", r.truncation.truncated === false, String(r.truncation.truncated))
}

// 4. Scopes
{
  const api = await visualizeProject(projectId, { scope: "module", target: "src/api", maxNodes: 100 })
  const fp = (n: any) => n.filePath ?? n.file ?? "?"
  harness.check("scope: module -> src/api", api.nodes.length > 0 && api.nodes.every((n: any) => fp(n).includes("src/api")), [...new Set(api.nodes.map(fp))].join(","))

  const sym = await visualizeProject(projectId, { scope: "symbol", target: "parse", maxNodes: 100 })
  harness.check("scope: symbol -> parse", sym.nodes.some((n: any) => n.name === "parse"), sym.nodes.map((n: any) => n.name).join(","))

  const feat = await visualizeProject(projectId, { scope: "feature", target: "unused", maxNodes: 100 })
  harness.check("scope: feature runs", Array.isArray(feat.nodes), String(feat.nodes.length))

  const file = await visualizeProject(projectId, { scope: "file", target: "src/core/engine.ts", maxNodes: 100 })
  harness.check("scope: file -> engine.ts", file.nodes.length > 0 && file.nodes.every((n: any) => fp(n).includes("engine.ts")), [...new Set(file.nodes.map(fp))].join(","))
}

// 5. F9 — the node cut and the budget cut are reported as what they are
{
  const nodeCut = await visualizeProject(projectId, { scope: "project", maxNodes: 2, maxLinks: 5000, format: "json" })
  harness.check("node cut: the loss is attributed to the node cut", nodeCut.provenance.linksOmittedWithNodeCut > 0, JSON.stringify(nodeCut.provenance))
  harness.negative(
    "node cut: `maxLinks` cut nothing, so the set is NOT reported truncated by it",
    nodeCut.considered.relationshipSetTruncated === false,
    `truncated=${nodeCut.considered.relationshipSetTruncated} budget=${nodeCut.provenance.linksOmittedByBudget} maxLinks=5000`,
  )
  const budgetCut = await visualizeProject(projectId, { scope: "project", maxNodes: 100, maxLinks: 1, format: "json" })
  harness.check(
    "budget cut: a link budget below the edge set IS reported as a relationship cut",
    budgetCut.provenance.linksOmittedByBudget > 0 && budgetCut.considered.relationshipSetTruncated === true,
    JSON.stringify({ provenance: budgetCut.provenance, truncated: budgetCut.considered.relationshipSetTruncated }),
  )
  harness.negative(
    "budget cut: the two counters are not the same number",
    budgetCut.provenance.linksOmittedWithNodeCut !== budgetCut.provenance.linksOmittedByBudget,
    JSON.stringify(budgetCut.provenance),
  )
  // The TEXT format said "then cut by maxLinks" for the node cut. A reader checking the
  // arithmetic was told the wrong event by the only reply they asked for.
  const textCut = formatVisualization(await visualizeProject(projectId, { scope: "project", maxNodes: 2, maxLinks: 5000, format: "text" }))
  harness.negative("node cut: the text does not blame maxLinks for the node cut", !textCut.includes("then cut by maxLinks"), textCut.split("\n").find((l) => l.startsWith("edges:")) ?? "")
  harness.check("node cut: the text names the cut it made", textCut.includes("attached only to nodes the node cut removed"), textCut.split("\n").find((l) => l.startsWith("edges:")) ?? "")
  harness.check("node cut: the text provenance line names both counters", textCut.includes("links-omitted-by-node-cut=") && textCut.includes("links-omitted-by-budget="), textCut.split("\n").reverse().find((l) => l.startsWith("provenance:")) ?? "")
  const textBudget = formatVisualization(await visualizeProject(projectId, { scope: "project", maxNodes: 100, maxLinks: 1, format: "text" }))
  harness.check("budget cut: the text says maxLinks did it, with the count", /then cut by maxLinks \(\d+ withdrawn\)/.test(textBudget), textBudget.split("\n").find((l) => l.startsWith("edges:")) ?? "")
}

rmSync(root, { recursive: true, force: true })
harness.emit()
