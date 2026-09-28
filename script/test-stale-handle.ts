// test-stale-handle.ts — prove the in-place force-reindex fix: a connected
// MCP server sees externally reindexed data WITHOUT any restart.
//   bun run script/test-stale-handle.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { spawnSync } from "child_process"
import { writeFileSync, rmSync, statSync } from "fs"
import path from "path"
import { getProjectId } from "../src/cli/index"
import { BrainDatabase } from "../src/brain/database"

const project = "$HOME/mcp/backbencher-brain"
const dataDir = path.join(project, ".bb-data")
const pid = getProjectId(project)
const dbPath = BrainDatabase.getDbPath(pid)

// 1. spawn a fresh compiled server
const transport = new StdioClientTransport({
  command: "node",
  args: [path.join(project, "bin", "bb"), "mcp", "--dir", project],
  cwd: project,
  env: { ...process.env, BB_DATA_DIR: dataDir },
  stderr: "pipe",
})
const client = new Client({ name: "stale-test", version: "1.0.0" })
await client.connect(transport)

const health = async (): Promise<string> => {
  const r: any = await client.callTool({ name: "bb_health", arguments: {} })
  return (r.content ?? []).map((c: any) => c.text ?? "").join("\n")
}
const search = async (q: string): Promise<string> => {
  const r: any = await client.callTool({ name: "bb_search", arguments: { query: q, limit: 3 } })
  return (r.content ?? []).map((c: any) => c.text ?? "").join("\n")
}

const inoBefore = statSync(dbPath).ino
console.log("server connected. inode before:", inoBefore)
console.log("health before:", (await health()).replace("\n", " | "))

// 2. external change + in-place --force reindex from a SEPARATE process
const scratch = path.join(project, "bb-tooltest-marker.ts")
writeFileSync(scratch, "export function zzzAutoRefreshMarker(): string {\n  return \"marker\"\n}\n")
const res = spawnSync("node", [path.join(project, "bin", "bb"), "index", "--force", project], {
  cwd: project,
  env: { ...process.env, BB_DATA_DIR: dataDir },
  stdio: "pipe",
})
console.log("external reindex exit:", res.status)

const inoAfter = statSync(dbPath).ino
console.log("inode after:", inoAfter)

// 3. same server connection, no restart — can it see the marker?
const found = await search("zzzAutoRefreshMarker")
console.log("search 'zzzAutoRefreshMarker' via SAME server:", found.slice(0, 200))
console.log("health after:", (await health()).replace("\n", " | "))

rmSync(scratch, { force: true })
await client.close()

const inodeStable = inoBefore === inoAfter
const markerFound = found.includes("zzzAutoRefreshMarker")
console.log(`\ninode stable: ${inodeStable} | marker visible without restart: ${markerFound}`)
console.log(inodeStable && markerFound ? "STALE-HANDLE FIX: PASS" : "STALE-HANDLE FIX: FAIL")
process.exit(inodeStable && markerFound ? 0 : 1)
