// Emit real bb_visualize documents from a real directory of this repository, so the
// delivered artifact can be looked at (and driven) outside a test fixture.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { createToolHandlers } from "../../src/mcp/tool-handlers"

const TARGET = process.argv[2] ?? path.join(process.cwd(), "src", "ast", "visualization")
// The output directory is a parameter because the payload size is the point: the
// default target above is two files, which is what makes the labels readable in a
// screenshot and also what makes the picture look like nothing at all. Point this at
// src/ or the repository root to see the map at the scale the tool actually runs at.
const OUT = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(process.cwd(), "validation", "m13", "results", "viz-redesign-final")
mkdirSync(OUT, { recursive: true })

const projectId = getProjectId(TARGET)
const t0 = Date.now()
await indexProjectParallel(projectId, TARGET, {})
console.log(`indexed ${TARGET} in ${Date.now() - t0}ms`)

const handlers = createToolHandlers() as any
const ctx = { projectPath: TARGET, projectId }
const call = async (args: Record<string, unknown>): Promise<string> =>
  (await handlers.bb_visualize({ scope: "project", view: "graph", format: "html", ...args }, ctx)).content[0].text as string

/** One slot out of the composed page: the document a reader sees inside the studio frame. */
const slotOf = (studio: string, slot: string): string => {
  const m = studio.match(/<script id="bb-studio-data" type="application\/json">([\s\S]*?)<\/script>/)
  if (!m) throw new Error("the composed page carries no slot payload")
  return (JSON.parse(m[1]) as Record<string, string>)[slot] ?? ""
}

const graph = await call({ layout: "regions" })
writeFileSync(path.join(OUT, "preview-graph-regions.html"), graph)
writeFileSync(path.join(OUT, "preview-graph-raw.html"), slotOf(graph, "graph"))
const force = await call({ layout: "force" })
writeFileSync(path.join(OUT, "preview-graph-force.html"), force)
writeFileSync(path.join(OUT, "preview-graph-force-raw.html"), slotOf(force, "graph"))
console.log(`wrote composed + raw graph documents (regions/force) to ${path.relative(process.cwd(), OUT)}`)
