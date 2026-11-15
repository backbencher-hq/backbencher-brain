// Which bb_search read operations still move the index DB/WAL?
// Same process, same DB, hash after each operation so the first writer is named.
import { createHash } from "node:crypto"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
import { searchSymbols } from "../../../../src/intelligence/search/symbol-search"
import { searchContent } from "../../../../src/intelligence/search/content-search"
import { searchRegex } from "../../../../src/intelligence/search/regex-search"
import { ASTEngine } from "../../../../src/ast/engine"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const projectDir = path.join(repoRoot, process.argv[2]!)
const pid = getProjectId(projectDir) as any
const dbPath = BrainDatabase.getDbPath(pid)
const hash = (file: string): string => (existsSync(file) ? createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16) : "absent")
const snap = () => ({ db: hash(dbPath), wal: hash(dbPath + "-wal"), shm: hash(dbPath + "-shm") })
const rows: Array<{ step: string; state: ReturnType<typeof snap>; changed: boolean }> = []
let previous = snap()
const record = (step: string) => {
  const current = snap()
  rows.push({ step, state: current, changed: JSON.stringify(current) !== JSON.stringify(previous) })
  previous = current
}
record("baseline (after first index)")
await searchSymbols(pid, "walHost")
record("searchSymbols (symbols mode)")
await searchContent(pid, "walHost")
record("searchContent (content mode)")
await searchRegex(pid, "^walHost$")
record("searchRegex (regex option)")
await ASTEngine.findSymbol(pid, "walHost")
record("ASTEngine.findSymbol (symbol mode)")
const { createToolHandlers } = await import("../../../../src/mcp/tool-handlers")
const handler = createToolHandlers().bb_search as any
const ctx = { projectId: pid, projectPath: projectDir }
await handler({ mode: "file", filePath: "src/a.ts" }, ctx)
record("handler file mode")
await handler({ query: "walHost" }, ctx)
record("handler symbols mode")
await handler({ query: "walHost", language: "typescript" }, ctx)
record("handler symbols + language filter (shared describeUnknownFilters)")
console.log(JSON.stringify({ dbPath, rows }, null, 2))
