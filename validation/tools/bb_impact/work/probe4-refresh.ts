// Compare refresh semantics arms on a private index: default repair vs refresh:false.
import { mkdirSync, writeFileSync, utimesSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const FIXTURES = path.join(ROOT, "validation/tools/bb_impact/work/fixtures")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

const dir = path.join(FIXTURES, "refresh")
const files: Record<string, string> = {
  "src/a.ts": "export function leaf(): number { return 1 }\nexport function other(): void { leaf() }\n",
  "src/b.ts": "import { leaf } from \"./a\"\nexport function b1(): void { leaf() }\n",
}
for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(dir, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}
const pid = getProjectId(dir)
await indexProjectParallel(pid, dir, {})
const h: any = createToolHandlers()
const ctx: any = { projectPath: dir, projectId: pid }
const call = async (args: Record<string, unknown>) => {
  const r = await h.bb_impact(args, ctx)
  const text = String(r.content[0].text)
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch { /* error text */ }
  return { isError: r.isError === true, text, parsed }
}
const show = (label: string, r: any) => console.log(JSON.stringify({
  label, isError: r.isError, autoRefresh: r.parsed?.autoRefresh ?? null,
  shown: r.parsed?.shownCount, total: r.parsed?.totalCountIfKnown, truncated: r.parsed?.truncated,
  freshness: r.parsed?.freshness && { fresh: r.parsed.freshness.fresh, stale: r.parsed.freshness.stale, missing: r.parsed.freshness.missing },
  freshAfter: r.parsed ? undefined : r.text.slice(0, 120),
}))

// 1. clean index, both arms
show("clean-default", await call({ symbol: "leaf" }))
show("clean-optout", await call({ symbol: "leaf", refresh: false }))

// 2. make the index stale: a file whose CONTENT changed (auto-refresh repairs modified files)
const target = path.join(dir, "src", "b.ts")
writeFileSync(target, files["src/b.ts"] + "export function b2(): void { leaf() }\n")
const future = new Date(Date.now() + 5000)
utimesSync(target, future, future)
show("stale-default", await call({ symbol: "leaf" }))
show("stale-after-default", await call({ symbol: "leaf" }))

// 3. stale again, ask for refresh:false
writeFileSync(target, files["src/b.ts"] + "export function b2(): void { leaf() }\nexport function b3(): void { leaf() }\n")
utimesSync(target, future, future)
show("stale-optout", await call({ symbol: "leaf", refresh: false }))
show("stale-optout-again", await call({ symbol: "leaf" }))
