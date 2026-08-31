// Node driver for brain-core (better-sqlite3). Same surface as db.bun.ts.
import Database from "better-sqlite3"
import type { Database as DatabaseType } from "better-sqlite3"

export interface CoreStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
}

export interface CoreDatabase {
  /** Original driver instance (bun:sqlite / better-sqlite3) for drizzle adapters. */
  native: DatabaseType
  prepare(sql: string): CoreStatement
  exec(sql: string): void
  close(): void
  transaction<T>(fn: (...args: any[]) => T): (...args: any[]) => T
  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  readonly: boolean
}

export function openDatabase(path: string, options: { readonly?: boolean } = {}): CoreDatabase {
  const db = new Database(path, { readonly: options.readonly ?? false })
  // M21.D2: explicit cross-runtime concurrency policy (mirrors db.bun.ts).
  // WAL + busy_timeout + synchronous=NORMAL on both runtimes so concurrent
  // indexer workers behave identically; transient locks recover within the
  // busy timeout, permanent locks/corruption still fail closed (throw).
  if (!options.readonly) {
    db.pragma("journal_mode = WAL")
    db.pragma("busy_timeout = 5000")
    db.pragma("synchronous = NORMAL")
  }
  return {
    native: db,
    prepare(sql: string): CoreStatement {
      const stmt = db.prepare(sql)
      return {
        get: (...params) => stmt.get(...(params as never[])) as unknown,
        all: (...params) => stmt.all(...(params as never[])) as unknown[],
        run: (...params) => {
          const r = stmt.run(...(params as never[]))
          return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) }
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
