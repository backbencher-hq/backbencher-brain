import { writeFileSync } from "node:fs"
import path from "node:path"
process.env.BB_DATA_DIR = path.resolve(import.meta.dirname!, "..", "bbdata")
process.env.BB_NO_AUTO_REFRESH = "1"
const { fixtureContext } = await import("./fixture")
const { FIXTURE_DIR, WORK_DIR } = await import("./fixture")
const { createToolHandlers } = await import("../../../../src/mcp/tool-handlers")
const { projectId } = await fixtureContext(FIXTURE_DIR, false)
const handlers = createToolHandlers()
const run = async (args: any) => String(((await handlers.bb_visualize(args, { projectId, projectPath: FIXTURE_DIR } as any)) as any).content[0].text)
const html = await run({ format: "html", maxNodes: 60 })
writeFileSync(path.join(WORK_DIR, "sample-regions.html"), html)
writeFileSync(path.join(WORK_DIR, "sample-force.html"), await run({ format: "html", maxNodes: 60, layout: "force" }))
const json = JSON.parse(await run({ format: "json", maxNodes: 60 }))
const check = (label: string, value: boolean | number | string) => console.log(`${label}: ${value}`)
check("html bytes", html.length)
check("doctypes", (html.match(/<!DOCTYPE html>/gi) ?? []).length)
for (const marker of ["data-bb-layout", "totalNodesAvailable", "truncation", "freshness", "stale", "bb-studio-data", "bb-graph-data"]) check(`contains ${marker}`, html.includes(marker))
check("external url", /(?:src|href)\s*=\s*["']https?:\/\//.test(html))
check("http string count", (html.match(/https?:\/\//g) ?? []).length)
check("json nodes", json.nodes.length)
// Extract embedded graph payloads
const outer = /<script id="bb-studio-data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
check("outer payload found", !!outer)
if (outer) {
  const doc = JSON.parse(outer[1])
  check("outer keys", Object.keys(doc).join(","))
  const inner = doc.graph as string
  check("inner length", inner.length)
  check("inner layout", /data-bb-layout="([a-z]+)"/.exec(inner)?.[1] ?? "none")
  const payload = /<script id="bb-graph-data" type="application\/json">([\s\S]*?)<\/script>/.exec(inner)
  check("inner payload found", !!payload)
  if (payload) {
    const graph = JSON.parse(payload[1].replace(/\\u003c/g, "<"))
    check("payload nodes", graph.nodes.length)
    check("payload links", graph.links.length)
    check("payload == json answer node ids", JSON.stringify(graph.nodes.map((n: any) => n.id).sort()) === JSON.stringify(json.nodes.map((n: any) => n.id).sort()))
    check("payload keys", Object.keys(graph).join(","))
  }
}
