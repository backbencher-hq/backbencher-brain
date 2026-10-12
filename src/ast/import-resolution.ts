// M60 / review JD2 — resolution of the `<module>:<item>` import target form.
//
// The problem this exists to solve, measured end to end on a 2-file project
// (imported with the production entry, then read out of brain.db):
//
//   relationship_type='imports'   target_external      target_symbol_id
//   ./widget.js:Widget   (default import)   UNRESOLVED
//   ./widget.js:render   (aliased  {draw as render})  UNRESOLVED
//   ./util.js:helper     (named, unaliased)          UNRESOLVED
//   ./util.js:*          (namespace)                 UNRESOLVED
//
// while `exports` edges (a BARE name) and cross-file `calls` / `instantiates`
// all resolved. The difference is the `path:item` form itself: the three
// strategies in `resolveRelationships` match a bare `name`, a `qualified_name`
// (`Owner.member`), or — for a dotted target — everything after the first `.`.
// `./util.js:helper` satisfies none of them, and `./util.js:helper` is a
// perfectly ordinary internal import. So 100% of `imports` edges in every
// lane that emits this form were permanently unresolved.
//
// WHAT THIS DOES NOT FIX, deliberately:
//
//   - `import * as ns from "./m"`  -> `./m:*`.  A namespace has no single
//     target symbol, so the row stays unresolved. Resolving it would invent a
//     node.
//   - `import { a as b } from "./m"` -> `./m:b`.  The edge names the LOCAL
//     binding while the target symbol carries the declared name `a`. No
//     resolver can fix a wrong name; that is the analyzer's convention
//     question (JD2b), and two fixtures deliberately pin the local-name
//     convention. Left alone rather than papered over.
//   - an ambiguous specifier (`./util` resolving to ten different `util.js`).
//     Left unresolved, because guessing would attach the edge to a file the
//     import does not name. The file-dependency engine's basename fallback
//     remains the documented approximation for that case.
//
// So the honest win is the shape that IS well-defined: a named, unaliased
// import of an internal module, to a unique target file, where the item names
// exactly one symbol there.

export interface ImportTargetRow {
  /** brain_relationship.id — the row to update. */
  id: string
  /** `<module>:<item>` as the analyzer wrote it. */
  target_external: string
  /**
   * The importing file, when the lane spells it as a PATH.
   *
   * The doc here used to read "a module basename for import edges", and the
   * planner's ambiguity refusal was built on it — see the measurement in
   * `planImportResolutions`. Every lane that stamps `metadata.fileLevel`
   * (c, cpp, graphql, kotlin, nim, objc, php, scala, swift, zig, and
   * javascript since the file-level wave) has the store rewrite
   * `source_external` to the project-relative path, so for those lanes the
   * importing file IS in the row and a specifier can be resolved from its
   * directory. Lanes that still spell a basename are unchanged: the planner
   * falls through to the basename-keyed strategies exactly as before.
   */
  source_external: string | null
  /**
   * The name the MODULE DECLARES, when the analyzer recorded it (M60 / JD2b:
   * `declaredName` + `declaredKind` on the relationship's metadata). Present for
   * ESM import edges and absent for lanes that do not record it, in which case
   * the planner falls back to the item spelled in the target.
   */
  metadata?: { declaredName?: string; declaredKind?: string } | null
  /**
   * `brain_relationship.target_symbol_id` as stored — read only by
   * `settleImportTargets`, which re-decides rows that already carry one and so
   * needs to know whether a target is already the settled answer (idempotence)
   * and whether a settled NULL has a target to remove.
   */
  currentTarget?: string | null
  /**
   * The file the row's SOURCE symbol lives in — the second route to the row's
   * own file, for a lane whose `source_external` is not a path this project
   * contains. Settlement only; the planner reads `source_external`.
   */
  sourceFileId?: string | null
}

export interface ImportResolutionIndex {
  /** import specifier -> the file ids it resolves to, built file-aware from brain_import. */
  pathTargets: Map<string, Set<string>>
  /** file id -> relative_path */
  filePath: Map<string, string>
  /**
   * relative_path -> file id, the inverse of `filePath`.
   *
   * Exists for the importer-relative half of the planner: a row whose
   * `source_external` is a path can be resolved from THAT file's directory —
   * an exact answer — instead of the project-wide tail match, whose own
   * comment records it as the approximation it is.
   */
  fileIdByPath: Map<string, string>
  /**
   * file id -> the names the file EXPORTS.
   *
   * This is the gate that makes a resolution trustworthy, and it was added after
   * the first end-to-end run produced a confidently WRONG edge: `import { draw
   * as render }` emits the target `./widget.js:render` (the LOCAL binding), and
   * that file happens to contain an unrelated METHOD named `render`, so a
   * name-only match attached the import to `Widget.render` instead of the
   * function `draw`. An unresolved edge is honest — "we cannot tell". An edge
   * resolved to the wrong symbol is a confident lie that bb_graph, bb_impact
   * and hover will all repeat. So a target must be in the importing module's
   * EXPORT SURFACE before it may be joined, which is also the semantically
   * correct condition: an import can only name something the module exports.
   * When a file's export surface cannot be established, nothing in it resolves.
   */
  exportsByFile: Map<string, Set<string>>
  /**
   * file id -> the symbol id of its DEFAULT export, when it has one.
   *
   * `export default class X {}` publishes a SYMBOL named `X`, not `default`, so
   * a default import (`import Def from "./m"`, whose edge spells the local
   * binding `Def`) can only be resolved through the default-export FLAG on the
   * export edge. That is the same reason the export side emits a literal
   * "default" sentinel for the anonymous case.
   */
  defaultExportByFile: Map<string, string>
  /** file id -> symbol name -> symbol ids */
  symbolsByFile: Map<string, Map<string, string[]>>
  /** file relative_path basename (no extension) -> file ids */
  fileByTail: Map<string, string[]>
}

export interface ImportResolution {
  id: string
  symbolId: string
  fileId: string
  /** Why it resolved — recorded so a reader can audit the decision, not just trust it. */
  via: "unique-file+unique-symbol" | "unique-file+qualified-leaf" | "default-export-of-target" | "importer-relative-unique-file"
}

const PROBE_SUFFIXES = [
  "", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".json",
]
// `"index.js", "index.mjs", ".cjs", …` — the third entry was a copy-paste slip
// that dropped the `index` prefix, so `./bar` probed for `src/bar/.cjs`, a
// dotfile that essentially never exists. Every CommonJS directory import
// (`./bar` where bar/ holds index.cjs) therefore failed to resolve.
const INDEX_BASENAMES = ["index.js", "index.mjs", "index.cjs", "index.ts", "index.tsx", "index.jsx"]

/** Join a specifier onto an importer's directory and normalise `.` / `..`. */
export function resolveSpecifierPath(importerRelPath: string, specifier: string): string | null {
  if (!specifier) return null
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
    const dir = importerRelPath.includes("/") ? importerRelPath.slice(0, importerRelPath.lastIndexOf("/")) : ""
    const parts = (dir ? dir.split("/") : []).concat(specifier.split("/"))
    const out: string[] = []
    for (const seg of parts) {
      if (seg === "" || seg === ".") continue
      if (seg === "..") {
        // UNDERFLOW means the specifier climbs ABOVE the project root. The old
        // `out.pop()` on an empty array is a silent no-op, so `a.ts` importing
        // `../../escape` clamped to `escape` — and if a real `escape.ts` existed
        // the caller resolved it and emitted a cross-file edge to a module the
        // source never referenced. A false edge is worse than no edge: `bb_graph`
        // and `bb_impact` report it as truth.
        //
        // Climbing WITHIN the project is unaffected and still works:
        // `packages/a/src/index.ts` importing `../../b/src/index.ts` resolves to
        // `packages/b/src/index.ts`, because there is something to pop.
        if (out.length === 0) return null
        out.pop()
        continue
      }
      out.push(seg)
    }
    return out.join("/")
  }
  // A bare specifier is package-shaped unless it names a path we can see.
  if (specifier.includes("/") && !specifier.startsWith("@")) {
    return specifier.replace(/^\.\//, "")
  }
  return null
}

/**
 * Build the index from real rows. `imports` are (fileId, importPath) pairs as
 * stored in brain_import; `files` are (fileId, relativePath); `symbols` are
 * (fileId, name, symbolId).
 */
export function buildImportResolutionIndex(
  files: Array<{ fileId: string; relativePath: string }>,
  symbols: Array<{ fileId: string; name: string; symbolId: string }>,
  imports: Array<{ fileId: string; importPath: string }>,
  /**
   * Exported names per file, as (fileId, name) pairs. Callers derive these from
   * the `exports` relationships a module emitted; pass [] to refuse everything
   * (the safe direction).
   */
  exports: Array<{ fileId: string; name: string; isDefault?: boolean; symbolId?: string }> = [],
): ImportResolutionIndex {
  const filePath = new Map<string, string>()
  const fileByTail = new Map<string, string[]>()
  for (const f of files) {
    filePath.set(f.fileId, f.relativePath)
    const tail = f.relativePath.split("/").pop() ?? f.relativePath
    const stem = tail.includes(".") ? tail.slice(0, tail.lastIndexOf(".")) : tail
    const arr = fileByTail.get(stem) ?? []
    arr.push(f.fileId)
    fileByTail.set(stem, arr)
  }

  const symbolsByFile = new Map<string, Map<string, string[]>>()
  for (const s of symbols) {
    let byName = symbolsByFile.get(s.fileId)
    if (!byName) { byName = new Map(); symbolsByFile.set(s.fileId, byName) }
    const arr = byName.get(s.name) ?? []
    arr.push(s.symbolId)
    byName.set(s.name, arr)
  }

  // The file-aware half: resolve every specifier from the directory of the file
  // that wrote it, so `./util` means that importer's `util`, not another's.
  const pathTargets = new Map<string, Set<string>>()
  const byRel = new Map<string, string>()
  for (const [id, p] of filePath) byRel.set(p, id)
  // The inverse map, published on the index so the planner can resolve a
  // specifier against the importing file's own directory (see its note).
  const fileIdByPath = new Map(byRel)

  for (const imp of imports) {
    const importer = filePath.get(imp.fileId)
    if (!importer) continue
    const base = resolveSpecifierPath(importer, imp.importPath)
    if (base === null) continue
    for (const cand of candidatePaths(base)) {
      const hit = byRel.get(cand)
      if (hit) {
        const set = pathTargets.get(imp.importPath) ?? new Set<string>()
        set.add(hit)
        pathTargets.set(imp.importPath, set)
      }
    }
  }
  const exportsByFile = new Map<string, Set<string>>()
  const defaultExportByFile = new Map<string, string>()
  for (const e of exports) {
    const set = exportsByFile.get(e.fileId) ?? new Set<string>()
    set.add(e.name)
    exportsByFile.set(e.fileId, set)
    if (e.isDefault && e.symbolId) defaultExportByFile.set(e.fileId, e.symbolId)
  }

  return { pathTargets, filePath, fileIdByPath, symbolsByFile, fileByTail, exportsByFile, defaultExportByFile }
}

/**
 * Every file name a specifier could name, in probe order.
 *
 * The EXTENSION-SUBSTITUTION step is not speculative. Measured on a real
 * 468k-symbol TypeScript monorepo, the first cut of this function resolved
 * 53% of its resolvable set and reported the rest as "specifier not internal
 * here" — but 15,902 of those were RELATIVE specifiers, not packages, and they
 * failed for one reason: the project writes ESM-style `.js` specifiers that
 * name `.ts` sources (`import { X } from "../common/extHost.protocol.js"`
 * resolving to `.../extHost.protocol.ts`), which is what NodeNext/ESM
 * TypeScript requires. Appending extensions to a base that already ends in
 * `.js` can never produce `.ts`. So a JS-family extension is SWAPPED for each
 * of its TS/JS siblings as well, and the substitution is tried before the
 * append so an exact hit still wins.
 */
const JS_EXT_TO_SIBLINGS: Record<string, string[]> = {
  ".js": [".ts", ".tsx", ".mts", ".cts", ".jsx", ".mjs", ".cjs", ".js"],
  ".mjs": [".mts", ".ts", ".mjs"],
  ".cjs": [".cts", ".ts", ".cjs"],
  ".jsx": [".tsx", ".jsx"],
}

function candidatePaths(base: string): string[] {
  const out: string[] = [base]
  const dot = base.lastIndexOf(".")
  const slash = base.lastIndexOf("/")
  if (dot > slash && dot > 0) {
    const ext = base.slice(dot)
    const stem = base.slice(0, dot)
    for (const sib of JS_EXT_TO_SIBLINGS[ext] ?? []) out.push(stem + sib)
  }
  for (const ext of PROBE_SUFFIXES) {
    if (ext) out.push(base + ext)
  }
  for (const idx of INDEX_BASENAMES) out.push(`${base}/${idx}`)
  return out
}

/** Split `path:item` on the LAST colon — a specifier may itself contain one. */
/**
 * The file ids a specifier names when read from the importing file's own
 * directory, or `null` when that question cannot be asked of this row.
 *
 * `null` means "fall through to the basename-keyed strategies": the row carries
 * no importer, or its `source_external` is not a path this project contains (a
 * basename-spelling lane), or the specifier is not path-shaped (a package). An
 * EMPTY set means the specifier is path-shaped and names nothing here, which is
 * also a fall-through — `brain_import` may hold a spelling this probe cannot
 * reconstruct (an extensionless directory import, an alias), and the caller's
 * other strategies know about those.
 */
function importerRelativeFileIds(
  index: ImportResolutionIndex,
  importerPath: string | null,
  specifier: string,
): Set<string> | null {
  if (!importerPath || !index.fileIdByPath.has(importerPath)) return null
  const base = resolveSpecifierPath(importerPath, specifier)
  if (base === null) return null
  const hits = new Set<string>()
  for (const cand of candidatePaths(base)) {
    const hit = index.fileIdByPath.get(cand)
    if (hit) hits.add(hit)
  }
  return hits
}

export function splitImportTarget(targetExternal: string): { path: string; item: string } | null {
  const i = targetExternal.lastIndexOf(":")
  if (i <= 0 || i === targetExternal.length - 1) return null
  return { path: targetExternal.slice(0, i), item: targetExternal.slice(i + 1) }
}

/**
 * Plan the updates. Pure: no DB, no I/O — every decision is a function of the
 * index, which is what makes it exhaustively testable.
 */
export function planImportResolutions(
  rows: ImportTargetRow[],
  index: ImportResolutionIndex,
): ImportResolution[] {
  const out: ImportResolution[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (seen.has(row.id)) continue
    const split = splitImportTarget(row.target_external ?? "")
    if (!split) continue
    const { path, item } = split
    const declaredKind = row.metadata?.declaredKind
    // A namespace/star import has no single target symbol. Declining is the
    // honest answer; resolving it would invent a node.
    if (item === "*" || declaredKind === "namespace") continue

    // ── IMPORTER-RELATIVE, FIRST ────────────────────────────────────────
    //
    // When the row names the importing file as a PATH, the specifier can be
    // resolved from that file's own directory. MEASURED on the pinned JS draw
    // (250 files, post file-level wave) before this branch existed: 926 of
    // 1,202 `imports` rows were detached, and of the 693 that named a RELATIVE
    // internal module, 234 named a module that is in the sample and declares
    // the item — a should-bind population declined by two gates below, the
    // ambiguity refusal being one of them (`ambiguity-multiple-files`, whose
    // own comment says the tie cannot be broken "because the row carries no
    // importing file"). That premise is what the path spelling removed.
    //
    // It is also strictly better than the alternatives it precedes: the
    // brain_import-derived `pathTargets` map is keyed by the specifier STRING, so
    // one `./utils.js` spelled by three importers yields a 3-element set and the
    // row is refused, even though each importer's meaning is unambiguous.
    const importerRelative = importerRelativeFileIds(index, row.source_external, path)
    let via: ImportResolution["via"] = "unique-file+unique-symbol"
    let fileIds: Set<string> | undefined
    if (importerRelative && importerRelative.size > 1) continue
    if (importerRelative && importerRelative.size === 1) {
      fileIds = importerRelative
      via = "importer-relative-unique-file"
    } else {
      fileIds = index.pathTargets.get(path)
    }

    if (!fileIds || fileIds.size === 0) {
      // No brain_import row for this specifier (a lane that does not persist
      // per-file imports, or a re-export). Fall back to a project-wide tail
      // match, and accept it ONLY when it is unique.
      const tail = path.split("/").pop() ?? path
      const stem = tail.includes(".") ? tail.slice(0, tail.lastIndexOf(".")) : tail
      const cands = index.fileByTail.get(stem) ?? []
      if (cands.length === 1) fileIds = new Set(cands)
      else continue
    }

    if (fileIds.size > 1) {
      // AMBIGUOUS FOR THIS STRATEGY, and still refused here. The importer-first
      // branch above already broke every tie it can (and this branch is reached
      // exactly when it could not, i.e. when the row carries no importer path
      // or the specifier resolves to several files from that directory). What
      // remains true — and the reason a fallback cannot fix it — is that a
      // strategy matching the specifier string PROJECT-WIDE has no importer to
      // break the tie with; `source_external` for a basename-spelling lane says
      // nothing about which of the candidate TARGET files was meant. (A first
      // cut of this function compared the importer's name against the
      // candidates' names — incoherent, and the unit test caught it: it can
      // never narrow to exactly one. Removed rather than kept as plausible-
      // looking code.)
      //
      // So: refuse. The file-DEPENDENCY engine keeps its documented basename
      // approximation for this case (intelligence/analysis/dependencies.ts,
      // "We approximate"); a symbol-level edge has no such fallback, and
      // guessing one would attach the import to a file it does not name.
      continue
    }

    const fileId = [...fileIds][0]

    // JD2b: a DEFAULT import resolves through the target module's default
    // export, which is the only honest route — the edge spells the local
    // binding and the published symbol carries the declared name.
    if (declaredKind === "default") {
      const def = index.defaultExportByFile.get(fileId)
      if (def) { out.push({ id: row.id, symbolId: def, fileId, via: "default-export-of-target" }); seen.add(row.id) }
      continue
    }

    // JD2b: otherwise prefer the DECLARED name when the analyzer recorded it.
    // `import { a as b }` spells `b` in the target; the declared name is `a`.
    const wanted = row.metadata?.declaredName && row.metadata.declaredName !== "*"
      ? row.metadata.declaredName
      : item
    const byName = index.symbolsByFile.get(fileId)
    if (!byName) continue
    // THE GATE: only a name the target file actually exports may be joined.
    // See exportsByFile's note for the wrongly-resolved `render` this prevents.
    // It tests the DECLARED name, which is the one that can be in the surface.
    const exported = index.exportsByFile.get(fileId)
    if (!exported || !exported.has(wanted)) continue
    const direct = byName.get(wanted)
    if (direct && direct.length === 1) {
      out.push({ id: row.id, symbolId: direct[0], fileId, via })
      seen.add(row.id)
      continue
    }
    // `Owner.member`: the imported name is a member of an exported owner. The
    // analyzer emits `qualified_name` for those, so try the leaf against the
    // file's symbols rather than inventing an owner.
    if (wanted.includes(".")) {
      const leaf = wanted.slice(wanted.lastIndexOf(".") + 1)
      const leafHits = byName.get(leaf)
      if (leafHits && leafHits.length === 1) {
        out.push({ id: row.id, symbolId: leafHits[0], fileId, via: "unique-file+qualified-leaf" })
        seen.add(row.id)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// The DB-facing wrapper. Both resolver sites call THIS, so the logic exists once.
// (Before this, resolution logic already existed in two places — inline in
// storeResults and standalone in resolveRelationships — which is how a whole
// edge class came to be invisible to both.)
// ---------------------------------------------------------------------------

/** The slice of a better-sqlite3 / bun:sqlite handle this needs. */
export interface MinimalDb {
  prepare(sql: string): {
    all(...params: any[]): any[]
    get(...params: any[]): any
    run(...params: any[]): any
  }
  run(sql: string, ...params: any[]): any
}

export interface ImportResolutionOutcome {
  scanned: number
  resolved: number
  byReason: Record<string, number>
}

/**
 * What the SETTLEMENT pass did — see `settleImportTargets`.
 *
 * `corrected` and `settled` are the two halves of the same closure: a row the
 * module-aware planner proves is CORRECTED to the planner's answer (whatever the
 * insert path had attached), and a row it cannot prove is SETTLED by the same
 * leaf ranking the insert path used, re-evaluated over the complete table.
 * `unchanged` is the idempotence gauge: on a second run over the same store it
 * counts every row, and `corrected`/`settled` are 0.
 */
export interface ImportSettlementOutcome {
  scanned: number
  planned: number
  corrected: number
  settled: number
  unresolved: number
  unchanged: number
  /**
   * Rows that carried a target WHEN THE PASS RAN — the population it actually
   * re-decided. A gauge rather than a verdict: on a draw whose `module:item`
   * rows are all detached it reads 0, which says the fixed point was checked on
   * nothing rather than that it held. `scanned` is the population; this is the
   * half of it the pass could disagree with.
   */
  attached: number
  byReason: Record<string, number>
}

/**
 * One candidate the leaf ranking can choose — a symbol plus the two things the
 * ranking compares it against: its file and that file's language.
 */
interface LeafCandidate {
  symbolId: string
  fileId: string
  isDeclaration: number
  language: string
}

/**
 * `resolveTargetStmt`'s ranking, re-evaluated in memory over a symbol table that
 * is COMPLETE.
 *
 * The insert path asks SQLite
 *
 *   ORDER BY COALESCE(s.is_declaration, 0) ASC, (s.file_id = ?) DESC,
 *            (f.language = ?) DESC, s.id
 *   LIMIT 1
 *
 * with `?` the file and language of the file being stored, and with `LIMIT 1`
 * over whatever the table held AT THAT MOMENT. For a parallel index that is a
 * prefix — the batches land as workers finish — so the answer was a function of
 * scheduling rather than of the store. This is the same total order with the
 * same four keys, answered once the table is complete: a definition ahead of a
 * declaration, then the row's own file, then the row's own language, then the
 * id. It is a fixed point (ranking a table cannot change the table), which is
 * what makes the pass built on it idempotent.
 *
 * The id comparison is a string compare, which is what SQLite's default BINARY
 * collation does to these ids byte-for-byte; the two orderings part company
 * only on code points at or above U+10000, where UTF-16 orders a surrogate pair
 * below U+E000 and UTF-8 does not. Ids are `project:path:name:line`, so that
 * needs an astral character in a path AND a tie on all three keys above.
 */
function rankLeafCandidates(
  cands: LeafCandidate[],
  rowFile: string | null,
  rowLang: string,
): string | null {
  if (cands.length === 0) return null
  let best = cands[0]
  for (const c of cands) {
    let cmp = 0
    if (best.isDeclaration !== c.isDeclaration) cmp = best.isDeclaration - c.isDeclaration
    else {
      const bs = rowFile != null && best.fileId === rowFile ? 1 : 0
      const cs = rowFile != null && c.fileId === rowFile ? 1 : 0
      if (bs !== cs) cmp = cs - bs
      else {
        const bl = best.language === rowLang ? 1 : 0
        const cl = c.language === rowLang ? 1 : 0
        if (bl !== cl) cmp = cl - bl
        else cmp = best.symbolId < c.symbolId ? -1 : best.symbolId > c.symbolId ? 1 : 0
      }
    }
    if (cmp > 0) best = c
  }
  return best.symbolId
}

/**
 * The five inputs both import-resolution passes read, loaded once so the export
 * surface is recovered by ONE piece of code rather than two copies.
 */
interface ImportResolutionInputs {
  files: Array<{ fileId: string; relativePath: string; language: string }>
  symbols: Array<{ symbolId: string; fileId: string; name: string; isDeclaration: number }>
  imports: Array<{ fileId: string; importPath: string }>
  rows: ImportTargetRow[]
  exports: Array<{ fileId: string; name: string; isDefault?: boolean; symbolId?: string }>
}

/**
 * Load them, or `null` when the store cannot answer.
 *
 * `unresolvedOnly` is the one difference between the two callers, and it is a
 * QUERY-level difference on purpose: `resolveImportTargets` fills NULLs and must
 * not revisit a row another strategy already claimed, while `settleImportTargets`
 * reads EVERY row, because re-deciding rows that already carry a target is
 * exactly its job. The extra columns (`language`, `is_declaration`) are the two
 * keys the leaf ranking compares on and the target-null/`sourceFileId` pair is
 * what settlement needs; they cost nothing to read for the filler, which
 * ignores them.
 */
function loadImportInputs(
  db: MinimalDb,
  projectId: string,
  opts: { unresolvedOnly: boolean },
): ImportResolutionInputs | null {
  try {
    const files = db.prepare(
      `SELECT id AS fileId, relative_path AS relativePath, COALESCE(language, '') AS language
         FROM brain_file WHERE project_id = ?`,
    ).all(projectId) as ImportResolutionInputs["files"]
    const symbols = db.prepare(
      `SELECT id AS symbolId, file_id AS fileId, name AS name, COALESCE(is_declaration, 0) AS isDeclaration
         FROM brain_symbol WHERE project_id = ?`,
    ).all(projectId) as ImportResolutionInputs["symbols"]
    const imports = db.prepare(
      `SELECT file_id AS fileId, import_path AS importPath FROM brain_import WHERE project_id = ?`,
    ).all(projectId) as ImportResolutionInputs["imports"]
    const rows = db.prepare(
      `SELECT r.id AS id, r.target_external AS target_external, r.source_external AS source_external,
              r.metadata AS metadata, r.target_symbol_id AS currentTarget,
              ss.file_id AS sourceFileId
         FROM brain_relationship r
         LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
        WHERE r.project_id = ? AND r.relationship_type = 'imports'
          AND r.target_external IS NOT NULL AND instr(r.target_external, ':') > 0
          ${opts.unresolvedOnly ? "AND r.target_symbol_id IS NULL" : ""}`,
    ).all(projectId) as ImportTargetRow[]
    for (const r of rows) {
      if (typeof r.metadata === "string") {
        try { r.metadata = JSON.parse(r.metadata) } catch { r.metadata = null }
      }
    }

    // The export surface, keyed by FILE. An `exports` edge carries no file on
    // its source side (its source symbol is the module, which is not a symbol),
    // so the file is recovered from `source_external` and the row's own target
    // symbol. TWO spellings occur, and this is the whole of the recovery:
    //
    //   PATH       the file-level lanes write the project-relative path (the
    //              store rewrites it from metadata.fileLevel), so the check is
    //              exact: the spelling must equal the exported symbol's own
    //              file's path. NOTHING ELSE CAN MATCH IT, which is why this is
    //              tried first.
    //   BASENAME   the older spelling, kept for every lane that still writes
    //              one: the basename is accepted only when it is UNIQUE in the
    //              project AND names the same file the symbol lives in.
    //
    // The path branch is not a nicety. Before it, a path-spelling lane's export
    // rows matched no basename key, so EVERY file in the lane had an EMPTY
    // export surface, and the gate below — "a target must be in the importing
    // module's export surface before it may be joined" — then declined every
    // import into the lane, correctly by its own rule and for a reason that had
    // nothing to do with the edges. MEASURED on the pinned JS draw: 234 detached
    // `imports` rows name an internal module whose declaration is in the sample,
    // and this was the gate that declined them.
    const exportRows = db.prepare(
      `SELECT source_external AS src, target_external AS tgt, target_symbol_id AS sym, metadata
         FROM brain_relationship
        WHERE project_id = ? AND relationship_type = 'exports' AND target_external IS NOT NULL`,
    ).all(projectId) as Array<{ src: string | null; tgt: string; sym: string | null; metadata: string | null }>
    const byBase = new Map<string, string[]>()
    for (const f of files) {
      const tail = f.relativePath.split("/").pop() ?? f.relativePath
      const stem = tail.includes(".") ? tail.slice(0, tail.lastIndexOf(".")) : tail
      const arr = byBase.get(stem) ?? []
      arr.push(f.fileId)
      byBase.set(stem, arr)
    }
    const symFile = new Map<string, string>()
    for (const sy of symbols) symFile.set(sy.symbolId, sy.fileId)
    const relPathOfFile = new Map<string, string>()
    const relPathToFile = new Map<string, string>()
    for (const f of files) {
      relPathOfFile.set(String(f.fileId), String(f.relativePath))
      relPathToFile.set(String(f.relativePath), String(f.fileId))
    }
    // (file, name) -> symbol ids, for the recovery below. Built here rather than
    // re-queried so the recovery reads the same rows the rest of this pass does.
    const symIdsByNameInFile = new Map<string, string[]>()
    for (const sy of symbols) {
      const key = `${sy.fileId}\u0000${sy.name}`
      const arr = symIdsByNameInFile.get(key) ?? []
      arr.push(sy.symbolId)
      symIdsByNameInFile.set(key, arr)
    }
    const exports: ImportResolutionInputs["exports"] = []
    for (const er of exportRows) {
      let isDefault = false
      let localName: string | undefined
      if (er.metadata) {
        try {
          const m = JSON.parse(er.metadata)
          isDefault = m?.isDefault === true
          localName = typeof m?.localName === "string" ? m.localName : undefined
        } catch { /* unparsed: not a default */ }
      }
      let symbolId = er.sym
      let fileId = symbolId ? symFile.get(symbolId) : undefined
      // A NAMED default declaration is exported under the name `default`
      // (ECMAScript: `export default function fragment(){}` publishes the name
      // `default`), which is in the symbol denylist and matches no symbol — so
      // the row cannot resolve by name and the default export stays invisible to
      // every importer of that module. MEASURED (`js-default-export-probe.ts`):
      // `export default class Main` stores `exports target=default
      // isDefault=true` with no target symbol, `defaultExportByFile` is empty,
      // and `import Def from "./lib.js"` therefore never resolves — the JD2.4
      // check of script/m40/verify-import-resolution.ts has been red since the
      // naming decision landed.
      //
      // The name is not lost: the analyzer records the declaration's own name in
      // this row's metadata (`viaDefaultDeclaration.localName`, and `localName`
      // for `export { x as default }`) precisely so it can be recovered. This is
      // that recovery — the declaration's name, in the row's OWN file, and only
      // when it identifies exactly one symbol. Nothing is guessed: a file with
      // two same-named symbols stays unresolved.
      if (!fileId && isDefault && localName) {
        const f = relPathToFile.get(String(er.src ?? ""))
        if (f) {
          const ids = symIdsByNameInFile.get(`${f}\u0000${localName}`) ?? []
          if (ids.length === 1) { fileId = f; symbolId = ids[0] }
        }
      }
      if (!fileId || !symbolId) continue
      const spelling = er.src ?? ""
      // Exact for a path spelling; basename-uniqueness for the older one.
      if (relPathOfFile.get(fileId) !== spelling) {
        const cands = byBase.get(spelling) ?? []
        if (cands.length !== 1 || cands[0] !== fileId) continue
      }
      exports.push({ fileId, name: er.tgt, isDefault, symbolId })
    }
    return { files, symbols, imports, rows, exports }
  } catch (e: any) {
    // A project with no import table, or a store that has not been migrated,
    // must not fail an index run over a relationship class that is a bonus.
    return null
  }
}

/**
 * Resolve the `<module>:<item>` import edges this project left unresolved.
 * Safe to call when there is nothing to do; never throws into the caller.
 *
 * `opts.onlyRowIds` restricts the call to a caller-supplied row set. It exists
 * for the bounded incremental pass, which must make the SAME decisions as the
 * full pass — the modules/symbols/exports tables it reads are project-wide
 * either way, and a second copy of these rules is exactly what this file was
 * factored out to prevent — while writing only the rows its own run re-stored,
 * so a `--changed` run cannot silently resolve rows in files it never touched.
 * Absent = the whole project (the full pass).
 */
export function resolveImportTargets(
  db: MinimalDb,
  projectId: string,
  opts: { onlyRowIds?: Set<string> } = {},
): ImportResolutionOutcome {
  const byReason: Record<string, number> = {}
  const bump = (k: string) => { byReason[k] = (byReason[k] ?? 0) + 1 }
  const out: ImportResolutionOutcome = { scanned: 0, resolved: 0, byReason }
  const inputs = loadImportInputs(db, projectId, { unresolvedOnly: true })
  if (!inputs) return out
  const { files, symbols, imports, exports } = inputs
  const rows = opts.onlyRowIds ? inputs.rows.filter((r) => opts.onlyRowIds!.has(r.id)) : inputs.rows
  out.scanned = rows.length
  if (rows.length === 0) return out

  const index = buildImportResolutionIndex(files, symbols, imports, exports)
  const plan = planImportResolutions(rows, index)

  const planned = new Set(plan.map((p) => p.id))
  const update = db.prepare(
    `UPDATE brain_relationship
        SET target_symbol_id = ?,
            is_cross_file = CASE WHEN ? IS NOT NULL AND ? != (
                  SELECT file_id FROM brain_symbol WHERE id = ?
                ) THEN 1 ELSE 0 END
      WHERE id = ? AND target_symbol_id IS NULL`,
  )
  let resolved = 0
  for (const p of plan) {
    try {
      // the UPDATE is guarded on `target_symbol_id IS NULL`, so a row another
      // strategy already claimed is left alone and counted once
      const r = update.run(p.symbolId, p.fileId, p.fileId, p.symbolId, p.id)
      const changed = typeof r?.changes === "number" ? r.changes : 1
      if (changed > 0) resolved += changed
    } catch { /* one bad row must not abandon the pass */ }
  }
  out.resolved = resolved

  for (const r of rows) {
    if (planned.has(r.id)) continue
    const t = r.target_external ?? ""
    const i = t.lastIndexOf(":")
    if (i <= 0) { bump("no-colon-in-target"); continue }
    const item = t.slice(i + 1)
    if (item === "*") { bump("namespace-star-no-single-target"); continue }
    const spec = t.slice(0, i)
    // The classification must know about the importer-relative branch, or it
    // reports the WRONG reason for every row that branch could have resolved:
    // `pathTargets` is keyed by the specifier STRING, so it says "ambiguous"
    // about rows whose file WAS identified from their own importer and whose
    // refusal was really about the item or the export surface. A diagnostic that
    // names the wrong gate sends the next reader to the wrong code.
    const relHits = importerRelativeFileIds(index, r.source_external, spec)
    if (relHits && relHits.size > 1) { bump("importer-relative-multiple-files"); continue }
    if (relHits && relHits.size === 0) { bump("specifier-not-internal"); continue }
    if (relHits && relHits.size === 1) {
      const ex = index.exportsByFile.get([...relHits][0])
      bump(!ex ? "no-export-surface-recorded" : (ex.has(item) ? "no-such-symbol-in-target-file" : "item-not-exported-by-target"))
      continue
    }
    const tg = index.pathTargets.get(spec)
    if (!tg || tg.size === 0) { bump("specifier-not-internal"); continue }
    if (tg.size > 1) { bump("ambiguous-multiple-files"); continue }
    const ex = index.exportsByFile.get([...(tg ?? [])][0])
    bump(!ex ? "no-export-surface-recorded" : (ex.has(item) ? "no-such-symbol-in-target-file" : "item-not-exported-by-target"))
  }
  return out
}

/**
 * SETTLE the `<module>:<item>` targets: make every one of them a function of the
 * COMPLETE tables rather than of the order the parallel batches happened to be
 * stored in.
 *
 * ## The defect this removes
 *
 * `storeResults` resolves each relationship's target as it stores the batch, with
 * `resolveTargetStmt` — ranked on the target's LEAF name, `LIMIT 1`, over
 * whatever the symbol table held AT THAT MOMENT. A parallel index stores batches
 * in worker-completion order, so a leaf match that had two candidate files
 * answered differently from run to run, and every later pass was guarded on
 * `target_symbol_id IS NULL`, which made the first answer FINAL. Measured on the
 * pinned 250-file JS draw, indexing the same source twice:
 *
 *   row identity, symbol identity, planner decisions   0 differences
 *   resolved targets of `imports` rows                 4–42 rows differ per pair
 *
 * Every divergent row is this form, so this pass closes the class: it is the
 * first point at which BOTH tables are complete and the import/export evidence
 * exists, and it re-decides every row rather than only the NULL ones.
 *
 * ## The rule, and why it is this rule
 *
 *   proven by the module-aware planner   → the planner's answer, ALWAYS.
 *     The planner resolves the specifier from the importing file's own directory
 *     and gates on the target module's export surface, so it is evidence rather
 *     than a guess; when it is right it must not lose to a name match the insert
 *     path made against a partial table.
 *   otherwise                            → `rankLeafCandidates` over the
 *     COMPLETE symbol table, the same four keys the insert path used. This is
 *     the insert path's own policy, evaluated correctly; the alternative
 *     (detach everything the planner does not prove) would discard a mechanism
 *     this lane uses everywhere else — a bare `name` target is attached by
 *     exactly this ranking, deterministically, by the I13 pass.
 *
 * Both halves are idempotent: the planner's plan is a pure function of the
 * tables, and ranking a complete table cannot change it. A second run over the
 * same store therefore reports `corrected: 0, settled: 0` with every row counted
 * `unchanged`, which is the property the gate asserts.
 *
 * ## What it costs, measured on the pinned draw (250 files)
 *
 *   1,203 `module:item` import rows
 *    519 attach a target, 684 do not
 *    503 are planner-proven; of the rows that already carried a target, 115
 *        stored something OTHER than the planner's answer and are CORRECTED
 *     22 detached rows gain a target — the ranking can answer them because the
 *        LEAF name exists somewhere in the project. That is the honest price of
 *        determinism, and it is the same answer the insert path already
 *        produced whenever the name happened to be stored early enough; the
 *        other 662 detached rows have no same-named symbol anywhere and stay
 *        detached in every run.
 *      1 attached row the ranking re-rank (the two mechanisms agreed on the
 *        rest).
 *
 * A store that has not been through the insert path at all (a fresh, unwritten
 * project, or a lane whose analyzer emits no `imports` edges) reads as
 * `scanned: 0` and does nothing.
 */
export function settleImportTargets(db: MinimalDb, projectId: string): ImportSettlementOutcome {
  const byReason: Record<string, number> = {}
  const bump = (k: string) => { byReason[k] = (byReason[k] ?? 0) + 1 }
  const out: ImportSettlementOutcome = {
    scanned: 0, planned: 0, corrected: 0, settled: 0, unresolved: 0, unchanged: 0,
    attached: 0, byReason,
  }
  const inputs = loadImportInputs(db, projectId, { unresolvedOnly: false })
  if (!inputs) return out
  const { files, symbols, imports, rows, exports } = inputs
  out.scanned = rows.length
  if (rows.length === 0) return out

  const index = buildImportResolutionIndex(files, symbols, imports, exports)
  const plan = planImportResolutions(rows, index)
  const provenById = new Map(plan.map((p) => [p.id, p]))
  out.planned = plan.length

  const fileLang = new Map<string, string>()
  for (const f of files) fileLang.set(f.fileId, f.language)
  const candidatesByName = new Map<string, LeafCandidate[]>()
  for (const s of symbols) {
    const arr = candidatesByName.get(s.name) ?? []
    arr.push({
      symbolId: s.symbolId,
      fileId: s.fileId,
      isDeclaration: s.isDeclaration ?? 0,
      language: fileLang.get(s.fileId) ?? "",
    })
    candidatesByName.set(s.name, arr)
  }

  // TARGET ONLY, deliberately. `is_cross_file` is DERIVED from the settled
  // target, so it has exactly one writer and that writer is the store-wide
  // closure in `resolveRelationships` (`_xf_src`), which runs after this pass and
  // before the cross-language normalization. Writing it here as well was the
  // shape that made the flag differ between runs with the TARGET held fixed: this
  // pass only rewrites the rows whose target it MOVES, so a row whose target it
  // confirms kept whatever the earlier writer (the planner's UPDATE, strategies
  // 1-3, or the insert path) had stored — and which of those ran for a row is
  // itself scheduling-dependent. See JSD51 in the lane doc for the measurement.
  const update = db.prepare(`UPDATE brain_relationship SET target_symbol_id = ? WHERE id = ?`)
  // A settled answer of NULL means "still detached", and a row that carries a
  // target the ranking cannot reproduce is one the insert path attached out of a
  // prefix that the complete table does not support. Detaching it is the
  // deterministic answer, and it is the only branch here that REMOVES an edge.
  const detach = db.prepare(`UPDATE brain_relationship SET target_symbol_id = NULL WHERE id = ?`)

  for (const row of rows) {
    const split = splitImportTarget(row.target_external ?? "")
    if (!split) { bump("not-module-item-form"); continue }
    const proven = provenById.get(row.id)
    // The row's own file: the importing file's PATH when the source spelling is
    // one this project contains (the file-level lanes — the same spelling
    // `importerRelativeFileIds` reads), else the file its source SYMBOL lives in.
    const rowFile = (row.source_external != null
      ? index.fileIdByPath.get(row.source_external) ?? null
      : null) ?? row.sourceFileId ?? null
    const rowLang = rowFile != null ? fileLang.get(rowFile) ?? "" : ""
    const settled = proven
      ? proven.symbolId
      : rankLeafCandidates(candidatesByName.get(split.item) ?? [], rowFile, rowLang)
    const current = row.currentTarget ?? null
    if (current != null) out.attached++

    if (settled == null) {
      out.unresolved++
      if (current != null) {
        try {
          const r = detach.run(row.id)
          if ((typeof r?.changes === "number" ? r.changes : 1) > 0) out.settled++
        } catch { /* one bad row must not abandon the pass */ }
      }
      continue
    }
    if (current === settled) { out.unchanged++; continue }
    try {
      const r = update.run(settled, row.id)
      if ((typeof r?.changes === "number" ? r.changes : 1) > 0) {
        if (proven) out.corrected++
        else out.settled++
      }
    } catch { /* one bad row must not abandon the pass */ }
  }
  return out
}
