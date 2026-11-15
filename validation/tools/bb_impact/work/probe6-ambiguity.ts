// Ambiguous-name behavior + whether the MCP door can disambiguate like the editor twin.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
const dir = path.join(ROOT, "validation/tools/bb_impact/work/fixtures/ambiguous")
const files: Record<string, string> = {
  "src/one.ts": "export function dup(): number { return 1 }\nexport function callerOne(): void { dup() }\n",
  "src/two.ts": "export function dup(): number { return 2 }\nexport function callerTwo(): void { dup() }\n",
}
for (const [rel, content] of Object.entries(files)) { const abs = path.join(dir, rel); mkdirSync(path.dirname(abs), { recursive: true }); writeFileSync(abs, content) }
const pid = getProjectId(dir)
await indexProjectParallel(pid, dir, {})
const h: any = createToolHandlers()
const ctx = { projectPath: dir, projectId: pid }
for (const args of [{ symbol: "dup" }, { symbol: "dup", file: "src/one.ts" }, { target: "dup" }] as any[]) {
  const r = await h.bb_impact(args, ctx)
  const text = String(r.content[0].text)
  let p: any = null; try { p = JSON.parse(text) } catch { /* error */ }
  console.log(JSON.stringify({ args, isError: r.isError === true, errorText: p ? undefined : text.slice(0, 200), shown: p?.shownCount, rootMatch: p?.rootMatch, rootFile: p?.root?.file, deps: p?.impact?.map((d: any) => `${d.name}@${d.file}`) }))
}
