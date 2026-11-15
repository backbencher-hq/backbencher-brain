// `file` hint contract: resolves an ambiguous member through its owning
// declaration; refuses (with teaching) a hint that cannot identify the symbol.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const { getProjectId } = await import(path.join(ROOT, "src/util/project-id.ts"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

const dir = path.join(ROOT, "validation/tools/bb_impact/work/fixtures/hint")
const files: Record<string, string> = {
  "src/one.ts": "export class Alpha {\n  constructor() {}\n  run(): void {}\n}\nexport function callOne(): void { new Alpha().run() }\n",
  "src/two.ts": "export class Beta {\n  constructor() {}\n  run(): void {}\n}\nexport function callTwo(): void { new Beta().run() }\n",
}
for (const [rel, content] of Object.entries(files)) {
  const abs = path.join(dir, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}
const pid = getProjectId(dir)
await indexProjectParallel(pid, dir, {})
const h: any = createToolHandlers()
const ctx = { projectPath: dir, projectId: pid }
const call = async (args: Record<string, unknown>) => {
  const r = await h.bb_impact(args, ctx)
  const text = String(r.content[0].text)
  let p: any = null
  try { p = JSON.parse(text) } catch { /* error text */ }
  return { isError: r.isError === true, text: String(text).replace(/\s+/g, " ").slice(0, 300), p }
}
const cases: Array<[string, Record<string, unknown>]> = [
  ["alpha-no-hint", { symbol: "Alpha" }],
  ["alpha-hint-one", { symbol: "Alpha", file: "src/one.ts" }],
  ["alpha-hint-suffix", { symbol: "Alpha", file: "one.ts" }],
  ["alpha-hint-wrong", { symbol: "Alpha", file: "src/two.ts" }],
  ["alpha-hint-unknown-path", { symbol: "Alpha", file: "src/nope.ts" }],
  ["constructor-no-hint", { symbol: "constructor" }],
  ["constructor-hint-two", { symbol: "constructor", file: "src/two.ts" }],
  ["constructor-hint-one", { symbol: "constructor", file: "src/one.ts" }],
  ["run-no-hint", { symbol: "run" }],
  ["run-hint-two", { symbol: "run", file: "src/two.ts" }],
]
for (const [label, args] of cases) {
  const r = await call(args)
  console.log(JSON.stringify({
    label, args,
    isError: r.isError,
    error: r.isError ? r.text : undefined,
    shown: r.p?.shownCount,
    root: r.p?.root?.name,
    rootFile: r.p?.root?.file,
    rootMatch: r.p?.rootMatch,
    resolution: r.p?.resolution,
    deps: r.p?.impact?.map((d: any) => `${d.name}@${d.file}`),
  }))
}
