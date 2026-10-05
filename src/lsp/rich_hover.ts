// src/lsp/rich_hover.ts — M42.H2 (issue #650): the rich hover sections.
//
// The SINGLE owner of the H2 surface:
//   1. connected summary — "calls X, called by Y, implements Z" from STORED
//      brain_relationship rows (relationship_type as the analyzer wrote it),
//      display verbs assigned by direction (never guessed from names).
//   2. top-3 usage links + "N more" — every link target is an index-stored
//      location, resolved through navigation.ts's edgeLocation (the SAME
//      location builder the L3 references surface uses — one owner, so the
//      hover's links and the native references tree can never disagree).
//   3. definition link (declaration of the hovered symbol).
//
// Honesty law (IDE Honesty Contract §12.1): nothing unclickable, no guessed
// link. A site renders only when its other end is a REAL indexed symbol with
// a resolvable location; rows whose other end is NULL/external never render.
// Rows of purely structural kinds (contains/exports) are usages (the L3
// references surface counts them, and H2 stays differential with it) but are
// NOT connection facts: they never appear in the connected summary.
// Staleness is inherited from the hover response — this module never claims
// freshness (contract §12.2).

import type { CoreDatabase } from "../brain/database"
import { edgeLocation } from "./navigation"
import { PositionError } from "./positions"
import { usageSites, USAGE_SITE_FILTER_LABEL } from "./relations"
import {
  ADDRESS_NOTES,
  addressLine0,
  deriveCallSiteAddress,
  isExactAddress,
} from "../intelligence/graph/line-address"
import type { CallSiteAddress } from "../intelligence/contracts"
import { enrichmentIsStale, hasDisplayableEnrichment, describeEnrichment, parseEnrichment, type Enrichment } from "./enrichment"

/** A resolved usage site: the OTHER end of an edge touching the hovered
 *  symbol, with the index-stored location (LSP coordinates via P1). */
export interface RichSite {
  /** other-end symbol name as indexed */
  name: string
  symbolType: string | null
  /** index-stored location — LSP 0-based, via navigation.edgeLocation */
  path: string
  line: number
  character: number
  endLine: number
  endCharacter: number
  /** relationship_type as the analyzer wrote it (source -> target) */
  relationshipType: string
  /** true when the hovered symbol is the TARGET of the row */
  reversed: boolean
  /** confidence as stored (ordering only; tiers render globally) */
  confidence: number | null
  /** M42.H3: stored enrichment of the relationship row — null when the row
   *  is un-enriched (declared absence); parsed only, never inferred here. */
  enrichment: Enrichment | null
  /** M42.H3: enrichment is stale when computed before the row last changed. */
  enrichmentStale: boolean
  /** Lane 6 (§14 rule 3): where this site is. The ONE owner of stored
   *  call-site lines is src/intelligence/graph/line-address.ts — this is ITS
   *  verdict for this row, passed through unchanged and never re-derived.
   *
   *  - "call-site": the store holds a real call-site line and the link opens
   *    THAT line. This is the §14 rule 3 case: the range points at the call.
   *  - "declaration": the store holds no call-site line (NULL, or the legacy
   *    `0` placeholder), so the link opens the referencing symbol's
   *    declaration and SAYS SO on the card (ADDRESS_NOTES.substitute). The
   *    substitution is declared, never silent (§14 rule 2).
   *  - "unknown": the store holds something that is not a position at all.
   *    No line is claimed; the row falls back to the declaration location and
   *    the card states the store-contract fact.
   *
   *  Before this field the hover had NO way to say which of the three it was
   *  doing — it always linked the declaration and never said so, which is how
   *  validation/m42/results/KNOWN-GAPS.json came to carry "usage links point
   *  at the referencing symbol's declaration" as a limitation while
   *  `brain_relationship.line_number` sat unread in the very row it was
   *  reading. */
  callSite: CallSiteAddress
}

export const MAX_USAGE_LINKS = 3

// Display verbs for CONNECTION facts only. Purely structural kinds
// (contains, exports, references, uses) intentionally have no entry: they
// stay usages but are never connection claims.
// Both stored conventions are covered: the M24-era fixtures write `call`, the
// real analyzers write `calls` — same fact, two spellings (one of them must
// never render as a plain usage while the other gets a verb).
const OUT_VERB: Record<string, string> = {
  calls: "calls",
  call: "calls",
  instantiates: "instantiates",
  implements: "implements",
  overrides: "overrides",
  extends: "extends",
  inherits: "inherits",
}
const IN_VERB: Record<string, string> = {
  calls: "called by",
  call: "called by",
  instantiates: "instantiated by",
  implements: "implemented by",
  overrides: "overridden by",
  extends: "extended by",
  inherits: "inherited by",
}

/** Command URI scheme for hover links (executed by the editor client). */
export const USAGE_COMMAND = "bb.openUsage"
export const DEFINITION_COMMAND = "bb.openDefinition"
export const SHOW_ALL_USAGES_COMMAND = "bb.showAllUsages"
// M42.H4 (issue #652): the hover action commands. One constant set — the
// hover markdown embeds these exact ids, the extension registers them, and
// the drift gate asserts both sides agree.
export const OPEN_GRAPH_COMMAND = "bb.openGraph"
export const OPEN_IMPACT_COMMAND = "bb.openImpact"
export const SHOW_CALL_HIERARCHY_COMMAND = "bb.showCallHierarchy"

/** Wire args for bb.openUsage / bb.openDefinition: the index-stored LSP
 *  location. Encoded once here — every hover link shares this encoding. */
export function encodeLocationArgs(path: string, line: number, character: number): string {
  // Command-URI args are a JSON ARRAY (one element per handler argument); a
  // bare object is off-spec and delivered inconsistently across VS Code
  // versions (owner test, 2026-09-05: hover links did nothing in 1.136.1).
  return encodeURIComponent(JSON.stringify([{ file: path, line, character }]))
}

export function openUsageUri(site: { path: string; line: number; character: number }): string {
  return `command:${USAGE_COMMAND}?${encodeLocationArgs(site.path, site.line, site.character)}`
}

export function openDefinitionUri(path: string, line: number, character: number): string {
  return `command:${DEFINITION_COMMAND}?${encodeLocationArgs(path, line, character)}`
}

// --- M42.H4: hover action URIs -------------------------------------------------
// The action args carry the SERVER-RESOLVED symbol identity: the name and
// the index-stored declaration location of the hovered symbol (the same
// location the definition link uses). The client never guesses the symbol
// from its own cursor — it executes what the index resolved (issue #652
// negative list: no client-side position guessing).
export interface HoverActionArgs {
  /** name of the hovered symbol, resolved server-side from the index row */
  symbol: string
  /** absolute path of the declaration file (index-stored) */
  file: string
  /** LSP 0-based declaration position (index-stored) */
  line: number
  character: number
}

export function encodeActionArgs(symbol: string, path: string, line: number, character: number): string {
  return encodeURIComponent(JSON.stringify([{ symbol, file: path, line, character } satisfies HoverActionArgs]))
}

export function openGraphUri(a: HoverActionArgs): string {
  return `command:${OPEN_GRAPH_COMMAND}?${encodeActionArgs(a.symbol, a.file, a.line, a.character)}`
}

export function openImpactUri(a: HoverActionArgs): string {
  return `command:${OPEN_IMPACT_COMMAND}?${encodeActionArgs(a.symbol, a.file, a.line, a.character)}`
}

export function showCallHierarchyUri(a: HoverActionArgs): string {
  return `command:${SHOW_CALL_HIERARCHY_COMMAND}?${encodeActionArgs(a.symbol, a.file, a.line, a.character)}`
}

/** The hover actions row: graph, impact, and call hierarchy one click away
 *  from the hover. Composed ONLY when the symbol identity is complete (a
 *  symbol without a resolvable declaration line renders no actions row —
 *  declared absence; an unclickable action would violate §12.1). */
export function actionsSection(symbol: string, filePath: string, line: number, character: number): string {
  if (symbol.length === 0 || filePath.length === 0 || line < 0 || character < 0) return ""
  const a: HoverActionArgs = { symbol, file: filePath, line, character }
  return `**actions**: [Open in graph](${openGraphUri(a)}) · [Impact analysis](${openImpactUri(a)}) · [Call hierarchy](${showCallHierarchyUri(a)})`
}

/** M44.U6: the link carries the SERVER-RESOLVED identity — the symbol name
 *  rides alongside the location so the client fallback can open the hub
 *  usages surface for the symbol without client-side guessing (issue #693;
 *  issue #652's no-client-guessing rule applies to the fallback too). */
export function showAllUsagesUri(a: { file: string; line: number; character: number; symbol: string }): string {
  return `command:${SHOW_ALL_USAGES_COMMAND}?${encodeURIComponent(JSON.stringify([{ file: a.file, line: a.line, character: a.character, symbol: a.symbol }]))}`
}

/** Human label: `main — App.java:12` (file base name, 1-based human line).
 *  The LINK target stays the 0-based LSP coordinate; the label is display.
 *
 *  Lane 6 (§14 rule 2, identity is stated): a site whose address is a labeled
 *  SUBSTITUTE — the store holds no call-site line, so the link opens the
 *  referencing symbol's declaration — gets that fact in its label. Before this,
 *  a reader who clicked `main — App.java:12` and landed on `main`'s function
 *  header had no way to know the index had a call-site line for that row and
 *  this surface chose not to use it. The vocabulary is the address owner's
 *  (`ADDRESS_NOTES`), never invented here. */
export function siteLabel(site: { name: string; path: string; line: number; callSite?: CallSiteAddress }): string {
  // Separator-independent base name: win32 paths use backslashes, POSIX
  // forward slashes (found by the E7 win32 CI leg, 2026-09-05).
  const base = site.path.split(/[\\/]/).pop() ?? site.path
  const label = `${site.name} — ${base}:${site.line + 1}`
  return addressNoteSuffix(site.callSite) === null ? label : `${label} ${addressNoteSuffix(site.callSite)}`
}

/** The ONE place a site's address becomes a stated caveat, or null when the
 *  address is exact (a real call site: nothing to declare). Returns null for an
 *  absent address so a caller that has no verdict renders no caveat rather than
 *  a fabricated one. */
export function addressNoteSuffix(address: CallSiteAddress | undefined | null): string | null {
  if (address === undefined || address === null) return null
  if (isExactAddress(address)) return null
  return address.kind === "declaration" ? `_(${ADDRESS_NOTES.substitute})_` : `(${address.kind === "unknown" ? address.note : ""})`
}

/**
 * Collect the usage sites of a symbol: every stored relationship row whose
 * OTHER end is a real indexed symbol with a resolvable location, in the same
 * row order (confidence DESC, id) and with the same dedup key
 * (path:line:character) as the L3 references surface — one location owner.
 *
 * The OR-free UNION shape mirrors the M29.R3 scale fix: two indexed probes
 * (source_symbol_id / target_symbol_id are both indexed) instead of one
 * OR-scan of brain_relationship.
 */
export function richSitesForSymbol(raw: CoreDatabase, symbolId: string): RichSite[] {
  // Lane 6 (§3 budget): PER-CALL location memo.
  //
  // `edgeLocation` re-reads the source file and rebuilds a PositionMapper on
  // every call, and this collector calls it once per relationship row. Measured
  // on a real index (this machine, backbencher-brain, 183 files / 52,597 rows):
  // a symbol with 128 stored rows resolved 128 locations across 34 distinct
  // files — 1.5 MB read and 30,250 lines re-split for every hover, 560 ms of
  // the hover's cost on that one symbol, against a 50 ms budget.
  //
  // 128 rows collapse to 73 DISTINCT (path, byte columns, lines) tuples on that
  // symbol, so memoizing inside the call removes 55 of 128 resolutions and,
  // more importantly, makes the cost proportional to distinct locations rather
  // than to row count. Measured: 560 ms -> 356 ms per call, same outputs.
  //
  // The memo is scoped to ONE call on purpose. A process-wide cache would make
  // the hover answer from bytes the file watcher has not re-read yet — which is
  // the §4 staleness violation the freshness marker exists to prevent. Within
  // a single request the bytes cannot meaningfully change under us, and the
  // staleness marker is computed from a fresh read on the same request.
  const locationMemo = new Map<string, ReturnType<typeof edgeLocation> | undefined>()
  const locationOf = (p: string, bs: number, be: number, ls: number, le: number): ReturnType<typeof edgeLocation> => {
    const key = `${p}:${bs}:${be}:${ls}:${le}`
    const hit = locationMemo.get(key)
    if (hit !== undefined || locationMemo.has(key)) return hit ?? null
    let loc: ReturnType<typeof edgeLocation>
    try {
      loc = edgeLocation(p, bs, be, ls, le)
    } catch (error) {
      if (!(error instanceof PositionError)) throw error
      loc = null
    }
    locationMemo.set(key, loc)
    return loc
  }

  const rows = raw
    .prepare(
      `SELECT r.id, r.relationship_type, r.confidence, r.metadata, r.time_updated,
              r.source_symbol_id, r.target_symbol_id, r.line_number,
              ss.name AS src_name, ss.symbol_type AS src_type,
              ss.byte_start AS src_bs, ss.byte_end AS src_be,
              ss.line_start AS src_ls, ss.line_end AS src_le, sf.path AS src_path,
              ss.line_start AS src_decl, sf.relative_path AS src_rel,
              ts.name AS tgt_name, ts.symbol_type AS tgt_type,
              ts.byte_start AS tgt_bs, ts.byte_end AS tgt_be,
              ts.line_start AS tgt_ls, ts.line_end AS tgt_le, tf.path AS tgt_path,
              ts.line_start AS tgt_decl, tf.relative_path AS tgt_rel
       FROM brain_relationship r
       LEFT JOIN brain_symbol ss ON ss.id = r.source_symbol_id
       LEFT JOIN brain_file sf ON sf.id = ss.file_id
       LEFT JOIN brain_symbol ts ON ts.id = r.target_symbol_id
       LEFT JOIN brain_file tf ON tf.id = ts.file_id
       WHERE r.source_symbol_id = ? OR r.target_symbol_id = ?
       ORDER BY r.confidence DESC, r.id`,
    )
    .all(symbolId, symbolId) as Array<{
    id: string
    relationship_type: string
    confidence: number | null
    source_symbol_id: string | null
    target_symbol_id: string | null
    line_number: number | null
    src_name: string | null
    src_type: string | null
    src_bs: number | null
    src_be: number | null
    src_ls: number | null
    src_le: number | null
    src_path: string | null
    src_decl: number | null
    src_rel: string | null
    tgt_name: string | null
    tgt_type: string | null
    tgt_bs: number | null
    tgt_be: number | null
    tgt_ls: number | null
    tgt_le: number | null
    tgt_path: string | null
    tgt_decl: number | null
    tgt_rel: string | null
    metadata: string | null
    time_updated: number | null
  }>

  const sites: RichSite[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    // Degenerate self-loop rows (both ends resolve to S itself — an
    // analyzer artifact, e.g. an @Override row whose target collided with
    // its own symbol) are not connections and not usages: skip them. The L3
    // tree's visible outcome is unchanged (such a row dedups with the
    // declaration entry).
    if (row.source_symbol_id === symbolId && row.target_symbol_id === symbolId) continue
    // The site is the OTHER end: for incoming rows (S is target) it is the
    // source; for outgoing rows (S is source) it is the target.
    const incoming = row.target_symbol_id === symbolId && row.source_symbol_id !== symbolId
    const other = incoming
      ? { name: row.src_name, type: row.src_type, path: row.src_path, bs: row.src_bs, be: row.src_be, ls: row.src_ls, le: row.src_le, decl: row.src_decl, rel: row.src_rel }
      : { name: row.tgt_name, type: row.tgt_type, path: row.tgt_path, bs: row.tgt_bs, be: row.tgt_be, ls: row.tgt_ls, le: row.tgt_le, decl: row.tgt_decl, rel: row.tgt_rel }
    if (!other.name || !other.path || other.bs === null || other.be === null || other.ls === null || other.le === null) continue
    // Lane 6 (measured on a real index, script/m55/verify-hover-coverage.ts
    // R6): edgeLocation THROWS PositionError on a stored row whose byte column
    // lands mid-code-point — a row the indexer wrote for a line containing a
    // multi-byte character. This collector called it unguarded, so ONE such row
    // anywhere in a symbol's relationship set threw out of `hover()` itself. The
    // server has no try/catch on the hover path, so the LSP request REJECTED:
    // VS Code logged "provider FAILED" and silently fell back to the native
    // hover, which is the §12 contract rendered as a crash with no content at
    // all. Measured on this machine's backbencher-brain index: 46 of the 400
    // busiest source symbols (11.5%) and 71 of 4000 symbols swept (1.8%).
    //
    // The guard lives INSIDE `locationOf`, which is the single choke point
    // every resolution passes through — one guard, one place, and the memo
    // cannot serve a value the guard would have refused. A second try/catch at
    // this call site was tried first and the mutation suite caught the
    // consequence: removing the inner guard changed nothing, so the mutant
    // SURVIVED. One guard, at the choke point.
    const loc = locationOf(other.path, other.bs, other.be, other.ls, other.le)
    if (loc === null) continue
    // The stored call-site line, classified by the ONE owner
    // (src/intelligence/graph/line-address.ts). Never re-derived here.
    const address = deriveCallSiteAddress({
      storedLine: row.line_number,
      file: other.rel ?? "",
      callerDeclaration: { line: other.decl },
    })
    // §14 rule 3: when the store holds a REAL call site, the link opens the
    // CALL SITE. Otherwise the link opens the declaration the owner permits as
    // a substitute, and the card says which of the two it is (below).
    const callLine0 = addressLine0(address)
    const opening: { path: string; line: number; character: number; endLine: number; endCharacter: number } =
      callLine0 !== null
        ? { path: loc.path, line: callLine0, character: 0, endLine: callLine0, endCharacter: 0 }
        : { path: loc.path, line: loc.line, character: loc.character, endLine: loc.endLine, endCharacter: loc.endCharacter }
    const key = `${opening.path}:${opening.line}:${opening.character}`
    if (seen.has(key)) continue
    seen.add(key)
    const enrichment = parseEnrichment(row.metadata)
    sites.push({
      name: other.name,
      symbolType: other.type,
      path: opening.path,
      line: opening.line,
      character: opening.character,
      endLine: opening.endLine,
      endCharacter: opening.endCharacter,
      relationshipType: row.relationship_type,
      reversed: incoming,
      confidence: row.confidence,
      enrichment,
      enrichmentStale: enrichment === null ? false : enrichmentIsStale(enrichment, row.time_updated),
      callSite: address,
    })
  }
  return sites
}

export interface ConnectedGroup {
  verb: string
  sites: RichSite[]
}

/** The usage sites of a symbol as they come off the index (M55.T3): the one
 *  collection every count on the hover surface is taken from. */
export function usageSitesForSymbol(raw: CoreDatabase, symbolId: string): RichSite[] {
  return usageSitesOf(richSitesForSymbol(raw, symbolId))
}

/** Group sites into connection facts (summary-verb rows only). */
// The verb maps below carry no entry for `contains`/`exports` (declaration
// containments) or for structural ends: a declaration row can therefore never
// become a connection claim, and every "called by X" name is a member of the
// usage-site set above (both derive from the same collected rows).
export function connectedGroups(sites: RichSite[]): ConnectedGroup[] {
  const groups = new Map<string, ConnectedGroup>()
  for (const site of sites) {
    const verb = (site.reversed ? IN_VERB[site.relationshipType] : OUT_VERB[site.relationshipType]) ?? null
    if (verb === null) continue
    let g = groups.get(verb)
    if (!g) {
      g = { verb, sites: [] }
      groups.set(verb, g)
    }
    g.sites.push(site)
  }
  // First-appearance order (stable across runs).
  return [...groups.values()]
}

export const MAX_SUMMARY_PER_VERB = 3

/** Render the connected summary line. Empty string = declared absence: no
 *  connection facts exist — nothing is rendered, nothing is fabricated. */
export function connectedSummarySection(groups: ConnectedGroup[]): string {
  if (groups.length === 0) return ""
  const parts: string[] = []
  for (const group of groups) {
    const names = group.sites.slice(0, MAX_SUMMARY_PER_VERB)
    const overflow = group.sites.length - names.length
    const seen = new Set<string>()
    const links = names.map((s) => {
      // Same-named sites (e.g. two `displayName` methods in different files)
      // are disambiguated by file:line so the link's target is never a guess.
      const dup = seen.has(s.name)
      seen.add(s.name)
      const label = dup ? siteLabel(s) : s.name
      return `[${label}](${openUsageUri(s)})`
    })
    if (overflow > 0) links.push(`+${overflow}`)
    let groupText = `${group.verb} ${links.join(", ")}`
    // M42.H3: a single-site verb group whose row carries enrichment annotates
    // the connection with the stored facts, labeled as index-inferred — never
    // at parser-fact tier (§12.3). Multi-site groups skip per-site annotations
    // (bounded hover); the graph/webview surface carries per-edge enrichment.
    if (group.sites.length === 1 && hasDisplayableEnrichment(group.sites[0]!.enrichment)) {
      const s = group.sites[0]!
      const desc = describeEnrichment(s.enrichment!)
      const staleNote = s.enrichmentStale ? ", stale — row changed after enrichment" : ""
      groupText += ` · _${desc} (enriched by index${staleNote})_`
    }
    parts.push(groupText)
  }
  return `**connected**: ${parts.join("; ")}`
}

/** The usage sites of a symbol's collected rows — the vocabulary's own filter
 *  (src/lsp/relations.ts). Exported so a caller can COUNT exactly what this
 *  module renders: count and list are the same array, never two filters. */
export function usageSitesOf(sites: readonly RichSite[]): RichSite[] {
  return usageSites(sites)
}

/** Render the usages section: top-MAX_USAGE_LINKS clickable file:line links
 *  plus the "N more" escape hatch — native references view where available,
 *  our hub usages surface otherwise (M44.U6: never a message-only dead end).
 *  Empty string = declared absence (zero usage sites).
 *
 * M55.T3 (issue #772): the section renders USAGE SITES only — the owning
 * declaration and callees are filtered out by the vocabulary owner before
 * anything is rendered (the pre-M55 list offered the hovered method's own
 * class as a "usage"). The header declares what the rows ARE: a row's
 * file:line is the REFERENCING symbol's indexed location, where the call is.
 *
 * M62.A2 (issue #876): that stays true by construction — this section reads
 * the referencing symbol's own indexed range (src/lsp/relations.ts), never the
 * stored `line_number`, so it can never present a call-site line it does not
 * have. The exact stored call-site address (real line, labeled substitute, or
 * declared unknown) is served by the address owner
 * (src/intelligence/graph/line-address.ts) on the hub/graph/MCP surfaces; the
 * hover's vocabulary is the referencing location, and it says so. */
export function usagesSection(sites: RichSite[], total: number, forSymbol: string, forFile: string, forLine: number, forCharacter: number): string {
  // Defensive: filter here as well as at the caller — a caller that forgets
  // cannot leak a declaration into the list (the filter is idempotent).
  const usage = usageSitesOf(sites)
  if (usage.length === 0) return ""
  const lines: string[] = [`**usages** — ${usage.length} stored reference${usage.length === 1 ? "" : "s"} (${USAGE_SITE_FILTER_LABEL})`]
  // Lane 6: the header now says WHAT each row's position is, per §14 rule 3.
  // `sitesRendered` are rows the store gave a real call-site line for (the link
  // opens the CALL); `usage.length - sitesRendered` are rows where the store
  // held no call-site line and the link opens the referencing declaration, each
  // labeled at the row. Before this the header said "stored references" and the
  // rows said nothing, which is how a reader could not tell which of the two
  // they were looking at.
  const exact = usage.filter((s) => isExactAddress(s.callSite)).length
  lines[0] += exact === usage.length
    ? " — each opens the stored call site"
    : exact === 0
      ? ` — the index stores no call-site line for these, so each opens the referencing declaration`
      : ` — ${exact} open the stored call site, ${usage.length - exact} open the referencing declaration (no call-site line stored)`
  const shown = usage.slice(0, MAX_USAGE_LINKS)
  shown.forEach((s, i) => {
    lines.push(`${i + 1}. [${siteLabel(s)}](${openUsageUri(s)})`)
  })
  // total is the authoritative site count (caller passes usage.length or a
  // truncated count); rest = sites beyond the rendered top-3.
  const rest = Math.max(0, Math.min(total, usage.length) - shown.length)
  if (rest > 0) {
    lines.push(`+${rest} more — [show all usages](${showAllUsagesUri({ file: forFile, line: forLine, character: forCharacter, symbol: forSymbol })})`)
  }
  return lines.join("\n")
}

/** Render the clickable definition line (replaces the plain location in the
 *  source footnote). */
export function definitionLink(path: string, line: number, character: number): string {
  return `_source: bb index ([${path}:${line + 1}](${openDefinitionUri(path, line, character)}))_`
}
