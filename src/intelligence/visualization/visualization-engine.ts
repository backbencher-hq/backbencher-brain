// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the visualization engine: it turns the index's stored
//   symbol and relationship rows into one bounded, declared graph projection
//   (nodes, links, exclusions, page, owner-cascade folds, annotation overlay) and
//   renders that projection as text, JSON or a self-contained HTML artifact.
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true,
//   modes: project, file, module, symbol, feature).
// WHY IT IS SHAPED THIS WAY — the answer is a SELECTION, so every quantity that
//   could be mistaken for a total is declared separately: totalNodesAvailable
//   (what the scope and filters match), truncation.originalNodes (what reached
//   the projection) and the returned node count; the page cursor walks one total
//   order with an `s.id` tiebreaker; and the two reasons an edge is absent (the
//   node cut, the maxLinks budget) are counted apart. The edge set is complete
//   for the returned nodes because it is fetched by joining both endpoints
//   rather than by slicing the relationship table. Targets are VALUES, never
//   patterns: LIKE metacharacters are escaped and every LIKE carries ESCAPE.
// WHERE ITS EVIDENCE LIVES — docs/tools/bb_visualize.md, docs/BB_VISUALIZE.md,
//   validation/tools/bb_visualize/** (probe.ts, read-path.ts, latency.ts,
//   real-corpus.ts); gates: npx tsx validation/tools/bb_visualize/probe.ts,
//   script/m13/verify-visualize-*.ts, script/m15/verify-visualize-migrate-deep.ts.
// EDIT TOGETHER WHEN THIS FILE CHANGES — src/mcp/tools/bb_visualize/{descriptor,handler}.ts,
//   src/ast/dependency-graph-visualizer.ts (projection), the gates above, and
//   both documentation pages.
// CONTRACTS IT MUST NOT BREAK — read-only index access (byte-read-only handle),
//   declared bounds and declared absence, the noise filter's attribution, and
//   the no-regex policy (validation/tools/regex-allowlist.json).
// ─────────────────────────────────────────────────────────────────────────────

import { BrainDatabase } from "../../brain/database"
import { DependencyGraphVisualizer } from "../../ast/dependency-graph-visualizer"
import { renderVisualizationStudio } from "../../ast/visualization/studio-renderer"

export type VisualizationScope = "project" | "file" | "module" | "symbol" | "feature"
export type VisualizationFormat = "text" | "json" | "html"
/** Which picture of the project the answer draws: the dependency graph.
 *  Any other `view` value is refused rather than answered as the graph. */
export type VisualizationView = "graph"

/** HOW the graph view arranges its nodes.
 *
 *  `regions` groups every node into the DIRECTORY it lives in, anchors each region
 *  and draws it as a named pod, so the picture is a map of the repository's parts.
 *  `force` ignores directories completely: one force-directed layout, no pods and no
 *  region links, every stored edge drawn as itself — which is the graph as it looked
 *  before the regions arrived, and which some readers want back for a connected
 *  project whose parts do not fall along directory lines.
 *
 *  It is a CHOICE rather than a replacement: the reader asked for the earlier graph
 *  to remain available, selectable in the sidebar and from the tool call. */
export type VisualizationLayout = "regions" | "force"

/** What the graph draws, in the words of the DEFAULT text format.
 *
 *  The text answer names it so the reply a caller gets without asking is the
 *  reply that can be audited. */
const VIEW_NOTE: Record<VisualizationView, string> = {
  graph: "the force-directed dependency map \u2014 nodes are symbols, sized by the index's own gravity",
}

/** What each graph layout draws, in the words of the DEFAULT text format.
 *
 *  Both layouts are force-directed; the difference is what the nodes are grouped
 *  INTO, and therefore what an edge between two groups can be. `regions` has named
 *  parts to summarise between, `force` has none, so a summary there would have
 *  nothing to summarise. The text answer says which one the HTML will draw, because
 *  a caller choosing `layout: "force"` and receiving `regions` would otherwise have
 *  no way to tell except by opening the file. */
const LAYOUT_NOTE: Record<VisualizationLayout, string> = {
  regions: "nodes grouped into the DIRECTORY they live in, each region anchored, outlined and named, and an edge between two regions summarised as one dotted region link per pair (the reader can switch this at runtime in the generated page)",
  force: "no directories: one force layout, no region pods and no region links \u2014 every stored edge drawn as itself, capped at a zoom-dependent count with the readout naming the cap",
}

export interface VisualizationRequest {
  scope?: VisualizationScope
  target?: string
  format?: VisualizationFormat
  view?: VisualizationView
  /** The graph's arrangement: `regions` (default) or `force`. */
  layout?: VisualizationLayout
  maxNodes?: number
  maxLinks?: number
  /** How many symbols of the SAME total order the ranking uses to SKIP before this page
   *  begins.
   *
   *  MEASURED as a gap, not a defect: `maxNodes` selects the top-N, and on a project the
   *  default 200 is a slice of tens of thousands — there was no `offset`, no `startAfter`
   *  and no id list, so symbol 201 of a scope could not be asked for at all. `bb_search`
   *  has `offset` and `bb_migrate` has `symbolIds`; the tool whose whole answer is about
   *  declared bounds was the one that could only ever show the first page. A page is a
   *  page: `considered.page` states which one this is, and the order carries a final
   *  tiebreaker so page k+1 begins where page k ended. */
  offset?: number
  relationshipTypes?: string[]
  languages?: string[]
  /** Symbol kinds to KEEP (`class`, `function`, `method`, `constant`, ...), matched
   *  case-insensitively against the index's own spellings by the handler.
   *
   *  MEASURED: with no way to ask for kinds, `scope: "project"` on this repository returns
   *  200 nodes of which 124 (62%) are `constant` or `property` and exactly ONE is a class —
   *  the "architecture" map is a map of string constants and a spine of containment, and
   *  nothing in the reply or the picture said so. The census below states it, and this filter
   *  is how a caller asks for the other picture instead. */
  symbolKinds?: string[]
  /** Path SEGMENTS to treat as noise. Matched on whole segments, never as
   *  substrings " the previous hardcoded filter removed `src/util/edit_distance.rs`
   *  because "dist" is inside "edit_distance", and `src/compiler/layout.rs`
   *  because "out" is inside "layout". */
  excludePatterns?: string[]
  /** Include test/spec sources. Default true: they are ordinary source. */
  includeTests?: boolean
}

export interface VisualizationResult {
  scope: VisualizationScope
  target: string | null
  format: VisualizationFormat
  view: VisualizationView
  /** The layout the graph was drawn with: `regions` groups nodes by directory,
   *  `force` is one plain force layout. */
  layout: VisualizationLayout
  nodes: any[]
  links: any[]
  /** What the noise filter removed, and on whose authority. A partial graph must
   *  never be allowed to look like a whole one. */
  excluded?: {
    symbols: number
    /** Exclusions attributed to a path SEGMENT, whether the caller supplied it or it is one
     *  of the documented defaults. */
    byPattern: Record<string, number>
    /** Exclusions attributed to the RULES that are not segments — the build-artifact suffix
     *  list and the test rule. Present even when it counted nothing, so an unattributed
     *  remainder is visible rather than assumed away.
     *
     *  MEASURED before: with four symbols dropped, `byPattern` attributed ONE (`vendor`) and
     *  `src/b.d.ts`, `src/c.min.js`, `src/d.map` were attributed to nothing at all; with
     *  `includeTests:false` a fifth was dropped by the test rule and the block still read
     *  `byPattern {vendor:1}`. A caller narrowing exclusions could not reconcile `symbols`
     *  with `byPattern`, and the option they set was invisible in the block. */
    byRule?: Record<string, number>
    /** The build-artifact suffixes filtered unconditionally. DECLARED because they are not
     *  overridable and were previously invisible in the reply. */
    suffixes?: string[]
    patterns: string[]
    includesTestFiles: boolean
  }
  /** How many symbols this scope and filter set actually match, ignoring every
   *  output bound. Kept distinct from `truncation.originalNodes` (how many
   *  reached the projection) and from `nodes` (how many were returned), so a
   *  short page can never be mistaken for the whole set. */
  totalNodesAvailable: number
  /** What the answer actually READ, as opposed to what it returned.
   *
   *  The edge set is COMPLETE for the selected nodes rather than a slice of the
   *  relationship table, so there is nothing to confess there. MEASURED: the old
   *  query read `LIMIT maxLinks*3` rows in PRIMARY KEY order and found 0 of the
   *  1,142 relationships that actually connected 400 selected symbols — the slice
   *  was uncorrelated with the node set, so the answer was both slow and wrong.
   *  The NODE set is still a selection, and that is what this block declares. */
  considered?: {
    /** Stored relationship rows connecting two of the RETURNED nodes, counted for
     *  the node set the reader can actually see rather than the larger set the
     *  fetch was built from. MEASURED: counting the fetch set declared 1,142 edges
     *  for a graph of 200 nodes whose true figure is 394. */
    relationshipsBetweenSelectedNodes: number
    /** Why the edge set is complete, stated so a reader need not infer it. */
    relationshipSelection: string
    /** True when `maxLinks` cut the complete edge set after all. */
    relationshipSetTruncated: boolean
    /** Which symbols got a chance to be in the graph, and in what order. */
    nodeSelection: string
    /** The language filter, which is applied BEFORE the limit. */
    languagesConsidered: string[] | null
    /** The relationship-type filter that was APPLIED, in the index's own spelling.
     *
     *  MEASURED before: `relationshipTypes: ["call"]` (a typo for the stored `calls`) left the
     *  nodes in place and emptied the edge set, and the answer still described itself as
     *  "complete for this node set" while nothing in the reply named the filter that had
     *  produced the empty edges. The handler now folds the values against the stored
     *  vocabulary and refuses an unknown one, naming the set it should have come from; this
     *  field states what was applied either way, so the edge census can be reconciled with
     *  the filter that produced it. */
    relationshipTypesConsidered: string[] | null
    /** The symbol-kind filter that was APPLIED (the index's own spellings), or null when the
     *  selection was left to the index's ranking. */
    symbolKindsConsidered: string[] | null
    /** What the RETURNED nodes are made of, kind by kind, counted from the answer itself.
     *
     *  MEASURED: `scope: "project"` on this repository returns 200 nodes of which 124 (62%)
     *  are `constant` or `property` and one is a class. That composition existed only inside
     *  the HTML census, so the default reply could not answer "what am I looking at" and a
     *  caller could not tell it was reading a map of string constants. Counted here, so both
     *  formats state it. */
    kindCensus: Record<string, number>
    /** The same, by language — the question "how much of this project is TypeScript" was
     *  answerable only by opening the HTML artifact. */
    languageCensus: Record<string, number>
    /** The index's OTHER facts about the nodes this answer returned, as a declared layer.
     *
     *  A picture that carries only nodes and edges is a map of ONE layer, while the
     *  same index already holds agent annotations (`bb_annotate`), security findings
     *  and orphan findings. A note written on a symbol is a fact about that symbol,
     *  and a map that cannot show it is incomplete evidence rather than a smaller
     *  picture.
     *
     *  Annotations are matched by (symbol name, symbol path), which is how the store keys them
     *  rather than by symbol id — so a note whose path does not match any returned symbol is
     *  COUNTED (`notesOnOtherPaths`) instead of silently attached to a same-named symbol
     *  elsewhere in the project. A name is not an identity. */
    overlays?: {
      annotations: {
        /** Notes matched to a RETURNED node. */
        notes: number
        /** How many of the returned nodes carry at least one. */
        nodes: number
        /** Notes whose symbol name matched but whose path did not — not attached. */
        notesOnOtherPaths: number
        /** The notes themselves, bounded, with the node each is attributed to. */
        items: { node: string; name: string; author: string; body: string; updated: string }[]
        /** True when `items` was cut; `notes` is always the true count. */
        capped: boolean
        rule: string
      }
    }
    /** WHICH PAGE this answer is, stated rather than left to be inferred by subtracting
     *  the other numbers in the reply.
     *
     *  A page is only meaningful if the order it was cut from is TOTAL: gravity and line
     *  numbers tie constantly on a real index, and an order with ties lets page k+1 repeat
     *  rows page k already showed while silently dropping others. That is why every ORDER BY
     *  in this engine ends with `s.id` — the tiebreaker exists for this field, not for looks. */
    page: {
      offset: number
      limit: number
      returned: number
      /** How many symbols the scope and filters match — `totalNodesAvailable`, repeated here so a
       *  caller reading only the page block has the denominator. */
      total: number
      /** What `total` counts, because a page is cut from the PROJECTION order and the two are
       *  not the same set: the projection drops build noise and unlinked locals, so a page can
       *  be short of `limit` while `total` still counts them. Stated rather than left to be
       *  discovered by dividing. */
      totalBasis: string
      /** 1-based page number, so `offset:0` is page 1 and not page 0. */
      number: number
      /** Where the next page starts, or null when this one reached the end.
       *
       *  Computed from whether the FETCH ran out of rows, not from `total`: the arithmetic must
       *  be exact, and `total` counts symbols the projection may not draw. A caller walks pages
       *  by following this cursor until it reads null. */
      nextOffset: number | null
      rule: string
    }
    /** The owner-cascade fold, whenever a class-like symbol was selected. Present
     *  even when it folded nothing, so "no folded edges" and "the fold never ran"
     *  are distinguishable. */
    ownerCascade?: {
      applied: boolean
      owners: number
      membersScanned: number
      rowsFolded: number
      /** Symbol(s) that the folded edges connect to and that were ADDED to the node
       *  set so those edges have two ends to draw. */
      nodesAdded: number
      /** Of those, how many the node budget cut — a folded edge the answer will not
       *  show, counted rather than silently lost. */
      nodesDropped: number
      rule: string
      capped: boolean
    }
  }
  /** True when the answer is empty, with the reason. Absence is declared, —
   *  never an empty result that looks like a real project. */
  declaredAbsent?: boolean
  absenceNote?: string | null
  /** Where the picture's numbers came from — and the two DIFFERENT reasons an edge can be
   *  missing from it, counted apart because they describe different events.
   *
   *  MEASURED: this block used to carry one counter named `omittedDanglingLinks`, and it read
   *  2 for `maxNodes: 2` on a graph whose SQL had returned every row. The number was always
   *  about the NODE CUT (a link whose endpoint the node budget removed); `generateGraphData`
   *  cannot emit a link whose endpoints are missing, so "dangling" was never what it
   *  measured, and the text format printed "then cut by maxLinks" from it while `maxLinks`
   *  was 5000 and had withdrawn nothing. */
  provenance: {
    source: "stored-symbol-and-relationship-rows"
    indexedProject: string
    /** Links the answer does not show because an ENDPOINT is not in the returned node set. */
    linksOmittedWithNodeCut: number
    /** Links withdrawn by the `maxLinks` budget AFTER the node cut — the only thing
     *  `considered.relationshipSetTruncated` is about. */
    linksOmittedByBudget: number
  }
  truncation: {
    truncated: boolean
    originalNodes: number
    originalLinks: number
    maxNodes: number
    maxLinks: number
    reason: string | null
    totalNodesAvailable: number
    /** The page cursor this answer was cut with, and where the next one starts (null when
     *  this is the last page). Carried in `truncation` as well as `considered.page` because
     *  a caller reconciling "how much is there" with "what did I get" reads this block. */
    offset: number
    nextOffset: number | null
    /** Present ONLY when a bound had to be adjusted, naming what was asked for and what was
     *  applied.
     *
     *  `maxNodes: 0` used to become 1 silently — the same shape `bb_health` refuses for
     *  `sampleSize: 0`, where the caller asks to check no files and is told one file was
     *  checked and clean. The TOOL door now refuses such a value outright
     *  (see the handler), naming the accepted range; this field covers the other door, a
     *  direct caller of the engine, so neither can be quietly given a different page than
     *  the one it asked for. */
    boundsAdjusted?: string[]
  }
}

/** Escape the LIKE metacharacters so a target is matched as a VALUE.
 *  Measured: `scope: "file", target: "%"` previously selected every file in the
 *  corpus, because the target was interpolated into a LIKE pattern raw. The
 *  sibling tool states the same rule for itself — "a target is a VALUE, never a
 *  pattern: %, _ and \ are escaped and match themselves" — so the two now agree. */
const LIKE_ESCAPE_CHAR = "\\"

function escapeLike(value: string): string {
  // Character walk rather than a regular expression: the set is three literal
  // characters and the operation is a prefix, which string operations express
  // exactly. A backslash is escaped too, because with ESCAPE in force it is the
  // escape character and has to be able to match itself.
  let escaped = ""
  for (const character of value) {
    if (character === LIKE_ESCAPE_CHAR || character === "%" || character === "_") escaped += LIKE_ESCAPE_CHAR
    escaped += character
  }
  return escaped
}

/** Strip ONE trailing directory separator, so `src/util` and `src/util/` name the
 *  same module on every scope. String operations rather than a regex because a
 *  single anchored suffix is not a pattern language problem. */
function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value
}

/** The clause that makes `escapeLike` mean what it says.
 *
 *  MEASURED: without an ESCAPE clause SQLite has NO escape character, so a
 *  pattern containing the two characters `\_` is "a literal backslash, then any
 *  character": `'src/my_mod/x.ts' LIKE 'src/my\_mod/%'` is 0 and
 *  `'100%' LIKE '100\%'` is 0. Every scope whose predicate used a LIKE therefore
 *  matched NOTHING for a target containing `_` or `%`, and the answer declared
 *  "no indexed symbol matches scope=module target=src/my_mod — absence declared,
 *  never guessed" for a module the index holds (measured: 2 rows). The docs told
 *  the caller those characters "match themselves"; they matched nothing.
 *
 *  The clause rides every LIKE that binds an escaped value, so the escaping and
 *  the SQL cannot drift apart again. `\` is escaped in `escapeLike` as well,
 *  because with ESCAPE in force the backslash is the escape character and has to
 *  be able to match itself. */
const LIKE_ESCAPE = " ESCAPE '\\'"

/** A directory prefix matched on a whole SEGMENT boundary: `src/util` matches
 *  `src/util/x.ts` and never `src/utilities/x.ts`. */
function segmentPrefix(value: string): string {
  return `${escapeLike(value)}/%`
}

/** Apply a numeric bound, and REPORT the adjustment instead of making it silently.
 *
 *  MEASURED before: `bounded()` returned `Math.max(1, Math.min(max, floor(n)))`, so
 *  `maxNodes: 0` returned ONE node and echoed `truncation.maxNodes: 1` — the caller asked for
 *  no nodes and was handed one. `bb_health` refuses the same shape for `sampleSize: 0`
 *  ("asked to check no files and was told one file was checked and clean"), and
 *  `bb_analyze` refuses `limit: 0` because a returned page must mean the page that was
 *  asked for.
 *
 *  So both doors are closed: the tool refuses an out-of-range budget (handler, naming the
 *  accepted range), and this function cannot adjust one without naming it, which is what a
 *  direct caller of the engine sees. "2 clamped to 1" and "the caller asked for 1" are
 *  different facts and must not print the same. */
function applyBound(label: string, value: unknown, fallback: number, max: number): { value: number; adjusted: string | null } {
  const n = Number(value)
  if (!Number.isFinite(n)) return { value: fallback, adjusted: null }
  const asked = Math.floor(n)
  const applied = Math.max(1, Math.min(max, asked))
  if (applied === asked) return { value: applied, adjusted: null }
  return {
    value: applied,
    adjusted: asked < 1
      ? `${label}: ${asked} is below the accepted minimum 1 — applied ${applied} (accepted range 1..${max})`
      : `${label}: ${asked} is above the accepted ceiling ${max} — applied ${applied} (accepted range 1..${max})`,
  }
}

/** The SQL clause and parameters for the language filter.
 *
 *  MEASURED on cargo: `bb_visualize({languages: ["javascript"]})` returned 0
 *  nodes and declared the project had none, while the index held 56 javascript
 *  symbols in real files. The engine selected `LIMIT maxNodes*2` symbols ordered
 *  by gravity and then filtered them in memory, so any language whose symbols were
 *  not already in that slice was cut before the filter ran. The tool even
 *  contradicted itself: the declared total counted the language in SQL while the
 *  returned nodes came from the empty in-memory result.
 *
 *  Built in one place and used by BOTH the symbol query and the count query, so
 *  the two can never disagree about what was asked for — which is how the
 *  contradiction above arose in the first place. */
function languageClause(request: VisualizationRequest): { where: string; params: unknown[] } {
  const wanted = request.languages?.filter((l) => typeof l === "string" && l.length > 0) ?? []
  if (wanted.length === 0) return { where: "", params: [] }
  return {
    where: ` AND f.language IN (${wanted.map(() => "?").join(",")})`,
    params: wanted,
  }
}


/** The SQL clause for the symbol-kind filter, built once and used by BOTH the symbol
 *  query and the count query — the same discipline `languageClause` documents, and for the
 *  same measured reason: when the declared total and the returned answer are built from
 *  different predicates, one reply declares symbols available that it then does not return. */
function kindClause(request: VisualizationRequest): { where: string; params: unknown[] } {
  const wanted = request.symbolKinds?.filter((kind) => typeof kind === "string" && kind.length > 0) ?? []
  if (wanted.length === 0) return { where: "", params: [] }
  return {
    where: ` AND s.symbol_type IN (${wanted.map(() => "?").join(",")})`,
    params: wanted,
  }
}

function countAvailableSymbols(
  raw: any,
  projectId: string,
  scope: VisualizationScope,
  target: string,
  request: VisualizationRequest,
): number {
  // The SAME predicate the symbol query uses, so the declared true size and the
  // returned answer can never describe different sets. This is not a nicety:
  // when the two drifted, one reply declared 56 javascript symbols available and
  // returned none of them.
  const stripped = withoutTrailingSlash(target)
  let where = "1=1"
  const params: unknown[] = []
  if (scope === "file") {
    where = "(f.relative_path=? OR f.path=? OR f.relative_path LIKE ?" + LIKE_ESCAPE + ")"
    params.push(target, target, segmentPrefix(stripped))
  } else if (scope === "module") {
    where = "(f.relative_path LIKE ?" + LIKE_ESCAPE + " OR f.relative_path LIKE ?" + LIKE_ESCAPE + ")"
    params.push(segmentPrefix(stripped), segmentPrefix(stripped.split("/").pop() ?? stripped))
  } else if (scope === "symbol") {
    where = "(s.name=? OR s.qualified_name=?)"
    params.push(target, target)
  } else if (scope === "feature") {
    const needle = `%${escapeLike(target.toLowerCase())}%`
    where = "(lower(s.name) LIKE ?" + LIKE_ESCAPE + " OR lower(COALESCE(s.docstring,'')) LIKE ?" + LIKE_ESCAPE + ")"
    params.push(needle, needle)
  }
  const lang = languageClause(request)
  const kind = kindClause(request)
  // The join to brain_file is only there because the PREDICATE sometimes reads
  // f.language or f.relative_path. When neither does — the whole-project count
  // with no language filter — the join is pure waste, and SQLite then has to walk
  // the file table to satisfy it. MEASURED on cargo, project scope, no filter:
  // 406.1 ms with the join against 3.0 ms without it, on the same 40,595 symbols.
  // So the join is applied only when a predicate actually needs it. (The kind filter reads
  // only `s`, so it never forces the join.)
  const needsFile = where !== "1=1" || lang.params.length > 0
  const row = needsFile
    ? raw
        .prepare(
          `SELECT COUNT(*) AS c FROM brain_symbol s JOIN brain_file f ON f.id = s.file_id
            WHERE s.project_id = ? AND ${where}${lang.where}${kind.where}`,
        )
        .get(projectId, ...lang.params, ...kind.params, ...params)
    : raw.prepare(`SELECT COUNT(*) AS c FROM brain_symbol s WHERE s.project_id = ?${kind.where}`).get(projectId, ...kind.params)
  return Number((row as { c: number })?.c ?? 0)
}


/**
 * The ORDER BY for a scope that ranks by importance: the index's own gravity, so
 * the graph is the project's busiest core rather than a sample. The narrower
 * scopes (file, module, symbol) order by source position, which is already the
 * right order for a reader of one file, so they are untouched.
 */
/**
 * The symbol kinds that count as class-like: the owner cascade attributes a member's
 * rows to one of these. One list, used everywhere the engine tests for one, so the
 * two can never drift.
 */
const CLASS_LIKE_TYPES = new Set([
  "class", "struct", "interface", "enum", "trait", "type", "protocol", "object",
])

function importanceOrder(): string {
  return "s.gravity_score DESC, s.line_start, s.id"
}

/**
 * The ORDER BY for a scope that walks source order: the base the caller names, with
 * `s.id` as the final tiebreaker in EVERY order this engine cuts a page from — two
 * symbols can share a gravity score and a line number, and an order with ties cannot
 * be paged without repeating one row and dropping another.
 */
function scopedOrder(base: string): string {
  return `${base}, s.id`
}

export async function visualizeProject(projectId: string, request: VisualizationRequest = {}): Promise<VisualizationResult> {
  // Byte-read-only: a read answer must not migrate, heal or otherwise write the
  // index just by being asked for. The read-write open runs the schema migrations
  // and healers, which moves the WAL on every call (measured: WAL 0 → 2.5 MB after
  // one default answer, and the annotation guard triggers were dropped and
  // recreated on every open).
  const raw = await BrainDatabase.getRawInstance(projectId as any, { readonly: true })
  const scope = request.scope ?? "project"
  const target = String(request.target ?? "")
  const nodeBound = applyBound("maxNodes", request.maxNodes, 200, 2000)
  const linkBound = applyBound("maxLinks", request.maxLinks, 5000, 20000)
  const maxNodes = nodeBound.value
  const maxLinks = linkBound.value
  // The OFFSET is a page cursor, not a budget, and it is normalised with a note rather than
  // silently: the tool door refuses a non-integer or a negative (the validation layer calls
  // `offset` an integer parameter), but the ENGINE is called directly by the CLI and by
  // every gate, and a direct caller must not be handed a different page than it asked for
  // without being told.
  const requestedOffset = request.offset
  const offset = typeof requestedOffset === "number" && Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0
  const offsetNote = requestedOffset != null && offset !== requestedOffset
    ? `offset ${JSON.stringify(requestedOffset)} is not a non-negative whole number; 0 applied`
    : null
  const boundsAdjusted = [nodeBound.adjusted, linkBound.adjusted, offsetNote].filter((note): note is string => note !== null)
  // The fetch is a WINDOW, not the whole table. It must reach far enough to serve this page
  // plus the 2x headroom the node cut has always drawn from — the owner cascade spends
  // it — so the headroom travels with the offset instead of shrinking to nothing on page 2.
  const fetchLimit = offset + maxNodes * 2
  // The language filter is applied in SQL, BEFORE the LIMIT — see languageClause above for
  // what that costs when it is applied afterwards instead.
  const lang = languageClause(request)
  const kind = kindClause(request)
  let symbols: any[]
  const stripped = withoutTrailingSlash(target)
  const leaf = stripped.split("/").pop() ?? stripped
  const needle = `%${escapeLike(target.toLowerCase())}%`
  if (scope === "file") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where}${kind.where} AND (f.relative_path=? OR f.path=? OR f.relative_path LIKE ?${LIKE_ESCAPE}) ORDER BY ${scopedOrder("s.line_start")} LIMIT ?`).all(projectId, ...lang.params, ...kind.params, target, target, segmentPrefix(stripped), fetchLimit) as any[]
  else if (scope === "module") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where}${kind.where} AND (f.relative_path LIKE ?${LIKE_ESCAPE} OR f.relative_path LIKE ?${LIKE_ESCAPE}) ORDER BY ${scopedOrder("f.relative_path,s.line_start")} LIMIT ?`).all(projectId, ...lang.params, ...kind.params, segmentPrefix(stripped), segmentPrefix(leaf), fetchLimit) as any[]
  else if (scope === "symbol") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where}${kind.where} AND (s.name=? OR s.qualified_name=?) ORDER BY ${scopedOrder("s.line_start")} LIMIT ?`).all(projectId, ...lang.params, ...kind.params, target, target, fetchLimit) as any[]
  else if (scope === "feature") symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where}${kind.where} AND (lower(s.name) LIKE ?${LIKE_ESCAPE} OR lower(COALESCE(s.docstring,'')) LIKE ?${LIKE_ESCAPE}) ORDER BY ${importanceOrder()} LIMIT ?`).all(projectId, ...lang.params, ...kind.params, needle, needle, fetchLimit) as any[]
  else symbols = raw.prepare(`SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id WHERE s.project_id=?${lang.where}${kind.where} ORDER BY ${importanceOrder()} LIMIT ?`).all(projectId, ...lang.params, ...kind.params, fetchLimit) as any[]
  const ids = new Set(symbols.map((symbol) => symbol.id))
  // The edge set is fetched BY JOINING the selected nodes, not by reading a slice
  // of the relationship table and discarding most of it.
  //
  // MEASURED on cargo (400 selected symbols): the old query read
  // `LIMIT maxLinks*3` = 15,000 rows in PRIMARY KEY order and found **zero** of the
  // 1,142 relationships that actually connect those nodes — the slice is essentially
  // uncorrelated with the node set, so it was slow AND wrong. Joining on both
  // endpoints returns the same answer from 1,142 rows in 43.4 ms, using the
  // existing brain_rel_proj_source_idx, with no new index.
  //
  // The consequence is an honesty IMPROVEMENT, not just a speedup. There is no
  // longer an arbitrary slice to disclose: the edge set is every relationship
  // between the selected nodes, which is a complete fact. So the full-table COUNT
  // that existed only to say "we read M of N" is not merely slow (453 ms for a
  // SCAN of 164,767 rows) — it is unnecessary, and deleting it removes the known
  // primary-key weakness the docs had to confess.
  //
  // `id` and the stored classification are selected because the projection carries
  // them: an edge with no row id cannot be traced to the stored row that justifies
  // it, and a graph that cannot tell a confident edge from a weak one is a picture,
  // not evidence. Evidence TIERS are absent by design — they are not a stored column
  // (verified with PRAGMA table_info) and bb_graph derives them; deriving them here
  // too would create a second, divergent source of truth.
  let relationships: any[]
  if (ids.size === 0) {
    relationships = []
  } else {
    // The edge set is fetched by joining the SELECTED identities, in chunks.
    //
    // MEASURED on the reference index (6,452 files / 310,423 symbols / 820,040
    // relationships): the one-statement form with two IN lists of 400 parameters
    // apiece took 9,825 ms cold because the planner can only seek one arm and then
    // re-checks the other list per candidate. The same row set — verified identical,
    // 8,382 rows — is fetched in 91 ms by binding a 100-id source chunk per statement
    // and the full target list once per chunk. Chunking is what keeps the parameter
    // count inside a plan SQLite can use; it is not a sampling of the edge set, so
    // the completeness claim below still holds.
    const idList = [...ids]
    const RELATIONSHIP_FETCH_CHUNK = 100
    const targetPlaceholders = idList.map(() => "?").join(",")
    relationships = []
    for (let start = 0; start < idList.length; start += RELATIONSHIP_FETCH_CHUNK) {
      const chunk = idList.slice(start, start + RELATIONSHIP_FETCH_CHUNK)
      relationships.push(
        ...(raw
          .prepare(
            `SELECT id AS row_id,source_symbol_id AS source_id,target_symbol_id AS target_id,relationship_type,confidence,is_cross_language,is_cross_file,bridge_mechanism,line_number
               FROM brain_relationship
              WHERE project_id = ?
                AND source_symbol_id IN (${chunk.map(() => "?").join(",")})
                AND target_symbol_id IN (${targetPlaceholders})`,
          )
          .all(projectId, ...chunk, ...idList) as any[]),
      )
    }
  }
  // The owner cascade: a relationship stored on a MEMBER is attributed to the
  // class-like owner that is actually in the node set, and the edge says so.
  //
  // The fold is deliberately narrow, because an eager fold DOUBLE COUNTS: a member
  // is folded only when it is NOT itself in the node set (an exact edge is always
  // preferred to an attributed one), only for CLASS-LIKE owners (the attribution is
  // about the owner CLASS), and never for `contains` rows (the membership relation
  // itself, which would fold into a self-loop). Every folded row is MARKED on the
  // edge, so a reader can tell an edge the index stored between the two drawn nodes
  // from one attributed through a member.
  let ownerCascade: { applied: boolean; owners: number; membersScanned: number; rowsFolded: number; nodesAdded: number; nodesDropped: number; nodesFiltered: number; foldedRowsWithoutDrawableCounterpart: number; capped: boolean } = { applied: false, owners: 0, membersScanned: 0, rowsFolded: 0, nodesAdded: 0, nodesDropped: 0, nodesFiltered: 0, foldedRowsWithoutDrawableCounterpart: 0, capped: false }
  // The counterpart nodes the cascade added, so a budget cut can be counted later.
  const cascadeNodeIds = new Set<string>()
  const classOwners = ids.size === 0 ? [] : symbols.filter((symbol) => CLASS_LIKE_TYPES.has(String(symbol.symbol_type))).map((symbol) => symbol.id)
  const OWNER_SCAN_CAP = 500
  const ownersCapped = classOwners.length > OWNER_SCAN_CAP
  const ownersToScan = ownersCapped ? classOwners.slice(0, OWNER_SCAN_CAP) : classOwners
  if (ownersToScan.length > 0) {
    const MEMBER_CAP = 3000
    const ownerPlaceholders = ownersToScan.map(() => "?").join(",")
    const selectedPlaceholders = [...ids].map(() => "?").join(",")
    const memberRows = raw
      .prepare(
        `SELECT r.source_symbol_id AS owner_id, r.target_symbol_id AS member_id, child.name AS member_name, child.symbol_type AS member_type
           FROM brain_relationship r JOIN brain_symbol child ON child.id = r.target_symbol_id
          WHERE r.project_id = ? AND r.relationship_type = 'contains'
            AND r.source_symbol_id IN (${ownerPlaceholders})
            AND r.target_symbol_id NOT IN (${selectedPlaceholders})
          LIMIT ?`,
      )
      .all(projectId, ...ownersToScan, ...ids, MEMBER_CAP) as any[]
    const memberOwner = new Map<string, { owner: string; name: string; type: string }>()
    for (const row of memberRows) {
      if (!memberOwner.has(String(row.member_id))) {
        memberOwner.set(String(row.member_id), { owner: String(row.owner_id), name: String(row.member_name), type: String(row.member_type) })
      }
    }
    let rowsFolded = 0
    let capped = memberRows.length >= MEMBER_CAP || ownersCapped
    let foldedRelationships: any[] = []
    const counterpartIds = new Set<string>()
    if (memberOwner.size > 0) {
      const CASCADE_CAP = 20000
      const memberIds = [...memberOwner.keys()]
      // Fetch the rows on members in source/target chunks and de-duplicate by row id.
      //
      // MEASURED on the reference index: the one-statement `(source IN (N) OR target IN
      // (N))` form with 399 member ids took 288-639 ms warm and grew sharply with the id
      // list, while 100-id chunks keep every statement on an index seek. A row is
      // collected once even though it appears in both directions.
      const rowsOnMemberMap = new Map<string, any>()
      const MEMBER_ROW_CHUNK = 100
      const selectRows = "SELECT id AS row_id,source_symbol_id AS source_id,target_symbol_id AS target_id,relationship_type,confidence,is_cross_language,is_cross_file,bridge_mechanism,line_number FROM brain_relationship WHERE project_id = ? AND relationship_type <> 'contains'"
      for (let start = 0; start < memberIds.length && rowsOnMemberMap.size < CASCADE_CAP; start += MEMBER_ROW_CHUNK) {
        const chunk = memberIds.slice(start, start + MEMBER_ROW_CHUNK)
        const placeholders = chunk.map(() => "?").join(",")
        for (const row of raw.prepare(`${selectRows} AND source_symbol_id IN (${placeholders})`).all(projectId, ...chunk) as any[]) {
          if (rowsOnMemberMap.size >= CASCADE_CAP) break
          rowsOnMemberMap.set(String(row.row_id), row)
        }
        for (const row of raw.prepare(`${selectRows} AND target_symbol_id IN (${placeholders})`).all(projectId, ...chunk) as any[]) {
          if (rowsOnMemberMap.size >= CASCADE_CAP) break
          rowsOnMemberMap.set(String(row.row_id), row)
        }
      }
      const rowsOnMembers: any[] = [...rowsOnMemberMap.values()]
      // An END of a stored row, resolved against the node set: the symbol itself
      // when it is selected, the owner it is a member of when it is not, and
      // nothing when it is neither. A row whose other end resolves to nothing is
      // still folded — but its counterpart has to be DRAWN, or the edge has no
      // endpoint and the projection drops it. A class whose members carry stored
      // calls therefore shows those calls only when the connected symbols are added
      // to the node set, which is what the block below does.
      const resolved = (id: unknown): { owner: string | null; member: { owner: string; name: string; type: string } | null } => {
        const key = String(id)
        if (ids.has(key)) return { owner: key, member: null }
        const viaMember = memberOwner.get(key)
        return viaMember ? { owner: viaMember.owner, member: viaMember } : { owner: null, member: null }
      }
      const folded: any[] = []
      for (const row of rowsOnMembers) {
        const source = resolved(row.source_id)
        const target = resolved(row.target_id)
        if (source.owner === null && target.owner === null) continue
        // An edge whose two ends resolve to the SAME node is not an edge.
        const foldedSource = source.owner ?? String(row.source_id)
        const foldedTarget = target.owner ?? String(row.target_id)
        if (foldedSource === foldedTarget) continue
        const via = source.member ?? target.member
        if (source.owner === null) counterpartIds.add(String(row.source_id))
        if (target.owner === null) counterpartIds.add(String(row.target_id))
        folded.push({ ...row, source_id: foldedSource, target_id: foldedTarget, owner_cascade: 1, matched_member: via ? `${via.name}:${via.type}` : null })
      }
      foldedRelationships = folded
      capped = capped || rowsOnMemberMap.size >= CASCADE_CAP
    }
    // Draw the counterparts the folded edges need. Budgeted like everything else,
    // and every removal is declared rather than silently dropping the edge: a
    // counterpart cut by the node budget, by the page window, or by the caller's own
    // symbolKinds/languages filter is counted, and a folded row whose counterpart
    // cannot be drawn is not reported as folded.
    let nodesAdded = 0
    let nodesFiltered = 0
    const budget = Math.max(0, fetchLimit - symbols.length)
    const wanted = [...counterpartIds].filter((id) => !ids.has(id))
    const chosen = wanted.slice(0, budget)
    if (wanted.length > chosen.length) capped = true
    const allowedKinds = request.symbolKinds?.length ? new Set(request.symbolKinds.map((kind) => kind.toLowerCase())) : null
    const allowedLanguages = request.languages?.length ? new Set(request.languages.map((language) => language.toLowerCase())) : null
    const drawnCounterparts = new Set<string>()
    if (chosen.length > 0) {
      const chosenPlaceholders = chosen.map(() => "?").join(",")
      const extra = raw
        .prepare(
          `SELECT s.id,s.name,s.qualified_name,s.symbol_type,s.line_start,s.line_end,s.gravity_score,f.language,f.relative_path AS file
             FROM brain_symbol s JOIN brain_file f ON f.id=s.file_id
            WHERE s.project_id=?
              AND s.id IN (${chosenPlaceholders})`,
        )
        .all(projectId, ...chosen) as any[]
      // The caller's stored-row filters scope the whole answer, including the
      // symbols the cascade would add: a graph returned for `symbolKinds: ["class"]`
      // must not contain a function just because a folded edge pointed at it.
      const kept = extra.filter((node) => (!allowedKinds || allowedKinds.has(String(node.symbol_type).toLowerCase())) && (!allowedLanguages || allowedLanguages.has(String(node.language ?? "").toLowerCase())))
      nodesFiltered = extra.length - kept.length
      if (kept.length > 0) {
        symbols = symbols.concat(kept)
        for (const node of kept) { cascadeNodeIds.add(String(node.id)); drawnCounterparts.add(String(node.id)) }
        nodesAdded = kept.length
      }
    }
    // A folded row whose non-selected end is not drawn has no second endpoint, so it
    // is not part of the edge set the answer states — count it out and say so.
    const foldedDrawable = foldedRelationships.filter((row) => (ids.has(String(row.source_id)) || drawnCounterparts.has(String(row.source_id))) && (ids.has(String(row.target_id)) || drawnCounterparts.has(String(row.target_id))))
    const foldedUndrawable = foldedRelationships.length - foldedDrawable.length
    relationships = relationships.concat(foldedDrawable)
    rowsFolded = foldedDrawable.length
    ownerCascade = { applied: true, owners: classOwners.length, membersScanned: memberOwner.size, rowsFolded, nodesAdded, nodesDropped: 0, nodesFiltered, foldedRowsWithoutDrawableCounterpart: foldedUndrawable, capped }
  }
  const filteredRelationships = relationships.filter((relationship) => !request.relationshipTypes?.length || request.relationshipTypes.includes(relationship.relationship_type))
  const graph = DependencyGraphVisualizer.generateGraphData(symbols, filteredRelationships, { excludePatterns: request.excludePatterns, includeTests: request.includeTests })
  const originalNodes = graph.nodes.length
  const originalLinks = graph.links.length
  const nodes = graph.nodes.slice(offset, offset + maxNodes)
  const nodeIds = new Set(nodes.map((node) => node.id))
  // A counterpart that the node budget cut is a folded edge the reader will not
  // see, so the count is declared rather than left to be discovered.
  if (cascadeNodeIds.size > 0) {
    ownerCascade = { ...ownerCascade, nodesDropped: [...cascadeNodeIds].filter((id) => !nodeIds.has(id)).length }
  }
  // What the answer is MADE OF, counted from the answer itself rather than from the fetch.
  // The kinds and languages of the returned nodes are the two questions a reader asks first
  // and the two the JSON could not answer: the only census in the tool lived in the HTML
  // panel, so a text or JSON caller could not see that 62% of the "architecture" graph is
  // constants and properties.
  const censusBy = (pick: (node: any) => string): Record<string, number> => {
    const counts: Record<string, number> = {}
    for (const node of nodes as any[]) {
      const key = pick(node)
      counts[key] = (counts[key] ?? 0) + 1
    }
    return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]))
  }
  const kindCensus = censusBy((node) => String(node.type ?? "unknown"))
  const languageCensus = censusBy((node) => String(node.group ?? "unknown"))
  // The complete edge set FOR THE RETURNED NODES, before the link budget touches it. The
  // budget is applied to this and nothing else, so the two can be counted apart below.
  const linksAmongReturnedNodes = graph.links.filter((link) => nodeIds.has(link.source) && nodeIds.has(link.target))
  const links = linksAmongReturnedNodes.slice(0, maxLinks)
  // The edge count is stated for the node set the reader actually SEES, not the
  // larger one the fetch was built from. MEASURED: the fetch is bounded by
  // `maxNodes * 2` symbols while `maxNodes` are returned, so counting against the
  // fetch set declared 1,142 edges for a graph showing 200 nodes, when the true
  // figure between those 200 nodes is 394. A completeness claim is only worth
  // making about the thing it is claiming completeness FOR.
  const relationshipsBetweenSelectedNodes = filteredRelationships.filter(
    (relationship) => nodeIds.has(relationship.source_id) && nodeIds.has(relationship.target_id),
  ).length
  // How many symbols this scope and these filters ACTUALLY match, independent of
  // the pre-selection LIMIT. Without this the declared "original" was the size of
  // a slice: measured on cargo it reported 3,463 against an index of 40,595, so a
  // reader would conclude the project holds 3.5k symbols. `bb_search` states the
  // rule for itself — "a short page is never mistaken for a complete one" — and the
  // three quantities are now always distinguishable.
  const totalNodesAvailable = countAvailableSymbols(raw, projectId, scope, target, request)
  // Which symbols got a chance to be in the graph, and in what order. The project
  // and feature scopes take the index's own gravity, so the graph is the busiest
  // core rather than a sample; the narrower scopes take source order, because that
  // is the only order a reader of one file would want. Either way it is a
  // SELECTION, and until now nothing in the answer named it.
  let nodeSelectionNote = "every symbol matching the scope, in source order"
  if (scope === "project" || scope === "feature") {
    nodeSelectionNote = "the highest-gravity symbols first, so the graph is the project's busiest core rather than a sample"
  } else if (scope === "file") {
    nodeSelectionNote = "every symbol in the file, in source order"
  } else if (scope === "module") {
    nodeSelectionNote = "every symbol under the module directory, in source order"
  } else {
    nodeSelectionNote = `every symbol named ${target}, in source order`
  }
  // The cascade's counterparts are a change to the SELECTION too, and a reader who
  // asked for ONE symbol would otherwise find a neighbour they never asked for.
  if (ownerCascade.nodesAdded > 0) {
    nodeSelectionNote += `, plus the ${ownerCascade.nodesAdded} symbol(s) the folded member rows connect to, added so those edges have two ends to draw`
  }
  // Two DIFFERENT reasons an edge is absent, counted apart because they mean different things
  // to the reader who is reconciling the picture. MEASURED before: one counter, named
  // `omittedDanglingLinks`, read 2 for `maxNodes: 2` — on a graph whose rows had all been
  // fetched, and whose renderer cannot even emit a link with a missing endpoint. The number
  // was always the node cut, and the text blamed `maxLinks` for it.
  const linksOmittedWithNodeCut = graph.links.length - linksAmongReturnedNodes.length
  const linksOmittedByBudget = linksAmongReturnedNodes.length - links.length
  /** True when `maxLinks` — and only `maxLinks` — withdrew edges from the complete set for the
   *  nodes that were actually returned. The old form compared `originalLinks` (the pre-cut
   *  count) with the drawn count, so a node cut that removed 400 edges marked the relationship
   *  set truncated while `maxLinks` had withdrawn nothing at all. */
  const relationshipSetTruncated = linksOmittedByBudget > 0
  const truncated = originalNodes > nodes.length || originalLinks > links.length
  // A filter or scope that matches nothing is DECLARED, never returned as a
  // plausible empty project. Measured: relationshipTypes:["not_a_real_type"]
  // produced {nodes:[],links:[]} indistinguishable from an empty repository.
  const declaredAbsent = nodes.length === 0
  // An empty PAGE is not an empty project. Without this branch, `offset` past the end
  // returned `declaredAbsent` with the "none survived the projection" wording, which
  // describes a defect in the projection rather than a caller who walked off the end.
  const absenceNote = declaredAbsent
    ? (totalNodesAvailable === 0
      ? `no indexed symbol matches scope=${scope}${target ? ` target="${target}"` : ""}${request.languages?.length ? ` languages=[${request.languages.join(",")}]` : ""}${request.relationshipTypes?.length ? ` relationshipTypes=[${request.relationshipTypes.join(",")}]` : ""}${request.symbolKinds?.length ? ` symbolKinds=[${request.symbolKinds.join(",")}]` : ""} — absence declared, never guessed`
      : offset > 0
        ? `offset ${offset} holds no drawable symbol, and the fetch had no rows of its own left to offer — this is an empty PAGE, not an empty project: ${totalNodesAvailable} symbol(s) match, so restart at an offset below ${totalNodesAvailable}`
        : `${totalNodesAvailable} symbol(s) match this query but none survived the projection — absence declared, never guessed`)
    : null
  // The page, declared. `totalNodesAvailable` is the size of the whole ordered scope and
  // this says where in it the answer sits, so "200 nodes" can never be read as "the project
  // has 200 symbols" — the failure mode paging exists to close.
  // Did the fetch run out of rows below its window? That — not `totalNodesAvailable` — is the
  // fact that says whether another page exists, because `totalNodesAvailable` counts symbols the
  // projection may not draw (noise, unlinked locals). Using the total here would mint a cursor
  // past the last drawable symbol and hand the caller an empty page that looks like an end.
  const moreRowsExist = symbols.length >= fetchLimit
  // The cursor stops when EITHER the fetch ran out of rows OR it has reached the scope's own
  // count. The second test is what keeps a scope whose row count lands exactly on the window
  // from minting one empty page; the first is what keeps a short page (noise, unlinked locals)
  // from being mistaken for the end.
  const cursor = offset + nodes.length
  const nextOffset = moreRowsExist && nodes.length > 0 && cursor < totalNodesAvailable ? cursor : null
  // ── the annotation layer ────────────────────────────────────────────────────
  // The store keys a note by (project, symbol_name, symbol_path), so the match is on those two
  // fields and never on the id: two symbols can share a name, and a note written against one of
  // them must not appear on the other. Read in one query bounded by the returned node ids' own
  // names, then attributed in memory so a path mismatch is counted rather than guessed.
  const annotationOverlay = (() => {
    const names = [...new Set((nodes as any[]).map((node) => String(node.name ?? "")).filter((name) => name.length > 0))]
    const empty = { notes: 0, nodes: 0, notesOnOtherPaths: 0, items: [] as any[], capped: false, rule: "notes are matched to a returned symbol by NAME and PATH, never by name alone: a note whose path matches no returned symbol is counted on notesOnOtherPaths instead of being attached to a same-named symbol elsewhere" }
    if (names.length === 0) return empty
    const placeholders = names.map(() => "?").join(",")
    const rows = raw
      .prepare(`SELECT symbol_name, symbol_path, author_class, body, time_updated FROM brain_annotation WHERE project_id = ? AND symbol_name IN (${placeholders}) ORDER BY time_updated DESC`)
      .all(projectId, ...names) as any[]
    if (rows.length === 0) return empty
    const byName = new Map<string, any[]>()
    for (const node of nodes as any[]) {
      const key = String(node.name ?? "")
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(node)
    }
    const items: any[] = []
    const hitNodes = new Set<string>()
    let notes = 0
    let notesOnOtherPaths = 0
    for (const row of rows) {
      const candidates = byName.get(String(row.symbol_name ?? "")) ?? []
      const wantPath = row.symbol_path == null ? null : String(row.symbol_path)
      const target = candidates.find((node) => wantPath == null || String(node.filePath ?? "") === wantPath || String(node.filePath ?? "").endsWith(`/${wantPath}`))
      if (!target) { notesOnOtherPaths++; continue }
      notes++
      hitNodes.add(String(target.id))
      if (items.length < 50) {
        items.push({
          node: String(target.id),
          name: String(target.name ?? ""),
          author: String(row.author_class ?? "unknown"),
          body: String(row.body ?? "").slice(0, 280),
          updated: new Date(Number(row.time_updated ?? 0)).toISOString(),
        })
      }
    }
    return { notes, nodes: hitNodes.size, notesOnOtherPaths, items, capped: notes > items.length, rule: empty.rule }
  })()
  const page = {
    offset,
    limit: maxNodes,
    returned: nodes.length,
    total: totalNodesAvailable,
    totalBasis: "symbols matching this scope and these filters, counted before the noise filter and every output bound; pages are cut from the projection order, so a page can be shorter than `limit` and the numbers need not divide",
    number: maxNodes > 0 ? Math.floor(offset / maxNodes) + 1 : 1,
    nextOffset,
    rule: `the same total order the ranking uses — ${nodeSelectionNote}${offset > 0 ? `, after the first ${offset}` : ", from the first"}`,
  }
  return { scope, target: target || null, format: request.format ?? "text", view: request.view ?? "graph", layout: request.layout === "force" ? "force" : "regions", nodes, links, excluded: graph.excluded, declaredAbsent, absenceNote, totalNodesAvailable, provenance: { source: "stored-symbol-and-relationship-rows", indexedProject: projectId, linksOmittedWithNodeCut, linksOmittedByBudget }, considered: { relationshipsBetweenSelectedNodes, relationshipSelection: `every relationship connecting two of the ${nodeIds.size} returned nodes — complete for this node set, not a slice of the relationship table${ownerCascade.rowsFolded > 0 ? `, including ${ownerCascade.rowsFolded} row(s) stored on members of selected classes and folded onto the owner (marked ownerCascade)` : ""}`, relationshipSetTruncated, nodeSelection: nodeSelectionNote, languagesConsidered: request.languages?.length ? request.languages : null, relationshipTypesConsidered: request.relationshipTypes?.length ? request.relationshipTypes : null, symbolKindsConsidered: request.symbolKinds?.length ? request.symbolKinds : null, kindCensus, languageCensus, page, overlays: { annotations: annotationOverlay }, ownerCascade: { ...ownerCascade, rule: "a relationship stored on a member of a SELECTED class-like symbol is attributed to that symbol; the edge is marked ownerCascade with the member it came through (matchedMembers), the member itself keeps its exact edge when it is also in the node set, and the symbol at the other end is added to the node set so the folded edge can be drawn at all — the stored row is never modified" } }, truncation: { truncated, originalNodes, originalLinks, maxNodes, maxLinks, reason: truncated ? "output limits" : null, totalNodesAvailable, offset, nextOffset: page.nextOffset, ...(boundsAdjusted.length ? { boundsAdjusted } : {}) } }
}

export function formatVisualization(result: VisualizationResult): string {
  if (result.format === "json") return JSON.stringify(result, null, 2)
  if (result.format === "html") {
    // The artifact carries the SAME declared bounds as the text and JSON formats
    // instead of only the drawn slice: the payload is machine-readable, so
    // `totalNodesAvailable`, the projection count and the page cursor are facts a
    // reader (or a script) can check without a second call. The projection keys
    // (`nodes`, `links`, `excluded`) are unchanged, so the renderer reads it as before.
    const declared = {
      totalNodesAvailable: result.totalNodesAvailable,
      originalNodes: result.truncation.originalNodes,
      originalLinks: result.truncation.originalLinks,
      maxNodes: result.truncation.maxNodes,
      maxLinks: result.truncation.maxLinks,
      truncated: result.truncation.truncated,
      offset: result.truncation.offset,
      nextOffset: result.truncation.nextOffset,
      returnedNodes: result.nodes.length,
      returnedLinks: result.links.length,
      scope: result.scope,
      target: result.target,
      layout: result.layout,
      page: result.considered?.page ?? null,
      ownerCascade: result.considered?.ownerCascade ?? null,
      freshness: (result as VisualizationResult & { freshness?: unknown }).freshness ?? null,
      rule: "the artifact carries the same declared bounds as the text and JSON formats: totalNodesAvailable (what the scope and filters match), originalNodes (what reached the projection) and returnedNodes (what was drawn), so a short page cannot be read as a whole set",
    }
    const graphData = { nodes: result.nodes, links: result.links, excluded: result.excluded, declared }
    return DependencyGraphVisualizer.generateHTML(graphData as any, { layout: result.layout })
  }

  // The DEFAULT format is what every caller gets unless they think to ask for JSON,
  // so it must carry the same facts the JSON does. It used to be four lines and 153
  // characters that never mentioned the true symbol total, the declared relationship
  // slice, the node ordering, or the noise exclusion — so the one reply that could
  // not be audited was the default one. Brevity was never the defect; silence was.
  const lines: string[] = []
  lines.push(`graph: ${result.nodes.length} nodes, ${result.links.length} links`)
  lines.push(`scope: ${result.scope}${result.target ? ` (${result.target})` : ""}`)
  lines.push(`view: ${result.view} — ${VIEW_NOTE[result.view]}`)
  // The layout is always stated, including when it is the default, because
  // "the reader's choice" must be visible in the answer.
  lines.push(`layout: ${result.layout} — ${LAYOUT_NOTE[result.layout]}`)
  if (result.declaredAbsent) {
    lines.push(`absent: ${result.absenceNote ?? "this query matches nothing"}`)
  } else {
    lines.push(
      `available: ${result.totalNodesAvailable} symbol(s) match, ${result.truncation.originalNodes} reached the projection, ${result.nodes.length} returned — limits ${result.truncation.maxNodes} nodes / ${result.truncation.maxLinks} links`,
    )
  }
  // WHICH PAGE, always — including when it is the only page and including when it is empty.
  // A paged tool that does not say where the page sits in the scope is a tool whose caller
  // believes it has seen everything.
  if (result.considered?.page) {
    const p = result.considered.page
    lines.push(
      p.returned > 0
        ? `page: symbols ${p.offset + 1}-${p.offset + p.returned} (offset ${p.offset}, limit ${p.limit}, page ${p.number}; ${p.total} symbol(s) match this scope)${p.nextOffset != null ? ` — next page: offset=${p.nextOffset}` : " — this is the LAST page"}`
        : `page: offset ${p.offset} holds no drawable symbol — ${p.total} symbol(s) match this scope, so this is an empty PAGE, not an empty project`,
    )
  }
  if (result.considered) {
    lines.push(
      `edges: ${result.considered.relationshipsBetweenSelectedNodes} relationship(s) connect the selected symbols — complete for this node set${result.considered.relationshipSetTruncated ? `, then cut by maxLinks (${result.provenance.linksOmittedByBudget} withdrawn)` : ""}${result.provenance.linksOmittedWithNodeCut > 0 ? `; ${result.provenance.linksOmittedWithNodeCut} more attached only to nodes the node cut removed` : ""}`,
    )
    lines.push(`node selection: ${result.considered.nodeSelection}`)
    // The composition of the answer, stated where a reader cannot miss it. A selection that is
    // 62% constants is not a defect in itself — being silent about it is. MEASURED before: the
    // only census was inside the HTML panel, so the default reply never said what it drew.
    const kinds = Object.entries(result.considered.kindCensus ?? {})
    const languages = Object.entries(result.considered.languageCensus ?? {})
    if (kinds.length) {
      lines.push(
        `returned kinds: ${kinds.map(([kind, n]) => `${kind} ${n}`).join(", ")}${result.considered.symbolKindsConsidered?.length ? ` (filtered by symbolKinds=[${result.considered.symbolKindsConsidered.join(",")}])` : " — no kind filter was passed, so this is the composition the index's own ranking produced"}`,
      )
    }
    if (languages.length) {
      lines.push(`returned languages: ${languages.map(([language, n]) => `${language} ${n}`).join(", ")}`)}
    // The annotation layer is stated even when it is empty, for the same reason `excluded` is:
    // silence and zero must not be the same reply. "No agent has annotated these symbols" is a
    // fact about the answer; "nobody looked" is not.
    if (result.considered.overlays?.annotations) {
      const a = result.considered.overlays.annotations
      lines.push(
        a.notes > 0
          ? `annotations: ${a.notes} agent note(s) on ${a.nodes} of the returned symbols, matched by name AND path${a.notesOnOtherPaths > 0 ? ` (${a.notesOnOtherPaths} note(s) name a symbol of this scope at another path and are NOT attached)` : ""}${a.capped ? `, ${a.items.length} carried` : ""}`
          : `annotations: none on the returned symbols${a.notesOnOtherPaths > 0 ? ` (${a.notesOnOtherPaths} note(s) name a symbol of this scope at another path and are NOT attached)` : ""} — the index's agent notes were read, and none matches this page`,
      )
    }
    if (result.considered.ownerCascade?.rowsFolded) {
      const c = result.considered.ownerCascade
      lines.push(`owner cascade: ${c.rowsFolded} relationship(s) stored on members of selected classes are attributed to the class (marked ownerCascade${c.nodesAdded ? `, ${c.nodesAdded} connected symbol(s) drawn so the folded edges have ends` : ""}${c.nodesDropped ? `, ${c.nodesDropped} of them fell outside the node budget` : ""}${c.capped ? ", capped" : ""})`)
    }
    if (result.considered.languagesConsidered?.length) {
      lines.push(`language filter: ${result.considered.languagesConsidered.join(", ")} (applied before the limit)`)
    }
    if (result.considered.relationshipTypesConsidered?.length) {
      lines.push(`relationship filter: ${result.considered.relationshipTypesConsidered.join(", ")} — the edge set above is what this filter left`)
    }
  }
  // The exclusion is ALWAYS stated, including when it is empty. "Nothing was
  // excluded" is information a reader needs in order to trust that the graph is
  // the whole project, and a line that appears only when there is something to
  // report makes silence and zero indistinguishable — which is the same class of
  // defect as the slice being called "the original".
  if (result.excluded) {
    const byPattern = Object.entries(result.excluded.byPattern).map(([pattern, n]) => `${pattern} (${n})`).join(", ")
    lines.push(
      result.excluded.symbols > 0
        ? `excluded: ${result.excluded.symbols} symbol(s) as noise by ${byPattern}${result.excluded.includesTestFiles ? "" : " (test sources excluded)"} — this graph is not the whole project`
        : "excluded: nothing — this graph is the whole project (build output and VCS metadata are filtered on whole path segments; test sources are included)",
    )
  }
  if (result.truncation.truncated) {
    lines.push(
      `truncated: yes — ${result.truncation.originalNodes} nodes and ${result.truncation.originalLinks} links reached the projection, the limits kept fewer`,
    )
  }
  // The two edge losses are named for what they are. This line used to print
  // `dangling-links-omitted=${n}` for a count that was never about dangling rows, which is
  // how a reader checking the arithmetic was told the wrong event.
  lines.push(
    `provenance: ${result.provenance.source} links-omitted-by-node-cut=${result.provenance.linksOmittedWithNodeCut} links-omitted-by-budget=${result.provenance.linksOmittedByBudget}`,
  )
  if (result.truncation.boundsAdjusted?.length) {
    lines.push(`bounds adjusted: ${result.truncation.boundsAdjusted.join("; ")}`)
  }
  return lines.join("\n")
}

export { renderVisualizationStudio }
