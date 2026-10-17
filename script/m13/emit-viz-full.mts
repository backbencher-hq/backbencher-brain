// Same as emit-viz-preview.mts, but raises the node budget so the map is not cut at 200
// symbols. The default budget is the reason a whole-tree graph still looks capped:
// src/ holds 11k+ indexed symbols and the shipped default shows 200 of them.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"

const TARGET = path.resolve(process.argv[2] ?? "src")
const BUDGET = Number(process.argv[3] ?? 2000)
const OUT = path.resolve(process.argv[4] ?? "validation/m13/results/viz-redesign-src")
mkdirSync(OUT, { recursive: true })

const projectId = getProjectId(TARGET)
const t0 = Date.now()
await indexProjectParallel(projectId, TARGET, {})
console.log(`indexed ${TARGET} in ${Date.now() - t0}ms`)

const handlers = createToolHandlers() as any
const call = async (args: Record<string, unknown>): Promise<string> =>
  (await handlers.bb_visualize({ scope: "project", view: "graph", format: "html", ...args }, { projectPath: TARGET, projectId })).content[0].text as string
const slotOf = (studio: string, slot: string): string => {
  const m = studio.match(/<script id="bb-studio-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error("the composed page carries no slot payload")
  return (JSON.parse(m[1]) as Record<string, string>)[slot] ?? ""
}

const graph = await call({ layout: "regions", maxNodes: BUDGET })
writeFileSync(path.join(OUT, "preview-graph-full.html"), graph)
writeFileSync(path.join(OUT, "preview-graph-full-raw.html"), slotOf(graph, "graph"))
console.log(`wrote graph at maxNodes=${BUDGET}`)

// The default budget too, from the same index: the legibility of the map at 200 nodes is a
// different picture from its legibility at 2,000, and the default is what a reader sees.
const graphDefault = await call({})
writeFileSync(path.join(OUT, "preview-graph.html"), graphDefault)
writeFileSync(path.join(OUT, "preview-graph-raw.html"), slotOf(graphDefault, "graph"))
console.log("wrote graph at the default budget")
