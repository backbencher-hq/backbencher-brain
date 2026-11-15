// Public-door read/write proof: one MCP stdio bb_migrate call against a pristine index copy.
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs"
import path from "node:path"
import { openDoor } from "./door"
import { getProjectId } from "../../../src/cli/index"
import { BrainDatabase } from "../../../src/brain/database"
const getProjectIdOf = (dir: string) => getProjectId(dir)
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const WORK = path.join(ROOT, "validation/tools/bb_migrate/work/door-write-probe3")
const FIXTURE = path.join(WORK, "fixture")
const DATA = WORK
const projectId = getProjectIdOf(FIXTURE)
const dbPath = path.join(DATA, "projects", projectId, "brain.db")
const sha = (p: string) => existsSync(p) ? createHash("sha256").update(readFileSync(p)).digest("hex") : null
const state = () => Object.fromEntries(["", "-wal", "-shm"].map((s) => { const p = dbPath + s; return [s || "db", existsSync(p) ? { size: statSync(p).size, mtimeMs: Math.round(statSync(p).mtimeMs) } : null] }))
// settle the index first (rw open + checkpoint), then baseline a db-only state
const settle = await BrainDatabase.getRawInstance(projectId)
try { settle.exec("PRAGMA wal_checkpoint(TRUNCATE)") } catch {}
try { settle.close() } catch {}
const before = { files: state(), sha256: sha(dbPath) }
const door = await openDoor({ dir: FIXTURE, dataDir: DATA, label: "write-probe" })
const r = await door.callTool({ symbolNames: ["basePrice"], targetLanguage: "python", format: "json" }, 120_000)
const during = { files: state(), sha256: sha(dbPath) }
await door.close()
await new Promise((resolve) => setTimeout(resolve, 500))
const after = { files: state(), sha256: sha(dbPath) }
const out = { call: { isError: r.isError, ms: r.ms }, before, during, after, walAppeared: before.files["-wal"] === null && during.files["-wal"] !== null, dbBytesChanged: before.sha256 !== after.sha256 }
console.log(JSON.stringify(out, null, 1))
writeFileSync(path.join(ROOT, "validation/tools/bb_migrate/raw/door-write-probe.json"), JSON.stringify(out, null, 1))
