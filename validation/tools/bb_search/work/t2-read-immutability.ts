// Does a bb_search read move the reference index DB/WAL? Start/end DB hash plus a
// per-step WAL hash, driven through the engines and the real handler (no MCP
// server process, so the shared server index-gate open cannot mask the answer).
import { createHash } from "node:crypto"
import { createReadStream, existsSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { getProjectId } from "../../../../src/cli/index"
import { BrainDatabase } from "../../../../src/brain/database"
import { searchSymbols } from "../../../../src/intelligence/search/symbol-search"
import { searchContent } from "../../../../src/intelligence/search/content-search"
import { searchRegex } from "../../../../src/intelligence/search/regex-search"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")
const projectDir = path.join(repoRoot, process.argv[2] ?? ".")
const pid = getProjectId(projectDir) as any
const dbPath = BrainDatabase.getDbPath(pid)
const hash = async (file: string): Promise<string> => {
  if (!existsSync(file)) return "absent"
  const digest = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on("data", (chunk) => digest.update(chunk))
      .on("end", () => resolve())
      .on("error", reject)
  })
  return digest.digest("hex").slice(0, 16)
}
const stats = (file: string) => (existsSync(file) ? `${statSync(file).size}:${statSync(file).mtimeMs}` : "absent")
const dbBefore = await hash(dbPath)
const rows: Array<{ step: string; wal: string; walStats: string; db: string }> = []
const record = async (step: string) => rows.push({ step, wal: await hash(dbPath + "-wal"), walStats: stats(dbPath + "-wal"), db: await hash(dbPath) })

await record("baseline")
await searchSymbols(pid, "handleRequest")
await record("searchSymbols")
await searchContent(pid, "serialize cache entry")
await record("searchContent")
await searchRegex(pid, "^getProjectId$")
await record("searchRegex")
const { createToolHandlers } = await import("../../../../src/mcp/tool-handlers")
const handler = createToolHandlers().bb_search as any
const ctx = { projectId: pid, projectPath: projectDir }
await handler({ mode: "file", filePath: "src/mcp/server.ts" }, ctx)
await record("handler file mode")
await handler({ query: "handleRequest" }, ctx)
await record("handler symbols mode")
await handler({ mode: "content", query: "serialize cache entry" }, ctx)
await record("handler content mode")
const dbAfter = await hash(dbPath)
const unchanged = rows.every((row) => row.wal === rows[0]!.wal && row.db === dbBefore)
console.log(JSON.stringify({ dbPath, dbBefore, dbAfter, dbUnchanged: dbBefore === dbAfter, walUnchangedEachStep: rows.every((r) => r.wal === rows[0]!.wal), allUnchanged: unchanged, rows }, null, 2))
process.exit(unchanged ? 0 : 1)
