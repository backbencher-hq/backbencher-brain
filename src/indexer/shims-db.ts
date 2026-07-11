import { openDatabase, loadProjectIndex } from "../database.js"
import type Database from "better-sqlite3"

const instances = new Map<string, any>()

// Drizzle-compatible query builder mock
function createDbWrapper(rawDb: Database.Database) {
  // Chainable query builder that mimics Drizzle ORM
  const chain = (obj: any = {}) => new Proxy(obj, {
    get(target, prop) {
      if (prop === 'all') return () => {
        if (target._exec) return target._exec()
        return []
      }
      if (prop === 'get') return () => null
      if (prop === 'run') return (...args: any[]) => {
        if (target._sql) rawDb.prepare(target._sql).run(...args)
      }
      // Return a new chain for any property
      return chain({ ...target, _lastCall: prop })
    }
  })
  
  return chain({ db: rawDb })
}

function createDrizzleDb(rawDb: Database.Database) {
  return {
    select: (..._cols: any[]) => ({
      from: (_table: any) => ({
        innerJoin: (_other: any, _on: any) => ({
          where: (_where: any) => ({
            orderBy: (..._order: any[]) => ({
              limit: (n: number) => ({
                offset: (o: number) => ({ all: () => [] }),
                all: () => [],
              }),
              all: () => [],
            }),
            all: () => [],
          }),
          all: () => [],
        }),
        where: (_where: any) => ({
          orderBy: (..._order: any[]) => ({
            limit: (n: number) => ({ all: () => [] }),
            all: () => [],
          }),
          all: () => [],
        }),
        all: () => [],
      }),
    }),
    run: (sql: string, ...params: any[]) => rawDb.prepare(sql).run(...params),
    all: (sql: string, ...params: any[]) => rawDb.prepare(sql).all(...params),
    get: (sql: string, ...params: any[]) => rawDb.prepare(sql).get(...params),
    db: rawDb,
  }
}

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
