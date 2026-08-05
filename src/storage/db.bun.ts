// Bun driver for brain-core. Mirrors the better-sqlite3 surface so the
// rest of the core is runtime-agnostic.
import { Database } from "bun:sqlite"

export interface CoreStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

export interface CoreDatabase {
  /** Original driver instance (bun:sqlite / better-sqlite3) for drizzle adapters. */
  native: Database
  prepare(sql: string): CoreStatement
  exec(sql: string): void
  close(): void
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  readonly: boolean
}

export function openDatabase(path: string, options: { readonly?: boolean } = {}): CoreDatabase {
  // bun:sqlite throws SQLITE_MISUSE when readonly:false is passed explicitly.
  const db = options.readonly ? new Database(path, { readonly: true }) : new Database(path)
  return {
    native: db,
    prepare(sql: string): CoreStatement {
      const stmt = db.prepare(sql)
      return {
        get: (...params) => stmt.get(...(params as never[])) as unknown,
        all: (...params) => stmt.all(...(params as never[])) as unknown[],
        run: (...params) => {
          const r = stmt.run(...(params as never[]))
          return { changes: Number(r.changes ?? 0), lastInsertRowid: r.lastInsertRowid ?? 0 }
        },
      }
    },
    exec(sql: string) {
      db.exec(sql)
    },
    close() {
      db.close()
    },
    transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T {
      const run = db.transaction(fn)
      return (...args: any[]) => run(...args)
    },
    run(sql: string, ...params: unknown[]) {
      const r = db.prepare(sql).run(...(params as never[]))
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) }
    },
    readonly: options.readonly ?? false,
  }
}
