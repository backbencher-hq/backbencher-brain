
    const { createHash } = await import("node:crypto")
    const { realpathSync } = await import("node:fs")
    const path = await import("node:path")
    const pid = createHash("sha1").update(realpathSync("$HOME/mcp/backbencher-brain")).digest("hex")
    const dbPath = path.join("$HOME/.bb", "projects", pid, "brain.db")
    const { openDatabase } = await import("$HOME/mcp/backbencher-brain/src/storage/db.bun.ts")
    const db = openDatabase(dbPath, { readonly: true })
    const fk = (db.native as any).prepare("PRAGMA foreign_keys").get() as any
    const danglers = db.prepare(`SELECT COUNT(*) c FROM brain_relationship r
      WHERE r.source_symbol_id IS NOT NULL AND r.source_symbol_id != ''
        AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id)`).get() as any
    const nullSource = db.prepare("SELECT COUNT(*) c FROM brain_relationship WHERE source_symbol_id IS NULL").get() as any
    const withName = db.prepare(`SELECT COUNT(*) c FROM brain_relationship
      WHERE source_symbol_id IS NULL AND source_external IS NOT NULL AND source_external != ''`).get() as any
    const orphanSyms = db.prepare(`SELECT COUNT(*) c FROM brain_symbol s
      WHERE s.file_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM brain_file f WHERE f.id = s.file_id)`).get() as any
    db.close()
    console.log(JSON.stringify({ fk: fk.foreign_keys, danglers: danglers.c, nullSource: nullSource.c, withName: withName.c, orphanSyms: orphanSyms.c }))
  