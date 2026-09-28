// script/m54/apply-real-heal.ts — M54.P1 one-time production heal.
// Opens the REAL repo index read-write through BrainDatabase.openByPath — the
// exact path every real `bb` command takes — so ensureSchemaIfNew runs the
// M54 orphan cleanup against the legacy FK-OFF-era rows (measured 4,154 at
// decision time). Idempotent: on an already-conformant DB it deletes 0 rows.
// Records before/after counts as the migration receipt.

import { createHash } from "node:crypto"
import { realpathSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")
const realDataDir = "$HOME/.bb"
const realRepo = realpathSync(ROOT)

const pid = createHash("sha1").update(realRepo).digest("hex")
const dbPath = path.join(realDataDir, "projects", pid, "brain.db")
if (!existsSync(dbPath)) {
  console.error(`real DB not found: ${dbPath}`)
  process.exit(1)
}

const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

const countOrphans = (db: any) =>
  (db.prepare(`SELECT COUNT(*) c FROM brain_relationship r LEFT JOIN brain_symbol s ON s.id = r.source_symbol_id WHERE s.id IS NULL`).get() as any).c

console.log(`opening (rw): ${dbPath}`)
const db: any = BrainDatabase.openByPath(dbPath)
const before = countOrphans(db)
console.log(`orphan-source relationships BEFORE: ${before}`)

const t0 = Date.now()
const { cleanupOrphanedFkRows } = await import(path.join(ROOT, "src/brain/schema-ddl.ts"))
const healed = cleanupOrphanedFkRows(db)
const ms = Date.now() - t0
const after = countOrphans(db)
console.log(`heal result: ${JSON.stringify(healed)} in ${ms}ms`)
console.log(`orphan-source relationships AFTER: ${after}`)
console.log(after === 0 ? "✅ real DB conformant" : "❌ orphans remain")

BrainDatabase.closeByPath?.(dbPath)
process.exit(after === 0 ? 0 : 1)
