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
  /** The analyzer's source name (a module basename for import edges). */
  source_external: string | null
  /**
   * The name the MODULE DECLARES, when the analyzer recorded it (M60 / JD2b:
   * `declaredName` + `declaredKind` on the relationship's metadata). Present for
   * ESM import edges and absent for lanes that do not record it, in which case
   * the planner falls back to the item spelled in the target.
   */
  metadata?: { declaredName?: string; declaredKind?: string } | null
}

export interface ImportResolutionIndex {
  /** import specifier -> the file ids it resolves to, built file-aware from brain_import. */
  pathTargets: Map<string, Set<string>>
  /** file id -> relative_path */
  filePath: Map<string, string>
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
  via: "unique-file+unique-symbol" | "unique-file+qualified-leaf" | "default-export-of-target"
}

const PROBE_SUFFIXES = [
  "", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".json",
]
const INDEX_BASENAMES = ["index.js", "index.mjs", ".cjs", "index.ts", "index.tsx", "index.jsx"]

/** Join a specifier onto an importer's directory and normalise `.` / `..`. */
export function resolveSpecifierPath(importerRelPath: string, specifier: string): string | null {
  if (!specifier) return null
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
    const dir = importerRelPath.includes("/") ? importerRelPath.slice(0, importerRelPath.lastIndexOf("/")) : ""
    const parts = (dir ? dir.split("/") : []).concat(specifier.split("/"))
    const out: string[] = []
    for (const seg of parts) {
      if (seg === "" || seg === ".") continue
      if (seg === "..") { out.pop(); continue }
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

  return { pathTargets, filePath, symbolsByFile, fileByTail, exportsByFile, defaultExportByFile }
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

    let fileIds = index.pathTargets.get(path)
    let via: ImportResolution["via"] = "unique-file+unique-symbol"

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
      // AMBIGUOUS, and unresolvable from this row. The relationship carries no
      // importing file — `relId` is `${projectId}:rel:${sourceId}:...` and an
      // import edge's source symbol does not exist, so the file is simply not
      // in the row. `source_external` is the importing file's module BASENAME,
      // which says nothing about which of the candidate TARGET files the
      // specifier meant, so it cannot break the tie. (A first cut of this
      // function tried to, and compared the importer's name against the
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
 * Resolve the `<module>:<item>` import edges this project left unresolved.
 * Safe to call when there is nothing to do; never throws into the caller.
 */
export function resolveImportTargets(db: MinimalDb, projectId: string): ImportResolutionOutcome {
  const byReason: Record<string, number> = {}
  const bump = (k: string) => { byReason[k] = (byReason[k] ?? 0) + 1 }
  const out: ImportResolutionOutcome = { scanned: 0, resolved: 0, byReason }
  let files: any[] = []
  let symbols: any[] = []
  let imports: any[] = []
  let rows: ImportTargetRow[] = []
  let exports: Array<{ fileId: string; name: string; isDefault?: boolean; symbolId?: string }> = []
  try {
    files = db.prepare(
      `SELECT id AS fileId, relative_path AS relativePath FROM brain_file WHERE project_id = ?`,
    ).all(projectId) as any[]
    symbols = db.prepare(
      `SELECT id AS symbolId, file_id AS fileId, name AS name FROM brain_symbol WHERE project_id = ?`,
    ).all(projectId) as any[]
    imports = db.prepare(
      `SELECT file_id AS fileId, import_path AS importPath FROM brain_import WHERE project_id = ?`,
    ).all(projectId) as any[]
    rows = db.prepare(
      `SELECT id, target_external AS target_external, source_external AS source_external, metadata
         FROM brain_relationship
        WHERE project_id = ? AND relationship_type = 'imports'
          AND target_symbol_id IS NULL AND target_external IS NOT NULL AND instr(target_external, ':') > 0`,
    ).all(projectId) as ImportTargetRow[]
    for (const r of rows) {
      if (typeof r.metadata === "string") {
        try { r.metadata = JSON.parse(r.metadata) } catch { r.metadata = null }
      }
    }

    // The export surface, keyed by FILE. An `exports` edge carries no file on
    // its source side either (its source symbol is the module, which is not a
    // symbol), so the file is recovered from `source_external` — the module
    // basename — and only when that basename is UNIQUE in the project. An
    // ambiguous basename contributes no export surface, so its files resolve
    // nothing: the same refuse-don't-guess rule the item gate applies.
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
    exports = []
    for (const er of exportRows) {
      if (!er.sym) continue
      const fileId = symFile.get(er.sym)
      if (!fileId) continue
      const stem = er.src ?? ""
      const cands = byBase.get(stem) ?? []
      if (cands.length === 1 && cands[0] === fileId) {
        let isDefault = false
        if (er.metadata) {
          try { isDefault = JSON.parse(er.metadata)?.isDefault === true } catch { /* unparsed: not a default */ }
        }
        exports.push({ fileId, name: er.tgt, isDefault, symbolId: er.sym })
      }
    }
  } catch (e: any) {
    // A project with no import table, or a store that has not been migrated,
    // must not fail an index run over a relationship class that is a bonus.
    return out
  }
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
    const tg = index.pathTargets.get(spec)
    if (!tg || tg.size === 0) { bump("specifier-not-internal"); continue }
    if (tg.size > 1) { bump("ambiguous-multiple-files"); continue }
    const ex = index.exportsByFile.get([...(tg ?? [])][0])
    bump(!ex ? "no-export-surface-recorded" : (ex.has(item) ? "no-such-symbol-in-target-file" : "item-not-exported-by-target"))
  }
  return out
}
