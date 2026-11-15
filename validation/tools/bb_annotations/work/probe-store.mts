// validation/tools/bb_annotations/work/probe-store.mts
//
// Store-level audit of the read door's predicates, measured on the probe fixture
// index this lane built (never the shared store):
//
//   S1  the rows the writes created, with their location tuple
//   S2  the EXACT predicate the editor hover runs (src/lsp/hover.ts), and what it
//       returns for the same symbol — the twin the descriptor claims to agree with
//   S3  the predicate bb_annotations runs, reconstructed from the handler source
//   S4  the name set the handler's own comment says it builds ("simple name AND
//       qualified name") versus the one the SQL actually selects
//   S5  the deterministic id tiebreak when two rows share time_updated
//
// Run: BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_annotations/work/probe-store.mts
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createRequire } from "node:module"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, "..", "..", "..", "..")
const DATA_DIR = join(HERE, "..", "bbdata")
const WORKSPACE = join(HERE, "probe-fixture")
process.env.BB_DATA_DIR = DATA_DIR
process.env.BB_NO_AUTO_REFRESH = "1"

const require = createRequire(import.meta.url)
const Database = require("better-sqlite3")
const manifest = JSON.parse(readFileSync(join(HERE, "..", "raw", "index-manifest.json"), "utf8"))
const PROJECT = manifest.tiers.probe.projectId as string
const DB = join(DATA_DIR, "projects", PROJECT, "brain.db")

const ro = new Database(DB, { readonly: true, fileMustExist: true })

const rows = ro.prepare(
  "SELECT symbol_name, symbol_path, body FROM brain_annotation WHERE project_id = ? ORDER BY time_updated DESC, id",
).all(PROJECT) as Array<{ symbol_name: string; symbol_path: string | null; body: string }>

// S1 — the written store.
const s1 = { rowCount: rows.length, rows }

// S2 — the hover's own SQL (src/lsp/hover.ts: `(symbol_name = ? OR symbol_name = ?)`
// with the symbol's name and qualified_name, scoped to the cursor's file).
const symbolRows = ro.prepare(
  "SELECT name, qualified_name FROM brain_symbol WHERE project_id = ? AND name = ?",
).all(PROJECT, "render") as Array<{ name: string; qualified_name: string }>
const hoverMatches = (name: string, qualified: string, relativePath: string) =>
  ro.prepare(
    `SELECT symbol_name, symbol_path, body FROM brain_annotation
     WHERE project_id = ? AND (symbol_name = ? OR symbol_name = ?)
       AND (symbol_path IS NULL OR symbol_path = ? OR symbol_path = ?)
     ORDER BY time_updated DESC, id`,
  ).all(PROJECT, name, qualified, relativePath, WORKSPACE + "/" + relativePath) as any[]
const s2 = {
  predicate: "(symbol_name = name OR symbol_name = qualified_name) AND (symbol_path IS NULL OR symbol_path = <relative> OR symbol_path = <absolute>)",
  symbols: symbolRows,
  hoverForRenderInAlpha: symbolRows.map((row) => ({ name: row.name, qualified: row.qualified_name, matches: hoverMatches(row.name, row.qualified_name, "src/alpha.ts") })),
}

// S3 — the handler's OWN resolver (imported, not reconstructed): the set of
// stored names it matches, and the rows the same predicate returns. Measuring the
// production function is what makes this comparable to the hover predicate in S2.
const { resolveAnnotationNames } = await import(join(ROOT, "src/mcp/tools/bb_annotations/handler.ts"))
const handlerNameSet = (requested: string) => {
  const resolved = resolveAnnotationNames(ro, PROJECT, requested)
  const rowsOut = ro.prepare(
    `SELECT symbol_name, symbol_path, body FROM brain_annotation WHERE project_id = ? AND symbol_name IN (${resolved.names.map(() => "?").join(",")})`,
  ).all(PROJECT, ...resolved.names)
  return { requested, resolvedNames: resolved.names, indexed: resolved.indexed, matches: rowsOut }
}
const s3 = {
  bySimpleName: handlerNameSet("render"),
  byQualifiedName: handlerNameSet("Widget.render"),
}

// S4 — the set the handler's comment claims: the simple name AND the qualified
// name of every symbol the request names.
const intendedNameSet = (requested: string) => {
  const symbolNames = ro.prepare(
    "SELECT DISTINCT name, qualified_name FROM brain_symbol WHERE project_id = ? AND (name = ? OR qualified_name = ?)",
  ).all(PROJECT, requested, requested) as Array<{ name: string; qualified_name: string | null }>
  const set = [...new Set(symbolNames.flatMap((row) => [row.name, row.qualified_name].filter((v): v is string => typeof v === "string")))]
  const matches = set.length
    ? ro.prepare(`SELECT symbol_name, symbol_path, body FROM brain_annotation WHERE project_id = ? AND symbol_name IN (${set.map(() => "?").join(",")})`).all(PROJECT, ...set)
    : []
  return { requested, intendedNames: set, matches }
}
const s4 = {
  originalHandlerComment: "the requested name is resolved to the set of stored names of every symbol it names (its simple name AND its qualified name), and a note matches when its symbol_name is in that set",
  bySimpleName: intendedNameSet("render"),
  byQualifiedName: intendedNameSet("Widget.render"),
}

// S5 — deterministic ordering when time_updated ties. The mutation happens on a
// COPY of the fixture store so later door runs still see the pristine ordering.
const tiebreakCopy = join(HERE, "..", "raw", "tiebreak.db")
// Copy the sidecars too: rows written since the last checkpoint live in the WAL,
// so a copy of brain.db alone would be a snapshot from before those writes.
for (const suffix of ["", "-wal", "-shm"]) {
  if (existsSync(DB + suffix)) copyFileSync(DB + suffix, tiebreakCopy + suffix)
}
const tieRo = new Database(tiebreakCopy, { readonly: false, fileMustExist: true })
const two = tieRo.prepare("SELECT id, symbol_name FROM brain_annotation WHERE project_id = ? ORDER BY id LIMIT 2").all(PROJECT) as Array<{ id: string; symbol_name: string }>
tieRo.prepare("UPDATE brain_annotation SET time_updated = 1111111111111 WHERE id IN (?, ?)").run(two[0].id, two[1].id)
const tied = tieRo.prepare("SELECT id, symbol_name FROM brain_annotation WHERE project_id = ? AND time_updated = 1111111111111 ORDER BY time_updated DESC, id").all(PROJECT) as Array<{ id: string; symbol_name: string }>
const withoutTiebreak = tieRo.prepare("SELECT id FROM brain_annotation WHERE project_id = ? AND time_updated = 1111111111111").all(PROJECT) as Array<{ id: string }>
tieRo.close()
const s5 = { ids: two, orderedWithIdTiebreak: tied, orderMatchesAscendingId: tied.map((r) => r.id).join(",") === [...tied.map((r) => r.id)].sort().join(","), rawUnordered: withoutTiebreak }

ro.close()

const out = {
  schemaVersion: 1,
  tool: "bb_annotations",
  action: "store predicate audit on the isolated probe fixture",
  measuredAt: new Date().toISOString(),
  currentCommit: (() => { try { return require("node:child_process").execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })(),
  database: { path: DB, projectId: PROJECT },
  s1_writtenStore: s1,
  s2_hoverTwinPredicate: s2,
  s3_handlerPredicate: s3,
  s4_nameSetTheCommentClaims: s4,
  s5_orderingTiebreak: s5,
  verdicts: {
    hoverFindsQualifiedNameNote: s2.hoverForRenderInAlpha.some((h) => h.matches.some((m: any) => m.symbol_name === "Widget.render")),
    doorFindsQualifiedNameNoteByQualifiedName: s3.byQualifiedName.matches.length > 0,
    doorFindsQualifiedNameNoteBySimpleName: s3.bySimpleName.matches.length > 0,
    intendedSetFindsQualifiedNameNote: s4.bySimpleName.matches.length > 0 && s4.byQualifiedName.matches.length > 0,
    // The measured agreement test, not a literal: the rows the hover would show
    // for each symbol named `render` (S2, unioned over the symbols) against the
    // rows the tool's own resolver returns for the same name (S3).
    doorAgreesWithHover: JSON.stringify(
      [...s2.hoverForRenderInAlpha.flatMap((h) => h.matches)].sort((x: any, y: any) => String(x.body).localeCompare(String(y.body))),
    ) === JSON.stringify(
      [...s3.bySimpleName.matches].sort((x: any, y: any) => String(x.body).localeCompare(String(y.body))),
    ),
  },
}
const dir = join(HERE, "..", "raw", "probe-store.json")
writeFileSync(dir, JSON.stringify(out, null, 2) + "\n")
console.log(JSON.stringify({ out: dir, verdicts: out.verdicts, s2: s2.hoverForRenderInAlpha, s3: s3, s4: s4.bySimpleName }, null, 2))
