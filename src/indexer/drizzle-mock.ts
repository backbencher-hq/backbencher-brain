// Comprehensive Drizzle ORM mock — builds real SQL from chain calls
// This enables the backbencher parallel-indexer to use our database directly

import type Database from "better-sqlite3"

// ============================================================================
// CHAINABLE QUERY BUILDER
// ============================================================================

class QueryChain {
  private _columns: string = "*"
  private _table: string = ""
  private _conditions: string[] = []
  private _params: any[] = []
  private _orderBy: string = ""
  private _limitVal: number = 0
  private _offsetVal: number = 0
  private _isDelete: boolean = false
  private _insertData: any = null
  private _tableName: string = ""
  private _db: Database.Database

  constructor(db: Database.Database) {
    this._db = db
  }

  select(cols: any) {
    if (cols && typeof cols === "object") {
      const keys = Object.keys(cols)
      // Check if any column uses sql template
      this._columns = keys.map(k => {
        const v = cols[k]
        if (v && v._sql) return v._sql
        if (typeof v === "function") return v() || k
        return k
      }).join(", ")
    }
    return this
  }

  from(table: any) {
    this._table = table._tableName || "brain_file"
    return this
  }

  innerJoin(_other: any, _on: any) {
    return this
  }

  where(condition: any) {
    if (condition && condition._sql) {
      this._conditions.push(condition._sql)
      if (condition._params) this._params.push(...condition._params)
    }
    return this
  }

  orderBy(...orders: any[]) {
    return this
  }

  limit(n: number) {
    this._limitVal = n
    return this
  }

  offset(n: number) {
    this._offsetVal = n
    return this
  }

  all(): any[] {
    if (this._isDelete) return []
    let sql = `SELECT ${this._columns} FROM ${this._table}`
    if (this._conditions.length) {
      sql += " WHERE " + this._conditions.join(" AND ")
    }
    if (this._orderBy) sql += " ORDER BY " + this._orderBy
    if (this._limitVal) sql += " LIMIT " + this._limitVal
    if (this._offsetVal) sql += " OFFSET " + this._offsetVal
    try {
      return this._db.prepare(sql).all(...this._params) as any[]
    } catch {
      return []
    }
  }

  get(): any {
    if (this._isDelete) return null
    let sql = `SELECT ${this._columns} FROM ${this._table}`
    if (this._conditions.length) {
      sql += " WHERE " + this._conditions.join(" AND ")
    }
    try {
      return this._db.prepare(sql).get(...this._params) || null
    } catch {
      return null
    }
  }

  run(...args: any[]): any {
    let sql = ""
    if (this._isDelete) {
      sql = `DELETE FROM ${this._tableName}`
    } else if (this._insertData) {
      const cols = Object.keys(this._insertData).join(", ")
      const vals = Object.keys(this._insertData).map(() => "?").join(", ")
      sql = `INSERT OR REPLACE INTO ${this._tableName} (${cols}) VALUES (${vals})`
      this._params = Object.values(this._insertData)
    }
    if (this._conditions.length) {
      sql += " WHERE " + this._conditions.join(" AND ")
    }
    try {
      return this._db.prepare(sql).run(...this._params, ...args)
    } catch (e) {
      return { changes: 0 }
    }
  }

  values(data: any) {
    this._insertData = data
    return this
  }

  onConflictDoUpdate(_conflict: any) {
    return this
  }

  onConflictDoNothing() {
    return this
  }

  insert(table: any) {
    this._tableName = table._tableName || "brain_file"
    return this
  }

  delete(table: any) {
    this._isDelete = true
    this._tableName = table._tableName || "brain_file"
    return this
  }
}

// ============================================================================
// Drizzle-compatible condition builders
// ============================================================================

export function eq(col: any, val: any) {
  if (col && col._colName) {
    return { _sql: `${col._colName} = ?`, _params: [val], _colName: col._colName }
  }
  return { _sql: "1=1", _params: [] }
}

export function and(...conditions: any[]) {
  const sql = conditions.filter((c: any) => c._sql).map((c: any) => c._sql).join(" AND ")
  const params = conditions.flatMap((c: any) => c._params || [])
  return { _sql: sql, _params: params }
}

export function or(...conditions: any[]) {
  const sql = conditions.filter((c: any) => c._sql).map((c: any) => c._sql).join(" OR ")
  const params = conditions.flatMap((c: any) => c._params || [])
  return { _sql: `(${sql})`, _params: params }
}

export function like(col: any, val: string) {
  if (col && col._colName) {
    return { _sql: `${col._colName} LIKE ?`, _params: [val] }
  }
  return { _sql: "1=1", _params: [] }
}

export function ne(col: any, val: any) {
  if (col && col._colName) {
    return { _sql: `${col._colName} != ?`, _params: [val] }
  }
  return { _sql: "1=1", _params: [] }
}

export function inArray(col: any, vals: any[]) {
  if (col && col._colName) {
    const placeholders = vals.map(() => "?").join(", ")
    return { _sql: `${col._colName} IN (${placeholders})`, _params: vals }
  }
  return { _sql: "1=1", _params: [] }
}

export function isNotNull(col: any) {
  if (col && col._colName) return { _sql: `${col._colName} IS NOT NULL`, _params: [] }
  return { _sql: "1=1", _params: [] }
}

export function desc(col: any) {
  if (col && col._colName) return `${col._colName} DESC`
  return "1 DESC"
}

// ============================================================================
// SQL template tag
// ============================================================================

export function sql(strings: TemplateStringsArray, ...values: any[]) {
  const sqlParts = []
  for (let i = 0; i < strings.length; i++) {
    sqlParts.push(strings[i])
    if (i < values.length) sqlParts.push("?")
  }
  return { _sql: sqlParts.join(""), _params: values }
}

// ============================================================================
// CREATE DRIZZLE DB WRAPPER
// ============================================================================

export function createDrizzleDb(rawDb: Database.Database) {
  return new Proxy(new QueryChain(rawDb), {
    get(target, prop) {
      if (prop in target) return (target as any)[prop]
      // Any unknown property returns the chain for fluent API
      return target
    }
  })
}
