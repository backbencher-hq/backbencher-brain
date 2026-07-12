import { openDatabase, loadProjectIndex } from "../database.js"
import type Database from "better-sqlite3"
import { createDrizzleDb } from "./drizzle-mock.js"

const instances = new Map<string, any>()

export const BrainDatabase = {
  async getInstance(projectId: string): Promise<any> {
    if (!instances.has(projectId)) {
      const index = loadProjectIndex()
      const entry = index[projectId]
      if (!entry) throw new Error(`Project not found: ${projectId}`)
      const db = openDatabase(entry.path)
      const wrapper = createDrizzleDb(db.db)
      instances.set(projectId, wrapper)
    }
    return instances.get(projectId)
  },

  async getRawInstance(projectId: string): Promise<any> {
    const index = loadProjectIndex()
    const entry = index[projectId]
    if (!entry) throw new Error(`Project not found: ${projectId}`)
    const db = openDatabase(entry.path)
    const raw = db.db as any
    if (!raw.run) raw.run = (sql: string) => raw.exec(sql)
    return raw
  },

  async getStats(projectId: string) {
    try {
      const db = await this.getRawInstance(projectId)
      return {
        files: (db.prepare("SELECT count(*) as c FROM brain_file WHERE project_hash = ?").get(projectId) as any)?.c || 0,
        symbols: (db.prepare("SELECT count(*) as c FROM brain_symbol WHERE project_hash = ?").get(projectId) as any)?.c || 0,
        relationships: (db.prepare("SELECT count(*) as c FROM brain_relationship WHERE project_hash = ?").get(projectId) as any)?.c || 0,
        imports: 0,
      }
    } catch { return { files: 0, symbols: 0, relationships: 0, imports: 0 } }
  },

  async updateIndexStatus(projectId: string, data: any) {
    try {
      const db = await this.getRawInstance(projectId)
      db.prepare("UPDATE index_status SET status = ?, files_indexed = ?, symbols_indexed = ?, last_indexed_at = ? WHERE project_hash = ?")
        .run(data.status || "complete", data.filesIndexed || 0, data.symbolsIndexed || 0, Date.now(), projectId)
    } catch {}
  },
}
