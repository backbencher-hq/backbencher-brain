import { CrossLanguageIntelligence } from "./cross-language-intelligence"
import * as Log from "../tool/brain-log"
import { renderDocument, assertRendererParses, MAP_SCRIPT } from "./visualization/map-renderer"

const log = Log.create({ service: "dependency-graph-visualizer" })

export namespace DependencyGraphVisualizer {
  export interface GraphNode {
    id: string
    name: string
    group: string // Usually Language
    val: number // Size/Weight
    type: string // Symbol type
    filePath: string
    /** The symbol's line, so a graph is NAVIGABLE: the index stores
     *  line_start/line_end and the projection used to discard both, so a reader
     *  could see a symbol in the graph and still have no way to reach it. */
    line?: number
    lineEnd?: number
    /** The symbol's qualified name where the index publishes one, so a node can
     *  be matched to the name a reader searched for. */
    qualifiedName?: string
    /** The index's own gravity score. The projection used to recompute importance
     *  as a degree count while the index already stored a better notion of it. */
    gravity?: number
    /** Per-node staleness, attached by the handler after the freshness read. */
    stale?: boolean
  }

  export interface GraphLink {
    source: string
    target: string
    type: string // Relationship type
    color: string
    label: string
    /** The stored relationship row this edge came from. Without it an edge
     *  cannot be audited against the index that justifies it. */
    rowId?: string
    confidence?: number
    evidenceTier?: string
    /** The relationship's line, when the index stored one. */
    line?: number
    /** Per-link staleness (worst-of-endpoints), attached by the handler. */
    stale?: boolean
    /** This edge crosses a language boundary. The index stores 1,549 of these
     *  across 9 languages in cargo alone; a polyglot map that cannot show them
     *  is not a polyglot map. */
    crossLanguage?: boolean
    crossFile?: boolean
    /** How the cross-language edge is bridged, when the index recorded it. */
    bridge?: string
    /** How many stored relationship rows this one drawn edge stands for. A call
     *  made from 15 call sites is one edge with weight 15, not 15 edges: the graph
     *  shape is right to merge them and the weight is right to keep. MEASURED on
     *  cargo: 394 stored rows between 200 returned nodes collapsed to 285 links, so
     *  109 rows used to vanish with nothing to say so. */
    occurrences?: number
    /** Every stored row behind this edge, so a reader can audit all of them and not
     *  only the representative `rowId`. */
    rowIds?: string[]
  }

  export interface GraphData {
    nodes: GraphNode[]
    links: GraphLink[]
    /** What the filter removed, and why. A projection that drops rows MUST say
     *  so: a partial graph that looks whole is the failure this documents. */
    excluded?: {
      symbols: number
      byPattern: Record<string, number>
      patterns: string[]
      includesTestFiles: boolean
    }
  }

  /** Caller control over what counts as noise. The filter has an opinion about
   *  build output and VCS metadata; the caller can replace that opinion, and can
   *  ask for test sources back. */
  export interface GraphOptions {
    /** Path SEGMENTS to exclude (matched on whole segments, never as substrings). */
    excludePatterns?: string[]
    /** Include test/spec sources. Default true: they are ordinary source. */
    includeTests?: boolean
  }

  /**
   * Transforms polyglot AST data into a generic Graph structure suitable for 3D visualization.
   */
  export function generateGraphData(
    symbols: any[], // Expected to contain id, name, language, type, file
    relationships: any[], // Expected to contain source_id, target_id, type
    options: GraphOptions = {},
  ): GraphData {
    log.info("🌐 Generating Polyglot Dependency Graph Data...")

    // 1. Pre-calculate link counts for node importance (PageRank style)
    const linkCount: Record<string, number> = {}
    for (const rel of relationships) {
      if (!rel.source_id || !rel.target_id) continue
      linkCount[rel.source_id] = (linkCount[rel.source_id] || 0) + 1
      linkCount[rel.target_id] = (linkCount[rel.target_id] || 0) + 1
    }

    // MEASURED, cargo (2,071 files): the previous filter matched these as bare
    // SUBSTRINGS of the id or path, so `dist` removed `src/util/edit_distance.rs`,
    // `out` removed `src/compiler/layout.rs` and `src/compiler/output_depinfo.rs`,
    // and `build` removed `crates/cargo-test-support/build.rs`. 225 of 1,787
    // symbol-bearing files survived and the answer declared no exclusion at all.
    //
    // Two corrections. First, a pattern is a PATH SEGMENT, so collateral damage
    // inside a longer word is impossible. Second, the list is the CALLER'S:
    // `excludePatterns` overrides it, and whatever is dropped is reported on the
    // result as `excluded` with a count and the patterns responsible, so a
    // partial graph can never look like a whole one.
    const DEFAULT_EXCLUDE_SEGMENTS = [
      "node_modules", ".git", ".next", ".turbo", ".cache", "coverage",
      "dist", "build", "out", "target", "vendor", "__pycache__",
    ]
    const DEFAULT_EXCLUDE_SUFFIXES = [".d.ts", ".min.js", ".map"]
    // Test/spec/migration directories are separated from build output: they are
    // ordinary source a reader may well want, so they are NOT excluded by
    // default (the previous filter removed 1,589 of cargo's 2,071 files this way).
    const excludeSegments = options?.excludePatterns
      ? options.excludePatterns.map((p) => p.toLowerCase())
      : DEFAULT_EXCLUDE_SEGMENTS
    const includeTestFiles = options?.includeTests !== false

    /** True when a path is inside one of the excluded SEGMENTS (or carries an
     *  excluded suffix). A segment test, so `out` never matches `layout.rs`. */
    const isExcluded = (candidate: string): boolean => {
      const parts = candidate.toLowerCase().split("/").filter(Boolean)
      for (const seg of excludeSegments) {
        if (parts.includes(seg)) return true
      }
      const leaf = parts.length > 0 ? parts[parts.length - 1]! : ""
      for (const suffix of DEFAULT_EXCLUDE_SUFFIXES) {
        if (leaf.endsWith(suffix)) return true
      }
      if (!includeTestFiles) {
        for (const seg of ["test", "tests", "spec", "specs", "__tests__", "testdata"]) {
          if (parts.includes(seg)) return true
        }
        if (/(?:^|[._-])(?:test|spec)\\.[a-z0-9]+$/.test(leaf)) return true
      }
      return false
    }

    // 2. Map and filter nodes
    let validNodes: GraphNode[] = []
    let excludedCount = 0
    const excludedByPattern = new Map<string, number>()
    for (const sym of symbols) {
      const filePath = sym.file || sym.filePath || ""
      const id = sym.id || ""

      // Skip declared build/noise paths, and count them so the answer can say so.
      if (isExcluded(filePath) || isExcluded(id)) {
        excludedCount++
        const culprit = excludeSegments.find((seg) => filePath.toLowerCase().split("/").includes(seg) || id.toLowerCase().split("/").includes(seg))
        if (culprit) excludedByPattern.set(culprit, (excludedByPattern.get(culprit) ?? 0) + 1)
        continue
      }

      // Include all valid project codebase symbols to show absolute reality.
      // We will skip purely local anonymous variables to prevent garbage,
      // but include files, classes, methods, functions, interfaces, etc.
      if (sym.symbol_type === "local" || sym.symbol_type === "variable") {
        if (!linkCount[id]) continue // Only include variables if they have links
      }

      validNodes.push({
        id: sym.id,
        name: sym.name || "unknown",
        group: sym.language || "unknown",
        val: 1 + (linkCount[id] || 0) * 0.5, // Scale node size by connections
        type: sym.symbol_type || "unknown",
        filePath: filePath || "unknown",
        // Carried straight from the index rather than recomputed, so the graph
        // keeps the same notion of importance and position the editor uses.
        ...(sym.line_start != null ? { line: Number(sym.line_start) } : {}),
        ...(sym.line_end != null ? { lineEnd: Number(sym.line_end) } : {}),
        ...(sym.qualified_name ? { qualifiedName: String(sym.qualified_name) } : {}),
        ...(sym.gravity_score != null ? { gravity: Number(sym.gravity_score) } : {}),
      })
    }

    const validNodeIds = new Set(validNodes.map((n) => n.id))

    // Ensure NO duplicates
    const uniqueNodes = []
    const seenNodes = new Set()
    for (const node of validNodes) {
      if (!seenNodes.has(node.id)) {
        seenNodes.add(node.id)
        uniqueNodes.push(node)
      }
    }
    validNodes = uniqueNodes

    // 3. Map relationships to links
    const links: GraphLink[] = []
    // Maps a link key to the link it produced, so a repeated (source, target,
    // type) can add to that link's multiplicity instead of being discarded.
    const seenLinks = new Map<string, GraphLink>()
    for (const rel of relationships) {
      if (!rel.source_id || !rel.target_id) continue

      // Only add links where both source and target exist in our filtered node map
      if (seenNodes.has(rel.source_id) && seenNodes.has(rel.target_id)) {
        // The key includes the relationship TYPE. It used to be
        // `${source}->${target}`, so two stored relationships of different types
        // between one pair collapsed into a single link and the second was
        // dropped without a word. Measured on cobra: 126 of 126 in-answer pairs
        // carrying more than one stored type under-reported, while bb_analyze
        // showed both edges from the same index. A visualisation is a LOSSY
        // projection, and loss must be the declared kind, never silent.
        const relType = rel.relationship_type || rel.type || "dependency"
        const linkKey = `${rel.source_id}->${rel.target_id}::${relType}`
        // Several STORED ROWS can share one (source, target, type) — 15 call sites
        // of the same call is one edge drawn once, but it is fifteen pieces of
        // evidence. MEASURED on cargo: 394 stored rows between 200 returned nodes
        // collapsed to 285 links, so 109 rows vanished with nothing to say so. The
        // graph shape is right to merge them; the WEIGHT is not, and weight is what
        // tells a reader this is a hot edge rather than a stray reference. So the
        // first row found stays the representative `rowId`, and the multiplicity
        // rides the edge as `occurrences` and `rowIds`.
        const existing = seenLinks.get(linkKey)
        if (existing) {
          existing.occurrences = (existing.occurrences ?? 1) + 1
          if (rel.row_id != null) (existing.rowIds ??= []).push(String(rel.row_id))
        } else {
          seenLinks.set(linkKey, null as any)
          const link: GraphLink = {
            source: rel.source_id,
            target: rel.target_id,
            type: relType,
            color: getRelationshipColor(relType),
            label: relType,
          }
          // Evidence the index already stores, so an edge can be traced and a
          // proven edge can be told from an inferred one. The previous
          // projection carried none of it, so no edge could be audited.
          if (rel.row_id != null) link.rowId = String(rel.row_id)
          if (rel.id != null && rel.row_id == null) link.rowId = String(rel.id)
          if (rel.confidence != null) link.confidence = Number(rel.confidence)
          if (rel.evidence_tier != null) link.evidenceTier = String(rel.evidence_tier)
          if (rel.line_number != null) link.line = Number(rel.line_number)
          // The language boundary. MEASURED on cargo: 1,549 cross-language
          // relationships across 9 languages are stored, and the projection
          // dropped this flag, so a "polyglot architecture map" could not show
          // where one language hands off to another. It is the whole reason the
          // tool exists, so it rides the edge.
          if (rel.is_cross_language != null) link.crossLanguage = Number(rel.is_cross_language) === 1
          if (rel.is_cross_file != null) link.crossFile = Number(rel.is_cross_file) === 1
          if (rel.bridge_mechanism != null) link.bridge = String(rel.bridge_mechanism)
          link.occurrences = 1
          link.rowIds = link.rowId != null ? [link.rowId] : []
          links.push(link)
          seenLinks.set(linkKey, link)
        }
      }
    }

    log.info(`✅ Graph Data Generated: ${validNodes.length} nodes, ${links.length} links`)

    return {
      nodes: validNodes,
      links,
      excluded: {
        symbols: excludedCount,
        byPattern: Object.fromEntries([...excludedByPattern.entries()].sort((a, b) => b[1] - a[1])),
        patterns: excludeSegments,
        includesTestFiles: includeTestFiles,
      },
    }
  }

  /**
   * A SELF-CONTAINED HTML artifact: one file, no network, no fonts, no build.
   *
   * The previous renderer loaded 3d-force-graph from a CDN and the Inter webfont
   * from Google Fonts, so a file the doc called "self-contained" rendered NOTHING
   * offline and phoned home to two CDNs on open. This one inlines a real
   * force-directed layout and a canvas renderer, so the artifact is genuinely
   * portable — and the picture carries the evidence the projection stores: edge
   * confidence sets opacity, relationship type sets colour and dash, a stale
   * endpoint is a hollow ring, node size follows the index's own gravity, and
   * every node and edge keeps the facts needed to reach the source.
   */
  export function generateHTML(graphData: GraphData, options?: { title?: string; viewLabel?: string }): string {
    // The renderer lives in its own module as real source. It used to be a ~600-line
    // template literal nested inside this function, which is a nesting hazard with a
    // demonstrated cost: a backtick in a COMMENT terminated the string and broke the
    // build with a parse error far from its cause, twice. The extracted module writes
    // backticks as a sentinel, and the assembled script is compiled before it is
    // returned, so a malformed renderer fails here rather than shipping a blank file.
    assertRendererParses(MAP_SCRIPT)
    const script = MAP_SCRIPT
    return renderDocument({
      payload: JSON.stringify(graphData),
      title: options?.title ?? "Backbencher Architecture Map",
      viewLabel: options?.viewLabel ?? "Architecture Map",
      script,
    })
  }

  // --- INTERNAL UTILS ---
  /** The published colour for a relationship type, in the machine-readable
   *  projection. The previous switch matched names this index does not emit
   *  (`api_call`, `message_queue`, `ffi_binding`), so every REAL edge fell
   *  through to grey and the colour carried no information at all. These are the
   *  types the analyzers actually store. */
  function getRelationshipColor(type: string): string {
    switch (type) {
      case "calls":
        return "#5eead4"
      case "uses":
        return "#60a5fa"
      case "contains":
        return "#a78bfa"
      case "extends":
        return "#f472b6"
      case "implements":
        return "#34d399"
      case "instantiates":
        return "#fbbf24"
      case "imports":
      case "exports":
        return "#94a3b8"
      case "references":
        return "#fb923c"
      default:
        return "#64748b"
    }
  }
}
