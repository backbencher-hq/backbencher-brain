// script/verify-sqlite-tuning.ts — the optional SQLite temp_store / page-cache knobs are real and OFF by default
//
// WHY. The old INDEXER-REVIEW listed "temp_store / page-cache tuning" as an unmeasured lever. It is now an
// opt-in knob pair (`BB_SQLITE_TEMP_STORE`, `BB_SQLITE_CACHE_MB`) rather than a hardcoded guess: both adapters
// (Node better-sqlite3 and Bun bun:sqlite) must apply the same policy, invalid values must be IGNORED (a typo
// must not silently change a connection's memory behaviour), and the DEFAULT must stay SQLite's own so a small
// install pays nothing. This gate opens a real database and reads the pragmas back — the only honest way to
// check "the knob took effect".
//
// Run: npx tsx script/verify-sqlite-tuning.ts
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import Database from "better-sqlite3"

let checks = 0
let failed = 0
function check(label: string, ok: boolean, detail = ""): void {
  checks++
  if (ok) console.log(`  ok: ${label}`)
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

const tmp = mkdtempSync(path.join(tmpdir(), "bb-sqlite-tuning-"))
const { openDatabase } = await import("../src/storage/db.node.ts")

function pragmas(env: Record<string, string | undefined>): { tempStore: number; cacheSize: number } {
  const saved: Record<string, string | undefined> = {}
  for (const k of ["BB_SQLITE_TEMP_STORE", "BB_SQLITE_CACHE_MB"]) {
    saved[k] = process.env[k]
    if (env[k] === undefined) delete process.env[k]
    else process.env[k] = env[k]
  }
  try {
    const db = openDatabase(path.join(tmp, `t-${Math.random().toString(36).slice(2)}.db`))
    const tempStore = Number((db.prepare("PRAGMA temp_store").get() as any)?.temp_store ?? -1)
    const cacheSize = Number((db.prepare("PRAGMA cache_size").get() as any)?.cache_size ?? 0)
    db.close()
    return { tempStore, cacheSize }
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  }
}

try {
  // The DRIVER's own defaults are the expectation: better-sqlite3's page-cache default is not SQLite's
  // compiled-in -2000 (measured -16000 KiB here), and hardcoding a number would make the gate assert the
  // driver version rather than the policy. Open a raw connection and require the adapter to match it.
  const rawDb = new Database(path.join(tmp, "raw-control.db"))
  const rawDefaults = {
    tempStore: Number(rawDb.pragma("temp_store", { simple: true })),
    cacheSize: Number(rawDb.pragma("cache_size", { simple: true })),
  }
  rawDb.close()

  const base = pragmas({})
  check("default connection keeps the driver's temp_store", base.tempStore === rawDefaults.tempStore, JSON.stringify({ base, rawDefaults }))
  check("default connection keeps the driver's page cache", base.cacheSize === rawDefaults.cacheSize, JSON.stringify({ base, rawDefaults }))

  const memory = pragmas({ BB_SQLITE_TEMP_STORE: "memory" })
  check("BB_SQLITE_TEMP_STORE=MEMORY maps to temp_store=2 (case-insensitive)", memory.tempStore === 2, JSON.stringify(memory))
  const numeric = pragmas({ BB_SQLITE_TEMP_STORE: "1" })
  check("BB_SQLITE_TEMP_STORE=1 maps to temp_store=1 (FILE)", numeric.tempStore === 1, JSON.stringify(numeric))
  const cache = pragmas({ BB_SQLITE_CACHE_MB: "64" })
  check("BB_SQLITE_CACHE_MB=64 maps to cache_size=-65536 KiB", cache.cacheSize === -65536, JSON.stringify(cache))

  const both = pragmas({ BB_SQLITE_TEMP_STORE: "MEMORY", BB_SQLITE_CACHE_MB: "8" })
  check("both knobs apply together", both.tempStore === 2 && both.cacheSize === -8192, JSON.stringify(both))

  const invalid = pragmas({ BB_SQLITE_TEMP_STORE: "banana", BB_SQLITE_CACHE_MB: "not-a-number" })
  check("invalid values are IGNORED, not guessed", invalid.tempStore === rawDefaults.tempStore && invalid.cacheSize === rawDefaults.cacheSize, JSON.stringify({ invalid, rawDefaults }))
  const outOfRange = pragmas({ BB_SQLITE_TEMP_STORE: "9", BB_SQLITE_CACHE_MB: "99999" })
  check("out-of-range values are IGNORED", outOfRange.tempStore === rawDefaults.tempStore && outOfRange.cacheSize === rawDefaults.cacheSize, JSON.stringify({ outOfRange, rawDefaults }))
} finally {
  try {
    rmSync(tmp, { recursive: true, force: true })
  } catch {}
}

console.log(`\nSQLITE TUNING: ${failed === 0 ? "PASS" : "FAIL"} — ${checks - failed}/${checks} checks`)
process.exit(failed === 0 ? 0 : 1)
