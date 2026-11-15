import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../../..")
const dataDir = mkdtempSync(path.join(tmpdir(), "p3d-data-"))
process.env.BB_DATA_DIR = dataDir
const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
const proj = mkdtempSync(path.join(tmpdir(), "p3d-fixture-"))
mkdirSync(path.join(proj, "src"), { recursive: true })
writeFileSync(path.join(proj, "src", "a.ts"), `export function leaf(): number { return 1 }\nexport class Service {\n  run(): void { leaf() }\n}\nexport function alpha(): void { leaf() }\n`)
writeFileSync(path.join(proj, "src", "b.ts"), `import { leaf, alpha } from "./a"\nexport function b1(): void { leaf() }\nexport function b2(): void { alpha() }\n`)
writeFileSync(path.join(proj, "src", "c.ts"), `import { b1 } from "./b"\nexport function c1(): void { b1() }\n`)
writeFileSync(path.join(proj, "src", "d.ts"), `import { c1 } from "./c"\nexport function d1(): void { c1() }\n`)
const pid = getProjectId(proj)
await indexProjectParallel(pid, proj, {})
const h = createToolHandlers() as any
const ctx = { projectPath: proj, projectId: pid }
const g = await h.bb_graph({ symbol: "leaf" }, ctx)
const a = await h.bb_analyze({ mode: "callers", target: "leaf" }, ctx)
const gp = JSON.parse(g.content[0].text), ap = JSON.parse(a.content[0].text)
const pick = (x: any) => ({ truncated: x?.truncated ?? null, reason: x?.truncationReason ?? null, totalCallers: x?.totalCallers ?? null, returnedCallers: x?.returnedCallers ?? null, maxDepthReached: x?.maxDepthReached ?? null, callerBudgetExhausted: x?.callerBudgetExhausted ?? null, cappedQueries: x?.cappedQueries ?? null })
console.log("P3-DIAGNOSE " + JSON.stringify({ graph: pick(gp.summary), analyze: pick(ap.summary) }))
