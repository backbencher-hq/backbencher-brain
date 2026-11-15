// Phase A unindexed-project probe: calls the SOURCE handler directly on a project
// the indexer has never run over, with a scratch data dir, and records whether a
// database is created and what the answer says. The MCP door refuses this case;
// this probe asks what the library/CLI door does underneath it.
//
// Usage: BB_DATA_DIR=<scratch> npx tsx unindexed-read.mts <out.json>
import { existsSync, readdirSync, statSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../../../src/util/project-id"
import { BrainDatabase } from "../../../../src/brain/database"
import { createToolHandlers } from "../../../../src/mcp/tool-handlers"

const outPath = process.argv[2]!
if (!outPath) { console.error("usage: unindexed-read.mts <out.json>"); process.exit(2) }
const dataDir = process.env.BB_DATA_DIR
if (!dataDir) { console.error("BB_DATA_DIR is required (a scratch dir)"); process.exit(2) }
const projectDir = mkdtempSync(path.join(tmpdir(), "bb-patterns-unindexed-"))
const projectId = getProjectId(projectDir)
const dbPath = BrainDatabase.getDbPath(projectId)
const handler = createToolHandlers().bb_patterns
const before = { dbExists: existsSync(dbPath), dataDirEntries: existsSync(path.dirname(path.dirname(dbPath))) ? readdirSync(path.dirname(path.dirname(dbPath))).length : 0 }
const result: any = await handler({} as any, { projectId, projectPath: projectDir } as any)
const text = (result?.content ?? []).map((c: any) => c.text ?? "").join("\n")
const dbExistsAfter = existsSync(dbPath)
const report = {
  door: "source handler (library/CLI path) on an unindexed project",
  projectDir, projectId, dbPath, dataDir,
  before, result: { isError: result?.isError === true, text, chars: text.length },
  after: { dbExists: dbExistsAfter, dbBytes: dbExistsAfter ? statSync(dbPath).size : null },
  createdIndexOnRead: !dbExistsAfter ? false : !before.dbExists,
  honestRefusal: result?.isError === true,
  generatedAt: new Date().toISOString(),
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify(report, null, 1))
