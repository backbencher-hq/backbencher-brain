// script/m61/staleness-probe2.mts — M61.V1 diagnostic (not a gate): the
// decisive experiment for the fork legs' 1/88 live-staleness failure.
//
// Seeds a db EXACTLY like buildFixtureWorkspace (sha1(realpath)[0:40] project
// id, `<projectId>:main.ts` file id, real hash+stat of the file on disk),
// drives the REAL dist server through edit -> stale -> reindex, then dumps
// every brain_file row. Interpretation:
//   - seeded row updated to the new hash  -> reindex updates the row (fixture ok)
//   - a SECOND row appears                -> id-convention divergence (root cause)
//   - seeded row unchanged, no second row -> reindex no longer writes file rows
//
// Run: npx tsx script/m61/staleness-probe2.mts

import { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync, realpathSync, existsSync, mkdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { StdioLsp, ensureServerBuilt } from "../m55/lsp-wire.ts"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const ws = mkdtempSync(path.join(os.tmpdir(), "stal2-ws-"))
const dataDir = mkdtempSync(path.join(os.tmpdir(), "stal2-data-"))
const mainPath = path.join(ws, "main.ts")
const V1 = `export function greet(): string { return "hi" }\nconst x = greet()\n`
writeFileSync(mainPath, V1)

// --- seed exactly like buildFixtureWorkspace ---------------------------------
const canonical = realpathSync.native(ws)
const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
const dbDir = path.join(dataDir, "projects", projectId)
mkdirSync(dbDir, { recursive: true })
process.env.BB_DATA_DIR = dataDir

const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database.ts"))
const { hashFileContent } = await import(path.join(ROOT, "src", "brain", "freshness.ts"))
const raw = await BrainDatabase.getRawInstance(projectId)
const fpath = mainPath
const fileStat = statSync(fpath)
const fileId = `${projectId}:main.ts`
raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash, size_bytes, last_modified) VALUES (?,?,?,?,?,?,?,?)`).run(
  fileId, projectId, fpath, "main.ts", "typescript",
  hashFileContent(readFileSync(fpath)), fileStat.size, Math.floor(fileStat.mtimeMs),
)
raw.close?.()

const dumpRows = (label: string) => {
  const Database = createRequire(import.meta.url)("better-sqlite3")
  const db = new Database(path.join(dbDir, "brain.db"), { readonly: true })
  const rows = db.prepare("SELECT id, path, file_hash, size_bytes, last_modified FROM brain_file").all()
  db.close()
  console.log(`${label}: ${rows.length} brain_file row(s)`)
  for (const r of rows) console.log("   ", JSON.stringify(r))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const serverOverride = process.env.BB61_SERVER
const serverCwd = process.env.BB61_CWD ?? ROOT
const lsp = new StdioLsp(ws, { ...process.env, BB_DATA_DIR: dataDir } as Record<string, string | undefined>, serverOverride ?? undefined, serverCwd)

try {
  ensureServerBuilt()
  await lsp.initialize(ws)
  const uri = "file://" + mainPath
  await lsp.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: 1, text: V1 } })
  await sleep(2500)

  const m0 = await lsp.request("bb/staleness", { uri }, 15000)
  console.log("initial marker:", JSON.stringify(m0.result))
  dumpRows("after open")

  writeFileSync(mainPath, V1 + "const y = greet()\n")
  const deadline = Date.now() + 25000
  let last: any = null
  while (Date.now() < deadline) {
    last = (await lsp.request("bb/staleness", { uri }, 15000)).result
    if (last?.stale === false && last?.status === "fresh") break
    await sleep(600)
  }
  console.log("final marker:", JSON.stringify(last))
  dumpRows("after reindex")
  console.log(last?.stale === false && last?.status === "fresh" ? "VERDICT: FRESH (seeded row updated)" : "VERDICT: STUCK — see rows above")
} finally {
  await lsp.dispose()
  rmSync(ws, { recursive: true, force: true })
  rmSync(dataDir, { recursive: true, force: true })
}
