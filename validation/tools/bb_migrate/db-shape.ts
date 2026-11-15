// Population + schema shape of one index, read through the byte-read-only open.
import path from "node:path"
import { getProjectId } from "../../../src/cli/index"
import { BrainDatabase } from "../../../src/brain/database"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const dir = process.argv[2] ? path.resolve(process.argv[2]) : ROOT
const projectId = getProjectId(dir)
const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })
const one = (sql: string, ...params: any[]) => raw.prepare(sql).get(...params) as any
const count = (table: string) => Number(one(`SELECT COUNT(*) c FROM ${table} WHERE project_id = ?`, projectId)?.c ?? 0)
console.log(JSON.stringify({
  dir, projectId,
  files: count("brain_file"), symbols: count("brain_symbol"), relationships: count("brain_relationship"),
  hasStat1: !!one("SELECT name FROM sqlite_master WHERE name='sqlite_stat1'"),
  tables: Number(one("SELECT COUNT(*) c FROM sqlite_master WHERE type='table'")?.c ?? 0),
}, (_, v) => typeof v === "bigint" ? Number(v) : v))
