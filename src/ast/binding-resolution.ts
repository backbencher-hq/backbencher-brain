// M14 JS lane (2026-10-10) — RESOLUTION BY THE IMPORT GRAPH.
//
// WHY THIS EXISTS. The strategies in `parallel-indexer.resolveRelationships` match a
// bare name against the project's symbol table (`_res_name_unique` needs the name to be
// UNIQUE project-wide; `_res_qname` needs an `Owner.member` spelling; the authoritative
// name pass ranks same-file, then same-language, then lowest id). None of them reads the
// ONE piece of evidence that turns a bare leaf into an exact answer: the row's own import
// statement. On the closed population this lane measures
// (`packages/svelte/src`, 368 files, `script/m14/javascript-import-decidability.ts`),
// **2,581 rows name a symbol the row's file IMPORTS from a module that is in the project
// and declares it** — every one decidable without guessing.
//
// So this pass does two things, and the second is the one that matters:
//
//   ATTACH   a bare target the name passes left NULL, where the file's import names the
//            module and that module declares the symbol.
//   CORRECT  a bare target the name passes attached to a DIFFERENT file's same-named
//            symbol. That is the failure mode that costs the most: the name pass picks by
//            ranking and always produces AN ANSWER, so a wrong file looks exactly like a
//            right one, and `bb_graph`, `bb_impact` and hover all repeat it.
//
// WHAT IT REFUSES, and each refusal is deliberate. It is the same posture as
// `import-resolution.ts`: an unresolved edge is honest, a wrong edge is a confident lie.
//
//   - a target that is not a bare name (`a.b`, `./m:m`) — those populations belong to the
//     qname strategy and the `module:item` resolver;
//   - a target the row's OWN FILE declares. The file's own declaration is the correct
//     answer (an import of the same name would be shadowed), so this pass never overrides
//     it — it is the first gate, not an afterthought;
//   - a target that is a PARAMETER of the row's own source symbol. `import { x }` followed
//     by `function f(x)` makes `x` inside `f` the parameter, not the import. The signature
//     is in `brain_symbol.parameters`, so this is decidable — and this case DETACHES the
//     row rather than merely declining to correct it, because the name passes have already
//     answered with some other file's same-named symbol and that answer is provably wrong;
//   - a module specifier that does not resolve to EXACTLY ONE project file;
//   - a target module that does not declare the name, or declares it more than once;
//   - a target module whose EXPORT SURFACE is recorded and does not contain the name. An
//     import can only bind something the module exports, so this is the semantic gate;
//   - structural labels: `contains` (pinned to the edge's own line), `overrides`
//     (retargeted by its own pass), `imports`/`exports` (module-level, already resolved by
//     `resolveImportTargets`).
//
// The planner is PURE (index + rows in, decisions out) so it can be asserted case by case,
// exactly like `planImportResolutions`.

import { resolveSpecifierPath } from "./import-resolution"

/** The specifier suffixes probed when turning a module string into a project file. */
const PROBE_SUFFIXES = ["", ".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts", ".vue", ".svelte", ".json"]
const INDEX_BASENAMES = ["index.js", "index.mjs", "index.cjs", "index.ts", "index.tsx", "index.jsx", "index.vue", "index.svelte"]

/** Labels this pass may touch. `contains`/`overrides`/`imports`/`exports` are excluded. */
export const BINDING_LABELS = new Set(["calls", "uses", "instantiates", "references", "extends", "exports"])

export interface BindingImport {
  /** The module as the import statement spelled it. */
  module: string
  /** The LOCAL name the importing file writes. */
  local: string
  /** The name the target module declares (`beta as bee` -> `beta`), when known. */
  declared: string
  kind: string
}

export interface BindingRow {
  id: string
  type: string
  target_external: string
  /** `target_symbol_id` as it stands after every name strategy has run. */
  currentTarget: string | null
  /** The file that CONTAINS the row: the source symbol's file, else a file-level path. */
  sourceFileId: string | null
  /** `brain_symbol.parameters` of the row's own source symbol, for the shadow guard. */
  sourceParams: string | null
  /** `metadata.calleeExpression` — the only place a receiver (`ns.member`) is recorded. */
  calleeExpression: string | null
}

/**
 * One clause of a re-export (`export { a as b } from './m'`): the module the name comes
 * FROM and the name THAT module declares. The name this file exports it under is the key
 * it is filed by, because that is the name a consumer of this file asks for.
 */
export interface BindingReexport {
  module: string
  declared: string
}

export interface BindingIndex {
  filePath: Map<string, string>
  fileIdByPath: Map<string, string>
  /** fileId -> symbol name -> symbol ids declared in it. */
  symbolsByFile: Map<string, Map<string, string[]>>
  symbolFile: Map<string, string>
  /** fileId -> its import bindings. */
  importsByFile: Map<string, BindingImport[]>
  /** fileId -> the names its recorded export surface contains, or undefined when none. */
  exportsByFile: Map<string, Set<string>>
  /** fileId -> exported name -> the re-export clauses that provide it. */
  reexportsByFile: Map<string, Map<string, BindingReexport[]>>
  /**
   * fileId -> the modules a BARE `export * from './m'` redistributes from. A redistribution
   * is not a clause: it names no member, so it cannot be filed by name, and the name it
   * carries forward is the SAME name at the next hop. `export * as ns from './m'` is NOT
   * here — that statement binds one name in this file and redistributes nothing — and
   * neither is a re-export edge that does not SAY which form it is: only an explicit
   * `starForm: "all"` is filed, because an indistinguishable record is exactly the record a
   * guess would be wrong about.
   */
  starsByFile: Map<string, string[]>
}

export interface BindingResolution {
  id: string
  /**
   * `null` means DETACH — the proven-correct state for this row is "no project symbol",
   * because the name is a local binding of the row's own source symbol. See
   * `shadowed-local-binding` in the planner.
   */
  symbolId: string | null
  fileId: string | null
  via:
    | "import-binding"
    | "import-namespace"
    | "import-alias"
    | "own-file-declaration"
    | "shadowed-local-binding"
    /** Reached through a re-export clause (`export { x } from './m'`), one or more hops. */
    | "import-reexport"
    /** An `exports` EDGE re-targeted through the re-export clause that publishes it. */
    | "reexport-chain"
    /**
     * Reached through a BARE `export * from './m'` redistribution — the name is not written
     * in the barrel at all, so no clause can be filed for it (`export * as ns` is a
     * namespace binding and never this).
     */
    | "import-star"
}

/** The trailing file component of a specifier, for the last-resort tail match. */
function tailStem(modulePath: string): string {
  const tail = modulePath.split("/").pop() ?? modulePath
  return tail.includes(".") ? tail.slice(0, tail.lastIndexOf(".")) : tail
}

/**
 * Candidate project files for a specifier written BY a known importing file. Importer-first,
 * because that is an exact answer: `./utils.js` means one file from the importer's
 * directory, while the same string project-wide can mean several.
 */
export function bindingCandidateFiles(
  index: BindingIndex,
  importerFileId: string,
  modulePath: string,
): string[] | null {
  const importerPath = index.filePath.get(importerFileId)
  if (!importerPath) return null
  if (modulePath.startsWith("./") || modulePath.startsWith("../") || modulePath === "." || modulePath === "..") {
    const base = resolveSpecifierPath(importerPath, modulePath)
    if (!base) return null
    for (const suffix of PROBE_SUFFIXES) {
      const hit = index.fileIdByPath.get(base + suffix)
      if (hit) return [hit]
    }
    for (const name of INDEX_BASENAMES) {
      const hit = index.fileIdByPath.get(`${base}/${name}`)
      if (hit) return [hit]
    }
    return []
  }
  // A non-relative specifier cannot be placed by this pass: without a resolver it is a
  // package, and a package is not a file of the project.
  return null
}

/** How far a re-export chain is followed before the pass gives up. */
export const MAX_REEXPORT_DEPTH = 8

export interface ChainHit {
  symbolId: string
  fileId: string
}

/**
 * THE RE-EXPORT CHAIN — where a name that a module does not declare actually comes from.
 *
 * WHY THIS IS A DIFFERENT ROUTE AND NOT A SPECIAL CASE OF THE IMPORT ROUTE. A barrel module
 * publishes names it does not own: `internal/client/index.js` writes
 * `export { pop } from './context.js'` and declares nothing called `pop`. Every consumer of
 * that barrel (`import { pop } from '#client'`) therefore has an import binding whose module
 * does not DECLARE the name, and the plain import route has to refuse — correctly, by its own
 * rule, because it has no evidence about which module the barrel took it from. The evidence
 * exists, it is one hop away, and the analyzer already publishes it: the clause's own
 * `imports` edge carries `metadata.isReExport`, the source module as the specifier, and the
 * name the source module declares (`declaredName`). So the chain is followed through the
 * clauses, not through the barrel's `exports` edge target — measured on the closed
 * population, that target is WRONG for exactly the names worth chasing:
 * `export { pop } from './context.js'` had `pop` attached to
 * `compiler/phases/1-parse/index.js:pop` and `add_svelte_meta` to a compiler visitor, while
 * the clause named `./context.js` in both cases. Following the clause is exact; following the
 * resolved target would have inherited the very error this pass exists to correct.
 *
 * Bounded (`MAX_REEXPORT_DEPTH`) and cycle-guarded by (file, name), so a barrel that re-exports
 * through itself — or a pair that re-export each other — terminates with no answer instead of
 * recursing. A name declared MORE THAN ONCE in a file is refused at that hop: two declarations
 * of the same name in one module make the chain's answer ambiguous, and an ambiguous answer is
 * not one this pass is willing to store.
 */
export function resolveThroughReexports(
  index: BindingIndex,
  fileId: string,
  name: string,
  depth = 0,
  visited: Set<string> = new Set(),
): ChainHit[] {
  // MECHANISM-TAGGED, and the tag is load-bearing rather than decorative: a clause hop and a
  // star hop at the same (file, name) are different questions, and a shared key let the
  // clause walk block the star walk that FOLLOWS it for the same pair — measured by A28 (a
  // star -> star -> declaration chain), which only resolves once each mechanism owns its own
  // key. `depth` still bounds every ping-pong between the two.
  const key = `${fileId}\u0000${name}\u0000clause`
  if (visited.has(key) || depth > MAX_REEXPORT_DEPTH) return []
  visited.add(key)
  const local = index.symbolsByFile.get(fileId)?.get(name)
  // A local declaration ends the chain, and is only an answer when it is the ONLY one: a
  // module that declares the name twice cannot say which one it re-exports.
  if (local) return local.length === 1 ? [{ symbolId: local[0], fileId }] : []
  const hits = new Map<string, ChainHit>()
  for (const clause of index.reexportsByFile.get(fileId)?.get(name) ?? []) {
    const files = bindingCandidateFiles(index, fileId, clause.module)
    if (!files || files.length !== 1) continue
    for (const hit of resolveThroughReexports(index, files[0], clause.declared, depth + 1, visited)) {
      hits.set(hit.symbolId, hit)
    }
  }
  return [...hits.values()]
}

/**
 * THE STAR REDISTRIBUTION — `export * from './m'` with no clause, and therefore no member
 * name written anywhere in the barrel.
 *
 * WHY THIS IS A DIFFERENT ROUTE FROM THE CLAUSE WALK. A clause names the member it carries
 * (`export { pop } from './context.js'`), so it can be filed by the name a consumer asks
 * for. A bare star writes no name at all: every member of `./m` is redistributed, so the
 * evidence is not a name but the STATEMENT — and the name carried forward is the same name
 * at the next hop. That is also why the barrel's recorded export surface cannot gate this
 * route: the analyzer cannot enumerate the members of a module it has not resolved, so a
 * surface that lacks the name is not evidence that the name is unpublished.
 *
 * WHAT IT REFUSES, and each refusal is the language's rule rather than a policy choice:
 *
 *   - `default`: `export *` never re-exports the default binding, so no hop may answer it;
 *   - AMBIGUITY: two star sources that both declare the name make it unknowable — the
 *     language itself excludes such a name from the module's exports — so the pass declines
 *     instead of picking one. The union is keyed by symbol, so two sources naming the SAME
 *     declaration still answer it;
 *   - a NAMED clause on the same file wins over a star (a named clause shadows a
 *     redistribution, again ES semantics), handled by trying the clause path first;
 *   - a name declared twice in one source module at any hop;
 *   - a specifier that does not resolve to exactly one project file.
 *
 * Depth-bounded by the same `MAX_REEXPORT_DEPTH` and cycle-guarded by (file, name) shared
 * with the clause walk, so the two mechanisms cannot ping-pong through each other.
 */
export function resolveThroughStarSources(
  index: BindingIndex,
  fileId: string,
  name: string,
  depth = 0,
  visited: Set<string> = new Set(),
): ChainHit[] {
  if (name === "default") return []
  // The STAR tag, deliberately different from the clause tag above (see that comment).
  const key = `${fileId}\u0000${name}\u0000star`
  if (visited.has(key) || depth > MAX_REEXPORT_DEPTH) return []
  visited.add(key)
  const local = index.symbolsByFile.get(fileId)?.get(name)
  if (local) return local.length === 1 ? [{ symbolId: local[0], fileId }] : []
  const hits = new Map<string, ChainHit>()
  for (const module of index.starsByFile.get(fileId) ?? []) {
    const files = bindingCandidateFiles(index, fileId, module)
    if (!files || files.length !== 1) continue
    const next = files[0]
    // The next hop may answer the name by declaring it, by a named clause of its own, or by
    // a star of its own — the union below is what makes a chain of mixed hops work.
    for (const hit of resolveThroughReexports(index, next, name, depth + 1, visited)) {
      hits.set(hit.symbolId, hit)
    }
    for (const hit of resolveThroughStarSources(index, next, name, depth + 1, visited)) {
      hits.set(hit.symbolId, hit)
    }
  }
  return [...hits.values()]
}

/**
 * Did this file publish the name through a recorded NAMED clause? There are exactly two
 * mechanisms a barrel can publish a name with, so a resolution that was NOT gated by the
 * clause route went through a star — which is what labels the row, rather than a guess.
 */
function publishedByNamedClause(index: BindingIndex, fileId: string, name: string): boolean {
  return (index.reexportsByFile.get(fileId)?.get(name)?.length ?? 0) > 0
}

/**
 * Plan the attachments and corrections. Pure: every decision is a function of the index
 * and the rows, so each refusal above can be asserted directly.
 */
export function planBindingResolutions(rows: BindingRow[], index: BindingIndex): BindingResolution[] {
  const out: BindingResolution[] = []
  const seen = new Set<string>()

  for (const row of rows) {
    if (seen.has(row.id)) continue
    if (!BINDING_LABELS.has(row.type)) continue
    if (!row.sourceFileId) continue
    const target = row.target_external
    if (!target) continue
    // Bare names only. A dotted target belongs to the qualified-name strategy and a
    // `module:item` target to `resolveImportTargets`.
    const leaf = target.replace(/:\d+$/, "")
    if (leaf.includes(".") || leaf.includes(":")) continue
    if (!leaf) continue

    const ownFileHits = index.symbolsByFile.get(row.sourceFileId)?.get(leaf)

    // ── EXPORTS: the OWN-FILE rule, inverted ─────────────────────────────────────
    //
    // An `exports` edge's source is the MODULE, not a symbol, so the name pass resolves it
    // by name like any other row — and it can pick a same-named symbol in ANOTHER file.
    // Measured on the three-file project this gate builds: `lib/parse.js` exports `parse`,
    // `lib/decoy.js` also declares `parse`, and BOTH export rows were attached to the
    // DECOY. Two independent repairs were needed, and neither alone is enough:
    //
    //   the SURFACE (below) is keyed on the edge's own source spelling, so a wrong target
    //   can no longer corrupt which names a module is said to offer — without this, this
    //   pass's own import gate was refusing a correct binding because the surface it
    //   consulted had been poisoned upstream.
    //
    //   the EDGE itself (here) is a published fact — `bb_graph` on a module shows its
    //   exports — and stays wrong until it is re-targeted.
    //
    // The repair is decidable rather than heuristic: an export edge whose source spelling
    // is a file that itself declares the name exactly once names THAT symbol. A re-export
    // (`export { x } from './m'`) declares nothing locally and is left alone, because its
    // target lives in another module and this rule has no evidence for which one.
    if (row.type === "exports") {
      if (ownFileHits && ownFileHits.length === 1) {
        out.push({ id: row.id, symbolId: ownFileHits[0], fileId: row.sourceFileId, via: "own-file-declaration" })
        seen.add(row.id)
        continue
      }
      // A RE-EXPORT row: the module publishes a name it does not declare. The chain follows
      // the clause that publishes it (`export { pop } from './context.js'`), so the row is
      // re-targeted at the symbol that actually declares it instead of whichever same-named
      // symbol the name pass ranked first — measured on the closed population, `pop` was on
      // `compiler/phases/1-parse/index.js` and `add_svelte_meta` on a compiler visitor.
      if (!ownFileHits) {
        const chain = resolveThroughReexports(index, row.sourceFileId, leaf)
        if (chain.length === 1) {
          out.push({ id: row.id, symbolId: chain[0].symbolId, fileId: chain[0].fileId, via: "reexport-chain" })
          seen.add(row.id)
        }
      }
      continue
    }

    // GATE 1 — the row's own file declares it. That IS the answer.
    if (ownFileHits) continue

    // GATE 2 — shadowing: a parameter of the row's own source symbol binds the name, so
    // the name is NOT the import. And here the pass does more than decline to correct:
    // it DETACHES the row.
    //
    // WHY DETACH AND NOT LEAVE IT. The name passes always produce an answer, and for a
    // shadowed name that answer is a same-named symbol from somewhere else in the project
    // — measured on the closed population: `store/index-server.js` declares
    // `export function toStore(get, set)` while importing `get`, and its two `get` call
    // rows were attached to `compiler/phases/scope.js:get`; `batch.js` declares
    // `capture(source, value, is_derived)` and its `source` row landed on
    // `compiler/preprocess/index.js:source`. The parameter list of the row's OWN source
    // symbol is scope-exact evidence — a parameter is in scope at every statement of the
    // body, by construction — so the edge is provably not that symbol, and each of these
    // is a confident lie in `bb_graph`, `bb_impact` and hover until it is cleared. An
    // unresolved edge is honest; two of the seven landed in a file that does not even
    // contain the name's owner. This is the SAME rule the gate above applies to decide
    // what NOT to do, applied to the state the store is already in.
    if (row.sourceParams) {
      try {
        const params = JSON.parse(row.sourceParams)
        if (Array.isArray(params)) {
          const names = params.map((p: any) => (typeof p === "string" ? p : String(p?.name ?? "")))
          if (names.includes(leaf)) {
            out.push({ id: row.id, symbolId: null, fileId: null, via: "shadowed-local-binding" })
            seen.add(row.id)
            continue
          }
        }
      } catch { /* an unparseable signature cannot exclude the name */ }
    }

    const bindings = index.importsByFile.get(row.sourceFileId) ?? []
    // A receiver is only recorded on `metadata.calleeExpression`; `w.get_prototype_of`
    // means the row targets the namespace member `get_prototype_of`.
    const receiver = row.calleeExpression && row.calleeExpression.includes(".")
      ? row.calleeExpression.slice(0, row.calleeExpression.indexOf("."))
      : null

    // ── NAMESPACE ────────────────────────────────────────────────────────────────
    if (receiver) {
      const ns = bindings.filter((b) => b.local === receiver && b.kind === "namespace")
      if (ns.length >= 1) {
        const modules = new Set(ns.map((b) => b.module))
        if (modules.size === 1) {
          const files = bindingCandidateFiles(index, row.sourceFileId, [...modules][0])
          if (files && files.length === 1) {
            const hits = index.symbolsByFile.get(files[0])?.get(leaf)
            if (hits && hits.length === 1 && exportSurfaceAllows(index, files[0], leaf)) {
              out.push({ id: row.id, symbolId: hits[0], fileId: files[0], via: "import-namespace" })
              seen.add(row.id)
              continue
            }
            // A namespace member the barrel itself does not declare: follow its clause. The
            // surface gate is asked of the BARREL (it is the module the import names), which
            // is what makes importing the name legal at all.
            if (!hits && exportSurfaceAllows(index, files[0], leaf)) {
              const chain = resolveThroughReexports(index, files[0], leaf)
              if (chain.length === 1) {
                out.push({ id: row.id, symbolId: chain[0].symbolId, fileId: chain[0].fileId, via: "import-reexport" })
                seen.add(row.id)
                continue
              }
            }
            // …or the barrel redistributes the whole module and writes no clause. No surface
            // gate here, because a surface CANNOT contain a redistributed name: the analyzer
            // cannot enumerate the members of a module it has not resolved, so asking for the
            // name in the surface would refuse every star-only barrel. The `export *`
            // statement itself is the evidence, and it is on the record.
            if (!hits && !publishedByNamedClause(index, files[0], leaf) && (index.starsByFile.get(files[0])?.length ?? 0) > 0) {
              const star = resolveThroughStarSources(index, files[0], leaf)
              if (star.length === 1) {
                out.push({ id: row.id, symbolId: star[0].symbolId, fileId: star[0].fileId, via: "import-star" })
                seen.add(row.id)
                continue
              }
            }
          }
        }
      }
    }

    // ── NAMED / DEFAULT / ALIASED BINDING ────────────────────────────────────────
    const direct = bindings.filter((b) => b.local === leaf && b.kind !== "namespace")
    if (direct.length === 0) continue
    const modules = new Set(direct.map((b) => b.module))
    if (modules.size !== 1) continue // two modules binding the same local name: refuse
    const files = bindingCandidateFiles(index, row.sourceFileId, [...modules][0])
    if (!files || files.length !== 1) continue
    const targetFile = files[0]
    // The DECLARED name when the import recorded one (an alias binds a different name),
    // otherwise the local name itself.
    const wanted = direct.find((b) => b.declared && b.declared !== "*")?.declared ?? leaf
    const hits = index.symbolsByFile.get(targetFile)?.get(wanted)
    if (hits && hits.length === 1 && exportSurfaceAllows(index, targetFile, wanted)) {
      out.push({
        id: row.id,
        symbolId: hits[0],
        fileId: targetFile,
        via: wanted === leaf ? "import-binding" : "import-alias",
      })
      seen.add(row.id)
      continue
    }
    // THE BARREL CASE: the module the import names does not declare the name, because it
    // publishes it through a re-export clause. The surface gate is still asked of the BARREL
    // (the import is only legal if the barrel exports the name), and the chain answers which
    // module actually declares it.
    if (!hits && exportSurfaceAllows(index, targetFile, wanted)) {
      const chain = resolveThroughReexports(index, targetFile, wanted)
      if (chain.length === 1) {
        out.push({ id: row.id, symbolId: chain[0].symbolId, fileId: chain[0].fileId, via: "import-reexport" })
        seen.add(row.id)
      }
    }
    // THE STAR BARREL, entered only when the clause route found nothing. The label is not a
    // guess: a file can publish a name by a recorded clause or by a redistribution, so a
    // resolution that no clause carries IS the star route.
    if (!hits && !publishedByNamedClause(index, targetFile, wanted) && (index.starsByFile.get(targetFile)?.length ?? 0) > 0) {
      const star = resolveThroughStarSources(index, targetFile, wanted)
      if (star.length === 1) {
        out.push({ id: row.id, symbolId: star[0].symbolId, fileId: star[0].fileId, via: "import-star" })
        seen.add(row.id)
      }
    }
    continue
  }
  return out
}

/**
 * The semantic gate: a name may only be joined when the target module's EXPORT SURFACE is
 * recorded and contains it. When the surface is not recorded at all the name is refused,
 * not guessed — the same rule `import-resolution.ts` applies, and for the same reason (a
 * confidently wrong attachment is worse than an unresolved one).
 */
function exportSurfaceAllows(index: BindingIndex, fileId: string, name: string): boolean {
  const surface = index.exportsByFile.get(fileId)
  return !!surface && surface.has(name)
}

export interface MinimalDb {
  prepare(sql: string): { all(...params: any[]): any[]; get(...params: any[]): any; run(...params: any[]): any }
  run(sql: string, ...params: any[]): any
}

export interface BindingResolutionOutcome {
  scanned: number
  attached: number
  corrected: number
  /** Rows CLEARED because their name is a local binding of their own source symbol. */
  detached: number
  agreed: number
  byReason: Record<string, number>
}

/**
 * Attach and correct edges by the importing file's own import graph. Safe to call when
 * there is nothing to do; never throws into the caller.
 *
 * `opts.onlySourceFileIds` scopes the rows this call ACTS on to those whose SOURCE
 * (or, for a file-level `exports` row, whose exporting) file is one of these — the
 * bounded incremental pass's spelling of ownership, because it knows the files it
 * re-stored and not the row ids the store created. The reads stay project-wide
 * either way: every decision below is a function of the complete tables (the
 * importing file's own import statements, the exported surface of the module it
 * names), so restricting the writes is what keeps the bounded contract without
 * changing an answer. A row with no determinable own file is not kept under a
 * scope — the caller would be writing a row it cannot prove it owns.
 *
 * WHY THE BOUNDED PATH NEEDS THE WHOLE PASS, not just its detach rule: the name
 * strategies bind by a name that is UNIQUE project-wide, which includes a name the
 * row's OWN file binds locally (a parameter of the row's own source symbol, a local
 * `const`) — and this pass is what CLEARS those (`shadowed-local-binding`, GATE 2
 * of the planner), plus the only route that attaches a row through a recorded
 * import clause when the bare name is ambiguous. MEASURED by
 * `script/m14/verify-store-path-parity.ts` on the 250-file draw: with the name and
 * `module:item` half of the bounded resolution but without this call, the parity
 * gate reads **118 rows the full pass left NULL and the re-index bound**, every one
 * of them a `uses` row whose requested name is a parameter of its own source
 * symbol (`count` in `create_sbench_test(label, count, num_sources, fn)`); with it,
 * 0 rows differ.
 */
export function resolveImportBoundTargets(
  db: MinimalDb,
  projectId: string,
  opts: { onlySourceFileIds?: string[] } = {},
): BindingResolutionOutcome {
  const byReason: Record<string, number> = {}
  const out: BindingResolutionOutcome = { scanned: 0, attached: 0, corrected: 0, detached: 0, agreed: 0, byReason }
  const bump = (k: string) => { byReason[k] = (byReason[k] ?? 0) + 1 }
  try {
    const files = db.prepare(
      "SELECT id AS fileId, relative_path AS relativePath FROM brain_file WHERE project_id = ?",
    ).all(projectId) as any[]
    const symbols = db.prepare(
      "SELECT id AS symbolId, file_id AS fileId, name AS name FROM brain_symbol WHERE project_id = ?",
    ).all(projectId) as any[]
    const importRows = db.prepare(
      `SELECT file_id AS fileId, import_path AS importPath, imported_name AS importedName,
              imported_as AS importedAs, import_type AS importType
         FROM brain_import WHERE project_id = ?`,
    ).all(projectId) as any[]
    // The DECLARED name of an aliased import lives on the `imports` EDGE (the record's
    // target spells the local name), so the surface is read here rather than guessed. The
    // SAME rows carry the re-export clauses (`metadata.isReExport`), which is the evidence
    // the chain route follows — one query, because they are one channel.
    const importEdges = db.prepare(
      `SELECT source_external AS src, target_external AS tgt, metadata AS md
         FROM brain_relationship
        WHERE project_id = ? AND relationship_type = 'imports' AND target_external IS NOT NULL`,
    ).all(projectId) as any[]
    // The EXPORTING file is named by the edge's own `source_external` spelling, NOT by
    // wherever the name pass happened to attach its target. Keying the surface by the
    // target symbol's file is what let a wrong attachment corrupt it: on the gated fixture
    // `lib/parse.js` exports `parse` while `lib/decoy.js` declares the same name, and the
    // name pass attached BOTH export rows to the DECOY — so `lib/parse.js`'s surface held
    // `helper` only, and every resolver consulting it was told the module does not export
    // the very symbol it does. The spelling is exact (path branch) or a unique basename.
    const exportEdges = db.prepare(
      `SELECT source_external AS src, target_external AS tgt, target_symbol_id AS sym,
              tf.relative_path AS symFile
         FROM brain_relationship r
         LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
         LEFT JOIN brain_file tf ON tf.id = ts.file_id
        WHERE r.project_id = ? AND r.relationship_type = 'exports'
          AND r.target_external IS NOT NULL`,
    ).all(projectId) as any[]
    // `exports` rows are included because their SOURCE is the module, not a symbol: with no
    // source symbol there is no own-file evidence, so the name strategies resolve them by
    // name like a call — and can pick another file's symbol. `sfx` recovers the exporting
    // file from `source_external` so the own-file rule can answer for them.
    const allRows = db.prepare(
      `SELECT r.id AS id, r.relationship_type AS type, r.target_external AS target_external,
              r.target_symbol_id AS currentTarget, r.metadata AS md,
              COALESCE(sf.id, sfx.id) AS sourceFileId, ss.parameters AS sourceParams
         FROM brain_relationship r
         LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
         LEFT JOIN brain_file sf ON sf.id = ss.file_id
         LEFT JOIN brain_file sfx ON sfx.id = (
               SELECT id FROM brain_file WHERE relative_path = r.source_external LIMIT 1
             )
        WHERE r.project_id = ?
          AND r.target_external IS NOT NULL
          AND instr(r.target_external, ':') = 0
          AND instr(r.target_external, '.') = 0
          AND r.relationship_type IN ('calls','uses','instantiates','references','extends','exports')`,
    ).all(projectId) as any[]
    // The SCOPE, applied to the rows this call may write. Everything the decision
    // reads (the file table, the symbol table, the import records, the edges that
    // carry the declared names) is already complete above, so a scoped call makes
    // the same decision the full pass makes and only touches the rows it owns.
    const inScope = opts.onlySourceFileIds && opts.onlySourceFileIds.length > 0
      ? new Set(opts.onlySourceFileIds.map(String))
      : null
    const rows = inScope
      ? allRows.filter((r: any) => r.sourceFileId && inScope.has(String(r.sourceFileId)))
      : allRows

    const index: BindingIndex = {
      filePath: new Map(), fileIdByPath: new Map(), symbolsByFile: new Map(),
      symbolFile: new Map(), importsByFile: new Map(), exportsByFile: new Map(),
      reexportsByFile: new Map(), starsByFile: new Map(),
    }
    for (const f of files) {
      index.filePath.set(String(f.fileId), String(f.relativePath))
      index.fileIdByPath.set(String(f.relativePath), String(f.fileId))
    }
    for (const s of symbols) {
      const fileId = String(s.fileId)
      index.symbolFile.set(String(s.symbolId), fileId)
      let byName = index.symbolsByFile.get(fileId)
      if (!byName) { byName = new Map(); index.symbolsByFile.set(fileId, byName) }
      const arr = byName.get(String(s.name)) ?? []
      arr.push(String(s.symbolId))
      byName.set(String(s.name), arr)
    }
    // Declared names for aliased imports, keyed by (source spelling, module, local name).
    // RE-EXPORT clauses are split out here as well: for one of those the edge target spells
    // the name the SOURCE module declares (`export { a as b } from './m'` writes `./m:a`)
    // and `metadata.exportedAs` spells the name THIS file publishes it under, so the chain is
    // filed by what a consumer asks for and remembers what to ask the next module for. A
    // clause with no `exportedAs` publishes the same name it consumes (`export { pop } from
    // './context.js'`), which is the common case in the corpus.
    const declaredFor = new Map<string, string>()
    for (const e of importEdges) {
      const t = String(e.tgt)
      const colon = t.lastIndexOf(":")
      if (colon <= 0) continue
      const module = t.slice(0, colon)
      const local = t.slice(colon + 1)
      let md: any = null
      try { md = JSON.parse(e.md ?? "{}") } catch { md = null }
      // THE STAR CLAUSE, filed by STATEMENT rather than by name (`local === "*"`): a bare
      // `export *` writes no member. This branch sits BEFORE the `*` guard below, and that
      // placement is the fix for a measured miss: the guard skipped every `*` target, so a
      // bare star was filed nowhere and the route it feeds could never fire (the first run
      // of the star gate read `attached 0` and left both rows detached, which is how the
      // ordering was found). `starForm` is the discriminator the analyzer publishes, and it
      // exists because the two star forms were byte-identical records — `export * as ns from
      // './m'` binds ONE name and redistributes NOTHING, so filing it here would let the pass
      // invent, for a consumer of that file, every member of `./m` that the language does not
      // export. A row written before the field existed has no `starForm`, and the historical
      // `starForm: "all"` is REQUIRED, and that is a deliberate tightening rather than an
      // omission: the field IS the evidence that separates a redistribution from a
      // namespace binding, and the two were indistinguishable in every record written
      // before it existed — so an old row is EXACTLY the row a guess would be wrong about
      // (the gate's B17 measures the invented edge that guess produces). A record without
      // the field is therefore not followed, which is also what every other lane needs: the
      // resolver indexes only `imports` edges, and no other analyzer publishes `isReExport`
      // on one — haskell's `isReExport` rides an `exports` edge and nim's key is
      // `nimReExport` — so this branch cannot be reached by a language that has not stated
      // the distinction.
      if (md?.isReExport === true && local === "*" && md?.starForm === "all") {
        const fileId = e.src ? index.fileIdByPath.get(String(e.src)) : undefined
        if (fileId) {
          const arr = index.starsByFile.get(fileId) ?? []
          arr.push(module)
          index.starsByFile.set(fileId, arr)
        }
        continue
      }
      if (!local || local === "*") continue
      const declared = String(md?.declaredName ?? "")
      if (md?.isReExport === true) {
        const fileId = e.src ? index.fileIdByPath.get(String(e.src)) : undefined
        if (!fileId) continue
        const exportedAs = String(md.exportedAs ?? local)
        if (!exportedAs || exportedAs === "*") continue
        let byName = index.reexportsByFile.get(fileId)
        if (!byName) { byName = new Map(); index.reexportsByFile.set(fileId, byName) }
        const arr = byName.get(exportedAs) ?? []
        arr.push({ module, declared: declared && declared !== "*" ? declared : local })
        byName.set(exportedAs, arr)
        continue
      }
      if (declared && declared !== "*") declaredFor.set(`${module}\u0000${local}`, declared)
    }
    for (const i of importRows) {
      const fileId = String(i.fileId)
      const module = String(i.importPath ?? "")
      // ONLY a record that carries a LOCAL BINDING is usable here. A lane that stores its
      // module in `imported_name` and nothing in `imported_as` has not told us which name
      // its file writes, and guessing from the module string would attach nothing (or, on
      // a module whose basename matches a symbol, the wrong thing).
      const local = i.importedAs ? String(i.importedAs) : ""
      if (!module || !local) continue
      const arr = index.importsByFile.get(fileId) ?? []
      arr.push({
        module,
        local,
        declared: declaredFor.get(`${module}\u0000${local}`) ?? local,
        kind: String(i.importType ?? ""),
      })
      index.importsByFile.set(fileId, arr)
    }
    // Path spelling first (exact), then the target symbol's file as a fallback for a lane
    // that names no file. A path spelling also places a RE-EXPORT correctly: the module
    // that re-exports a name is the module whose surface contains it.
    for (const e of exportEdges) {
      const spelled = e.src ? index.fileIdByPath.get(String(e.src)) : undefined
      const fileId = spelled ?? (e.sym ? index.symbolFile.get(String(e.sym)) : undefined)
      if (!fileId) continue
      const set = index.exportsByFile.get(fileId) ?? new Set<string>()
      const t = String(e.tgt)
      const colon = t.lastIndexOf(":")
      set.add(colon >= 0 ? t.slice(colon + 1) : t)
      index.exportsByFile.set(fileId, set)
    }

    out.scanned = rows.length
    if (rows.length === 0) return out

    const planned = planBindingResolutions(rows.map((r: any) => ({
      id: String(r.id),
      type: String(r.type),
      target_external: String(r.target_external),
      currentTarget: r.currentTarget ? String(r.currentTarget) : null,
      sourceFileId: r.sourceFileId ? String(r.sourceFileId) : null,
      sourceParams: r.sourceParams ?? null,
      calleeExpression: (() => {
        try { return String(JSON.parse(r.md ?? "{}")?.calleeExpression ?? "") || null } catch { return null }
      })(),
    })), index)

    const update = db.prepare(
      `UPDATE brain_relationship
          SET target_symbol_id = ?,
              is_cross_file = CASE WHEN ? <> (
                    SELECT file_id FROM brain_symbol WHERE id = ? LIMIT 1
                  ) THEN 1 ELSE 0 END
        WHERE id = ? AND project_id = ?`,
    )
    const detach = db.prepare(
      `UPDATE brain_relationship
          SET target_symbol_id = NULL, is_cross_file = 0
        WHERE id = ? AND project_id = ? AND target_symbol_id IS NOT NULL`,
    )
    const plannedIds = new Set(planned.map((p) => p.id))
    // id -> the target as it stood, so classifying a plan as ATTACH or CORRECT is a map
    // lookup rather than a scan per row (the scan made the pass O(rows x planned)).
    const currentById = new Map<string, string | null>()
    for (const r of rows) currentById.set(String(r.id), r.currentTarget ? String(r.currentTarget) : null)
    for (const p of planned) {
      const stood = currentById.get(p.id)
      // A DETACH is only meaningful for a row that carries a target: the guard is in the
      // statement, so a row that was already unresolved counts as AGREED rather than as a
      // change the pass did not make.
      if (p.symbolId === null) {
        if (!stood) { out.agreed++; continue }
        try {
          const r = detach.run(p.id, projectId)
          if (typeof r?.changes === "number" ? r.changes > 0 : true) out.detached++
        } catch { /* one bad row must not abandon the pass */ }
        continue
      }
      // A planned row that already carried the right target is AGREED, not corrected: a
      // count that lumps "re-set to the same value" into corrections overstates the fix.
      if (stood === p.symbolId) { out.agreed++; continue }
      try {
        update.run(p.symbolId, p.fileId, p.symbolId, p.id, projectId)
        if (stood) out.corrected++
        else out.attached++
      } catch { /* one bad row must not abandon the pass */ }
    }
    for (const r of rows) {
      const id = String(r.id)
      if (plannedIds.has(id)) continue
      // An unplanned EXPORT row is a different fact from an unplanned call: the file does
      // not declare that name (a re-export, or a name the name pass invented), so it is
      // reported under its own reason rather than as a missing import binding.
      if (String(r.type) === "exports") { bump("exports-not-locally-declared"); continue }
      if (r.currentTarget) out.agreed++
      else bump("no-import-evidence")
    }
    return out
  } catch {
    // A project with no import table, or a store that has not been migrated, must not
    // fail an index run over a relationship class that is a bonus.
    return out
  }
}
