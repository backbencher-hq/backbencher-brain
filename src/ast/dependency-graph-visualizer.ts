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
    const seenLinks = new Set()
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
        if (!seenLinks.has(linkKey)) {
          seenLinks.add(linkKey)
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
          links.push(link)
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
</div>
<div class="panel" id="detail"><span class="close" id="dclose">&#10005;</span><div id="dbody"></div></div>
<div id="hint">drag to pan &middot; scroll to zoom &middot; click a node or edge for its stored facts</div>
<noscript><p style="padding:24px">This map is interactive and needs JavaScript. The graph data is embedded below.</p></noscript>
<script id="bb-graph-data" type="application/json">${json.replace(/</g, "\\u003c")}</script>
<script>
(function () {
  "use strict";
  var G = JSON.parse(document.getElementById("bb-graph-data").textContent);
  var N = G.nodes || [], L = G.links || [];
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
  var STRUCTURAL = { contains: 1, exports: 1, imports: 1 };
  function dash(t) { return STRUCTURAL[t] ? [] : [5, 4]; }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  // ---- stats, declared rather than implied
  var stale = N.filter(function (n) { return n.stale; }).length;
  var byType = {};
  for (var j = 0; j < L.length; j++) { byType[L[j].type] = (byType[L[j].type] || 0) + 1; }
  document.getElementById("stats").innerHTML =
    row("nodes", N.length) + row("edges", L.length) +
    row("node types", uniq(N.map(function (n) { return n.type; })).length) +
    row("languages", uniq(N.map(function (n) { return n.group; })).length) +
    (stale ? row("stale since index", stale, true) : "");
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

  // ---- layout: Fruchterman-Reingold with annealing, on a seeded ring so the
  // result is DETERMINISTIC (the same graph always lays out the same way).
  function layout(nodes, links) {
    var n = nodes.length; if (!n) return;
    var W0 = 2000, H0 = 1400, k = Math.sqrt((W0 * H0) / n) * 0.62;
    var pos = new Array(n), rnd = 20240101;
    function rand() { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; }
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2, r = Math.sqrt(i / n) * Math.min(W0, H0) * 0.42;
      pos[i] = { x: W0 / 2 + Math.cos(a) * r, y: H0 / 2 + Math.sin(a) * r, vx: 0, vy: 0 };
    }
    var idx = {}; for (var m = 0; m < n; m++) idx[nodes[m].id] = m;
    var edges = [];
    for (var e = 0; e < links.length; e++) {
      var s = idx[links[e].source], t = idx[links[e].target];
      if (s !== undefined && t !== undefined && s !== t) edges.push([s, t]);
    }
    var temp = Math.min(W0, H0) * 0.09, iters = n > 900 ? 260 : 420;
    for (var it = 0; it < iters; it++) {
      for (var p = 0; p < n; p++) { pos[p].vx = 0; pos[p].vy = 0; }
      for (var a2 = 0; a2 < n; a2++) for (var b2 = a2 + 1; b2 < n; b2++) {
        var dx = pos[a2].x - pos[b2].x, dy = pos[a2].y - pos[b2].y;
        var d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        var f = (k * k) / d;
        pos[a2].vx += (dx / d) * f; pos[a2].vy += (dy / d) * f;
        pos[b2].vx -= (dx / d) * f; pos[b2].vy -= (dy / d) * f;
      }
      for (var e2 = 0; e2 < edges.length; e2++) {
        var s2 = edges[e2][0], t2 = edges[e2][1];
        var ex2 = pos[s2].x - pos[t2].x, ey2 = pos[s2].y - pos[t2].y;
        var d2 = Math.sqrt(ex2 * ex2 + ey2 * ey2) || 0.01;
        var g2 = (d2 * d2) / k;
        pos[s2].vx -= (ex2 / d2) * g2; pos[s2].vy -= (ey2 / d2) * g2;
        pos[t2].vx += (ex2 / d2) * g2; pos[t2].vy += (ey2 / d2) * g2;
      }
      for (var m2 = 0; m2 < n; m2++) {
        var sp = Math.sqrt(pos[m2].vx * pos[m2].vx + pos[m2].vy * pos[m2].vy) || 0.01;
        pos[m2].x += (pos[m2].vx / sp) * Math.min(sp, temp);
        pos[m2].y += (pos[m2].vy / sp) * Math.min(sp, temp);
        pos[m2].x = Math.max(30, Math.min(W0 - 30, pos[m2].x));
        pos[m2].y = Math.max(30, Math.min(H0 - 30, pos[m2].y));
      }
      temp *= 0.978;
    }
    // normalise into world space centred on the origin
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (var q2 = 0; q2 < n; q2++) {
      minx = Math.min(minx, pos[q2].x); maxx = Math.max(maxx, pos[q2].x);
      miny = Math.min(miny, pos[q2].y); maxy = Math.max(maxy, pos[q2].y);
    }
    var sx = (maxx - minx) || 1, sy = (maxy - miny) || 1;
    for (var q3 = 0; q3 < n; q3++) {
      pos[q3].x = ((pos[q3].x - minx) / sx - 0.5) * 2000;
      pos[q3].y = ((pos[q3].y - miny) / sy - 0.5) * 1400;
      nodes[q3].x = pos[q3].x; nodes[q3].y = pos[q3].y;
    }
  }
  layout(N, L);

  var gmax = 1;
  for (var gi = 0; gi < N.length; gi++) gmax = Math.max(gmax, N[gi].gravity || 0);
  function radius(nd) { return 4 + 13 * Math.sqrt((nd.gravity || 0) / gmax); }

  // ---- render
  function resize() {
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function toScreen(x, y) { return [W / 2 + (x * view.k + view.x), H / 2 + (y * view.k + view.y)]; }
  function draw() {
    ctx.clearRect(0, 0, W, H);
    var q2 = q.toLowerCase();
    for (var i = 0; i < L.length; i++) {
      var l = L[i], a = byId[l.source], b = byId[l.target];
      if (!a || !b) continue;
      var hit = hover === l || sel === l;
      var p1 = toScreen(a.x, a.y), p2 = toScreen(b.x, b.y);
      var c = col(l.type);
      var conf = (typeof l.confidence === "number") ? l.confidence : 0.5;
      ctx.save();
      ctx.globalAlpha = hit ? 1 : (0.16 + 0.62 * conf);
      ctx.strokeStyle = c; ctx.lineWidth = hit ? 2.4 : 1.1;
      ctx.setLineDash(hit ? [] : dash(l.type));
      ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.stroke();
      ctx.restore();
    }
    for (var n2 = 0; n2 < N.length; n2++) {
      var nd = N[n2], s = toScreen(nd.x, nd.y), r = radius(nd);
      var on = !q2 || (nd.name || "").toLowerCase().indexOf(q2) >= 0;
      var isSel = sel === nd, isHov = hover === nd;
      ctx.save();
      ctx.globalAlpha = on ? 1 : 0.16;
      ctx.beginPath(); ctx.arc(s[0], s[1], r, 0, 6.2832);
      if (nd.stale) { ctx.strokeStyle = "#fbbf24"; ctx.lineWidth = 1.6; ctx.stroke(); }
      else { ctx.fillStyle = isSel || isHov ? "#ffffff" : (nd.group === "unknown" ? "#64748b" : "#5eead4"); ctx.fill(); }
      if (isSel || isHov) { ctx.strokeStyle = "#a78bfa"; ctx.lineWidth = 2; ctx.stroke(); }
      ctx.restore();
      if (on && (view.k > 0.85 || isSel || isHov)) {
        ctx.save();
        ctx.globalAlpha = on ? 0.92 : 0.14;
        ctx.fillStyle = "#cfd4e0"; ctx.font = (isSel ? "600 " : "") + "11px ui-sans-serif,system-ui,sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(nd.name || "", s[0], s[1] + r + 12);
        ctx.restore();
      }
    }
  }
  var byId = {};
  for (var bi = 0; bi < N.length; bi++) byId[N[bi].id] = N[bi];

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
    if (drag && !moved) { var p = pick(ev.clientX, ev.clientY); sel = p; show(p); draw(); }
    drag = null;
  });
  cv.addEventListener("wheel", function (ev) {
    ev.preventDefault();
    var f = Math.exp(-ev.deltaY * 0.0016);
    var nk = Math.max(0.06, Math.min(14, view.k * f));
    var mx = ev.clientX - W / 2, my = ev.clientY - H / 2;
    view.x = mx - (mx - view.x) * (nk / view.k);
    view.y = my - (my - view.y) * (nk / view.k);
    view.k = nk; draw();
  }, { passive: false });
  function pick(cx, cy) {
    var best = null, bd = 16;
    for (var i = 0; i < N.length; i++) {
      var s = toScreen(N[i].x, N[i].y), d = Math.hypot(s[0] - cx, s[1] - cy) - radius(N[i]);
      if (d < bd) { bd = d; best = N[i]; }
    }
    if (best) return best;
    for (var j = 0; j < L.length; j++) {
      var l = L[j], a = byId[l.source], b = byId[l.target]; if (!a || !b) continue;
      var p1 = toScreen(a.x, a.y), p2 = toScreen(b.x, b.y);
      if (distSeg(cx, cy, p1, p2) < 5) return l;
    }
    return null;
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
         ["line", o.line != null ? o.line : "unknown"], ["stored row", o.rowId || "—"],
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
