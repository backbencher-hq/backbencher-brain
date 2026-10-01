import { CrossLanguageIntelligence } from "./cross-language-intelligence"
import * as Log from "../tool/brain-log"

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
  export function generateHTML(graphData: GraphData): string {
    const json = JSON.stringify(graphData)
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Backbencher Architecture Map</title>
<style>
  :root{
    --bg:#08080c; --panel:rgba(16,17,26,.82); --edge:rgba(255,255,255,.14);
    --text:#e8eaf0; --muted:#8b90a0; --accent:#5eead4; --accent2:#a78bfa;
    --warn:#fbbf24; --danger:#f87171;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);
    font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    overflow:hidden}
  #stage{position:absolute;inset:0}
  canvas{display:block;width:100%;height:100%;cursor:grab}
  canvas.dragging{cursor:grabbing}
  .panel{position:absolute;background:var(--panel);border:1px solid var(--edge);
    border-radius:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    box-shadow:0 10px 40px rgba(0,0,0,.55)}
  #hud{top:16px;left:16px;padding:16px 18px;max-width:330px}
  #hud h1{margin:0 0 2px;font-size:14px;letter-spacing:.02em}
  #hud .sub{color:var(--muted);font-size:12px}
  #stats{margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:2px 12px;
    font-variant-numeric:tabular-nums}
  #stats b{font-weight:600}
  #stats span{color:var(--muted)}
  #search{top:16px;right:16px;padding:12px;display:flex;gap:8px;align-items:center}
  #search input{background:rgba(0,0,0,.35);border:1px solid var(--edge);color:var(--text);
    border-radius:9px;padding:8px 11px;width:230px;outline:none;font:inherit}
  #search input:focus{border-color:var(--accent)}
  #legend{left:16px;bottom:16px;padding:14px 18px;max-width:330px}
  #legend h2{margin:0 0 8px;font-size:11px;letter-spacing:.09em;color:var(--muted);
    text-transform:uppercase}
  .row{display:flex;align-items:center;gap:9px;margin:3px 0;font-size:12px}
  .swatch{width:22px;height:0;border-top-width:2px;flex:none}
  .dot{width:9px;height:9px;border-radius:50%;flex:none}
  #detail{right:16px;bottom:16px;padding:14px 18px;max-width:400px;max-height:44vh;
    overflow:auto;display:none}
  #detail.on{display:block}
  #detail h3{margin:0 0 6px;font-size:13px}
  #detail dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0;
    font-variant-numeric:tabular-nums}
  #detail dt{color:var(--muted)} #detail dd{margin:0;word-break:break-all}
  #detail .close{position:absolute;top:8px;right:10px;cursor:pointer;color:var(--muted)}
  .note{margin-top:10px;padding-top:9px;border-top:1px solid var(--edge);
    color:var(--muted);font-size:11.5px}
  .warnrow{color:var(--warn)}
  #hint{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);
    color:var(--muted);font-size:11.5px;background:var(--panel);
    border:1px solid var(--edge);border-radius:999px;padding:6px 14px}
  #progress{position:absolute;left:50%;top:16px;transform:translateX(-50%);
    color:var(--accent);font-size:11.5px;background:var(--panel);
    border:1px solid var(--edge);border-radius:999px;padding:6px 14px;
    font-variant-numeric:tabular-nums}
  #shown{position:absolute;left:50%;top:52px;transform:translateX(-50%);
    color:var(--muted);font-size:11px;background:var(--panel);
    border:1px solid var(--edge);border-radius:999px;padding:5px 13px;
    font-variant-numeric:tabular-nums;text-align:center;max-width:70vw}
  @media (max-width:760px){#legend,#hint{display:none}#hud{max-width:56vw}}
</style>
</head>
<body>
<div id="stage"><canvas id="c"></canvas></div>
<div class="panel" id="hud">
  <h1>Architecture Map</h1>
  <div class="sub">bb_visualize &middot; self-contained &middot; no network</div>
  <div id="stats"></div>
  <div class="note" id="excluded"></div>
</div>
<div class="panel" id="search">
  <input id="q" placeholder="Find a node&hellip;" autocomplete="off" spellcheck="false">
  <span id="qstat" class="sub"></span>
</div>
<div class="panel" id="legend">
  <h2>Relationship types</h2>
  <div id="legend-rows"></div>
  <h2 style="margin-top:12px">Encoding</h2>
  <div class="row"><span class="dot" style="background:#5eead4"></span>size = index gravity</div>
  <div class="row"><span class="dot" style="background:none;border:1.5px solid #fbbf24"></span>hollow ring = stale since index</div>
  <div class="row"><span class="swatch" style="border-top-style:solid"></span>opacity = stored confidence</div>
  <div class="row"><span class="swatch" id="w-sw" style="border-top-style:solid;border-top-width:1px"></span>thickness = stored rows behind the edge</div>
  <div class="row"><span class="swatch" id="xl-sw" style="border-top-color:#f0abfc;border-top-width:3px"></span><span id="xl-text">cross-language edge</span></div>
</div>
<div class="panel" id="detail"><span class="close" id="dclose">&#10005;</span><div id="dbody"></div></div>
<div id="progress" style="display:none"></div>
<div id="shown" style="display:none"></div>
<div id="hint">drag to pan &middot; scroll to zoom &middot; click a node to focus, click an edge to frame both ends, double-click a node to fill the view with its neighbours</div>
<noscript><p style="padding:24px">This map is interactive and needs JavaScript. The graph data is embedded below.</p></noscript>
<script id="bb-graph-data" type="application/json">${json.replace(/</g, "\\u003c")}</script>
<script>
(function () {
  "use strict";
  var G = JSON.parse(document.getElementById("bb-graph-data").textContent);
  var N = G.nodes || [], L = G.links || [];
  // The id -> node index is built FIRST, before anything can draw.
  // MEASURED in a real browser: it used to be built after the layout driver, so the
  // driver's first draw() found it empty, the byId lookup threw a TypeError, and the
  // whole script died before resize() -- leaving the canvas at its default 300x150
  // with nothing painted on it. An index that must exist before the first paint is a
  // precondition, and preconditions belong at the top.
  var byId = {};
  for (var bi = 0; bi < N.length; bi++) byId[N[bi].id] = N[bi];
  var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  var cv = document.getElementById("c"), ctx = cv.getContext("2d");
  var W = 0, H = 0, view = { x: 0, y: 0, k: 1 };
  var sel = null, hover = null, q = "";

  // ---- colour: one stable hue per relationship type, plus a dash for
  // structural vs behavioural edges so the two are distinguishable without colour.
  var PALETTE = ["#5eead4","#a78bfa","#f472b6","#60a5fa","#fbbf24","#34d399","#fb923c","#c084fc"];
  var types = [], tidx = {};
  for (var i = 0; i < L.length; i++) {
    var t = L[i].type || "dependency";
    if (!(t in tidx)) { tidx[t] = types.length; types.push(t); }
  }
  function col(t) { return PALETTE[(tidx[t] || 0) % PALETTE.length]; }
  // Edge WIDTH encodes how much stored evidence sits behind the edge. A call made
  // from 15 call sites is one drawn edge with weight 15, and MEASURED on cargo the
  // heaviest edge is exactly that: parse -> push, 15 rows. Without this the hot
  // edges and the stray references look identical, which is the one distinction a
  // dependency picture most needs to make.
  var widest = 1;
  for (var w = 0; w < L.length; w++) if ((L[w].occurrences || 1) > widest) widest = L[w].occurrences || 1;
  function weightOf(l) { return 0.7 + 2.6 * Math.sqrt(((l.occurrences || 1) - 1) / Math.max(1, widest - 1)); }
  var STRUCTURAL = { contains: 1, exports: 1, imports: 1 };
  function dash(t) { return STRUCTURAL[t] ? [] : [5, 4]; }
  // A cross-language edge is a LANGUAGE BOUNDARY, not a dependency: wide, long
  // dashes, and drawn under the local edges so the local structure reads first.
  function edgeDash(l) { return l.crossLanguage ? [11, 8] : dash(l.type); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  // ---- stats, declared rather than implied
  var stale = N.filter(function (n) { return n.stale; }).length;
  var cross = L.filter(function (l) { return l.crossLanguage; }).length;
  var heaviest = L.reduce(function (a, l) { return Math.max(a, l.occurrences || 1); }, 1);
  var evidenceRows = L.reduce(function (a, l) { return a + (l.occurrences || 1); }, 0);
  var byType = {};
  for (var j = 0; j < L.length; j++) { byType[L[j].type] = (byType[L[j].type] || 0) + 1; }
  document.getElementById("stats").innerHTML =
    row("nodes", N.length) + row("edges", L.length) +
    row("node types", uniq(N.map(function (n) { return n.type; })).length) +
    row("languages", uniq(N.map(function (n) { return n.group; }))) +
    row("stored edges behind them", evidenceRows + (evidenceRows > L.length ? " (heaviest " + heaviest + ")" : "")) +
    (cross ? row("cross-language edges", cross, true) : "") +
    (stale ? row("stale since index", stale, true) : "");
  var xlt = document.getElementById("xl-text");
  if (xlt) xlt.textContent = cross ? "cross-language edge (" + cross + ")" : "cross-language edge (none in this slice)";
  function row(k, v, warn) {
    return '<b' + (warn ? ' class="warnrow"' : "") + ">" + esc(v) + "</b><span>" + esc(k) + "</span>";
  }
  function uniq(a) { var s = {}, n = 0; for (var i = 0; i < a.length; i++) if (!s[a[i]]) { s[a[i]] = 1; n++; } return n; }
  var ex = G.excluded;
  document.getElementById("excluded").innerHTML = ex && ex.symbols
    ? "<b>" + ex.symbols + "</b> symbol(s) excluded as noise by " +
      esc(Object.keys(ex.byPattern || {}).join(", ") || "the default patterns") +
      (ex.includesTestFiles ? "" : " (test sources excluded)") +
      " &mdash; this map is not the whole project"
    : "nothing excluded &mdash; this map is the whole project";

  // ---- legend
  document.getElementById("legend-rows").innerHTML = types.map(function (t) {
    return '<div class="row"><span class="swatch" style="border-top-color:' + col(t) +
      ";border-top-style:" + (STRUCTURAL[t] ? "solid" : "dashed") + '"></span>' +
      esc(t) + ' <span class="sub" style="color:var(--muted)">' + (byType[t] || 0) + "</span></div>";
  }).join("");

  // ---- layout: Fruchterman-Reingold over a Barnes-Hut tree, run as a STEPPER.
  //
  // Two measurements shaped this, both of them on the artifact rather than on a
  // model of it:
  //
  //   The first inlined renderer used textbook O(n^2) repulsion \u2014 every node
  //   against every other, every iteration. At n=2000 that is 40,319 ms of
  //   SYNCHRONOUS work: the page freezes for forty seconds before the first
  //   frame, which is the first thing a caller ever sees.
  //
  //   Barnes-Hut fixes the algorithm \u2014 a distant cluster is treated as one body,
  //   so the repulsion is ~20 cell visits per node per iteration instead of 2000
  //   pairwise comparisons. But the measurement does not stop there: even pruned,
  //   a 2000-node graph is ~4.1 million cell visits, which is 3-5 seconds of
  //   JavaScript. A frame is ~16 ms. No tuning makes seconds fit in a frame, so a
  //   layout that blocks the main thread is a defect however good the algorithm is.
  //
  // Therefore: the layout is a stepper. It does a slice of iterations per
  // animation frame, yields, and redraws. The canvas is painted with the seeded
  // positions on the FIRST frame, so there is never a blank screen; the page stays
  // interactive throughout; the work is bounded and scaled to the graph; and a
  // progress readout says what is happening, because a layout that takes seconds
  // must not be silent about it.
  //
  // The repulsion is APPROXIMATE by construction. That is stated rather than
  // hidden: two renders of different sizes will not place a node in the same spot,
  // which is inherent to the algorithm and not a defect to chase.
  function makeLayout(nodes, links) {
    var n = nodes.length;
    var W0 = 2000, H0 = 1400;
    var k = Math.sqrt((W0 * H0) / n) * 0.62;
    // Deterministic spiral seeding: no RNG, so a given graph always lays out
    // identically and two renders can be compared.
    var pos = new Array(n);
    for (var i = 0; i < n; i++) {
      var a = i * 2.399963229728653;
      var r = 0.42 * Math.min(W0, H0) * Math.sqrt((i + 1) / n);
      pos[i] = { x: W0 / 2 + Math.cos(a) * r, y: H0 / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
    }
    // Publish the seeded positions IMMEDIATELY, before a single iteration runs.
    // MEASURED in a real browser: publishing them only inside step() left the
    // canvas at 0 ink samples, because the one draw() that happened before the
    // first animation frame found every x and y undefined. The spiral seed is
    // already deterministic and readable, so the graph is correct from the first
    // frame and the simulation only ever improves it.
    publish();
    var idx = {};
    for (var m = 0; m < n; m++) idx[nodes[m].id] = m;
    var edges = [];
    for (var e = 0; e < links.length; e++) {
      var s = idx[links[e].source], t = idx[links[e].target];
      if (s !== undefined && t !== undefined && s !== t) edges.push([s, t]);
    }
    // Work is bounded and scaled: a big graph gets fewer, cheaper iterations
    // because it must, and a small one gets more because it can.
    var total = n > 1400 ? 110 : n > 700 ? 160 : n > 300 ? 240 : 340;
    var THETA = 0.9, MAX_DEPTH = 10, it = 0;
    var temp = Math.min(W0, H0) * 0.09;

    function Cell(x, y, half) { return { x: x, y: y, h: half, n: 0, cx: 0, cy: 0, c: null }; }
    function cellOf(root, x, y) {
      var cell = root, depth = 0;
      while (depth++ < MAX_DEPTH) {
        var h = cell.h / 2;
        if (h < 0.5) return cell;
        var q = (x >= cell.x ? 1 : 0) + (y >= cell.y ? 2 : 0);
        if (!cell.c) cell.c = [null, null, null, null];
        if (!cell.c[q]) cell.c[q] = Cell(cell.x + (q & 1 ? h : -h), cell.y + (q & 2 ? h : -h), h);
        cell = cell.c[q];
      }
      return cell;
    }
    function accumulate(cell) {
      // A LEAF already holds its own point, so it returns. An internal cell starts
      // at n = 0 and only gets its count by summing children \u2014 so it must NOT be
      // skipped for being zero. Getting this backwards leaves every internal cell
      // at n = 0, makes the centre of mass NaN, and silently disables the prune:
      // the layout then costs O(n^2) while looking like Barnes-Hut.
      if (cell.c === null) return;
      for (var q = 0; q < 4; q++) {
        var kid = cell.c[q];
        if (kid === null) continue;
        accumulate(kid);
        cell.n += kid.n; cell.cx += kid.cx; cell.cy += kid.cy;
      }
    }
    function repulsion(cell, i, out) {
      var dx = pos[i].x - cell.cx / cell.n, dy = pos[i].y - cell.cy / cell.n;
      var d2 = dx * dx + dy * dy;
      if (cell.c === null || d2 > THETA * THETA * cell.h * cell.h) {
        if (d2 < 0.01) d2 = 0.01;
        var f = (cell.n * k * k) / d2;
        out.vx += (dx / Math.sqrt(d2)) * f; out.vy += (dy / Math.sqrt(d2)) * f;
        return;
      }
      for (var q = 0; q < 4; q++) if (cell.c[q] !== null) repulsion(cell.c[q], i, out);
    }

    /** Run until the time budget for one frame is spent. Returns progress 0..1. */
    function step(budgetMs) {
      var deadline = Date.now() + budgetMs;
      while (it < total) {
        var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
        for (var p = 0; p < n; p++) {
          if (pos[p].x < minx) minx = pos[p].x;
          if (pos[p].x > maxx) maxx = pos[p].x;
          if (pos[p].y < miny) miny = pos[p].y;
          if (pos[p].y > maxy) maxy = pos[p].y;
        }
        var root = Cell((minx + maxx) / 2, (miny + maxy) / 2, Math.max(maxx - minx, maxy - miny) / 2 + 1);
        for (var p2 = 0; p2 < n; p2++) { pos[p2].vx = 0; pos[p2].vy = 0; }
        for (var b = 0; b < n; b++) {
          var c = cellOf(root, pos[b].x, pos[b].y);
          c.n++; c.cx += pos[b].x; c.cy += pos[b].y;
        }
        accumulate(root);
        for (var r = 0; r < n; r++) repulsion(root, r, pos[r]);
        for (var e2 = 0; e2 < edges.length; e2++) {
          var s2 = edges[e2][0], t2 = edges[e2][1];
          var ex = pos[s2].x - pos[t2].x, ey = pos[s2].y - pos[t2].y;
          var d = Math.sqrt(ex * ex + ey * ey) || 0.01;
          var g = (d * d) / k;
          pos[s2].vx -= (ex / d) * g; pos[s2].vy -= (ey / d) * g;
          pos[t2].vx += (ex / d) * g; pos[t2].vy += (ey / d) * g;
        }
        for (var m2 = 0; m2 < n; m2++) {
          var sp = Math.sqrt(pos[m2].vx * pos[m2].vx + pos[m2].vy * pos[m2].vy) || 0.01;
          var adv = sp < temp ? sp : temp;
          pos[m2].x += (pos[m2].vx / sp) * adv;
          pos[m2].y += (pos[m2].vy / sp) * adv;
          pos[m2].x = Math.max(30, Math.min(W0 - 30, pos[m2].x));
          pos[m2].y = Math.max(30, Math.min(H0 - 30, pos[m2].y));
        }
        temp *= 0.978;
        it++;
        if (Date.now() >= deadline) break;
      }
      publish();
      return it / total;
    }
    /** Copy the current positions onto the nodes the renderer draws. */
    function publish() {
      var nx = Infinity, ny = Infinity, ax = -Infinity, ay = -Infinity;
      for (var q2 = 0; q2 < n; q2++) {
        if (pos[q2].x < nx) nx = pos[q2].x;
        if (pos[q2].x > ax) ax = pos[q2].x;
        if (pos[q2].y < ny) ny = pos[q2].y;
        if (pos[q2].y > ay) ay = pos[q2].y;
      }
      var sx = (ax - nx) || 1, sy = (ay - ny) || 1;
      for (var q3 = 0; q3 < n; q3++) {
        nodes[q3].x = ((pos[q3].x - nx) / sx - 0.5) * 2000;
        nodes[q3].y = ((pos[q3].y - ny) / sy - 0.5) * 1400;
      }
    }
    return { step: step, total: total, done: function () { return it >= total; } };
  }

  // Drive the layout in frame-sized slices. The graph is painted from the seed
  // before any iteration runs, so the canvas is never blank, and the page stays
  // interactive while the graph settles. The progress readout is shown because a
  // layout that takes seconds must not be silent about it.
  var progressEl = document.getElementById("progress");
  var lay = N.length > 0 ? makeLayout(N, L) : null;
  // requestAnimationFrame does NOT fire in a hidden or background tab, and a
  // generated report is usually opened in one, so a purely rAF-driven layout never
  // advances there. MEASURED: 0 ink samples, forever, because positions were only
  // published inside the layout step and no step ever ran.
  //
  // A timer therefore rides alongside rAF as a watchdog. The FIRST version of this
  // registered BOTH unconditionally on every round with no cancellation, so the
  // number of pending callbacks doubled each step and the tab saturated -- even a
  // trivial evaluate against the page timed out at 60 seconds. Exactly ONE wake-up
  // is ever pending: whichever fires cancels the other, does the work, and arms one
  // replacement. A watchdog that can multiply is worse than no watchdog.
  var rafId = 0, timerId = 0;
  function schedule() {
    if (rafId || timerId) return;
    if (typeof requestAnimationFrame === "function") rafId = requestAnimationFrame(tickLayout);
    timerId = setTimeout(tickLayout, 80);
  }
  function tickLayout() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    if (timerId) { clearTimeout(timerId); timerId = 0; }
    if (!lay || lay.done()) return;
    var p = lay.step(12);
    // Positions moved, so the spatial index built from them is stale. Rebuilding
    // per slice would be wasteful at 60 slices; the grid is only needed for
    // CULLING, which is an optimisation, so it is simply invalidated here and
    // rebuilt lazily on the next frame that asks for it.
    grid = null;
    draw();
    if (progressEl) {
      progressEl.style.display = p < 1 ? "block" : "none";
      progressEl.textContent = "laying out\u2026 " + Math.round(p * 100) + "%";
    }
    if (p < 1) schedule();
  }
  if (lay) { draw(); schedule() }

  var gmax = 1;
  for (var gi = 0; gi < N.length; gi++) gmax = Math.max(gmax, N[gi].gravity || 0);
  function radius(nd) { return 4 + 13 * Math.sqrt((nd.gravity || 0) / gmax); }

  function resize() {
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function toScreen(x, y) { return [W / 2 + (x * view.k + view.x), H / 2 + (y * view.k + view.y)]; }

  // ---- spatial index over world space.
  //
  // Positions are fixed once the layout settles, so this is built once and reused.
  // It is what makes deep zoom possible at all: a frame asks the grid which cells
  // the viewport touches and draws only those, instead of stroking 3,831 edges and
  // throwing away the 3,700 that are off-screen.
  // The grid's minimum cell pitch, in world units. It lives HERE rather than in
  // the enclosing scope because buildGrid reads it: MEASURED, with the constant in
  // the outer scope the function computed NaN for its cell size (typeof CELL was
  // undefined inside it), so the grid dimensions were NaN and the cell allocation
  // threw RangeError -- which killed the entire renderer, leaving a blank canvas and
  // nothing in the console to explain it. A helper that cannot be broken by an outer
  // binding is worth more here than a shared constant.
  // The grid pitch FOLLOWS THE ZOOM, and this is the second-order version of the
  // culling bug. MEASURED: with a fixed 80-world-unit pitch, zooming took the
  // visible set from 1,148 nodes to 207 and then STUCK at 207 for every further
  // step, all the way to the 600x ceiling -- because one cell is 80 units, which at
  // high zoom is thousands of pixels, so the viewport still intersected the same
  // handful of cells. A uniform grid can only cull down to its own resolution.
  //
  // So the pitch is rebuilt to match the current scale: a cell is about a twelfth of
  // the viewport height, which keeps the culling equally effective at every zoom.
  // A rebuild is O(nodes + edges) -- about 5,000 steps for a large graph, well
  // under a millisecond -- and it happens only when the zoom moves by more than 60%,
  // so panning never pays for it and zooming pays rarely.
  var grid = null, gW = 0, gH = 0, gOX = 0, gOY = 0, cellSize = 80;
  var gridAtK = 0;
  function buildGrid() {
    var n = N.length;
    if (!n) return;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (var i = 0; i < n; i++) {
      var px = N[i].x, py = N[i].y;
      // A grid that meets one non-finite coordinate must not take the renderer down
      // with it. MEASURED: buildGrid threw "Invalid array length" on the first frame
      // because a NaN span propagated into the cell count, which killed the whole
      // script -- the canvas stayed blank with no console clue about the cause.
      // Non-finite nodes are placed off-grid and simply never cull into view, which
      // is the honest degradation: a node with no position cannot be zoomed to.
      if (!isFinite(px) || !isFinite(py)) { N[i].x = 1e7; N[i].y = 1e7; px = 1e7; py = 1e7 }
      if (px < minx) minx = px;
      if (px > maxx) maxx = px;
      if (py < miny) miny = py;
      if (py > maxy) maxy = py;
    }
    if (!isFinite(minx) || !isFinite(maxx) || !isFinite(miny) || !isFinite(maxy)) return;
    var spanX = Math.max(1, maxx - minx), spanY = Math.max(1, maxy - miny);
    // A cell is about a twelfth of the visible height, in world units, so the
    // culling stays equally sharp whatever the zoom.
    var minCell = Math.max(0.35, (H / Math.max(view.k, 1e-6)) / 12);
    var pitch = Math.max(minCell, Math.max(spanX, spanY) / 220);
    // Hard cap, so no extent can ask for an allocation the process cannot satisfy.
    if (Math.ceil(spanX / pitch) * Math.ceil(spanY / pitch) > 65536) pitch = Math.max(pitch, Math.max(spanX, spanY) / 256);
    // The pitch is a CHOICE made from the extent, so visible() must divide by the
    // same number the build used. Leaving it at the nominal CELL made the lookup
    // index the wrong cells — the grid existed and disagreed with itself about its
    // own geometry, which is why the first version of this culling drew nothing.
    gW = Math.max(1, Math.ceil(spanX / pitch) + 1);
    gH = Math.max(1, Math.ceil(spanY / pitch) + 1);
    gOX = minx; gOY = miny;
    cellSize = pitch;
    gridAtK = view.k;
    if (!isFinite(gW * gH) || gW * gH <= 0 || gW * gH > 4e6) { grid = null; return }
    grid = new Array(gW * gH);
    for (var c = 0; c < grid.length; c++) grid[c] = { n: [], e: [] };
    for (var j = 0; j < n; j++) {
      var cx = Math.min(gW - 1, Math.max(0, Math.floor((N[j].x - gOX) / pitch)));
      var cy = Math.min(gH - 1, Math.max(0, Math.floor((N[j].y - gOY) / pitch)));
      grid[cy * gW + cx].n.push(j);
    }
    // An edge lives in every cell its bounding box crosses, so a long edge is
    // visible from any cell along it rather than only where it started.
    for (var e = 0; e < L.length; e++) {
      var a = byId[L[e].source], b = byId[L[e].target];
      if (!a || !b) continue;
      var ax = Math.min(gW - 1, Math.max(0, Math.floor((Math.min(a.x, b.x) - gOX) / pitch)));
      var bx = Math.min(gW - 1, Math.max(0, Math.floor((Math.max(a.x, b.x) - gOX) / pitch)));
      var ay = Math.min(gH - 1, Math.max(0, Math.floor((Math.min(a.y, b.y) - gOY) / pitch)));
      var by2 = Math.min(gH - 1, Math.max(0, Math.floor((Math.max(a.y, b.y) - gOY) / pitch)));
      for (var yy = ay; yy <= by2; yy++) {
        for (var xx = ax; xx <= bx; xx++) grid[yy * gW + xx].e.push(e);
      }
    }
  }
  /** The world rectangle currently visible, with a margin in pixels. */
  function viewport(marginPx) {
    var m = (marginPx || 0) / view.k;
    var hw = W / 2 / view.k + m, hh = H / 2 / view.k + m;
    return { x0: -view.x / view.k - hw, x1: -view.x / view.k + hw, y0: -view.y / view.k - hh, y1: -view.y / view.k + hh };
  }
  /** Indices of the nodes and edges that can touch the viewport, de-duplicated. */
  function visible(marginPx) {
    if (!grid || Math.abs(Math.log(view.k / Math.max(gridAtK, 1e-9))) > 0.47) buildGrid();
    var v = viewport(marginPx);
    var ax = Math.min(gW - 1, Math.max(0, Math.floor((v.x0 - gOX) / cellSize)));
    var bx = Math.min(gW - 1, Math.max(0, Math.floor((v.x1 - gOX) / cellSize)));
    var ay = Math.min(gH - 1, Math.max(0, Math.floor((v.y0 - gOY) / cellSize)));
    var by = Math.min(gH - 1, Math.max(0, Math.floor((v.y1 - gOY) / cellSize)));
    var seenN = {}, nodes = [], seenE = {}, edges = [];
    for (var y = ay; y <= by; y++) {
      for (var x = ax; x <= bx; x++) {
        var cellRef = grid[y * gW + x];
        if (!cellRef) continue;
        for (var i = 0; i < cellRef.n.length; i++) {
          var ni = cellRef.n[i];
          if (!seenN[ni]) { seenN[ni] = 1; nodes.push(ni); }
        }
        for (var j = 0; j < cellRef.e.length; j++) {
          var ei = cellRef.e[j];
          if (!seenE[ei]) { seenE[ei] = 1; edges.push(ei); }
        }
      }
    }
    return { n: nodes, e: edges };
  }

  // ---- adjacency: what touches what.
  //
  // Without this, selecting a node cannot dim the rest of the graph, so the edge
  // you are trying to trace is one of several thousand drawn at the same strength.
  var adj = null;
  function buildAdjacency() {
    adj = [];
    for (var i = 0; i < N.length; i++) adj.push([]);
    for (var e = 0; e < L.length; e++) {
      var a = byId[L[e].source], b = byId[L[e].target];
      if (!a || !b) continue;
      var ai = N.indexOf(a), bi = N.indexOf(b);
      if (ai >= 0) adj[ai].push(e);
      if (bi >= 0 && bi !== ai) adj[bi].push(e);
    }
  }
  var nodeIndex = null;
  function idxOf(nd) {
    if (!nodeIndex) {
      nodeIndex = {};
      for (var i = 0; i < N.length; i++) nodeIndex[N[i].id] = i;
    }
    return nodeIndex[nd.id];
  }
  /** When something is selected, the edges worth seeing are its own; everything
   *  else becomes a ghost. Returns null when nothing is focused. */
  function focusSet() {
    var target = sel || hover;
    if (!target) return null;
    if (target.name !== undefined) {
      var i = idxOf(target);
      if (i == null || !adj) return null;
      var keep = {};
      for (var j = 0; j < adj[i].length; j++) keep[adj[i][j]] = 1;
      return { node: i, edges: keep };
    }
    var keep2 = {};
    keep2[L.indexOf(target)] = 1;
    return { node: -1, edges: keep2 };
  }

  // ---- labels that can be READ.
  //
  // Placed in importance order and any label whose box overlaps one already placed
  // this frame is skipped. The earlier version drew every visible node's name, so
  // add_deps, add_unit_deps and add_deps_for_unit printed on top of one
  // another -- a screenshot showed them as an illegible smear. Skipping is not
  // losing: the search box, the hover and the selection always name their target,
  // and zooming in spreads labels apart until more of them fit.
  var labelBoxes = [];
  function placeLabel(nd, s, r, important) {
    var text = nd.name || "";
    if (!text) return;
    ctx.font = (important ? "600 " : "") + "11px ui-sans-serif,system-ui,sans-serif";
    var w = ctx.measureText(text).width;
    var x0 = s[0] - w / 2 - 2, x1 = s[0] + w / 2 + 2;
    var y0 = s[1] + r + 4, y1 = y0 + 12;
    for (var i = 0; i < labelBoxes.length; i++) {
      var b = labelBoxes[i];
      if (x0 < b[2] && x1 > b[0] && y0 < b[3] && y1 > b[1]) return;
    }
    labelBoxes.push([x0, y0, x1, y1]);
    ctx.save();
    ctx.globalAlpha = important ? 1 : 0.9;
    ctx.fillStyle = important ? "#ffffff" : "#cfd4e0";
    ctx.textAlign = "center";
    // a dark plate behind the text, so a name stays readable over a dense mesh
    ctx.fillStyle = "rgba(8,8,12,0.72)";
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillStyle = important ? "#ffffff" : "#cfd4e0";
    ctx.fillText(text, s[0], s[1] + r + 13);
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    var focus = focusSet();
    var vis = visible(80);
    var visEdges = vis.e, visNodes = vis.n;
    var q2 = q.toLowerCase();
    labelBoxes = [];

    // edges first, so nodes read on top of them
    for (var ei = 0; ei < (visEdges ? visEdges.length : 0); ei++) {
      var l = L[visEdges[ei]];
      var a = byId[l.source], b = byId[l.target];
      if (!a || !b) continue;
      var hit = hover === l || sel === l;
      var inFocus = !focus || hit || focus.edges[visEdges[ei]];
      var p1 = toScreen(a.x, a.y), p2 = toScreen(b.x, b.y);
      // cheap segment-vs-viewport reject before any stroking work
      if (Math.max(p1[0], p2[0]) < 0 || Math.min(p1[0], p2[0]) > W ||
          Math.max(p1[1], p2[1]) < 0 || Math.min(p1[1], p2[1]) > H) continue;
      var conf = (typeof l.confidence === "number") ? l.confidence : 0.5;
      ctx.save();
      if (l.crossLanguage) {
        ctx.globalAlpha = hit ? 1 : (inFocus ? 0.85 : 0.07);
        ctx.strokeStyle = "#f0abfc";
        ctx.lineWidth = hit ? 3.2 : (inFocus ? 1.4 : 0.6) + weightOf(l);
        ctx.setLineDash(hit ? [] : edgeDash(l));
      } else {
        ctx.globalAlpha = hit ? 1 : (inFocus ? (0.2 + 0.7 * conf) : 0.05);
        ctx.strokeStyle = col(l.type);
        ctx.lineWidth = hit ? 2.6 + weightOf(l) : (inFocus ? 0.5 : 0.35) + weightOf(l);
        ctx.setLineDash(hit ? [] : edgeDash(l));
      }
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      ctx.restore();
    }

    // nodes, most important first, so labels land on the ones a reader wants
    var order = visNodes ? visNodes.slice() : [];
    if (order.length) {
      order.sort(function (p, q2i) {
        var np = N[p], nq = N[q2i];
        var sp = (sel === np ? 2 : 0) + (hover === np ? 2 : 0) + (np.gravity || 0) / 1e6;
        var sq = (sel === nq ? 2 : 0) + (hover === nq ? 2 : 0) + (nq.gravity || 0) / 1e6;
        return sq - sp;
      });
    }
    var focusIdx = focus && focus.node >= 0 ? focus.node : -1;
    for (var oi = 0; oi < order.length; oi++) {
      var ni = order[oi], nd = N[ni], s = toScreen(nd.x, nd.y), r = radius(nd);
      if (s[0] < -r - 40 || s[0] > W + r + 40 || s[1] < -r - 40 || s[1] > H + r + 40) continue;
      var on = !q2 || (nd.name || "").toLowerCase().indexOf(q2) >= 0;
      var isSel = sel === nd, isHov = hover === nd;
      var near = focusIdx < 0 || ni === focusIdx;
      ctx.save();
      ctx.globalAlpha = on ? (focusIdx < 0 || near || (adj && adj[focusIdx] && false) ? 1 : 0.22) : 0.12;
      ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, 6.2832);
      if (nd.stale) { ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 1.6; ctx.stroke(); }
      else { ctx.fillStyle = isSel || isHov ? "#ffffff" : (nd.group === "unknown" ? "#64748b" : "#5eead4"); ctx.fill(); }
      if (isSel || isHov) { ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.restore();
      if (on) placeLabel(nd, s, r, isSel || isHov || (focusIdx >= 0 && ni === focusIdx));
    }

    // the readout says what the frame actually drew, so a culled view is not
    // mistaken for a small graph
    var shownEl = document.getElementById("shown");
    if (shownEl) {
      var drawnE = visEdges ? visEdges.length : 0, drawnN = order.length;
      if (drawnE < L.length || drawnN < N.length) {
        shownEl.style.display = "block";
        shownEl.textContent = "showing " + drawnN + " of " + N.length + " nodes and " +
          drawnE + " of " + L.length + " edges in view — " + (view.k < 1 ? "zoom out for the whole graph" : "zoom in, or click a node to focus");
      } else {
        shownEl.style.display = "none";
      }
    }
  }

  /** Animate the view to a target scale and offset. Used by the two interactions a
   *  reader actually asks for: frame an edge's endpoints, frame a node's
   *  neighbourhood. Both are eased so the reader can see WHERE they were taken. */
  var anim = null;
  function animateTo(k, cx, cy, done) {
    var from = { k: view.k, x: view.x, y: view.y };
    // the target offset that puts world point (cx, cy) at the viewport centre
    var to = { k: k, x: -cx * k, y: -cy * k };
    var t0 = Date.now(), dur = 420;
    if (anim) cancelAnimationFrame(anim);
    function frame() {
      var p = Math.min(1, (Date.now() - t0) / dur);
      var e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      view.k = from.k + (to.k - from.k) * e;
      view.x = from.x + (to.x - from.x) * e;
      view.y = from.y + (to.y - from.y) * e;
      draw();
      if (p < 1) anim = requestAnimationFrame(frame);
      else { anim = null; if (done) done(); }
    }
    anim = requestAnimationFrame(frame);
  }
  /** The scale at which a world-space box fills the viewport with a margin. */
  function fitScale(x0, y0, x1, y1, marginPx) {
    var w = Math.max(1e-6, x1 - x0), h = Math.max(1e-6, y1 - y0);
    var m = marginPx || 90;
    return Math.max(0.02, Math.min(3000, Math.min((W - m * 2) / w, (H - m * 2) / h)));
  }

  // ---- interaction: pan, zoom, pick
  var drag = null, moved = false;
  cv.addEventListener("mousedown", function (ev) { drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y }; moved = false; cv.classList.add("dragging"); });
  window.addEventListener("mousemove", function (ev) {
    if (drag) {
      var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      view.x = drag.vx + dx; view.y = drag.vy + dy; draw();
    } else {
      var hit = pick(ev.clientX, ev.clientY);
      if (hit !== hover) { hover = hit; draw(); }
      cv.style.cursor = hit ? "pointer" : "grab";
    }
  });
  window.addEventListener("mouseup", function (ev) {
    cv.classList.remove("dragging");
    if (drag && !moved) {
      var p = pick(ev.clientX, ev.clientY);
      sel = p; show(p); draw();
      // Clicking an EDGE frames the two things it connects. A side panel that NAMES
      // the endpoints answers "what are these" only on paper; framing them answers
      // it in the picture, which is what the reader was reaching for.
      if (p && p.name === undefined) frameEndpoints(p);
    }
    drag = null;
  });
  function frameEndpoints(l) {
    var a = byId[l.source], b = byId[l.target];
    if (!a || !b) return;
    var padX = Math.max(60, Math.abs(a.x - b.x) * 0.18), padY = Math.max(60, Math.abs(a.y - b.y) * 0.18);
    animateTo(
      fitScale(Math.min(a.x, b.x) - padX, Math.min(a.y, b.y) - padY, Math.max(a.x, b.x) + padX, Math.max(a.y, b.y) + padY, 120),
      (a.x + b.x) / 2, (a.y + b.y) / 2,
    );
  }
  /** Double-clicking a node frames it AND its neighbours \u2014 the "zoom in to a single
   *  node" that used to dead-end against the zoom ceiling in a wall of lines. */
  cv.addEventListener("dblclick", function (ev) {
    var p = pick(ev.clientX, ev.clientY);
    if (p && p.name !== undefined) {
      var i = idxOf(p);
      var lo = p, hi = p;
      if (adj && adj[i]) {
        for (var j = 0; j < adj[i].length; j++) {
          var l = L[adj[i][j]];
          var other = byId[l.source] === p ? byId[l.target] : byId[l.source];
          if (!other) continue;
          if (other.x < lo.x) lo = other;
          if (other.x > hi.x) hi = other;
          if (other.y < lo.y) lo = other;
          if (other.y > hi.y) hi = other;
        }
      }
      var pad = 40;
      animateTo(
        fitScale(lo.x - pad, lo.y - pad, hi.x + pad, hi.y + pad, 110),
        (lo.x + hi.x) / 2, (lo.y + hi.y) / 2,
      );
    } else if (p) {
      frameEndpoints(p);
    }
  });
  // The ceiling is 600x rather than 14x, and is only safe BECAUSE a frame now draws
  // what is visible: at 600x that is a handful of primitives instead of five
  // thousand. The old ceiling was the "point where you cannot zoom in anymore" a
  // reader hit, and it hit it while still drawing the entire graph.
  cv.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var f = Math.exp(-ev.deltaY * 0.0016);
    var nk = Math.max(0.02, Math.min(600, view.k * f));
    var mx = ev.clientX - W / 2, my = ev.clientY - H / 2;
    view.x = mx - (mx - view.x) * (nk / view.k);
    view.y = my - (my - view.y) * (nk / view.k);
    view.k = nk; draw();
  }, { passive: false });
  function pick(cx, cy) {
    // only what is on screen is pickable, which also keeps picking O(visible)
    var vis = visible(24);
    var list = vis.n;
    var best = null, bd = 18;
    for (var i = 0; list && i < list.length; i++) {
      var nd = N[list[i]];
      var s = toScreen(nd.x, nd.y), d = Math.hypot(s[0] - cx, s[1] - cy) - radius(nd);
      if (d < bd) { bd = d; best = nd; }
    }
    if (best) return best;
    // edges, tightest first, and only near the cursor \u2014 the old loop tested every
    // edge in the graph on every mousemove
    var el = vis.e, ebest = null, ebd = 7;
    for (var j = 0; el && j < el.length; j++) {
      var l = L[el[j]], a = byId[l.source], b = byId[l.target];
      if (!a || !b) continue;
      var p1 = toScreen(a.x, a.y), p2 = toScreen(b.x, b.y);
      var d2 = distSeg(cx, cy, p1, p2);
      if (d2 < ebd) { ebd = d2; ebest = l; }
    }
    return ebest;
  }
  function distSeg(px, py, a, b) {
    var vx = b[0] - a[0], vy = b[1] - a[1], wx = px - a[0], wy = py - a[1];
    var L2 = vx * vx + vy * vy;
    var t = L2 ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2)) : 0;
    return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
  }

  var det = document.getElementById("detail"), dbody = document.getElementById("dbody");
  document.getElementById("dclose").onclick = function () { det.classList.remove("on"); sel = null; draw(); };
  function show(o) {
    if (!o) { det.classList.remove("on"); return; }
    var isNode = o.name !== undefined;
    var rows = isNode
      ? [["name", o.name], ["type", o.type], ["language", o.group], ["file", o.filePath],
         ["line", o.line != null ? o.line + (o.lineEnd ? "-" + o.lineEnd : "") : "unknown"],
         ["qualified name", o.qualifiedName || "—"], ["gravity", o.gravity != null ? o.gravity : "—"],
         ["stale", o.stale ? "yes — file changed since index" : "no"]]
      : [["from", (byId[o.source] || {}).name || o.source], ["to", (byId[o.target] || {}).name || o.target],
         ["type", o.type], ["confidence", o.confidence != null ? o.confidence : "unknown"],
         ["line", o.line != null ? o.line : "unknown"],
         ["language", o.crossLanguage ? (o.bridge || "crosses a language boundary") : "within one language"],
         ["stored rows", o.occurrences ? (o.occurrences + (o.occurrences === 1 ? " row" : " rows")) : "unknown"],
         ["first row", o.rowId || "—"],
         ["all rows", o.rowIds && o.rowIds.length > 1 ? o.rowIds.length + " carried" : "—"],
         ["stale", o.stale ? "yes" : "no"]];
    dbody.innerHTML = "<h3>" + (isNode ? "Symbol" : "Relationship") + "</h3><dl>" +
      rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>"; }).join("") + "</dl>";
    det.classList.add("on");
  }

  var input = document.getElementById("q"), qstat = document.getElementById("qstat");
  input.addEventListener("input", function () {
    q = input.value; var v = q.toLowerCase();
    var hits = v ? N.filter(function (n) { return (n.name || "").toLowerCase().indexOf(v) >= 0; }).length : 0;
    qstat.textContent = v ? hits + " match" + (hits === 1 ? "" : "es") : "";
    draw();
  });

  // The grid and the adjacency table need settled positions, so they are built
  // once the layout reports done and rebuilt if it is still running when the first
  // frame is painted.
  buildAdjacency();
  function ensureIndexes() { if (!grid) buildGrid(); }
  if (lay && lay.done()) ensureIndexes();
  else if (progressEl) {
    var waited = 0;
    var idxTimer = setInterval(function () {
      waited += 120;
      if (!lay || lay.done()) { ensureIndexes(); clearInterval(idxTimer) }
      else if (waited > 30000) { ensureIndexes(); clearInterval(idxTimer) }
    }, 120);
  }
  window.addEventListener("resize", function () { resize(); draw(); });
  resize(); draw();
  if (N.length === 0) {
    document.getElementById("stats").innerHTML = '<b>0</b><span>nodes</span><b>0</b><span>edges</span>';
  }
})();
</script>
</body>
</html>`
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
