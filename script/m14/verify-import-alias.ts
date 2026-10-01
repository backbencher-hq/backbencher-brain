// Does an import alias survive to brain_import.imported_as, on BOTH paths?
//
// The M60 fix bound `imported_as` at the store seam and stopped the fallback from
// stripping aliases. Both halves claim to work, so this checks them where it
// matters: does the value land in the column, and does `patterns.ts`'s
// `usedName = imported_as || imported_name` now pick the right name?
//
// Two paths are exercised because they are different code:
//   AST path       the analyzer publishes ImportInfo.alias (python/typescript do)
//   FALLBACK path  extractFallback -> extractBasicImports, the >13,000-file and
//                  analyzer-failure path, which used to strip `A as B` outright
//
// The regression this guards is specific: for `from x import Cygdb as cygdb` the
// unused-import pattern searched for `Cygdb`, a name the file never writes, and
// reported a used import as unused. 35.9% of python import specifiers are aliased.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import Database from "better-sqlite3"
import { extractFallback } from "../../src/ast/pool-worker"
import { ensureSchema } from "../../src/brain/schema-ddl"

let failures = 0
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`)
  if (!ok) failures++
}

function main(): void {
  console.log("# verify-import-alias\n")

  // ── the fallback path ───────────────────────────────────────────────────
  const py = [
    "from Cython.Debugger import Cygdb as cygdb",
    "from os import path as p",
    "from collections import OrderedDict",
    "",
    "def go():",
    "    return cygdb, p, OrderedDict",
    "",
  ].join("\n")
  const got = extractFallback(py, "python", "h", py.length, 0)
  const byName = new Map<string, any>()
  for (const i of (got as any).imports ?? []) byName.set(String(i.name), i)
  const byLocal = new Map<string, any>()
  for (const i of (got as any).imports ?? []) byLocal.set(String(i.alias ?? i.name), i)

  // The inversion this fixes: module and item were swapped for python because the
  // capture-group roles were inferred positionally from the JS/TS pattern shape.
  check("fallback: the MODULE lands in path, not in name", byLocal.get("cygdb")?.path === "Cython.Debugger",
    `path=${byLocal.get("cygdb")?.path}`)
  check("fallback: the module is NOT published as the imported name", !byName.has("Cython.Debugger"),
    `names=${[...byName.keys()].join(",")}`)
  check("fallback: isExternal is computed from the MODULE string", byLocal.get("cygdb")?.isExternal === true,
    `isExternal=${byLocal.get("cygdb")?.isExternal}`)

  check("fallback: the IMPORTED name stays `name` (its original meaning)", byName.has("Cygdb"), [...byName.keys()].join(","))
  check("fallback: `alias` carries the LOCAL binding, as ImportInfo.alias does", byName.get("Cygdb")?.alias === "cygdb", `alias=${byName.get("Cygdb")?.alias}`)
  check("fallback: second alias handled", byName.get("path")?.alias === "p", `alias=${byName.get("path")?.alias}`)
  check("fallback: a plain import has NO alias (NULL stays correct)", byName.get("OrderedDict")?.alias === undefined,
    `alias=${String(byName.get("OrderedDict")?.alias)}`)

  // ── the store seam, against the REAL schema ─────────────────────────────
  const db = new Database(":memory:")
  ensureSchema(db)
  db.prepare(`INSERT INTO brain_file (id,project_id,path,relative_path,file_hash,size_bytes,line_count,last_modified,language)
              VALUES ('f','p','a.py','a.py','h',0,0,0,'python')`).run()
  const ins = db.prepare(`INSERT OR REPLACE INTO brain_import
    (id,project_id,file_id,imported_name,imported_as,import_path,import_type,is_external,line_number,time_created,time_updated)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
  let n = 0
  for (const i of (got as any).imports ?? []) {
    const moduleName = i.module ?? i.path ?? i.localName ?? ""
    if (!moduleName) continue
    ins.run(`i${n++}`, "p", "f", String(i.name), i.alias ?? i.localName ?? null, i.path || moduleName, "named", 0, i.line ?? 0, 0, 0)
  }
  const cols = (db.prepare(`PRAGMA table_info(brain_import)`).all() as any[]).map((c) => c.name)
  void cols
  const rows = db.prepare(`SELECT imported_name, imported_as FROM brain_import ORDER BY imported_name`).all() as any[]
  void rows
  const aliasRow = rows.find((r) => r.imported_name === "Cygdb")
  check("store: imported_as receives the LOCAL binding", aliasRow?.imported_as === "cygdb", `imported_as=${String(aliasRow?.imported_as)}`)
  const plainRow = rows.find((r) => r.imported_name === "OrderedDict")
  check("store: a plain import stores NULL, not an empty string", plainRow?.imported_as === null, `imported_as=${String(plainRow?.imported_as)}`)

  // ── the consumer's rule, applied to what is actually stored ──────────────
  // patterns.ts: const usedName = imp.imported_as || imp.imported_name
  const usedNameFor = (r: any): string => String(r.imported_as || r.imported_name)
  check("patterns.ts usedName now resolves to the LOCAL binding",
    usedNameFor(aliasRow) === "cygdb" && py.includes(usedNameFor(aliasRow)),
    `usedName=${usedNameFor(aliasRow)} present in source=${py.includes(usedNameFor(aliasRow))}`)
  check("patterns.ts usedName is unchanged for a plain import",
    usedNameFor(plainRow) === "OrderedDict", usedNameFor(plainRow))

  db.close()
  console.log("")
  if (failures === 0) {
    console.log("import aliases survive to the column, and the consumer picks the right name")
    process.exit(0)
  }
  console.log(`${failures} check(s) failed`)
  process.exit(1)
}
main()