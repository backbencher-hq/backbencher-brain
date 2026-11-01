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

/**
 * bun:sqlite binds `@name` from a key spelled `@name`; better-sqlite3 — whose surface this
 * adapter exists to mirror — binds it from a key spelled `name`.
 *
 * The difference is not an error on either side, which is what makes it dangerous: bun:sqlite
 * IGNORES the un-prefixed key and leaves the placeholder NULL, so the statement runs, returns
 * zero rows, and reports success. MEASURED (2026-10-16, bun 1.3.14): the same statement with
 * `{projectId, t0…}` returns `[]` while `{'@projectId', '@t0'…}` returns the row, and a bind
 * object carrying BOTH spellings returns the row — so the translation below cannot change what
 * a statement already bound correctly.
 *
 * It blinded `src/intelligence/patterns/orphans.ts` (its whole usage filter binds by name):
 * `usedIds`, the refusal counters and `referencedFiles` all came back empty, so every function
 * with a perfectly good call edge pointing at it was reported as orphaned and nothing looked
 * broken — the numbers were internally consistent. Measured on the three-function fixture the
 * patterns e2e gate uses: 3 candidates reported where the same query, bound positionally,
 * clears 1 of them.
 *
 * Only keys the statement actually names are translated, and only when the un-prefixed spelling
 * is the one present, so an existing `@`/`:`/`$`-style caller is passed through untouched.
 */
function bindable(sql: string, params: unknown[]): unknown[] {
  if (params.length !== 1) return params
  const p = params[0]
  if (!p || typeof p !== "object" || Array.isArray(p)) return params
  const out: Record<string, unknown> = { ...(p as Record<string, unknown>) }
  for (const [k, v] of Object.entries(out)) {
    if (k.startsWith("@") || k.startsWith(":") || k.startsWith("$")) continue
    if (sql.includes(`@${k}`)) out[`@${k}`] = v
  }
  return [out]
}

export function openDatabase(path: string, options: { readonly?: boolean } = {}): CoreDatabase {
  // bun:sqlite throws SQLITE_MISUSE when readonly:false is passed explicitly.
  const db = options.readonly ? new Database(path, { readonly: true }) : new Database(path)
  // M21.D2: explicit cross-runtime concurrency policy. Both adapters must
  // configure the same pragmas so Bun and Node behave identically under
  // concurrent access:
  //   journal_mode = WAL  — concurrent readers during a write transaction.
  //   busy_timeout        — bounded transient-lock recovery: a blocked
  //                         statement waits up to the timeout instead of
  //                         failing immediately with SQLITE_BUSY.
  //   synchronous = NORMAL — WAL-safe durability with far fewer fsyncs than
  //                         FULL; matches the Node adapter's throughput.
  // A permanent lock (a foreign process holding the DB beyond the timeout)
  // or corruption still fails closed: the statement throws after the timeout.
  if (!options.readonly) {
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("PRAGMA busy_timeout = 5000")
    db.exec("PRAGMA synchronous = NORMAL")
    // Mirrors db.node.ts: optional tuning, off unless explicitly asked for.
    const tempStore = String(process.env.BB_SQLITE_TEMP_STORE ?? "").toUpperCase()
    if (tempStore === "MEMORY" || tempStore === "FILE" || tempStore === "DEFAULT") db.exec(`PRAGMA temp_store = ${tempStore}`)
    else if (tempStore === "0" || tempStore === "1" || tempStore === "2") db.exec(`PRAGMA temp_store = ${tempStore}`)
    const cacheMb = Number(process.env.BB_SQLITE_CACHE_MB ?? 0)
    if (Number.isInteger(cacheMb) && cacheMb >= 1 && cacheMb <= 4096) db.exec(`PRAGMA cache_size = -${cacheMb * 1024}`)
    // M54.P1 (#727): enforce declared FKs under Bun, matching better-sqlite3's
    // default (node) — until now the same statement kept data under bun and
    // cascade-deleted it under node (script/m54/probe-fk.ts A1/A3). Historical
    // orphan rows are healed by cleanupOrphanedFkRows at every open.
    // BB_FK_ENFORCE=0 is the documented escape hatch (gate mutation lever).
    if (process.env.BB_FK_ENFORCE !== "0") {
      db.exec("PRAGMA foreign_keys = ON")
    }
  } else {
    // M54.P1: readonly handles cannot write, so FK policy is inert there —
    // set it anyway for ONE uniform policy across every handle. Swallowed
    // errors here are acceptable ONLY because gate S1c proves the pragma
    // actually took effect on a readonly bun connection.
    if (process.env.BB_FK_ENFORCE !== "0") {
      try { db.exec("PRAGMA foreign_keys = ON") } catch {}
    }
  }
  return {
    native: db,
    prepare(sql: string): CoreStatement {
      const stmt = db.prepare(sql)
      return {
        get: (...params) => stmt.get(...(bindable(sql, params) as never[])) as unknown,
        all: (...params) => stmt.all(...(bindable(sql, params) as never[])) as unknown[],
        run: (...params) => {
          const r = stmt.run(...(bindable(sql, params) as never[]))
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
      const r = db.prepare(sql).run(...(bindable(sql, params) as never[]))
      return { changes: Number(r.changes ?? 0), lastInsertRowid: Number(r.lastInsertRowid ?? 0) }
    },
    readonly: options.readonly ?? false,
  }
}
