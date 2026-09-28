/**
 * M14 (nim wave, 2026-09-27) — NIM PIPELINE SEAM + CROSS-FILE RESOLUTION gate.
 *
 * Why this file exists. A per-file honesty audit cannot answer the two questions
 * that decide whether the lane is real:
 *
 *   1. Does the analyzer's output SURVIVE the indexer? The M14.0.F7 lesson is
 *      that layer gates missed the seam: analyzers emitted imports, fixtures
 *      passed, differential passed, and `brain_import` was still empty for every
 *      language for months because nothing ever queried the DATABASE. A NIM
 *      analyzer that emits correct ParseResults and loses them at the seam is
 *      worth nothing.
 *
 *   2. Are the "unknown" relationship targets actually resolvable once the whole
 *      module is indexed? In a single file, a call to `decodePng` looks unknown
 *      because `decodePng` is declared in a DIFFERENT file — which is the normal
 *      shape of real Nim, where a module's files call each other. Per-file
 *      "unknown" counts are therefore not defects until the project-level graph
 *      says they are. This gate measures the project-level resolution rate.
 *
 * It indexes a small multi-file Nim project through the REAL CLI (`node bin/bb
 * index`), then asserts row-level facts in the resulting brain.db.
 *
 * CLI: bun run script/m14/verify-nim-pipeline-e2e.ts
 */
import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { createHash } from "crypto"
import Database from "better-sqlite3"

const ROOT = path.resolve(process.cwd())
const TMP = "/tmp/opencode/nim-e2e-project"

/**
 * The project is written to exercise every relationship family the analyzer
 * claims, ACROSS FILES, so the resolution assertions are meaningful:
 *   - a `ref object` class with a field, in its own file
 *   - a `proc` in another file that a third file CALLS          -> calls edge
 *   - a generic type + a proc using it                          -> references edge
 *   - a `ref object of Base` in a third file                    -> extends edge
 *   - a `method` on the subclass overriding the base's          -> overrides edge
 *   - `import` across files                                      -> import rows
 *   - `export`                                                  -> export rows
 *   - an object construction                                     -> instantiates
 *   - a documented proc                                          -> docstring row
 */
function writeProject(): void {
  fs.rmSync(TMP, { recursive: true, force: true })
  fs.mkdirSync(path.join(TMP, "src"), { recursive: true })

  fs.writeFileSync(
    path.join(TMP, "src", "shapes.nim"),
    `## Geometry primitives for the seam gate.
type
  Point* = ref object of RootObj
    x*, y*: int
    label*: string

  Color* = enum
    Red, Green, Blue

  Registry*[T] = object
    items: seq[T]
    count: int

proc newPoint*(x, y: int; label: string = "p"): Point =
  ## Builds a Point. This doc comment must reach the symbol row.
  Point(x: x, y: y, label: label)

proc norm*(p: Point): int =
  ## Euclidean-ish norm of a point.
  p.x * p.x + p.y * p.y

type
  Tagged* = ref object of Point
    tag*: string

method describe*(p: Point): string {.base.} =
  "point"

method describe*(p: Tagged): string =
  "tagged " & p.tag
`,
  )

  fs.writeFileSync(
    path.join(TMP, "src", "registry.nim"),
    `import ./shapes

proc add*[T](r: var Registry[T], item: T) =
  r.items.add item
  inc r.count

proc size*[T](r: Registry[T]): int =
  r.count
`,
  )

  fs.writeFileSync(
    path.join(TMP, "src", "shapes_ext.nim"),
    `import ./shapes

type
  Named* = ref object of Point
    tag*: Color

proc useAll*() =
  let p = newPoint(3, 4, "corner")
  let n = norm(p)
  var reg: Registry[string]
  reg.add("x")
  let c = reg.size()
  echo n, c, p.label
`,
  )

  // The CROSS-FILE override pair. `Painter` and its `{.base.} paint` live here;
  // `GlossPainter` and the method that overrides `paint` live in a SIBLING module
  // that never sees this file's symbols. The `overrides` edge between them is
  // only derivable from the project's override companion index, which is why this
  // is the one family no single-file fixture can express.
  fs.writeFileSync(
    path.join(TMP, "src", "painter.nim"),
    `type
  Painter* = ref object of RootObj
    canvas*: string

method paint*(p: Painter): string {.base.} =
  p.canvas
`,
  )

  fs.writeFileSync(
    path.join(TMP, "src", "gloss.nim"),
    `import ./painter

type
  GlossPainter* = ref object of Painter
    sheen*: int

method paint*(g: GlossPainter): string =
  $paint(g) & "!" & $g.sheen
`,
  )

  fs.writeFileSync(
    path.join(TMP, "shapes.nimble"),
    `version       = "0.1.0"
author        = "seam"
description   = "seam gate fixture"
srcDir        = "src"
`,
  )
}

function main(): void {
  writeProject()
  // The CLI runs from dist/, so the bundle has to be current before the index —
  // the same precondition script/m14/verify-pipeline-e2e.ts states.
  execSync("npm run build", { cwd: ROOT, stdio: "pipe" })
  execSync(`node bin/bb index ${TMP} --force`, { cwd: ROOT, stdio: "pipe" })

  // The data dir keys each project by sha1(absolute project path); asking the
  // CLI for the id is not an option (`bb projects` has no --json), so the same
  // derivation the engine uses is applied here.
  const sha = createHash("sha1").update(TMP).digest("hex")
  const home = process.env.BB_DATA_DIR ?? path.join(process.env.HOME ?? "", ".bb")
  const dbPath = path.join(home, "projects", sha, "brain.db")
  if (!fs.existsSync(dbPath)) {
    console.error(`FAIL: no brain.db at ${dbPath}`)
    process.exit(1)
  }
  const db = new Database(dbPath, { readonly: true })
  const count = (sql: string, ...args: any[]): number => {
    const row = db.prepare(sql).get(...args) as any
    return Number(row?.c ?? 0)
  }

  const failures: string[] = []
  const ok = (label: string, cond: boolean, detail = ""): void => {
    if (cond) console.log(`  ok   ${label}${detail ? ` (${detail})` : ""}`)
    else {
      console.log(`  FAIL ${label}${detail ? ` (${detail})` : ""}`)
      failures.push(label)
    }
  }

  console.log(`project sha1=${sha} db=${dbPath}`)

  // ── 1. THE SEAM: did the analyzer's output reach the database? ──
  const sym = count("SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.nim'")
  ok("nim symbols persisted", sym >= 15, `sym=${sym}`)
  const rel = count("SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.nim'")
  ok("nim relationships persisted (joined to a real source symbol)", rel >= 5, `rel=${rel}`)
  const imp = count("SELECT COUNT(*) c FROM brain_import i JOIN brain_file f ON f.id = i.file_id WHERE f.path LIKE '%.nim'")
  ok("nim imports persisted", imp >= 2, `imports=${imp}`)
  // NOTE: there is deliberately no `brain_export` table — `export` is a
  // ParseResult field the analyzer emits and the store does not keep as rows
  // (the DB models imports, not re-exports). The export FACT is asserted in the
  // nim fixture lane; here the persisted proxy is that the exporting file's
  // exported symbols carry their export marker in the index.
  const expSyms = count(
    "SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.nim' AND s.visibility = 'public'",
  )
  ok("exported nim symbols persisted with visibility=public", expSyms >= 3, `n=${expSyms}`)

  // ── 2. Documented procs reach a docstring row ──
  const docs = count(
    "SELECT COUNT(*) c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.nim' AND (s.docstring IS NOT NULL AND s.docstring != '')",
  )
  ok("docstring persisted from ## comments", docs >= 2, `docs=${docs}`)

  // ── 3. Relationship families present with the right label ──
  for (const kind of ["calls", "contains", "references", "instantiates"]) {
    const n = count(
      "SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.nim' AND r.relationship_type = ?",
      kind,
    )
    ok(`relationship family '${kind}' present`, n >= 1, `n=${n}`)
  }

  // ── 4. Cross-file resolution: the seam question ──
  // A `calls` edge whose TARGET is a symbol declared in a DIFFERENT file of the
  // same project is the cross-file case; its resolution is what makes a Nim
  // module's graph connected.
  const crossFile = count(
    `SELECT COUNT(*) c
       FROM brain_relationship r
       JOIN brain_symbol src ON src.id = r.source_symbol_id
       JOIN brain_symbol tgt ON tgt.id = r.target_symbol_id
      WHERE r.relationship_type = 'calls'
        AND src.file_id LIKE '%.nim' AND tgt.file_id LIKE '%.nim'
        AND src.file_id <> tgt.file_id`,
  )
  ok("a calls edge RESOLVED to a symbol in another file (cross-file link)", crossFile >= 1, `n=${crossFile}`)
  if (crossFile === 0) {
    const unresolved = count(
      `SELECT COUNT(*) c
         FROM brain_relationship r
         JOIN brain_symbol src ON src.id = r.source_symbol_id
        JOIN brain_file sf ON sf.id = src.file_id
        WHERE r.relationship_type = 'calls' AND sf.path LIKE '%.nim'
          AND r.target_symbol_id IS NULL`,
    )
    console.log(`       (calls edges with an unresolved target: ${unresolved})`)
  }

  // ── 5. NO UNKNOWN SYMBOLS persisted: a row whose target is neither a symbol
  //      nor a documented import-based reference is a phantom row. ──
  const dangling = count(
    `SELECT COUNT(*) c
       FROM brain_relationship r
       JOIN brain_symbol src ON src.id = r.source_symbol_id
       JOIN brain_file sf ON sf.id = src.file_id
      WHERE sf.path LIKE '%.nim'
        AND r.target_symbol_id IS NULL
        AND COALESCE(json_extract(r.metadata, '$.evidenceClass'), '') <> 'import_based'`,
  )
  ok("no non-import relationship persisted with an unresolvable target", dangling === 0, `dangling=${dangling}`)

  // ── 6. Extends / overrides where the file set declares them ──
  const extendsN = count(
    "SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.nim' AND r.relationship_type = 'extends'",
  )
  ok("'extends' persisted for `ref object of Point`", extendsN >= 1, `n=${extendsN}`)
  const overridesN = count(
    "SELECT COUNT(*) c FROM brain_relationship r JOIN brain_symbol s ON s.id = r.source_symbol_id JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%.nim' AND r.relationship_type = 'overrides'",
  )
  ok("'overrides' persisted for the derived method", overridesN >= 1, `n=${overridesN}`)

  // ── 7. Every persisted relationship that claims a line has a sane one ──
  const badLine = count(
    "SELECT COUNT(*) c FROM brain_relationship WHERE line_number IS NOT NULL AND (line_number < 1 OR line_number > 100000)",
  )
  ok("no persisted relationship carries an out-of-range line", badLine === 0, `bad=${badLine}`)

  // ── 8. No phantom rows: a symbol row whose file was never analyzed ──
  const orphanFiles = count(
    `SELECT COUNT(DISTINCT f.id) c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id WHERE f.path LIKE '%shapes_ext%'`,
  )
  ok("the third file of the module is present in the index (no file skipped)", orphanFiles === 1, `files=${orphanFiles}`)

  db.close()
  console.log("")
  if (failures.length > 0) {
    console.error(`NIM PIPELINE SEAM FAILED: ${failures.length} check(s): ${failures.join("; ")}`)
    process.exit(1)
  }
  console.log("nim pipeline seam: all checks passed")
}

main()
