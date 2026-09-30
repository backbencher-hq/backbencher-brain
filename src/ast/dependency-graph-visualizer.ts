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
   * Generates a fully self-contained HTML file utilizing 3d-force-graph
   * to visualize the polyglot architecture in 3D.
   */
  export function generateHTML(graphData: GraphData): string {
    log.info("🎨 Rendering Interactive 3D HTML Visualization...")

    const jsonStr = JSON.stringify(graphData)

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Backbencher Architecture Map</title>
  <style>
    :root {
      --bg: #09090e;
      --glass: rgba(15, 15, 25, 0.65);
      --glass-border: rgba(255, 255, 255, 0.1);
      --accent: #00ffcc;
    }
    body { margin: 0; padding: 0; overflow: hidden; background-color: var(--bg); font-family: 'Inter', system-ui, sans-serif; color: #fff; }
    #3d-graph { width: 100vw; height: 100vh; position: absolute; top: 0; left: 0; z-index: 1; }
    
    .glass-panel {
      position: absolute;
      z-index: 10;
      background: var(--glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    }

    #ui-panel { top: 20px; left: 20px; max-width: 320px; max-height: 90vh; overflow-y: auto; pointer-events: auto; }
    #search-panel { top: 20px; right: 20px; pointer-events: auto; display: flex; gap: 8px; }

    h1 { margin: 0 0 5px 0; font-size: 20px; color: var(--accent); letter-spacing: -0.5px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    .subtitle { font-size: 12px; color: #8892b0; margin-bottom: 20px; font-weight: 500; text-transform: uppercase; letter-spacing: 1px; }
    
    .section-title { font-weight: 600; font-size: 11px; margin: 15px 0 10px 0; color: #fff; text-transform: uppercase; letter-spacing: 1px; }
    
    .legend-item { display: flex; align-items: center; margin-bottom: 8px; font-size: 13px; color: #d0d6e0; transition: opacity 0.2s; cursor: pointer; }
    .legend-item:hover { opacity: 0.8; }
    .legend-color { width: 14px; height: 14px; border-radius: 4px; margin-right: 10px; box-shadow: 0 0 8px rgba(255,255,255,0.2); }
    
    .controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }
    button { 
      background: rgba(0, 255, 204, 0.1); color: var(--accent); border: 1px solid rgba(0, 255, 204, 0.3); 
      padding: 8px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 600; transition: all 0.2s;
    }
    button:hover { background: rgba(0, 255, 204, 0.2); transform: translateY(-1px); }
    
    input {
      background: rgba(0,0,0,0.4); border: 1px solid var(--glass-border); color: #fff;
      padding: 8px 12px; border-radius: 6px; outline: none; font-family: inherit; font-size: 13px; width: 200px;
    }
    input:focus { border-color: var(--accent); }

    /* Custom Tooltip Styling */
    .scene-tooltip {
      background: var(--glass) !important;
      backdrop-filter: blur(8px) !important;
      border: 1px solid var(--glass-border) !important;
      border-radius: 8px !important;
      padding: 12px !important;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
      color: #fff !important;
      font-family: 'Inter', sans-serif !important;
    }
    .tt-title { font-weight: bold; font-size: 14px; color: var(--accent); margin-bottom: 4px; }
    .tt-type { font-size: 11px; color: #ffcc00; text-transform: uppercase; margin-bottom: 8px; }
    .tt-path { font-size: 11px; color: #8892b0; font-family: monospace; word-break: break-all; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 10px; }
  </style>
  <script src="https://unpkg.com/3d-force-graph"></script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div id="3d-graph"></div>
  
  <div id="ui-panel" class="glass-panel">
    <h1><span style="font-size: 24px">🪐</span> Architecture Map</h1>
    <div class="subtitle">Polyglot Architecture</div>
    
    <div class="section-title">Languages (Nodes)</div>
    <div id="language-legend"></div>
    
    <div class="section-title">Relationships (Edges)</div>
    <div id="relationship-legend">
      <label class="legend-item"><input type="checkbox" checked value="api_call" class="rel-filter" style="width: auto; margin-right: 8px;"><div class="legend-color" style="background: #ff3366;"></div> API Calls</label>
      <label class="legend-item"><input type="checkbox" checked value="service_dependency" class="rel-filter" style="width: auto; margin-right: 8px;"><div class="legend-color" style="background: #33ccff;"></div> Dependencies</label>
      <label class="legend-item"><input type="checkbox" checked value="database_access" class="rel-filter" style="width: auto; margin-right: 8px;"><div class="legend-color" style="background: #ffcc00;"></div> Database</label>
      <label class="legend-item"><input type="checkbox" checked value="data_transfer" class="rel-filter" style="width: auto; margin-right: 8px;"><div class="legend-color" style="background: #00ffcc;"></div> Data Flow</label>
      <label class="legend-item"><input type="checkbox" checked value="other" class="rel-filter" style="width: auto; margin-right: 8px;"><div class="legend-color" style="background: #aaaaaa;"></div> Other</label>
    </div>
    
    <div class="controls">
      <button onclick="Graph.d3Force('charge').strength(-200)">Relax Map</button>
      <button onclick="Graph.zoomToFit(1000)">Zoom Fit</button>
    </div>
  </div>

  <div id="search-panel" class="glass-panel">
    <input type="text" id="node-search" placeholder="Search components, APIs..." onkeypress="handleSearch(event)">
    <button onclick="executeSearch()">Find</button>
  </div>

  <script>
    const gData = ${jsonStr};
    
    // Auto-generate Language Legend
    const languages = new Set();
    gData.nodes.forEach(n => languages.add(n.group));
    const legendDiv = document.getElementById('language-legend');
    
    const stringToColor = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
      let color = '#';
      for (let i = 0; i < 3; i++) {
        const value = (hash >> (i * 8)) & 0xFF;
        color += ('00' + value.toString(16)).substr(-2);
      }
      return color;
    };

    const getLangColor = (lang) => {
      if(lang === 'typescript') return '#3178c6';
      if(lang === 'python') return '#ffcc00';
      if(lang === 'go') return '#00add8';
      if(lang === 'rust') return '#dea584';
      if(lang === 'java') return '#b07219';
      return stringToColor(lang);
    };

    languages.forEach(lang => {
      const color = getLangColor(lang);
      const div = document.createElement('div');
      div.className = 'legend-item';
      div.innerHTML = \`<div class="legend-color" style="background: \${color};"></div> <span style="text-transform: capitalize">\${lang}</span>\`;
      legendDiv.appendChild(div);
    });

    let activeLinkTypes = new Set(['api_call', 'service_dependency', 'database_access', 'data_transfer', 'other']);

    const Graph = ForceGraph3D()
      (document.getElementById('3d-graph'))
        .graphData(gData)
        .nodeLabel(node => \`
          <div class="tt-title">\${node.name}</div>
          <div class="tt-type">[\${node.group}] \${node.type.replace('_', ' ')}</div>
          <div class="tt-path">📁 \${node.filePath}</div>
        \`)
        .nodeColor(node => getLangColor(node.group))
        .nodeVal('val')
        .nodeOpacity(1)
        .nodeResolution(3)
        .linkColor('color')
        .linkWidth(0.2)
        .linkVisibility(link => {
           const t = link.type;
           if (['api_call', 'service_dependency', 'database_access', 'data_transfer'].includes(t)) {
             return activeLinkTypes.has(t);
           }
           return activeLinkTypes.has('other');
        })
        .linkDirectionalParticles(0)
        .linkDirectionalArrowLength(0)
        .warmupTicks(0)
        .cooldownTime(15000)
        .enableNodeDrag(false)
        .onNodeClick(node => flyToNode(node));

    // Increase repel force for better readability
    Graph.d3Force('charge').strength(-120);

    function flyToNode(node) {
      const distance = 80;
      const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);
      Graph.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio }, // new position
        node, // lookAt ({ x, y, z })
        2000  // ms transition duration
      );
    }

    // Edge filtering logic
    document.querySelectorAll('.rel-filter').forEach(cb => {
      cb.addEventListener('change', (e) => {
        if (e.target.checked) {
          activeLinkTypes.add(e.target.value);
        } else {
          activeLinkTypes.delete(e.target.value);
        }
        // Trigger graph update
        Graph.linkVisibility(Graph.linkVisibility());
      });
    });

    // Search logic
    function handleSearch(e) {
      if (e.key === 'Enter') executeSearch();
    }
    
    function executeSearch() {
      const q = document.getElementById('node-search').value.toLowerCase();
      if (!q) return;
      
      const nodes = Graph.graphData().nodes;
      // Try exact match first
      let target = nodes.find(n => n.name.toLowerCase() === q);
      // Then partial match
      if (!target) target = nodes.find(n => n.name.toLowerCase().includes(q) || n.filePath.toLowerCase().includes(q));
      
      if (target) {
        flyToNode(target);
      } else {
        alert('Symbol not found in graph.');
      }
    }
  </script>
</body>
</html>`
  }

  // --- INTERNAL UTILS ---
  function getRelationshipColor(type: string): string {
    switch (type) {
      case "api_call":
        return "#ff3366" // bright red/pink
      case "service_dependency":
        return "#33ccff" // bright blue
      case "database_access":
        return "#ffcc00" // yellow
      case "message_queue":
        return "#cc33ff" // purple
      case "data_transfer":
        return "#00ffcc" // teal
      case "ffi_binding":
      case "native_interop":
        return "#ff6600" // orange
      default:
        return "#aaaaaa" // grey
    }
  }
}
