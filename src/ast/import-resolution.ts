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
  opts: { unresolvedOnly: boolean; onlySourceFileIds?: string[] },
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
    // ── the row's OWN file, for a scoped caller ────────────────────────────
    //
    // `onlySourceFileIds` exists for the bounded incremental pass, which must
    // decide a re-stored file's import rows with the SAME rules the full pass
    // runs while writing only the rows its own run owns. Three routes name the
    // row's own file, in the order the store makes them true:
    //   the source SYMBOL's file      (an attributed row)
    //   the `:rel:file:<path>:` anchor in the row's own id
    //                                 (a FILE-level row: the store writes the
    //                                  anchor exactly when the source did not
    //                                  resolve, so it is a contract, and the
    //                                  match is a containment test rather than a
    //                                  parse because a path may contain ':')
    //   `source_external` as a path   (the file-level lanes' spelling, which the
    //                                  store rewrites to the project-relative
    //                                  path for exactly those rows)
    // A row whose own file cannot be determined is NOT kept: the scoped caller
    // would be writing a row it cannot prove it owns.
    if (opts.onlySourceFileIds && opts.onlySourceFileIds.length > 0) {
      const allowed = opts.onlySourceFileIds
      const allowedPaths = allowed.map((fid) => relPathOfFile.get(String(fid)) ?? "").filter((p) => p.length > 0)
      const anchors = allowedPaths.map((p) => `:rel:file:${p}:`)
      return {
        files,
        symbols,
        imports,
        exports,
        rows: rows.filter((r) => {
          if (r.sourceFileId && allowed.includes(String(r.sourceFileId))) return true
          if (anchors.some((a) => r.id.includes(a))) return true
          const p = typeof r.source_external === "string" ? r.source_external : ""
          return p.length > 0 && allowedPaths.includes(p)
        }),
      }
    }
    return { files, symbols, imports, rows, exports }
  } catch (e: any) {
    // A project with no import table, or a store that has not been migrated,
    // must not fail an index run over a relationship class that is a bonus.
    return null
  }
}

/**
 * THE OWNERSHIP PREDICATE, WRITTEN ONCE.
 *
 * A bounded run may write only the rows IT owns, and the store records ownership in three
 * ways — all three are contracts the store's own code states, so none of them is a guess:
 *
 *   the source SYMBOL's file     `brain_relationship.source_symbol_id` -> `brain_symbol.file_id`.
 *                                An attributed row. The common case.
 *   a FILE-LEVEL row's own file  `source_external` holds the importing file's PROJECT-RELATIVE
 *                                PATH (M60/#910: "the row's `source_external` now holds the
 *                                project-relative path every reader keys on"). The row has no
 *                                source symbol to attribute it to, so this field IS its owner.
 *   a FILE-LEVEL row's target   the target names a symbol declared in one of these files. The
 *                                store writes such a row when the analyzer's source was a file
 *                                scope (`exports`, file-level `uses`/`calls`/`imports`).
 *
 * The THIRD arm alone was not enough, and the failure is measured, not argued: with only the
 * symbol and target arms, the deciders declined a file-level `imports` row whose target is a
 * colon-spelled module item (`zimmerframe:walk` names no symbol), so a routine re-index left
 * it unresolved while a full index bound it — 9 rows of 9,563 in
 * `script/m14/verify-store-path-parity.ts`, every one an `imports` row, and the gate's own
 * "no row LOSES its resolved target" invariant caught it. The `source_external` arm is what
 * proves those rows belong to the run that touched their file.
 *
 * `sourceFileIds` are brain_file ids; the relative paths come from the same table, one query.
 *
 * THE CLAUSE IS WRITTEN AGAINST AN ALIAS, and the caller must give the one its statement uses.
 * It defaults to the QUALIFIED table name (`brain_relationship`) because four of the five call
 * sites write `UPDATE brain_relationship ... FROM ...` and reference the table unaliased. The
 * fifth (`_rn_src`, in `resolveRankedBareNameTargets`) aliases it as `r`, and a clause naming a
 * column of an alias the statement does not have does not weaken the scope — SQLite REJECTS the
 * statement, the decider's own `catch` swallows it, and the pass reports `scanned: 0`. That is
 * how the ranked arm became SILENTLY INERT for one round: lane `c` of
 * `script/m65/verify-refresh-resolution.ts` (the prototype/definition pair the arm was written
 * for) read `scanned: 0` and its three checks failed on exactly the rows the arm exists to
 * bind. An alias parameter makes that unrepresentable rather than documented.
 */
function ownershipScope(
  db: MinimalDb,
  projectId: string,
  sourceFileIds: string[] | undefined,
  alias = "brain_relationship",
): { clause: string; args: any[]; paths: string[] } {
  if (!sourceFileIds || sourceFileIds.length === 0) return { clause: "", args: [], paths: [] }
  const ids = sourceFileIds
  const t = alias.endsWith(".") ? alias : `${alias}.`
  const paths = (db
    .prepare(
      `SELECT relative_path AS p FROM brain_file WHERE project_id = ? AND id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(projectId, ...ids) as Array<{ p: string }>).map((r) => String(r.p ?? "")).filter((p) => p.length > 0)
  const idPh = ids.map(() => "?").join(",")
  const pathPh = paths.length > 0 ? paths.map(() => "?").join(",") : null
  const clause = ` AND (${t}source_symbol_id IN (SELECT id FROM brain_symbol WHERE project_id = ? AND file_id IN (${idPh}))
      OR (${t}source_symbol_id IS NULL AND (
           ${pathPh ? `${t}source_external IN (${pathPh}) OR ` : ""}${t}target_external IN (SELECT qualified_name FROM brain_symbol WHERE project_id = ? AND qualified_name IS NOT NULL AND file_id IN (${idPh}))
        OR ${t}target_external IN (SELECT name FROM brain_symbol WHERE project_id = ? AND file_id IN (${idPh}))
      )))`
  const args: any[] = [projectId, ...ids]
  if (pathPh) args.push(...paths)
  args.push(projectId, ...ids, projectId, ...ids)
  return { clause, args, paths }
}

/**
 * Decide a row's target by NAME, over the COMPLETE symbol table: the qualified
 * name first, then a name that is UNIQUE project-wide. These are the two rules
 * the full pass runs (strategies 1 and 2 of `resolveRelationships`), and this
 * function exists so a second path can make the SAME decision without a second
 * copy of it — the JSD44 lesson, where one list written four times left three
 * copies refusing the names the fourth had just admitted.
 *
 * WHY THE BOUNDED PATH NEEDS IT. `storeResults` no longer ranks a bare name by
 * proximity over the symbol table as it stood when the batch landed (J12): the
 * insert path decides only what the ROW's OWN FILE proves and defers everything
 * else to the passes that read the complete tables. The full index runs
 * `resolveRelationships` after the store, so a deferred row is decided there —
 * but the bounded incremental pass runs neither that pass nor the store's own
 * resolution (its batches are stored with `skipResolution: true`), so after the
 * J12 fix a re-stored file's own cross-file edge had NO decider and stayed NULL.
 * MEASURED by the M40 lifecycle corpus: S2 (`bb_edit` inserting a call to a
 * function in another file) read 0 resolved edges and failed, and S3 then
 * counted the leftover as an orphan (3 rows against a 0 baseline) — both green
 * once this ran, and nothing else in that corpus moved.
 *
 * `opts.sourceFileIds` restricts the writes to rows whose SOURCE symbol lives in
 * one of these files — the rows a bounded run owns. Absent = the whole project
 * (the full pass). Reads are project-wide either way; only the UPDATEs are
 * scoped, which is the bounded path's contract (a `--changed` run must not write
 * a row in a file it never touched).
 *
 * OWN-FILE PREFERENCE IS PART OF THE RULE, not a caller's flourish. The full
 * pass runs four arms in a fixed order — own-file qualified name, own-file
 * name, project-wide qualified name, project-wide unique name — because the two
 * project-wide tables collapse every name to ONE global winner (`MIN(id)`), so
 * a name declared in the row's own file would otherwise bind to a same-named
 * symbol elsewhere (measured on libxslt: 138 of 388 `calls` edges). A scoped
 * caller that skipped the own-file arms would write targets the full pass
 * itself would not have chosen, which is why they are here and first.
 */
export function resolveNameTargets(
  db: MinimalDb,
  projectId: string,
  opts: { sourceFileIds?: string[] } = {},
): { scanned: number; resolved: number } {
  const scopeIds = opts.sourceFileIds && opts.sourceFileIds.length > 0 ? opts.sourceFileIds : null
  // The scope predicate is what "the rows this run owns" means, and it has TWO
  // arms because the store records ownership in two ways:
  //
  //   the source SYMBOL's file     — an attributed row. The common case.
  //   a FILE-LEVEL row whose TARGET names a symbol declared in one of these
  //   files                        — the row the store writes when the analyzer's
  //   source was a file scope (`exports`, file-level `uses`/`calls`/`imports`):
  //   `source_symbol_id` is NULL, so the first arm cannot see it and nothing else
  //   in the row proves which file it belongs to. Its TARGET does: the row exists
  //   because that file publishes the name, and the arms below bind it to exactly
  //   the symbol the full pass binds it to (the same tables, the same SQL).
  //
  // Measured, and why the second arm is not optional: without it a routine
  // refresh left the edited file's `exports` rows unresolved while a full index
  // of the same source bound every one of them (script/m65/verify-refresh-resolution.ts,
  // typescript/javascript/rust/ruby/java before the arm existed).
  //
  // The predicate is the one difference between the two callers; the rules below
  // it are shared verbatim, including the is_cross_file expression (COALESCE to
  // '' so an unknown source file counts as a cross rather than as NULL, which is
  // what the full pass has always written).
  // The scope predicate is the shared ownership contract — see `ownershipScope`. It REPLACED
  // an inline copy that carried only the symbol and target arms; the third arm (`source_external`
  // = the file's relative path, the store's own record for a file-level row) is what lets the
  // deciders write the file-level rows a bounded run owns.
  // No alias: the four arms below write `UPDATE brain_relationship ... FROM ...` and name the
  // table qualified, which is `ownershipScope`'s default.
  const scope = ownershipScope(db, projectId, scopeIds ?? undefined)
  const scopeClause = scope.clause
  const scopeArgs = scope.args
  try {
    db.run(`CREATE TEMP TABLE IF NOT EXISTS _res_qname (qualified_name TEXT PRIMARY KEY, symbol_id TEXT NOT NULL, file_id TEXT)`)
    db.run(`CREATE TEMP TABLE IF NOT EXISTS _res_name (name TEXT, symbol_id TEXT NOT NULL, file_id TEXT, cnt INTEGER)`)
    db.run(`CREATE TEMP TABLE IF NOT EXISTS _res_qname_own (qualified_name TEXT, file_id TEXT, symbol_id TEXT NOT NULL)`)
    db.run(`CREATE TEMP TABLE IF NOT EXISTS _res_name_own (name TEXT, file_id TEXT, symbol_id TEXT NOT NULL)`)
    db.run(`DELETE FROM _res_qname`)
    db.run(`DELETE FROM _res_name`)
    db.run(`DELETE FROM _res_qname_own`)
    db.run(`DELETE FROM _res_name_own`)
    db.prepare(
      `INSERT OR IGNORE INTO _res_qname (qualified_name, symbol_id, file_id)
       SELECT qualified_name, MIN(id), MIN(file_id) FROM brain_symbol
       WHERE project_id = ? AND qualified_name IS NOT NULL GROUP BY qualified_name`,
    ).run(projectId)
    db.prepare(
      `INSERT OR IGNORE INTO _res_name (name, symbol_id, file_id, cnt)
       SELECT name, id, file_id, COUNT(*) OVER (PARTITION BY name)
       FROM brain_symbol WHERE project_id = ?`,
    ).run(projectId)
    db.prepare(
      `INSERT INTO _res_qname_own (qualified_name, file_id, symbol_id)
       SELECT qualified_name, file_id, MIN(id) FROM brain_symbol
       WHERE project_id = ? AND qualified_name IS NOT NULL GROUP BY qualified_name, file_id`,
    ).run(projectId)
    db.prepare(
      `INSERT INTO _res_name_own (name, file_id, symbol_id)
       SELECT name, file_id, MIN(id) FROM brain_symbol
       WHERE project_id = ? GROUP BY name, file_id`,
    ).run(projectId)
    db.run(`CREATE INDEX IF NOT EXISTS _res_name_idx ON _res_name(name)`)
    db.run(`CREATE INDEX IF NOT EXISTS _res_name_uniq_idx ON _res_name(name, cnt)`)
    db.run(`CREATE INDEX IF NOT EXISTS _res_qname_own_idx ON _res_qname_own(qualified_name, file_id)`)
    db.run(`CREATE INDEX IF NOT EXISTS _res_name_own_idx ON _res_name_own(name, file_id)`)

    const scannedRow = db.prepare(
      `SELECT COUNT(*) AS c FROM brain_relationship
        WHERE project_id = ? AND target_symbol_id IS NULL AND target_external IS NOT NULL${scopeClause}`,
    ).get(projectId, ...scopeArgs) as any
    const scanned = Number(scannedRow?.c ?? 0)

    // ── Arm 0: the row's OWN FILE, qualified name, then name ────────────────
    // Both are `is_cross_file = 0` by construction: the declaration is in the
    // row's own file. These run before the project-wide arms for the reason in
    // the docstring above.
    const r0own = db.prepare(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_qname_own.symbol_id,
          is_cross_file = 0
      FROM _res_qname_own
      WHERE brain_relationship.target_external = _res_qname_own.qualified_name
        AND _res_qname_own.file_id = (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1)
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND brain_relationship.project_id = '${projectId}'${scopeClause}
    `).run(...scopeArgs)

    const r0ownName = db.prepare(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_name_own.symbol_id,
          is_cross_file = 0
      FROM _res_name_own
      WHERE brain_relationship.target_external = _res_name_own.name
        AND _res_name_own.file_id = (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1)
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND brain_relationship.project_id = '${projectId}'${scopeClause}
    `).run(...scopeArgs)

    const r1 = db.prepare(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_qname.symbol_id,
          is_cross_file = CASE WHEN _res_qname.file_id != COALESCE(
            (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
          ) THEN 1 ELSE 0 END
      FROM _res_qname
      WHERE brain_relationship.target_external = _res_qname.qualified_name
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND brain_relationship.project_id = '${projectId}'${scopeClause}
    `).run(...scopeArgs)

    const r2 = db.prepare(`
      UPDATE brain_relationship
      SET target_symbol_id = _res_name.symbol_id,
          is_cross_file = CASE WHEN _res_name.file_id != COALESCE(
            (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
          ) THEN 1 ELSE 0 END
      FROM _res_name
      WHERE brain_relationship.target_external = _res_name.name
        AND _res_name.cnt = 1
        AND brain_relationship.target_symbol_id IS NULL
        AND brain_relationship.target_external IS NOT NULL
        AND brain_relationship.project_id = '${projectId}'${scopeClause}
    `).run(...scopeArgs)

    const resolved =
      (Number(r0own?.changes) || 0) +
      (Number(r0ownName?.changes) || 0) +
      (Number(r1?.changes) || 0) +
      (Number(r2?.changes) || 0)
    db.run(`DROP TABLE IF EXISTS _res_qname`)
    db.run(`DROP TABLE IF EXISTS _res_name`)
    db.run(`DROP TABLE IF EXISTS _res_qname_own`)
    db.run(`DROP TABLE IF EXISTS _res_name_own`)
    return { scanned, resolved }
  } catch (e: any) {
    // A store that has not been migrated, or a temp table another pass holds,
    // must not fail an index run over a relationship class that is a bonus.
    try {
      db.run(`DROP TABLE IF EXISTS _res_qname`)
      db.run(`DROP TABLE IF EXISTS _res_name`)
      db.run(`DROP TABLE IF EXISTS _res_qname_own`)
      db.run(`DROP TABLE IF EXISTS _res_name_own`)
    } catch { /* best-effort */ }
    return { scanned: 0, resolved: 0 }
  }
}

/**
 * THE DOTTED/COLON TARGET ARMS — strategies 3, 3b and 3c of the full pass, as a scoped
 * decider.
 *
 * WHY THEY ARE NEEDED HERE
 * A target the analyzer spells as a MEMBER CHAIN or a MODULE:ITEM pair (`A.refTarget`,
 * `a:ref_target_erlang`) is bound by none of the name deciders above: `resolveNameTargets`
 * compares the whole spelling against `name`/`qualified_name`, and a stored `qualified_name`
 * is prefixed with the file stem, so the ordinary `Owner.member` never matches it. The full
 * pass covers these shapes with three stages, in this order:
 *
 *   3   a dotted target by SUFFIX on `qualified_name` (the spelling the store actually holds)
 *   3b  the target's LEAF, when that leaf is declared exactly once in the project
 *   3c  the target's LEAF, RANKED — the target's full name first, then a definition ahead of
 *       a declaration, then the row's own file, then its own language, then the lowest id
 *
 * MEASURED (script/m65/verify-refresh-resolution.ts, lane `erlang`): a caller in `b.erl`
 * naming `a:ref_target_erlang` was bound by a full index to the declaration in `a.erl` and
 * left UNBOUND by an incremental refresh of the caller — the refreshed store held two
 * `calls` rows with no target, and `bb_graph` answered a symbol with two call sites as
 * having none, `truncated: false`. The scoped import planner was asked first and scanned
 * ZERO rows (it is a planner over the import/export surfaces, not over every colon-shaped
 * call), so nothing else in the bounded pass could decide it.
 *
 * Only stages that need the row to be UNRESOLVED apply: the full pass's 3/3b/3c all carry
 * `target_symbol_id IS NULL`, and this port keeps that guard, so it can never re-point a row
 * an earlier decider already decided.
 *
 * The plan is the full pass's, statement for statement (`resolveRelationships` in
 * `src/ast/parallel-indexer.ts`); only the rows WRITTEN are scoped. The drift guard is the
 * 48-lane refreshed-store comparison in the gate named above.
 */
export function resolveDottedTargets(
  db: MinimalDb,
  projectId: string,
  opts: { sourceFileIds?: string[] } = {},
): { scanned: number; resolved: number; byStage: { suffix: number; uniqueLeaf: number; rankedLeaf: number } } {
  const byStage = { suffix: 0, uniqueLeaf: 0, rankedLeaf: 0 }
  const scopeIds = opts.sourceFileIds && opts.sourceFileIds.length > 0 ? opts.sourceFileIds : null
  const scope = ownershipScope(db, projectId, scopeIds ?? undefined, "r")
  const scopeClause = scope.clause
  const scopeArgs = scope.args
  const tables = [
    "_dt_src", "_dt_qsuffix", "_dt_qsuffix_own", "_dt_name", "_dt_leaf", "_dt_best",
  ] as const
  const drop = () => {
    for (const t of tables) {
      try {
        db.run(`DROP TABLE IF EXISTS temp.${t}`)
      } catch {
        /* a temp table another pass holds is not this pass's failure */
      }
    }
  }
  try {
    drop()
    // The scoped row set: unresolved targets that carry a `.` or a `:` — the two shapes the
    // name deciders above cannot bind. Materialised with the source symbol's file and
    // language because the ranking depends on both and neither can be correlated out of a
    // subquery's ORDER BY here.
    db.prepare(
      `CREATE TEMP TABLE _dt_src AS
       SELECT r.id AS rel_id, r.source_symbol_id AS src_id, r.target_external AS full,
              COALESCE(src.file_id, '') AS src_file, COALESCE(sf.language, '') AS src_lang
       FROM brain_relationship r
       LEFT JOIN brain_symbol src ON src.id = r.source_symbol_id
       LEFT JOIN brain_file sf ON sf.id = src.file_id
       WHERE r.project_id = ?
         AND r.target_symbol_id IS NULL
         AND r.target_external IS NOT NULL
         AND (instr(r.target_external, '.') > 0 OR instr(r.target_external, ':') > 0)${scopeClause}`,
    ).run(projectId, ...scopeArgs)
    const scanned = Number((db.prepare(`SELECT COUNT(*) AS c FROM _dt_src`).get() as any)?.c ?? 0)
    if (scanned === 0) {
      drop()
      return { scanned: 0, resolved: 0, byStage }
    }
    db.run(`CREATE UNIQUE INDEX temp._dt_src_rel ON _dt_src(rel_id)`)

    // ── stage 3: a DOTTED target, by SUFFIX on qualified_name ──────────────────
    // `ASTEngine.LanguageAnalyzer` is stored as `t0128_engine.ASTEngine.LanguageAnalyzer`,
    // so an exact comparison can never match it; every dot-prefixed truncation of a stored
    // qualified_name is a candidate suffix.
    db.prepare(
      `CREATE TEMP TABLE _dt_qsuffix AS
       WITH RECURSIVE suffixes(suffix, rest, id, file_id) AS (
         SELECT qualified_name, qualified_name, id, file_id
         FROM brain_symbol
         WHERE project_id = ? AND qualified_name IS NOT NULL
         UNION ALL
         SELECT substr(rest, instr(rest, '.') + 1), substr(rest, instr(rest, '.') + 1), id, file_id
         FROM suffixes WHERE instr(rest, '.') > 0
       )
       SELECT suffix, MIN(id) AS symbol_id, MIN(file_id) AS file_id FROM suffixes
       WHERE instr(suffix, '.') > 0 GROUP BY suffix`,
    ).run(projectId)
    db.run(`CREATE INDEX temp._dt_qsuffix_idx ON _dt_qsuffix(suffix)`)
    db.prepare(
      `CREATE TEMP TABLE _dt_qsuffix_own AS
       SELECT suffix, file_id, MIN(symbol_id) AS symbol_id FROM (
         SELECT q.suffix AS suffix, s.file_id AS file_id, s.id AS symbol_id
         FROM brain_symbol s JOIN _dt_qsuffix q ON q.suffix = s.qualified_name
         WHERE s.project_id = ?
       ) GROUP BY suffix, file_id`,
    ).run(projectId)
    db.run(`CREATE UNIQUE INDEX temp._dt_qsuffix_own_key ON _dt_qsuffix_own(suffix, file_id)`)
    const s3own = db.run(
      `UPDATE brain_relationship
       SET target_symbol_id = o.symbol_id, is_cross_file = 0
       FROM _dt_qsuffix_own o
       WHERE brain_relationship.target_external = o.suffix
         AND o.file_id = (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1)
         AND brain_relationship.target_symbol_id IS NULL
         AND instr(brain_relationship.target_external, '.') > 0
         AND brain_relationship.id IN (SELECT rel_id FROM _dt_src)`,
    )
    const s3 = db.run(
      `UPDATE brain_relationship
       SET target_symbol_id = q.symbol_id,
           is_cross_file = CASE WHEN q.file_id != COALESCE(
             (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
           ) THEN 1 ELSE 0 END
       FROM _dt_qsuffix q
       WHERE brain_relationship.target_external = q.suffix
         AND brain_relationship.target_symbol_id IS NULL
         AND instr(brain_relationship.target_external, '.') > 0
         AND brain_relationship.id IN (SELECT rel_id FROM _dt_src)`,
    )
    byStage.suffix = Number(s3own?.changes ?? 0) + Number(s3?.changes ?? 0)

    // ── stage 3b: the target's LEAF, when the project declares that leaf EXACTLY once ──
    db.prepare(
      `CREATE TEMP TABLE _dt_name AS
       SELECT name, MIN(id) AS symbol_id, MIN(file_id) AS file_id, COUNT(*) AS cnt
       FROM brain_symbol WHERE project_id = ? GROUP BY name`,
    ).run(projectId)
    db.run(`CREATE UNIQUE INDEX temp._dt_name_key ON _dt_name(name)`)
    // A PATH IS NOT A MEMBER CHAIN, and the guard is the full pass's `extractLeaf`, SEGMENT
    // FOR SEGMENT — which is not the same test as "does the whole spelling contain a slash".
    // `extractLeaf` splits on ':' first and applies the path test to the LAST COLON SEGMENT,
    // so `./A.svelte:A` (a file-level import whose item is `A`) reduces to `A`, while
    // `synthetic/main.zig` (a file path, no colon) keeps its whole spelling and is left for a
    // file claim rather than binding to a symbol named after its extension. Applying the test
    // to the whole spelling instead was MEASURED here as a seam gap: the gate's `svelte` and
    // `vue` lanes kept their module-path `imports` row unbound after a refresh while a full
    // index bound it (`script/m65/verify-refresh-resolution.ts`).
    // The reduction is computed in JS because SQLite has no "after the last occurrence"
    // function, and a correlated expression here is the shape that made the full pass's first
    // version of stage 3 cost 68 s.
    db.run(`CREATE TEMP TABLE IF NOT EXISTS _dt_leaf (full TEXT, leaf TEXT)`)
    db.run(`DELETE FROM _dt_leaf`)
    const distinctFulls = db.prepare(`SELECT DISTINCT full FROM _dt_src`).all() as Array<{ full: string }>
    const insertLeaf = db.prepare(`INSERT INTO _dt_leaf (full, leaf) VALUES (?, ?)`)
    for (const { full } of distinctFulls) {
      const lastColon = String(full).split(":").pop() ?? ""
      if (lastColon.length === 0) continue
      if (lastColon.includes("/") || lastColon.includes("\\")) continue
      const leaf = lastColon.split(".").pop()
      if (leaf && leaf.length > 0) insertLeaf.run(full, leaf)
    }
    let uniqueLeaf = 0
    const uniq = db.prepare(
      `UPDATE brain_relationship
       SET target_symbol_id = n.symbol_id,
           is_cross_file = CASE WHEN n.file_id != COALESCE(
             (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id LIMIT 1), ''
           ) THEN 1 ELSE 0 END
       FROM _dt_name n, _dt_leaf l
       WHERE l.full = brain_relationship.target_external
         AND n.name = l.leaf
         AND n.cnt = 1
         AND brain_relationship.target_symbol_id IS NULL
         AND brain_relationship.id IN (SELECT rel_id FROM _dt_src)`,
    ).run()
    uniqueLeaf += Number(uniq?.changes ?? 0)
    byStage.uniqueLeaf = uniqueLeaf

    // ── stage 3c: the same LEAF, RANKED (the full name first, then definition-before-
    // declaration, then the row's own file, then its own language, then the lowest id) ──
    db.run(`DROP TABLE IF EXISTS temp._dt_best`)
    db.prepare(
      `CREATE TEMP TABLE _dt_best AS
       SELECT full, src_id, symbol_id, symbol_file FROM (
         SELECT r.target_external AS full,
                r.source_symbol_id AS src_id,
                s.id AS symbol_id,
                s.file_id AS symbol_file,
                ROW_NUMBER() OVER (
                  PARTITION BY r.target_external, r.source_symbol_id
                  ORDER BY (s.name = m.full) DESC,
                           COALESCE(s.is_declaration, 0) ASC,
                           (s.file_id = (SELECT b.file_id FROM brain_symbol b WHERE b.id = r.source_symbol_id)) DESC,
                           (f.language = (SELECT f2.language FROM brain_file f2
                                           WHERE f2.id = (SELECT b2.file_id FROM brain_symbol b2 WHERE b2.id = r.source_symbol_id))) DESC,
                           s.id ASC
                ) AS rn
         FROM brain_relationship r
         JOIN _dt_leaf m ON m.full = r.target_external
         JOIN brain_symbol s ON s.project_id = ? AND (s.name = m.full OR s.name = m.leaf)
         LEFT JOIN brain_file f ON f.id = s.file_id
         WHERE r.project_id = ? AND r.target_symbol_id IS NULL AND r.target_external IS NOT NULL
           AND r.id IN (SELECT rel_id FROM _dt_src)
       ) WHERE rn = 1`,
    ).run(projectId, projectId)
    db.run(`CREATE INDEX temp._dt_best_idx ON _dt_best(full, src_id)`)
    const ranked = db.prepare(
      `UPDATE brain_relationship
       SET target_symbol_id = b.symbol_id,
           is_cross_file = CASE WHEN b.symbol_file != COALESCE(
             (SELECT file_id FROM brain_symbol WHERE brain_symbol.id = brain_relationship.source_symbol_id), ''
           ) THEN 1 ELSE 0 END
       FROM _dt_best b
       WHERE b.full = brain_relationship.target_external
         AND b.src_id IS brain_relationship.source_symbol_id
         AND brain_relationship.target_symbol_id IS NULL
         AND brain_relationship.target_external IS NOT NULL
         AND brain_relationship.project_id = ?`,
    ).run(projectId)
    byStage.rankedLeaf = Number(ranked?.changes ?? 0)

    const resolved = byStage.suffix + byStage.uniqueLeaf + byStage.rankedLeaf
    drop()
    return { scanned, resolved, byStage }
  } catch (e: any) {
    if (process.env.BB_DEBUG_DOTTED === "1") console.error("resolveDottedTargets failed:", e?.message)
    drop()
    return { scanned: 0, resolved: 0, byStage }
  }
}

/**
 * THE BARE-NAME RANKED ARM — the full pass's `_i13_pick` plan, as a scoped decider.
 *
 * WHY IT EXISTS, AND WHY IT IS HERE RATHER THAN IN THE FULL PASS
 * The full pass resolves a bare-name edge (no `.` and no `:`) by a RANKING, not by
 * uniqueness: the minimum declaration tier first (`is_declaration = 0`, so a
 * DEFINITION beats a prototype — #612), then the row's own file, then the row's own
 * language, then the lowest id. `resolveNameTargets` above binds a bare name only when
 * the whole project holds exactly one candidate, so every shape with a prototype and
 * its definition — the ordinary C, C++, Objective-C and header-split form — was out of
 * its reach, and so was every name declared twice for any other reason.
 *
 * MEASURED (script/m65/verify-refresh-resolution.ts, lane `c`): a two-file fixture whose
 * caller names a function declared in `a.h` and defined in `a.c` was bound by the full
 * index to `a.c` (the definition) and left UNBOUND by an incremental refresh of the
 * caller — `bb_graph` then answered 0 callers with `truncated: false` for a symbol with
 * two call sites, while a full index of the same source answered 2. The bounded pass had
 * run the shared deciders for that row and they had declined it, because the decision
 * the full pass makes for that row lives in the `_i13_pick` plan and nowhere else. This
 * function is that decision, factored out so there is ONE implementation of it.
 *
 * THE RANKING IS THE FULL PASS'S, STATEMENT FOR STATEMENT (see
 * `resolveRelationships` in `src/ast/parallel-indexer.ts`, whose `_i13_*` plan is
 * whole-project and whose result this reproduces on a scope). What differs is only the
 * SCOPE: `sourceFileIds` restricts the rows WRITTEN to the files a bounded run owns.
 * Every lookup it reads (`tier`, `best_file`, `best_lang`, `best_any`) is built from the
 * complete symbol table either way, so the decision does not depend on the scope — which
 * is the whole point of a scoped decider rather than a second rule set.
 *
 * DRIFT. Two implementations of one ranking is exactly what this file exists to prevent,
 * and the guard is a measurement rather than a comment: the gate named above compares the
 * refreshed store's whole edge state against a full index of the same source, for each of
 * the fleet's 48 lanes (its lane set is read from `src/ast/real-*-analyzer.ts`), so a
 * divergence between this plan and the full pass's is a FAILING CHECK on the lane whose
 * fixture exposes it, not a silent difference.
 *
 * `contains` is excluded for the same reason the full pass excludes it: its target is
 * pinned to the edge's own line rather than to a name, and re-picking it by name would
 * discard the pin.
 */
export function resolveRankedBareNameTargets(
  db: MinimalDb,
  projectId: string,
  opts: { sourceFileIds?: string[] } = {},
): { scanned: number; resolved: number } {
  const scopeIds = opts.sourceFileIds && opts.sourceFileIds.length > 0 ? opts.sourceFileIds : null
  // The two-arm ownership predicate, identical in shape to `resolveNameTargets`': the
  // source SYMBOL's file for an attributed row, and the target's declaring file for a
  // FILE-level row (whose `source_symbol_id` is NULL, so nothing else in the row names
  // its owner). `?` per id, the same spelling the sibling deciders use.
  const scope = ownershipScope(db, projectId, scopeIds ?? undefined, "r")
  const scopeClause = scope.clause
  const scopeArgs = scope.args
  const tables = ["_rn_src", "_rn_tier", "_rn_best_file", "_rn_best_lang", "_rn_best_any", "_rn_pick"] as const
  const drop = () => {
    for (const t of tables) {
      try {
        db.run(`DROP TABLE IF EXISTS temp.${t}`)
      } catch {
        /* a temp table another pass holds is not this pass's failure */
      }
    }
  }
  try {
    drop()
    // The source file and language the ranking depends on, materialised once, for the
    // rows this run owns — and ONLY for them: the aggregate tables below are read-only
    // and the apply step joins this table, so nothing outside the scope can be written.
    db.prepare(
      `CREATE TEMP TABLE _rn_src AS
       SELECT r.id AS rel_id, src.file_id AS src_file, COALESCE(sf.language, '') AS src_lang
       FROM brain_relationship r
       LEFT JOIN brain_symbol src ON src.id = r.source_symbol_id
       LEFT JOIN brain_file sf ON sf.id = src.file_id
       WHERE r.project_id = ?
         AND r.relationship_type <> 'contains'
         AND r.target_external IS NOT NULL
         AND instr(r.target_external, '.') = 0
         AND instr(r.target_external, ':') = 0${scopeClause}`,
    ).run(projectId, ...scopeArgs)
    const scanned = Number(
      (db.prepare(`SELECT COUNT(*) AS c FROM _rn_src`).get() as any)?.c ?? 0,
    )
    if (scanned === 0) {
      drop()
      return { scanned: 0, resolved: 0 }
    }
    db.run(`CREATE UNIQUE INDEX temp._rn_src_rel ON _rn_src(rel_id)`)
    // (1) The winning declaration tier per name. A DEFINITION (0) outranks a
    // declaration (1), which is #612's rule and the one that decides a
    // prototype/definition pair.
    db.prepare(
      `CREATE TEMP TABLE _rn_tier AS
       SELECT name, MIN(COALESCE(is_declaration, 0)) AS tier
       FROM brain_symbol WHERE project_id = ?
       GROUP BY name`,
    ).run(projectId)
    db.run(`CREATE UNIQUE INDEX temp._rn_tier_name ON _rn_tier(name)`)
    // (2a) lowest id at the minimum tier, within one file.
    db.prepare(
      `CREATE TEMP TABLE _rn_best_file AS
       SELECT s.name AS name, s.file_id AS file_id, MIN(s.id) AS symbol_id
       FROM brain_symbol s
       JOIN _rn_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
       WHERE s.project_id = ?
       GROUP BY s.name, s.file_id`,
    ).run(projectId)
    db.run(`CREATE UNIQUE INDEX temp._rn_best_file_key ON _rn_best_file(name, file_id)`)
    // (2b) lowest id at the minimum tier, within one language. The key is the COALESCEd
    // language, so the '' bucket exists and '' matches '', the same comparison the full
    // pass's window key made.
    db.prepare(
      `CREATE TEMP TABLE _rn_best_lang AS
       SELECT s.name AS name, COALESCE(f.language, '') AS lang, MIN(s.id) AS symbol_id
       FROM brain_symbol s
       JOIN _rn_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
       LEFT JOIN brain_file f ON f.id = s.file_id
       WHERE s.project_id = ?
       GROUP BY s.name, COALESCE(f.language, '')`,
    ).run(projectId)
    db.run(`CREATE UNIQUE INDEX temp._rn_best_lang_key ON _rn_best_lang(name, lang)`)
    // (2c) lowest id at the minimum tier, no further preference.
    db.prepare(
      `CREATE TEMP TABLE _rn_best_any AS
       SELECT s.name AS name, MIN(s.id) AS symbol_id
       FROM brain_symbol s
       JOIN _rn_tier t ON t.name = s.name AND t.tier = COALESCE(s.is_declaration, 0)
       WHERE s.project_id = ?
       GROUP BY s.name`,
    ).run(projectId)
    db.run(`CREATE UNIQUE INDEX temp._rn_best_any_key ON _rn_best_any(name)`)
    // The pick. The three LEFT JOINs ARE the ranking (own file, then own language, then
    // anything), and the `IS NOT NULL` filter on the COALESCE is load-bearing: the apply
    // step writes this table's target, so a pick row carrying NULL would write NULL over
    // a target an earlier strategy had already resolved. `_rn_best_any` holds a row for
    // every name the project declares, so the COALESCE is NULL exactly when no symbol
    // carries the target name — the no-candidate case.
    db.prepare(
      `CREATE TEMP TABLE _rn_pick AS
       SELECT t.rel_id AS rel_id,
              COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) AS target_symbol_id
       FROM _rn_src t
       JOIN brain_relationship r ON r.id = t.rel_id
       LEFT JOIN _rn_best_file bf ON bf.name = r.target_external AND bf.file_id = t.src_file
       LEFT JOIN _rn_best_lang bl ON bl.name = r.target_external AND bl.lang = t.src_lang
       LEFT JOIN _rn_best_any  ba ON ba.name = r.target_external
       WHERE r.project_id = ?
         AND COALESCE(bf.symbol_id, bl.symbol_id, ba.symbol_id) IS NOT NULL`,
    ).run(projectId)
    db.run(`CREATE UNIQUE INDEX temp._rn_pick_rel ON _rn_pick(rel_id)`)
    const applied = db.run(
      `UPDATE brain_relationship
       SET target_symbol_id = p.target_symbol_id
       FROM _rn_pick p
       WHERE brain_relationship.id = p.rel_id`,
    )
    const resolved = Number(applied?.changes ?? 0)
    // The target these rows now hold is not necessarily the one an earlier strategy
    // picked, so `is_cross_file` is recomputed for the scoped bare-name population — the
    // same step, on the same population restricted to this run, that the full pass runs
    // whole-project.
    db.prepare(
      `UPDATE brain_relationship
       SET is_cross_file = CASE WHEN t.file_id <> s.file_id THEN 1 ELSE 0 END
       FROM brain_symbol t, brain_symbol s
       WHERE t.id = brain_relationship.target_symbol_id
         AND s.id = brain_relationship.source_symbol_id
         AND brain_relationship.project_id = ?
         AND brain_relationship.id IN (SELECT rel_id FROM _rn_src)`,
    ).run(projectId)
    drop()
    return { scanned, resolved }
  } catch (e: any) {
    // A store that has not been migrated, or a temp table another pass holds, must not
    // fail an index run over a relationship class that is a bonus.
    drop()
    return { scanned: 0, resolved: 0 }
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
 *
 * `opts.onlySourceFileIds` is the same scope expressed as the set of files whose
 * rows this run OWNS — the bounded pass's spelling, because it knows the files
 * it re-stored and not their row ids (the store creates those). The row's own
 * file is recovered by `loadImportInputs` (source symbol, id anchor, or path).
 * The two scopes are alternatives; either alone, or both together.
 */
export function resolveImportTargets(
  db: MinimalDb,
  projectId: string,
  opts: { onlyRowIds?: Set<string>; onlySourceFileIds?: string[] } = {},
): ImportResolutionOutcome {
  const byReason: Record<string, number> = {}
  const bump = (k: string) => { byReason[k] = (byReason[k] ?? 0) + 1 }
  const out: ImportResolutionOutcome = { scanned: 0, resolved: 0, byReason }
  const inputs = loadImportInputs(db, projectId, {
    unresolvedOnly: true,
    ...(opts.onlySourceFileIds && opts.onlySourceFileIds.length > 0 ? { onlySourceFileIds: opts.onlySourceFileIds } : {}),
  })
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
