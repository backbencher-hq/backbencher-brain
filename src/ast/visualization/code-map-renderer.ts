/**
 * The CODE MAP view: the codebase as a rectangulation, in the spirit of the
 * Sourcegraph Chromium map.
 *
 * WHAT THIS IS, PRECISELY, because the difference matters:
 *
 * The Sourcegraph map paints every SOURCE LINE, coloured by token kind. This
 * cannot. The index stores symbols with a line span (line_start, line_end) and a
 * kind (symbol_type) -- it stores no tokens and no per-line classification. So
 * this map paints one rectangle per SYMBOL, sized by its line span, laid out in
 * source order inside its file. That is a symbol-level map, and it is described as
 * one everywhere: in the view label, in the legend, in the readout, and in the tool
 * documentation. A view that let a reader believe it was token-level would be worse
 * than no view at all.
 *
 * WHAT IT SHOWS, and why it is worth having:
 *
 *   * the SHAPE of a codebase -- which directories carry the mass, which files are
 *     enormous, and how the mass is split between languages;
 *   * DENSITY -- a file packed with definitions reads differently from one with two
 *     enormous functions, and the gap between symbols is drawn at its true size, so
 *     the difference is visible rather than inferred;
 *   * KIND -- what a file is made of, at a glance: a file of 400 one-line getters
 *     and a file with four 200-line functions look nothing alike here;
 *   * and it is NESTED, so a directory is drawn in proportion to everything under
 *     it, which is the one thing a force-directed graph can never show you.
 *
 * The layout is a squarified treemap (Bruls, Huizing & van Wijk): rectangles keep
 * their aspect ratio close to 1, which is what makes a treemap readable at all --
 * naive slice-and-dice at this many files produces slivers.
 */

/**
 * Backticks inside a renderer part are written as SENTINEL and restored here.
 *
 * A renderer is a template literal in this file, so a literal backtick in the
 * JavaScript would terminate the string carrying it -- which is exactly how a
 * backtick in a COMMENT broke the build twice before the renderer was extracted.
 * Writing it as the sentinel makes that impossible to do by accident.
 *
 * The first attempt at this used a runtime JSON.stringify instead, which held the
 * literal SOURCE TEXT of a quoted string: MEASURED, the generated code map rendered
 * its own body as text, so every element id arrived as backslash-quote and the
 * document had no map element at all. Escaping is the wrong tool; a substitution
 * that cannot be got wrong is the right one.
 */
const BT = "\u0060"
const SENTINEL = "\u00a7"

function bt(text: string): string {
  const n = text.split(SENTINEL).length - 1
  if (n === 0) return text
  return text.split(SENTINEL).join(BT)
}

/** Join parts with a literal newline. Each part is already a complete block. */
function assemble(parts: string[]): string {
  return parts.map(bt).join("\n")
}

export const CODE_MAP_CSS = assemble([
  `  :root{
    --bg:#08080c; --panel:rgba(16,17,26,.86); --edge:rgba(255,255,255,.14);
    --text:#e8eaf0; --muted:#8b90a0; --accent:#5eead4; --warn:#fbbf24;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);
    font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    overflow:hidden}
  #map{position:absolute;inset:0;overflow:hidden;cursor:default}
  .panel{position:absolute;background:var(--panel);border:1px solid var(--edge);
    border-radius:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    box-shadow:0 10px 40px rgba(0,0,0,.55)}
  /* One sidebar, not four floating panels. A screenshot showed the treemap squeezed
     into a third of the width with the HUD, legend, group toggle and search each
     anchored to a different corner -- most of the canvas was chrome. The panels are
     controls and readouts; they belong together, and a tall legend belongs in a
     column rather than in a corner. The map now takes everything to the right of the
     sidebar at full height, with no vertical chrome at all. */
  #side{position:absolute;left:0;top:0;bottom:0;width:322px;padding:16px;
    display:flex;flex-direction:column;gap:12px;overflow:auto;z-index:2}
  #hud{padding:0;flex:none}
  /* position:relative, not the .panel absolute: inside the sidebar these two are
     flow items, and inheriting position:absolute made them stack on top of the
     HUD instead of sitting below it -- a screenshot caught the search box printed
     over the title and the group toggle missing entirely. */
  #group{position:relative;flex:none;padding:10px;display:flex;gap:6px;align-items:center}
  #search{position:relative;flex:none;padding:10px;display:flex;gap:8px;align-items:center}
  #search input{flex:1;width:auto;min-width:0}
  #legend{padding:14px 0 0;border-top:1px solid var(--edge);flex:none}
  .row{display:flex;align-items:center;gap:9px;margin:3px 0;font-size:12px}
  .sw{width:22px;height:11px;border-radius:2px;flex:none}
  #hud h1{margin:0 0 2px;font-size:14px}
  #hud .sub{color:var(--muted);font-size:12px}
  #stats{margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:2px 12px;
    font-variant-numeric:tabular-nums}
  #stats b{font-weight:600}
  #stats span{color:var(--muted)}
  #group button{background:rgba(0,0,0,.35);border:1px solid var(--edge);color:var(--text);
    border-radius:8px;padding:7px 12px;cursor:pointer;font:inherit}
  #group button.on{border-color:var(--accent);color:var(--accent)}
  #group label{color:var(--muted);font-size:12px}
  #legend h2{margin:0 0 8px;font-size:11px;letter-spacing:.09em;color:var(--muted);
    text-transform:uppercase}
  .row{display:flex;align-items:center;gap:9px;margin:3px 0;font-size:12px}
  .sw{width:22px;height:11px;border-radius:2px;flex:none}
  #search input{background:rgba(0,0,0,.35);border:1px solid var(--edge);color:var(--text);
    border-radius:9px;padding:8px 11px;width:220px;outline:none;font:inherit}
  #search input:focus{border-color:var(--accent)}
  /* position:absolute is stated HERE rather than left to the .panel class.
     MEASURED from a screenshot: the detail panel's text printed straight through the
     sidebar's own text, both at once. The class-based rule was being beaten in the
     cascade, so the panel fell back to static positioning and flowed from the top-left
     corner of the body -- directly over the sidebar. The close button, positioned
     absolutely INSIDE it, landed a thousand pixels away, which is the tell.
     A panel that has to win a cascade fight to exist is a panel that will lose one. */
  #detail{position:absolute;right:16px;top:16px;padding:14px 18px;max-width:380px;
    max-height:40vh;overflow:auto;display:none;border:1px solid var(--edge)}
  #detail.on{display:block}
  #detail h3{margin:0 0 6px;font-size:13px}
  #detail dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0;
    font-variant-numeric:tabular-nums}
  #detail dt{color:var(--muted)} #detail dd{margin:0;word-break:break-all}
  #detail .close{position:absolute;top:8px;right:10px;cursor:pointer;color:var(--muted)}
  /* Clear of the sidebar. MEASURED: at left:16px it printed under the sidebar, since
     the sidebar now owns that column outright. */
  #path{position:absolute;left:334px;top:50%;transform:translateY(-50%);
    background:var(--panel);border:1px solid var(--edge);border-radius:10px;
    padding:7px 12px;font-size:12px;color:var(--accent);display:none}
  #path.on{display:block}
  .note{margin-top:10px;padding-top:9px;border-top:1px solid var(--edge);
    color:var(--muted);font-size:11.5px}
  @media (max-width:900px){#side{width:250px}#hud{max-width:218px}}
`,
])

export const CODE_MAP_BODY = assemble([
  `<div id="map"></div>
<div id="side">
  <div id="hud">
    <h1>Code Map</h1>
    <div class="sub">bb_visualize &middot; one rectangle per SYMBOL, sized by its lines</div>
    <div id="stats"></div>
    <div class="note" id="excluded"></div>
  </div>
  <div class="panel" id="group">
    <label>group by</label>
    <button id="g-dir" class="on">directory</button>
    <button id="g-lang">language</button>
  </div>
  <div class="panel" id="search">
    <input id="q" placeholder="Find a file or symbol&hellip;" autocomplete="off" spellcheck="false">
    <span id="qstat" class="sub"></span>
  </div>
  <div id="legend">
    <h2>Symbol kinds</h2>
    <div id="kind-rows"></div>
    <h2 style="margin-top:12px">Reading it</h2>
    <div class="row"><span class="sw" style="background:#1e2130"></span>gap = code between symbols, at true size</div>
    <div class="row"><span class="sw" style="background:#fbbf24"></span>stale since index</div>
    <div class="row"><span class="sw" style="background:transparent;border:1px solid #ffffff"></span>matches the search</div>
  </div>
</div>
<div class="panel" id="detail"><span class="close" id="dclose">&#10005;</span><div id="dbody"></div></div>
<div id="path"></div>
<noscript><p style="padding:24px">This map needs JavaScript. The data is embedded below.</p></noscript>
`,
])

/**
 * The renderer. Written as a sequence of function declarations assembled at run
 * time, with backticks supplied by the BT sentinel so nothing here can terminate
 * the string that carries it.
 */
export const CODE_MAP_SCRIPT = assemble([
  `(function () {
  "use strict";
  var G = JSON.parse(document.getElementById("bb-graph-data").textContent);
  var S = G.symbols || [];
  var map = document.getElementById("map");
  var sel = null, hover = null, q = "", groupBy = "dir", boxes = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  // ---- one stable colour per symbol kind, and per language
  var KIND_COLOURS = {
    function: "#5eead4", method: "#5eead4", constructor: "#5eead4",
    class: "#a78bfa", struct: "#a78bfa", interface: "#c084fc", enum: "#c084fc",
    type: "#c084fc", trait: "#c084fc", module: "#94a3b8", file: "#94a3b8",
    variable: "#fb923c", constant: "#fb923c", field: "#fb923c",
    property: "#fb923c", parameter: "#64748b", local: "#64748b",
    import: "#60a5fa", export: "#60a5fa", reference: "#60a5fa",
    test: "#fbbf24", macro: "#f472b6", unknown: "#475569",
  };
  var LANG_COLOURS = {
    typescript: "#5eead4", javascript: "#5eead4", python: "#fbbf24", rust: "#fb923c",
    go: "#60a5fa", java: "#c084fc", c: "#94a3b8", cpp: "#94a3b8", ruby: "#f472b6",
    lua: "#a78bfa", elixir: "#fb7185", haskell: "#34d399", clojure: "#38bdf8",
    shell: "#64748b", markdown: "#475569", json: "#475569", yaml: "#475569",
    xml: "#475569", toml: "#475569", unknown: "#334155",
  };
  function kindColour(k) { return KIND_COLOURS[k] || KIND_COLOURS.unknown }
  function langColour(l) { return LANG_COLOURS[l] || LANG_COLOURS.unknown }

  // ---- the data, grouped
  //
  // A symbol's WEIGHT is its line span, not its byte count: the index stores no
  // token or byte detail, so lines are the only size it can state honestly.
  function spanOf(sym) {
    var a = sym.line, b = sym.lineEnd != null ? sym.lineEnd : sym.line
    if (a == null) return 0
    return Math.max(1, (b - a + 1))
  }
  function build() {
    var files = {}
    for (var i = 0; i < S.length; i++) {
      var sym = S[i]
      var f = sym.filePath || "unknown"
      var rec = files[f]
      if (!rec) { rec = files[f] = { path: f, lang: sym.language || "unknown", syms: [], lines: 0, maxLine: 0 } }
      var sp = spanOf(sym)
      sym._span = sp
      rec.syms.push(sym)
      rec.lines += sp
      if ((sym.lineEnd || sym.line || 0) > rec.maxLine) rec.maxLine = sym.lineEnd || sym.line || 0
    }
    var out = []
    for (var k in files) out.push(files[k])
    out.sort(function (a, b) { return b.lines - a.lines })
    return out
  }
  // The scope target, so directories can be named relative to what was asked for.
  //
  // The declaration sits ABOVE the assignment on purpose. A var declaration
  // hoists, so a declaration later in the scope would hoist its declaration but
  // run its INITIALISER afterwards -- silently resetting the prefix to empty.
  // MEASURED: the scope-relative grouping did nothing at all and every map came
  // back as a single group named after the top path segment.
  var SCOPE_PREFIX = ""
  if (G.scope === "module" && G.target) {
    // Trailing slashes trimmed WITHOUT a regex: a renderer lives inside a
    // template literal, where the escape \/ collapses to / and silently turns
    // the pattern into an empty one. MEASURED: a module scope produced a file
    // that did not parse at all, and the compile guard is what caught it.
    var mt = String(G.target)
    while (mt.length > 1 && mt.charAt(mt.length - 1) === "/") mt = mt.slice(0, mt.length - 1)
    SCOPE_PREFIX = mt + "/"
  } else if (G.scope === "file" && G.target) {
    // A file scope has no directories of its own, so groups are named against the
    // file's own parent directory \u2014 which is what a reader of one file wants to
    // see around it: its neighbours.
    var ft = String(G.target)
    SCOPE_PREFIX = ft.indexOf("/") > 0 ? ft.slice(0, ft.lastIndexOf("/") + 1) : ""
  }
  var FILES = build();

  // ---- grouping into rectangles
  function groupOf(rec) {
    if (groupBy === "lang") return rec.lang || "unknown"
    var p = rec.path
    // Group RELATIVE TO THE SCOPE, which is what makes the nesting useful.
    //
    // Grouping by the path's top segment produced exactly ONE group for a scoped
    // call -- a scope of src/compiler gave "1 directories", a treemap
    // of one rectangle. A code map is readable only when the nesting is FINE, so
    // the scope target is stripped and the FIRST REMAINING segment is the group.
    if (SCOPE_PREFIX && p.indexOf(SCOPE_PREFIX) === 0) p = p.slice(SCOPE_PREFIX.length)
    var seg = p.split("/")
    return seg.length > 1 ? seg[0] : "(files at the scope root)"
  }
  function groupFiles() {
    var g = {}
    for (var i = 0; i < FILES.length; i++) {
      var key = groupOf(FILES[i])
      if (!g[key]) g[key] = { key: key, files: [], lines: 0, syms: 0 }
      g[key].files.push(FILES[i])
      g[key].lines += FILES[i].lines
      g[key].syms += FILES[i].syms.length
    }
    var out = []
    for (var k in g) out.push(g[k])
    out.sort(function (a, b) { return b.lines - a.lines })
    return out
  }

  // ---- squarified treemap (Bruls, Huizing & van Wijk, 2000)
  //
  // The algorithm that makes a treemap readable: lay out along the SHORTER side of
  // the remaining area, and only start a new row when adding the next item would
  // make a row's aspect ratio worse than the best it already has. Slice-and-dice at
  // this many files produces slivers you cannot hover or read.
  function squarify(items, x, y, w, h, out) {
    var total = 0
    for (var i = 0; i < items.length; i++) total += items[i].lines
    // The placed rectangles ARE the return value. This filled out and returned
    // undefined on the early exit, so the caller read placed.length on undefined
    // and the whole view died before drawing anything.
    if (total <= 0 || w <= 0 || h <= 0) return out
    var scale = (w * h) / total
    var idx = 0
    while (idx < items.length) {
      var row = [], rowArea = 0, best = Infinity
      var side = Math.min(w, h)
      var i = idx
      while (i < items.length) {
        var nextArea = rowArea + items[i].lines * scale
        var ratio = worst(row, nextArea, side, scale)
        if (row.length === 0 || ratio <= best) {
          best = ratio; row.push(items[i]); rowArea = nextArea; i++
        } else break
      }
      // Place the row along the SHORTER side of what is left, all items sharing one
      // THICKNESS, which is the row's area divided by that shorter side.
      //
      // MEASURED, and the bug was a single confused axis. The row advanced its
      // offset along x while each item was given a height of frac*h -- so items in
      // one row were laid out SIDE BY SIDE but given INDIVIDUAL heights that all
      // started at the same y. They overlapped each other, the row's total width was
      // thickness*n, and rectangles ran past the right and bottom edges of the map.
      // On cargo's src/compiler every one of the 6 directory groups overlapped: the
      // worst pair covered 85,032px^2, and 2 of the 6 escaped the box entirely.
      //
      // The fix is that a row's items STACK along the short axis and share the
      // thickness, so each item varies only along the axis the offset advances. The
      // thickness divides by the short side because that is the axis the row spans;
      // dividing by the long side instead under-fills the box by a near-constant
      // fraction -- MEASURED 16-26% across every case in viz-13 -- because a row then
      // covers less area than it is owed.
      //
      // viz-13 asserts the two properties a treemap must have, so this cannot come
      // back silently: every pair of rectangles disjoint, and the areas summing to
      // the box.
      var thickness = rowArea / side
      var offset = 0
      for (var j = 0; j < row.length; j++) {
        var frac = row[j].lines * scale / (rowArea || 1)
        if (w >= h) {
          out.push({ item: row[j], x: x, y: y + offset, w: thickness, h: frac * h })
          offset += frac * h
        } else {
          out.push({ item: row[j], x: x + offset, y: y, w: frac * w, h: thickness })
          offset += frac * w
        }
      }
      if (w >= h) { x += thickness; w -= thickness } else { y += thickness; h -= thickness }
      idx = i
    }
    return out
  }
  function worst(row, rowArea, side, scale) {
    if (row.length === 0 || rowArea <= 0) return Infinity
    var worstRatio = 0
    for (var i = 0; i < row.length; i++) {
      var a = row[i].lines * scale
      var r = Math.max((side * side * a) / (rowArea * rowArea), (rowArea * rowArea) / (side * side * a))
      if (r > worstRatio) worstRatio = r
    }
    return worstRatio
  }

  // ---- render
  function draw() {
    boxes = []
    var W = map.clientWidth, H = map.clientHeight
    map.innerHTML = ""
    if (!W || !H) return
    // Lay out inside the space the floating panels leave. A screenshot showed the
    // HUD and the legend sitting ON TOP of the treemap, covering its top-left and
    // bottom-left corners -- so a quarter of the map was unreachable. The panels are
    // opaque and viewport-anchored; the map is the thing that should yield.
    // Everything to the right of the sidebar, full height. No vertical chrome, so
    // nothing can cover the map and the treemap is not inset around floating boxes.
    var sideEl = document.getElementById("side")
    var sideW = sideEl ? sideEl.offsetWidth : 0
    var inset = { x: sideW + 12, y: 12, w: W - sideW - 24, h: H - 24 }
    if (inset.w < 120 || inset.h < 120) inset = { x: 12, y: 12, w: Math.max(120, W - 24), h: Math.max(120, H - 24) }
    var groups = groupFiles()
    var placed = squarify(groups, inset.x, inset.y, inset.w, inset.h, [])
    var needle = q.toLowerCase()
    var hits = 0, totalSyms = 0, totalLines = 0, fileCount = 0
    var frag = document.createDocumentFragment()
    // The vertical strips already claimed by a drawn group label, as [top, bottom].
    // Two labels collide only if their groups share a strip, so this is checked per
    // strip rather than against a single high-water mark.
    var labelBands = []

    for (var gi = 0; gi < placed.length; gi++) {
      var gcell = placed[gi]
      if (gcell.w < 1 || gcell.h < 1) continue
      var g = document.createElement("div")
      g.style.cssText = "position:absolute;left:" + gcell.x + "px;top:" + gcell.y + "px;width:" +
        Math.max(0, gcell.w - 2) + "px;height:" + Math.max(0, gcell.h - 2) +
        "px;border:1px solid rgba(255,255,255,.10);border-radius:4px;overflow:hidden"
      g.dataset.group = gcell.item.key
      // A label is drawn when the group has room, unless a label has already been drawn in
      // the SAME vertical strip. MEASURED: a screenshot showed "fingerprint 5.4k
      // lines" and "build_runner 2.9k lines" printed on top of one another — both
      // groups are wide and short, so both qualified on size alone. Overlapping labels
      // are worse than one: neither is readable and the map looks broken.
      //
      // The test is per STRIP, not global. Keying it on the group's own y alone
      // suppressed every label below the first, because groups in later rows all sit
      // lower than the last one labelled — MEASURED, that left 2 of 6 groups named.
      // A label can only collide with another label that is at the same height, so the
      // occupied bands are tracked as [top, bottom] spans and a new label is allowed
      // whenever it clears all of them.
      var headerRoom = gcell.h > 26 && gcell.w > 70
      var clash = false
      for (var li = 0; li < labelBands.length; li++) {
        if (gcell.y < labelBands[li][1] && gcell.y + 20 > labelBands[li][0]) { clash = true; break }
      }
      if (headerRoom && !clash) {
        labelBands.push([gcell.y, gcell.y + 20])
        var gh = document.createElement("div")
        gh.style.cssText = "position:absolute;left:0;top:0;right:0;padding:3px 7px;font-size:10.5px;" +
          "color:rgba(255,255,255,.72);background:rgba(0,0,0,.42);pointer-events:none;" +
          "white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
        gh.textContent = gcell.item.key + "  " + fmt(gcell.item.lines) + " line" + (gcell.item.lines === 1 ? "" : "s")
        g.appendChild(gh)
      }
      var inner = []
      squarify(gcell.item.files, 0, headerRoom ? 20 : 0, gcell.w, Math.max(1, gcell.h - (headerRoom ? 20 : 0)), inner)
      for (var fi = 0; fi < inner.length; fi++) {
        var fcell = inner[fi]
        // A file is ALWAYS drawn, however small. MEASURED: a screenshot showed large
        // black holes punched through the middle of groups, and the cause was the
        // skip that used to sit here -- a file whose treemap cell came out under
        // 0.4px was left undrawn entirely, so the group's own background showed
        // through as if that region of the codebase were empty. It is not empty; it is
        // a file, and the map already counts it in its totals. A sub-pixel file is
        // drawn at the smallest size that renders, so the area is accounted for on
        // screen as well as in the arithmetic.
        var f = fcell.item
        fileCount++
        totalLines += f.lines
        totalSyms += f.syms.length
        var fd = document.createElement("div")
        fd.style.cssText = "position:absolute;left:" + fcell.x + "px;top:" + fcell.y +
          "px;width:" + Math.max(1, fcell.w) + "px;height:" + Math.max(1, fcell.h) +
          "px;overflow:hidden;cursor:pointer"
        fd.dataset.file = f.path
        // the file's own symbols, as bands in SOURCE ORDER, height = line span.
        // The gaps between them are drawn at their true size, which is the point:
        // a file of many small definitions and a file of a few enormous ones look
        // nothing alike here, and that difference is not visible any other way.
        var cursor = 0
        var syms = f.syms.slice().sort(function (p, r) { return (p.line || 0) - (r.line || 0) })
        var total = f.lines || 1
        for (var si = 0; si < syms.length; si++) {
          var sym = syms[si]
          var lead = (sym.line || 0) - 1 - cursor
          if (lead > 0) { pushBand(fd, fcell, lead / total, cursor / total, null, f) }
          var isSel = sel && sel.kind === "sym" && sel.id === sym.id
          var isHov = hover && hover.kind === "sym" && hover.id === sym.id
          var band = document.createElement("div")
          band.style.cssText = "position:absolute;left:0;top:" + (100 * cursor / total) + "%;width:100%;height:" +
            Math.max(0.35, 100 * sym._span / total) + "%;background:" +
            (sym.stale ? "#fbbf24" : kindColour(sym.type)) + ";"
          fd.appendChild(band)
          boxes.push({ kind: "sym", id: sym.id, el: band, sym: sym, file: f })
          if (needle) {
            var nm = (sym.name || "").toLowerCase()
            if (nm.indexOf(needle) >= 0 || f.path.toLowerCase().indexOf(needle) >= 0) {
              hits++
              band.style.outline = "1px solid #ffffff"
              band.style.outlineOffset = "-1px"
            }
          }
          cursor += sym._span
          if (isSel || isHov) band.style.outline = "2px solid #ffffff"
        }
        g.appendChild(fd)
      }
      frag.appendChild(g)
    }
    map.appendChild(frag)
    var pathEl = document.getElementById("path")
    if (sel && sel.kind === "file") { pathEl.className = "on"; pathEl.textContent = sel.path } else pathEl.className = ""
    readouts(totalSyms, totalLines, fileCount, hits, groups.length)
  }
  function pushBand(fd, fcell, hFrac, yFrac, colour, f) {
    var b = document.createElement("div")
    b.style.cssText = "position:absolute;left:0;top:" + (100 * yFrac) + "%;width:100%;height:" +
      (100 * hFrac) + "%;background:#1e2130"
    fd.appendChild(b)
    boxes.push({ kind: "gap", el: b, file: f })
  }
  function fmt(n) { return n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(n) }

  function readouts(syms, lines, files, hits, groups) {
    var kinds = {}
    for (var i = 0; i < S.length; i++) kinds[S[i].type || "unknown"] = (kinds[S[i].type || "unknown"] || 0) + 1
    var rows = []
    for (var k in kinds) rows.push([k, kinds[k]])
    rows.sort(function (a, b) { return b[1] - a[1] })
    document.getElementById("kind-rows").innerHTML = rows.map(function (r) {
      return '<div class="row"><span class="sw" style="background:' + kindColour(r[0]) + '"></span>' +
        esc(r[0]) + ' <span class="sub" style="color:var(--muted)">' + r[1] + "</span></div>"
    }).join("")
    var unit = groupBy === "lang" ? "language" : "director" + (groups === 1 ? "y" : "ies")
    document.getElementById("stats").innerHTML =
      '<b>' + files + '</b><span>file' + (files === 1 ? "" : "s") + "</span>" +
      '<b>' + groups + '</b><span>' + unit + "</span>" +
      '<b>' + syms + '</b><span>symbol' + (syms === 1 ? "" : "s") + "</span>" +
      '<b>' + fmt(lines) + '</b><span>lines spanned</span>'
    var ex = document.getElementById("excluded")
    ex.textContent = G.excluded && G.excluded.symbols
      ? G.excluded.symbols + " symbol(s) excluded as noise before this map — it is not the whole project"
      : "nothing excluded — this map covers every indexed symbol in scope"
    document.getElementById("qstat").textContent = q ? hits + " match" + (hits === 1 ? "" : "es") : ""
  }

  // ---- interaction: hover, click, drill in
  function boxAt(cx, cy) {
    for (var i = boxes.length - 1; i >= 0; i--) {
      var b = boxes[i]
      var r = b.el.getBoundingClientRect()
      if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) return b
    }
    return null
  }
  var pathEl = document.getElementById("path")
  document.addEventListener("mousemove", function (ev) {
    var b = boxAt(ev.clientX, ev.clientY)
    if (b === hover) return
    if (hover && hover.el) hover.el.style.cursor = ""
    hover = b
    if (b) { b.el.style.cursor = "pointer"; show(b) }
  })
  document.addEventListener("click", function (ev) {
    var b = boxAt(ev.clientX, ev.clientY)
    if (!b) { sel = null; hide(); draw(); return }
    if (b.kind === "sym") { sel = { kind: "sym", id: b.sym.id }; show(b) }
    else { sel = { kind: "file", path: b.file.path }; show(b) }
    draw()
  })
  document.getElementById("dclose").onclick = function () { hide(); sel = null; draw() }
  function hide() { document.getElementById("detail").className = "" }
  function show(b) {
    var det = document.getElementById("detail"), body = document.getElementById("dbody")
    if (!b) { det.className = ""; return }
    var rows
    if (b.kind === "sym") {
      var s = b.sym
      rows = [["name", s.name], ["kind", s.type], ["language", s.language],
              ["file", s.filePath], ["lines", (s.line || "?") + (s.lineEnd ? "-" + s.lineEnd : "")],
              ["lines spanned", s._span], ["qualified name", s.qualifiedName || "—"],
              ["gravity", s.gravity != null ? s.gravity : "—"],
              ["stale", s.stale ? "yes — file changed since index" : "no"]]
    } else {
      rows = [["file", b.file.path], ["language", b.file.lang], ["symbols", b.file.syms.length],
              ["lines spanned", b.file.lines], ["last line", b.file.maxLine]]
    }
    body.innerHTML = "<h3>" + (b.kind === "sym" ? "Symbol" : "File") + "</h3><dl>" +
      rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>" }).join("") + "</dl>"
    det.className = "on"
  }

  document.getElementById("g-dir").onclick = function () { setGroup("dir") }
  document.getElementById("g-lang").onclick = function () { setGroup("lang") }
  function setGroup(g) {
    groupBy = g
    document.getElementById("g-dir").className = g === "dir" ? "on" : ""
    document.getElementById("g-lang").className = g === "lang" ? "on" : ""
    sel = null; hide(); draw()
  }
  var input = document.getElementById("q")
  input.addEventListener("input", function () { q = input.value; draw() })
  window.addEventListener("resize", draw)
  draw()
})();
`,
])

/** Compile-check, so a malformed renderer fails at generate time. */
export function assertCodeMapParses(): void {
  try {
    // eslint-disable-next-line no-new-func
    new Function(CODE_MAP_SCRIPT)
  } catch (e) {
    throw new Error("bb_visualize: the code-map renderer failed to compile (" + String(e) + ")")
  }
}

export function renderCodeMapDocument(o: {
  symbols: any[]
  excluded?: unknown
  scope: string
  target: string | null
  totalNodesAvailable: number
  shownNodes: number
}): string {
  assertCodeMapParses()
  const payload = JSON.stringify({
    symbols: o.symbols,
    excluded: o.excluded ?? null,
    scope: o.scope,
    target: o.target,
    totalNodesAvailable: o.totalNodesAvailable,
    shownNodes: o.shownNodes,
  }).replace(/</g, "\\u003c")
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Backbencher Code Map</title>",
    "<style>",
    CODE_MAP_CSS,
    "</style>",
    "</head>",
    "<body>",
    CODE_MAP_BODY,
    '<script id="bb-graph-data" type="application/json">',
    payload,
    "</" + "script>",
    "<script>",
    CODE_MAP_SCRIPT,
    "</" + "script>",
    "</body>",
    "</html>",
  ].join("\n")
}
