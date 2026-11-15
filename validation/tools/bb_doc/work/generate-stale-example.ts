import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import path from "node:path"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"
import { getProjectId } from "../../../../src/util/project-id"
import { indexProjectParallel } from "../../../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../../../src/brain/database"
const REPO = path.resolve(import.meta.dirname, "../../../..")
const root = mkdtempSync(path.join(REPO, "validation/tools/bb_doc/work", "stale-example-"))
mkdirSync(path.join(root, "src"))
writeFileSync(path.join(root, "src", "math.ts"), "/** Adds two numbers. */\nexport function add(a: number, b: number): number { return a + b }\n")
const pid = getProjectId(root)
await indexProjectParallel(pid, root, {})
writeFileSync(path.join(root, "src", "math.ts"), "// edited after indexing\n/** Adds two numbers. */\nexport function add(a: number, b: number): number { return a + b }\n")
const h = createToolHandlers().bb_doc
const ctx = { projectPath: root, projectId: pid } as any
const json = await h({ mode: "symbol", target: "add", format: "json", refresh: false } as any, ctx) as any
const md = await h({ mode: "symbol", target: "add", refresh: false } as any, ctx) as any
console.log("===STALE-JSON===\n" + JSON.stringify({ freshness: JSON.parse(json.content[0].text).freshness, autoRefresh: JSON.parse(json.content[0].text).autoRefresh, references: JSON.parse(json.content[0].text).quality.references, budget: JSON.parse(json.content[0].text).quality.budget }, null, 2))
console.log("===STALE-MD-FOOTER===")
const lines = String(md.content[0].text).split("\n")
console.log(lines.slice(-4).join("\n"))
console.log("===FILE-MODE-ENVELOPE===")
const fileJson = await h({ mode: "file", target: "src/math.ts", format: "json", refresh: false } as any, ctx) as any
console.log(JSON.stringify(JSON.parse(fileJson.content[0].text).freshness, null, 2))
rmSync(path.join(path.dirname(BrainDatabase.getDbPath(pid))), { recursive: true, force: true })
rmSync(root, { recursive: true, force: true })
