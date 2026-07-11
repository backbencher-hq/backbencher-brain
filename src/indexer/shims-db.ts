import { openDatabase } from "../database.js"
import { loadProjectIndex } from "../database.js"

const instances = new Map<string, any>()

export const BrainDatabase = {
  async getInstance(projectId: string): Promise<any> {
    if (!instances.has(projectId)) {
      const index = loadProjectIndex()
      const entry = index[projectId]
      if (!entry) throw new Error(`Project not found: ${projectId}`)
      const db = openDatabase(entry.path)

      const mockDb = {
        select() { return this },
        from() { return this },
        innerJoin() { return this },
        where() { return this },
        orderBy() { return this },
        limit() { return this },
        offset() { return this },
        all() { return [] },
        get() { return null },
        run() {},
        db: db.db,
      }
      instances.set(projectId, mockDb)
    }
    return instances.get(projectId)
  },

  async getRawInstance(projectId: string): Promise<any> {
    const index = loadProjectIndex()
    const entry = index[projectId]
    if (!entry) throw new Error(`Project not found: ${projectId}`)
    const db = openDatabase(entry.path)
    return db.db
  },

  async getStats(projectId: string) {
    try {
      const db = await this.getRawInstance(projectId)
      const files = (db.prepare("SELECT count(*) as c FROM brain_file WHERE project_hash = ?").get(projectId) as any)?.c || 0
      const symbols = (db.prepare("SELECT count(*) as c FROM brain_symbol WHERE project_hash = ?").get(projectId) as any)?.c || 0
      const relationships = (db.prepare("SELECT count(*) as c FROM brain_relationship WHERE project_hash = ?").get(projectId) as any)?.c || 0
      return { symbols, files, relationships, imports: 0 }
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
