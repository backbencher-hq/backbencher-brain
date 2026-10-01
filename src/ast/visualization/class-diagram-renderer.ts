/**
 * The CLASS view: a UML-shaped class diagram drawn from what the index stores.
 *
 * WHAT UML MEANS HERE, precisely. A class diagram has three parts: TYPES (boxes),
 * INHERITANCE (extends / implements, drawn hollow), and CONTAINMENT (contains,
 * drawn solid). This draws all three from stored symbol kinds and stored
 * relationship types, and nothing else. It does not infer fields, attributes,
 * method signatures, cardinalities or multiplicities -- the index does not store
 * them, and a diagram that invents them is a lie with a legend attached.
 *
 * AND IT SAYS WHAT IT COULD NOT SHOW. A class diagram is the most seductive of the
 * views to draw partially: a diagram of 30 classes that silently omits the 40 it
 * could not resolve looks like a complete model of a small system rather than a
 * fragment of a large one. So the diagram states the count of types it found, the
 * count it drew, and the count of relationships that leave the frame -- because on a
 * real project most `extends` and `implements` targets are NOT among the selected
 * nodes, and that number is the honest measure of how much is off-screen.
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

export const CLASS_CSS = assemble([
  `  :root{
    --bg:#08080c; --panel:rgba(16,17,26,.86); --edge:rgba(255,255,255,.14);
    --text:#e8eaf0; --muted:#8b90a0; --accent:#5eead4; --warn:#fbbf24;
  }
  *{box-sizing:border-box}
  html,body{margin:0;height:100%;background:var(--bg);color:var(--text);
    font:13px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow:hidden}
  #stage{position:absolute;inset:0}
  svg{position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab}
  svg.dragging{cursor:grabbing}
  .panel{position:absolute;background:var(--panel);border:1px solid var(--edge);
    border-radius:14px;backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);
    box-shadow:0 10px 40px rgba(0,0,0,.55)}
  #hud{top:16px;left:16px;padding:16px 18px;max-width:360px}
  #hud h1{margin:0 0 2px;font-size:14px}
  #hud .sub{color:var(--muted);font-size:12px}
  #stats{margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:2px 12px;
    font-variant-numeric:tabular-nums}
  #stats b{font-weight:600}
  #stats span{color:var(--muted)}
  #warn{color:var(--warn);margin-top:9px;font-size:12px}
  .cls{position:absolute;background:#12141f;border:1.4px solid #a78bfa;border-radius:8px;
    overflow:hidden;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.5)}
  .cls.sel{border-color:#ffffff;box-shadow:0 0 0 2px rgba(255,255,255,.35)}
  .cls.dim{opacity:.25}
  .cls .hd{background:rgba(167,139,250,.20);padding:3px 7px;font-size:11px;font-weight:600;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid rgba(167,139,250,.35)}
  .cls .sub2{padding:2px 7px;font-size:10px;color:var(--muted);white-space:nowrap;
    overflow:hidden;text-overflow:ellipsis}
  /* The member compartment \u2014 the part that makes this a class diagram rather than a
     bag of names. Separated by a rule, because in UML this is a distinct compartment
     and the reader needs to see that the type name and its members are different
     kinds of thing. */
  .cls .mem{border-top:1px solid rgba(167,139,250,.20);margin-top:3px;padding:3px 0 1px}
  .cls .mrow{display:flex;align-items:center;gap:6px;padding:0 7px;height:15px;
    font-size:10px;color:#cbd5f5;white-space:nowrap;overflow:hidden}
  .cls .mrow .mk{color:var(--muted);flex:none;width:12px;text-align:center;font-size:9px}
  .cls .mrow .mn{overflow:hidden;text-overflow:ellipsis;min-width:0}
  .cls .mrow .ms{margin-left:auto;color:#fbbf24;font-size:8.5px;flex:none}
  .cls .mrow.more{color:var(--muted);font-style:italic}
  #legend{left:16px;bottom:16px;padding:14px 18px;max-width:360px;max-height:50vh;overflow:auto}
  #legend h2{margin:0 0 8px;font-size:11px;letter-spacing:.09em;color:var(--muted);text-transform:uppercase}
  .row{display:flex;align-items:center;gap:9px;margin:3px 0;font-size:12px}
  .row .mg{color:var(--muted);flex:none;width:14px;text-align:center;font-size:10px}
  /* Overrides the readable-scale floor, so the reader can ask for the whole shape when
     that is the question, without paying for it by default. */
  #fitall{margin:0 0 8px;background:rgba(255,255,255,.06);border:1px solid var(--edge);
    color:var(--text);border-radius:7px;padding:4px 10px;font:inherit;font-size:11.5px;cursor:pointer}
  #fitall:hover{border-color:var(--accent);color:var(--accent)}
  /* The relationships as text. A connector is only useful if you can follow it, and
     hundreds of dashed lines across the canvas cannot be followed. This is the same
     data the connectors are drawn from, so it cannot disagree with the picture, and it
     is findable with Ctrl-F. */
  #rel-list{margin:0;max-height:30vh;overflow:auto;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
    font-size:10.5px;line-height:1.5;color:var(--muted);white-space:pre-wrap;word-break:break-word;
    background:rgba(0,0,0,.30);border:1px solid var(--edge);border-radius:7px;padding:7px 8px}
  .ln{width:30px;height:0;border-top-width:2px;flex:none}
  #hint{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);
    color:var(--muted);font-size:11.5px;background:var(--panel);border:1px solid var(--edge);
    border-radius:999px;padding:6px 14px;max-width:40vw;white-space:nowrap;overflow:hidden;
    text-overflow:ellipsis}
  body.detail-open #hint{opacity:0;pointer-events:none}
  @media (max-width:820px){#legend{display:none}#hud{max-width:60vw}}
`,
])

export const CLASS_BODY = assemble([
  `<div id="stage">
  <svg id="c"><defs>
    <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8"/>
    </marker>
    <marker id="ah-hollow" viewBox="0 0 14 14" refX="13" refY="7" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
      <path d="M13,0 L13,14 L0,7 z" fill="#08080c" stroke="#94a3b8" stroke-width="1.6"/>
    </marker>
  </defs><g id="edges"></g></svg>
</div>
<div class="panel" id="hud">
  <h1>Class Diagram</h1>
  <div class="sub">bb_visualize &middot; types and relationships the index actually stores</div>
  <div id="stats"></div>
  <div id="warn"></div>
</div>
<div class="panel" id="legend">
  <h2>Relationships</h2>
  <button id="fitall" class="fitbtn">fit all</button>
  <div id="rel-rows"></div>
  <h2 style="margin-top:12px">In each box</h2>
  <div class="row"><span class="mg">()</span><span>method</span></div>
  <div class="row"><span class="mg">::</span><span>field or property</span></div>
  <div class="row"><span class="mg">=</span><span>enum member</span></div>
  <div class="row" style="color:var(--muted)">from the index's own containment links; at most six per box</div>
  <h2 style="margin-top:12px">Relationships, as text</h2>
  <pre id="rel-list"></pre>
  <h2 style="margin-top:12px">What this does NOT show</h2>
  <div class="row" style="color:var(--muted)">parameter types and return types</div>
  <div class="row" style="color:var(--muted)">cardinalities or multiplicities</div>
  <div class="row" style="color:var(--muted)">anything the index does not store</div>
</div>
<button id="savebtn" class="fitbtn" style="position:absolute;right:14px;top:14px;z-index:4">save as&hellip;</button>
<div class="panel" id="detail"><span class="close" id="dclose">&#10005;</span><div id="dbody"></div></div>
<div id="hint">drag to pan &middot; scroll to zoom &middot; click a type to focus its relationships</div>
<noscript><p style="padding:24px">This diagram needs JavaScript. The data is embedded below.</p></noscript>
`,
])

export const CLASS_SCRIPT = assemble([
  `(function () {
  "use strict";
  var G = JSON.parse(document.getElementById("bb-graph-data").textContent);
  var C = G.classes || [], E = G.edges || [];
  // The member list a box shows, and the glyph beside each one. Declared at the TOP,
  // before layout() -- see the note on MEMBERS below for why that position is load
  // bearing rather than stylistic.
  var MEMBERS = 6;
  function memberMark(type) {
    if (type === "method" || type === "function") return "()"
    if (type === "property" || type === "field" || type === "attribute") return "::"
    if (type === "enum_member" || type === "variant") return "="
    return "-"
  }
  var svg = document.getElementById("c"), gE = document.getElementById("edges");
  var W = 0, H = 0, view = { x: 0, y: 0, k: 1 }, sel = null, hover = null;
  var byId = {};
  for (var i = 0; i < C.length; i++) byId[C[i].id] = C[i];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  // The ancestry path of a box, used to order a depth so a child sits near its parent.
  //
  // The stored relationships give each type at most one parent here: the first
  // extends/implements edge found, and failing that the first contains edge.
  //
  // Both, because MEASURED with inheritance alone the connectors stayed long: on cargo's
  // src/compiler the median connector was 720px and the 90th percentile 1,567px in a
  // 1,296px viewport -- 203 of the 304 are 'contains' between types, and those
  // connect arbitrary pairs, so an ancestry that only follows inheritance left them
  // stretched across the canvas. Following containment as well puts a struct next to
  // the struct that holds it, which is also how a reader expects composition to look.
  //
  // Memoised, because a 400-box hierarchy asks for 400 paths.
  var _keyMemo = {}
  function ancestryKey(id, guard) {
    if (_keyMemo[id] !== undefined) return _keyMemo[id]
    if (guard[id]) return String((byId[id] || {}).name || id)
    guard[id] = 1
    var parent = null
    for (var e = 0; e < E.length && !parent; e++) {
      if (E[e].target === id && (E[e].type === "extends" || E[e].type === "implements")) parent = E[e].source
    }
    for (var e2 = 0; e2 < E.length && !parent; e2++) {
      if (E[e2].type === "contains" && E[e2].target === id) parent = E[e2].source
    }
    var me = byId[id]
    var out = parent ? ancestryKey(parent, guard) + "/" : ""
    out += String((me || {}).name || id)
    _keyMemo[id] = out
    return out
  }

  // ---- layout: a real UML-ish arrangement, not a force soup.
  //
  // Boxes are placed on a grid ordered by hierarchy depth, because that is what
  // makes inheritance READABLE: subclasses sit below their base, so "these four
  // extend this one" is a visual fact rather than something to trace. A force layout
  // would put the same information in the same place, less legibly.
  function depthOf(id, seen) {
    var d = 0, cur = id, guard = 0
    while (guard++ < 24) {
      var up = null
      for (var i = 0; i < E.length; i++) {
        var e = E[i]
        if ((e.type === "extends" || e.type === "implements") && e.target === cur) { up = e.source; break }
      }
      if (!up || seen[up]) break
      seen[up] = 1; cur = up; d++
    }
    return d
  }
  function layout() {
    var n = C.length
    for (var i = 0; i < n; i++) {
      var c = C[i]
      c._depth = depthOf(c.id, {})
      var span = (c.lineEnd || c.line || 0) - (c.line || 0) + 1
      // Box area follows the type's gravity, mildly, and its height follows its line
      // span \u2014 so a 400-line class is visibly bigger than a 3-line enum.
      c._w = Math.max(150, Math.min(280, 150 + Math.sqrt(Math.max(1, span)) * 7))
      // A UML box is a compartmented thing: the type's name above, its fields and
      // methods below. MEASURED: cargo's src/compiler stores 834 'contains'
      // relationships from types to properties and methods, which the previous
      // version counted as "969 undrawn inheritance relationships" and drew nothing.
      // Those links ARE the members, and they are already in the payload, so the
      // boxes now list them and the diagram finally shows what a class contains.
      c._members = (G.membersByClass && G.membersByClass[c.id]) || []
      c._shown = Math.min(c._members.length, MEMBERS)
      c._h = 34 + c._shown * 15 + (c._members.length > c._shown ? 14 : 0)
    }
    // Rows are separated by the tallest box in the row, so boxes do not overlap once
    // they have grown to fit their members. The old fixed 190 left a 6-member box
    // hanging into the row below.
    var rowGap = function (row) {
      var tallest = 0
      for (var z = 0; z < row.length; z++) if (row[z]._h > tallest) tallest = row[z]._h
      return tallest + 46
    }
    var rows = {}
    for (var j = 0; j < n; j++) {
      var d = C[j]._depth
      if (!rows[d]) rows[d] = []
      rows[d].push(C[j])
    }
    var depths = []
    for (var k in rows) depths.push(Number(k))
    depths.sort(function (p, q) { return p - q })
    var COL = 30
    // Rows WRAP, and stack by their own height rather than a fixed pitch.
    //
    // MEASURED from a screenshot of cargo's src/compiler: 135 types in one depth were
    // laid out as a single row about 27,000 world units wide. Fitting the view to that
    // row shrank it to scale 0.07 -- the whole diagram became a one-pixel ribbon, and
    // the earlier version that did NOT fit simply ran 130 of the 135 boxes off both
    // edges of the screen. Neither is a diagram; both come from treating a depth level
    // as an infinite line.
    //
    // So each depth is a wrapped grid, and the running y is
    // an ACCUMULATOR over the lines rather than a lookup keyed by depth. Keying it by
    // depth was the earlier bug: with depths 0 and 2 and no row 1, the offset for depth
    // 2 was never written, y became 40 + undefined, and the browser rejected those SVG
    // connectors with a path attribute naming NaN. Depth gaps are normal in a real
    // hierarchy, so that was not a corner case either.
    //
    // PER_LINE is per DEPTH, so it is computed inside the loop from that depth's own
    // count. Reading it from the enclosing scope -- which is where it sat first --
    // meant dereferencing a row that does not exist yet, and every box vanished.
    var y = 40
    for (var r = 0; r < depths.length; r++) {
      var row = rows[depths[r]]
      var PER_LINE = columnsFor(row.length)
      row.sort(function (p, q) { return (q.gravity || 0) - (p.gravity || 0) })
      // THEN re-sort by ancestry, so a child sits under its parent.
      //
      // MEASURED from a screenshot: with the boxes ordered only by gravity, an
      // implements edge ran the FULL width of the canvas between a parent and a child
      // hundreds of cells apart, and 100 of them turned the diagram into spaghetti.
      // The relationship was real and drawn; it was simply unreadable.
      //
      // A depth is ordered by the ANCESTRY PATH of each box -- the concatenated names
      // of its parents, then its own -- which puts siblings next to each other and a
      // child within a few columns of its parent. Gravity becomes the tie-break, so
      // the busiest types still lead. The result is that connectors are short and
      // mostly vertical, which is what makes a hierarchy read as one.
      // A fresh cycle guard per box. Passing "" here is what the first version did, and
      // writing guard[id] = 1 on a string throws, which took the whole layout down with
      // a message about a property that looked nothing like the bug.
      for (var oi = 0; oi < row.length; oi++) row[oi]._key = ancestryKey(row[oi].id, {})
      row.sort(function (p, q) {
        if (p._key < q._key) return -1
        if (p._key > q._key) return 1
        return (q.gravity || 0) - (p.gravity || 0)
      })
      var widest = 0
      for (var m = 0; m < row.length; m++) if (row[m]._w > widest) widest = row[m]._w
      var lineW = PER_LINE * widest + (PER_LINE - 1) * COL
      var lineH = 0
      for (var li = 0; li * PER_LINE < row.length; li++) {
        var slice = row.slice(li * PER_LINE, (li + 1) * PER_LINE)
        var sliceW = slice.length * widest + (slice.length - 1) * COL
        var x = -sliceW / 2
        for (var t = 0; t < slice.length; t++) {
          slice[t].x = x; slice[t].y = y
          x += slice[t]._w + COL
          if (slice[t]._h > lineH) lineH = slice[t]._h
        }
        y += lineH + 30
      }
      y += 16
    }
  }

  // The grid shape is derived from the VIEWPORT, so layout has to wait until the
  // viewport is measured -- and has to be re-runnable when that changes.
  //
  // MEASURED, and this is what made the diagram unnavigable: a fixed five boxes per
  // line turned cargo's 600 project-scope types into 120 lines, roughly 27,000 world
  // units tall against 1,400 wide. Fitting that put the scale at 0.04, so boxes were
  // a few pixels each and zooming drifted into the empty space below them. A
  // 120-line column is not a diagram, it is a list with extra steps.
  //
  // The column count now comes from the box count and the viewport's aspect, so the
  // grid comes out roughly as wide as the space it is drawn in and fits at a
  // readable scale. sqrt is the right shape because it is what balances a grid's two
  // dimensions; the 1.35 biases toward fewer, wider columns, because a class name
  // needs more room than a line of code does.
  function columnsFor(n) {
    var aspect = (W > 0 && H > 0) ? (W / Math.max(1, H)) : 1.5
    return Math.max(3, Math.min(28, Math.round(Math.sqrt(Math.max(1, n) * aspect * 1.35))))
  }

  function toScreen(x, y) { return [W / 2 + (x * view.k + view.x), H / 2 + (y * view.k + view.y)] }

  function render() {
    gE.innerHTML = ""
    for (var i = 0; i < E.length; i++) {
      var e = E[i]
      var a = byId[e.source], b = byId[e.target]
      if (!a || !b) continue
      var p1 = toScreen(a.x + a._w / 2, a.y + a._h)
      var p2 = toScreen(b.x + b._w / 2, b.y)
      var inherit = e.type === "extends" || e.type === "implements"
      var focused = !sel || e.source === sel || e.target === sel
      var line = document.createElementNS("http://www.w3.org/2000/svg", "path")
      // A real UML connector: a vertical drop, a horizontal run, and a vertical
      // rise. A straight diagonal between arbitrary box centres is the thing that
      // makes hand-rolled class diagrams unreadable.
      var midY = (p1[1] + p2[1]) / 2
      line.setAttribute("d", "M" + p1[0] + "," + p1[1] + " L" + p1[0] + "," + midY +
        " L" + p2[0] + "," + midY + " L" + p2[0] + "," + p2[1])
      line.setAttribute("fill", "none")
      line.setAttribute("stroke", inherit ? "#94a3b8" : "#5eead4")
      line.setAttribute("stroke-width", String((e.occurrences || 1) > 3 ? 2.2 : 1.3))
      line.setAttribute("stroke-dasharray", inherit ? "" : "5 4")
      line.setAttribute("opacity", focused ? 0.85 : 0.06)
      line.setAttribute("marker-end", inherit ? "url(#ah-hollow)" : "url(#ah)")
      gE.appendChild(line)
    }
    var stage = document.getElementById("stage")
    var existing = stage.querySelectorAll(".cls")
    for (var c = 0; c < existing.length; c++) existing[c].remove()
    for (var j = 0; j < C.length; j++) {
      var cls = C[j]
      var s2 = toScreen(cls.x, cls.y)
      var d = document.createElement("div")
      d.className = "cls" + (sel === cls.id ? " sel" : sel ? " dim" : "")
      d.style.left = s2[0] + "px"
      d.style.top = s2[1] + "px"
      d.style.width = (cls._w * view.k) + "px"
      d.style.height = (cls._h * view.k) + "px"
      var focusedCls = !sel || cls.id === sel || adjacentTo(cls.id)
      d.style.opacity = focusedCls ? 1 : 0.22
      // The member compartment. Rendered only when the box is big enough on screen to
      // read it, because a 6px row of clipped text is noise, and the member count is
      // in the box's tooltip either way.
      var showMembers = cls._shown > 0 && cls._h * view.k >= cls._shown * 15 + 40
      var mem = ""
      if (showMembers) {
        mem = '<div class="mem">'
        for (var mi = 0; mi < cls._shown; mi++) {
          var m2 = cls._members[mi]
          mem += '<div class="mrow">' +
            '<span class="mk mk-' + esc(String(m2.type)) + '">' + esc(memberMark(String(m2.type))) + '</span>' +
            '<span class="mn">' + esc(m2.name) + '</span>' +
            (m2.stale ? '<span class="ms">stale</span>' : '') +
            "</div>"
        }
        var hidden = cls._members.length - cls._shown
        if (hidden > 0) mem += '<div class="mrow more">+' + hidden + " more stored</div>"
        mem += "</div>"
      }
      d.innerHTML = '<div class="hd" style="font-size:' + (11 * Math.max(0.7, Math.min(1.6, view.k))) + 'px">' +
        esc(cls.name) + '</div><div class="sub2">' + esc(cls.type) +
        (cls.filePath ? " \u00b7 " + esc(cls.filePath.split("/").pop()) : "") + "</div>" + mem
      d.title = cls.name + " \\u2014 " + cls._members.length + " stored member(s)" +
        (hiddenCount(cls) > 0 ? ", showing " + cls._shown : "")
      d.onclick = function () { sel = (sel === cls.id ? null : cls.id); show(cls); render() }
      stage.appendChild(d)
    }
  }
  // How many members a box shows, and the glyph beside each entry, are declared at the
  // top of this IIFE, above layout(). Six members fits the row pitch without boxes
  // colliding, and a longer list is summarised honestly rather than silently truncated.
  function hiddenCount(cls) { return cls._members.length - cls._shown }
  function adjacentTo(id) {
    for (var i = 0; i < E.length; i++) if (E[i].source === id || E[i].target === id) return true
    return false
  }

  var counts = {}
  for (var i = 0; i < E.length; i++) counts[E[i].type] = (counts[E[i].type] || 0) + 1
  var rels = []
  for (var k in counts) rels.push([k, counts[k]])
  rels.sort(function (p, q) { return q[1] - p[1] })
  document.getElementById("rel-rows").innerHTML = rels.map(function (r) {
    var inherit = r[0] === "extends" || r[0] === "implements"
    return '<div class="row"><span class="ln" style="border-top-color:' + (inherit ? "#94a3b8" : "#5eead4") +
      ';border-top-style:' + (inherit ? "solid" : "dashed") + '"></span>' + esc(r[0]) +
      ' <span class="sub" style="color:var(--muted)">' + r[1] + "</span></div>"
  }).join("") || '<div class="row" style="color:var(--muted)">no relationships in scope</div>'

  document.getElementById("stats").innerHTML =
    '<b>' + C.length + '</b><span>types drawn</span>' +
    '<b>' + E.length + '</b><span>relationships drawn</span>' +
    '<b>' + (G.totalNodesAvailable != null ? G.totalNodesAvailable : "?") + '</b><span>symbols in scope</span>'
  // The honest part, stated where it cannot be missed -- and stated as the TWO
  // different things it is, because one number for both was measured to be false.
  //
  // The single count used to read "N inheritance or containment relationships point
  // at types outside this scope". On cargo's src/compiler that read 969 when the
  // index holds exactly 2 'implements' relationships there: the rest was 'contains'
  // pointing at properties and methods, which are a class's fields. A reader would
  // have concluded the index had no class hierarchy, when the truth is the reverse.
  var w = document.getElementById("warn")
  var parts = []
  if (G.outside) {
    parts.push("<b>" + G.outside + "</b> relationship" + (G.outside === 1 ? "" : "s") +
      " between a type here and a type this scope did not select, so it is not drawn. " +
      "Widen the scope to include it.")
  }
  if (G.members) {
    parts.push("Each box lists its own stored fields, methods and enum members, taken from the " +
      "index's containment links rather than inferred. A box shows at most " + MEMBERS +
      " of them; the rest are summarised as &ldquo;+N more stored&rdquo;.")
  }
  // The legibility ceiling, stated where the count is.
  //
  // MEASURED: drawing every one of cargo's src/compiler types produced 1,400 boxes and
  // 361 connectors. The connectors were real -- that was the previous bug -- but a
  // thousand boxes is a hairball with names in it, not something anyone reads. So the
  // boxes are capped and the cap is declared here rather than applied silently: a
  // reader who sees "215 types not drawn" can go and ask for them, and a reader who
  // does not see it cannot.
  if (G.boxesOmitted) {
    parts.push("<b>" + G.boxesOmitted + "</b> further type" + (G.boxesOmitted === 1 ? "" : "s") +
      " in this scope " + (G.boxesOmitted === 1 ? "was" : "were") + " not drawn: past this many boxes " +
      "the connectors stop being traceable and it is a hairball rather than a diagram. " +
      "The ones drawn are the highest-gravity ones.")
  }
  // The orphans, declared. A type with no relationship to another type has nothing to
  // draw, and 870 of them is what turned this into a hairball -- but they are real
  // symbols in scope, so saying nothing about them would be a lie of omission.
  if (G.isolatedOmitted) {
    parts.push("<b>" + G.isolatedOmitted + "</b> type" + (G.isolatedOmitted === 1 ? "" : "s") +
      " in this scope " + (G.isolatedOmitted === 1 ? "has" : "have") +
      " no stored relationship to any other type, so " + (G.isolatedOmitted === 1 ? "it is" : "they are") +
      " not drawn as boxes: a box with nothing attached to it is not part of a hierarchy. " +
      "They are still in the JSON answer and in the scope.")
  }
  if (parts.length) {
    w.innerHTML = parts.join(" ")
  } else if (!E.length) {
    w.textContent = "No inheritance or containment relationships among these types. The boxes are real; the connectors are missing because the index stores none."
  } else {
    w.textContent = "Every inheritance and containment relationship among these types is drawn. Signatures and cardinalities are not stored and are not invented."
  }

  // ---- the relationships, as text.
  //
  // A connector is only useful if you can follow it. At any zoom where a box is
  // readable, 361 dashed lines across the canvas are not followable -- so the panel
  // also lists them, which is searchable with Ctrl-F and readable when the picture is
  // not. The list is the same data the connectors are drawn from, so it cannot drift
  // from the picture.
  var relText = []
  for (var ri = 0; ri < E.length; ri++) {
    var re = E[ri]
    var ra = byId[re.source], rb = byId[re.target]
    if (!ra || !rb) continue
    relText.push(re.type + ": " + ra.name + " -> " + rb.name)
  }
  document.getElementById("rel-list").textContent =
    relText.length ? relText.slice(0, 400).join("\\n") +
      (relText.length > 400 ? "\\n... and " + (relText.length - 400) + " more" : "")
      : "none stored"

  // ---- pan / zoom / select
  var drag = null, moved = false
  svg.addEventListener("mousedown", function (ev) { drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y }; moved = false; svg.classList.add("dragging") })
  window.addEventListener("mousemove", function (ev) {
    if (!drag) return
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true
    view.x = drag.vx + dx; view.y = drag.vy + dy; render()
  })
  window.addEventListener("mouseup", function () { drag = null; svg.classList.remove("dragging") })
  svg.addEventListener("wheel", function (ev) {
    ev.preventDefault()
    var f = Math.exp(-ev.deltaY * 0.0016)
    var nk = Math.max(0.05, Math.min(60, view.k * f))
    var mx = ev.clientX - W / 2, my = ev.clientY - H / 2
    view.x = mx - (mx - view.x) * (nk / view.k)
    view.y = my - (my - view.y) * (nk / view.k)
    view.k = nk; render()
  }, { passive: false })
  document.getElementById("savebtn").onclick = function () {
    try {
      var blob = new Blob(["<!DOCTYPE html>\\n" + document.documentElement.outerHTML], { type: "text/html" })
      var url = URL.createObjectURL(blob)
      var a = document.createElement("a")
      a.href = url
      a.download = "bb-class-diagram.html"
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(function () { URL.revokeObjectURL(url) }, 4000)
    } catch (e) {
      var w2 = document.getElementById("warn")
      if (w2) w2.textContent = "could not save: " + String(e).slice(0, 90)
    }
  }
  document.getElementById("dclose").onclick = function () {
    document.getElementById("detail").className = ""
    document.body.classList.remove("detail-open")
    sel = null; render()
  }
  function show(cls) {
    var det = document.getElementById("detail")
    if (!cls) { det.className = ""; return }
    var rel = []
    for (var i = 0; i < E.length; i++) {
      var e = E[i]
      if (e.source === cls.id) rel.push(["extends/is \u2192", (byId[e.target] || {}).name, e.type])
      if (e.target === cls.id) rel.push(["\u2190 extended by", (byId[e.source] || {}).name, e.type])
    }
    var rows = [["name", cls.name], ["kind", cls.type], ["language", cls.language],
                ["file", cls.filePath], ["lines", (cls.line || "?") + (cls.lineEnd ? "-" + cls.lineEnd : "")],
                ["gravity", cls.gravity != null ? cls.gravity : "\u2014"]]
    document.getElementById("dbody").innerHTML = "<h3>Type</h3><dl>" +
      rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>" }).join("") +
      (rel.length ? "</dl><h3 style='margin-top:10px'>Relationships (" + rel.length + ")</h3><dl>" +
        rel.slice(0, 40).map(function (r) {
          return "<dt>" + esc(r[2]) + "</dt><dd>" + esc(r[0] + " " + r[1]) + "</dd>"
        }).join("") + "</dl>" : "</dl>")
    det.className = "on"
    document.body.classList.add("detail-open")
  }

  function resize() {
    var nw = svg.clientWidth, nh = svg.clientHeight
    // Re-lay out only when the SIZE changed. A resize event that does not change the
    // viewport must not move a reader's boxes under them.
    var changed = nw !== W || nh !== H
    W = nw; H = nh
    if (changed && W > 0 && H > 0) layout()
    render()
  }
  window.addEventListener("resize", resize)
  // Frame the whole diagram before the first paint.
  //
  // MEASURED from a screenshot: the diagram opened with its single row of 135 boxes
  // running off both edges and two thirds of the viewport empty above them, because the
  // view started at scale 1 and the row is about 27,000 world units wide. A diagram a
  // reader has to pan to discover is not showing itself.
  //
  // Fit is applied ONCE, on load. Re-fitting on every resize would yank the picture
  // back to the overview every time the window changed, undoing whatever the reader had
  // zoomed to.
  function fitAll(force) {
    if (!C.length) return
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (var i = 0; i < C.length; i++) {
      var c = C[i]
      if (c.x < x0) x0 = c.x
      if (c.x + c._w > x1) x1 = c.x + c._w
      if (c.y < y0) y0 = c.y
      if (c.y + c._h > y1) y1 = c.y + c._h
    }
    // A readable FLOOR under the fit.
    //
    // MEASURED: cargo's src/compiler has 135 types, and fitting all of them shrinks the
    // boxes to a few pixels -- an overview nobody can read, which is not an overview of
    // anything. So the load-time fit is clamped: below this scale the diagram opens
    // showing a legible portion of itself and the reader pans, which is a smaller ask
    // than being handed 135 illegible boxes. "Fit all" overrides the floor, because
    // sometimes the shape of the whole IS the question.
    var MIN_READABLE = 0.55
    var k = Math.min((W - 80) / Math.max(1, x1 - x0), (H - 80) / Math.max(1, y1 - y0))
    k = Math.max(0.02, Math.min(1, k))
    if (!force && k < MIN_READABLE) k = MIN_READABLE
    view.k = k
    // Centre on the whole diagram when it fits, and align the TOP of it when it
    // does not: centring a much taller world shows the middle of the grid, which
    // hides the highest-gravity types the ordering just put first.
    //
    // The top alignment is expressed against the viewport centre, because toScreen
    // adds H/2: setting the offset to -y0*k leaves the first row just BELOW the middle
    // (a screenshot showed two thirds of the viewport empty above the diagram), where
    // the top of the world needs to land at 40px from the top instead.
    view.x = -(x0 + x1) / 2 * k
    view.y = (force || k > MIN_READABLE) ? -(y0 + y1) / 2 * k : 40 - H / 2 - y0 * k
  }
  function bindFit() {
    var b = document.getElementById("fitall")
    if (b) b.onclick = function () { fitAll(true) }
  }
  resize()
  bindFit()
  fitAll(false)
  render()
})();
`,
])

export function assertClassDiagramParses(): void {
  try {
    // eslint-disable-next-line no-new-func
    new Function(CLASS_SCRIPT)
  } catch (e) {
    throw new Error("bb_visualize: the class-diagram renderer failed to compile (" + String(e) + ")")
  }
}

function escJson(value: unknown): string {
  return JSON.stringify(value ?? null).replace(/</g, "\\u003c")
}

export function renderClassDocument(o: {
  classes: any[]
  edges: any[]
  /** Relationships to a type this scope did not select -- widening the scope would draw them. */
  outside: number
  /** Relationships to a selected FIELD, method or enum member, not to another type. */
  members: number
  /** Per-type member lists, taken from the stored `contains` links. */
  membersByClass: Record<string, { name: string; type: string; stale?: boolean }[]>
  /** Types the legibility ceiling left undrawn. Declared, never applied quietly. */
  boxesOmitted: number
  /** Types in scope with no stored type-to-type relationship at all. */
  isolatedOmitted: number
  totalNodesAvailable: number
  excluded?: unknown
  scope: string
  target: string | null
}): string {
  assertClassDiagramParses()
  const payload = JSON.stringify({
    classes: o.classes,
    edges: o.edges,
    outside: o.outside,
    members: o.members,
    boxesOmitted: o.boxesOmitted,
    isolatedOmitted: o.isolatedOmitted,
    membersByClass: o.membersByClass,
    totalNodesAvailable: o.totalNodesAvailable,
    excluded: o.excluded ?? null,
    scope: o.scope,
    target: o.target,
  }).replace(/</g, "\\u003c")
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Backbencher Class Diagram</title>",
    "<style>",
    CLASS_CSS,
    "</style>",
    "</head>",
    "<body>",
    CLASS_BODY,
    '<script id="bb-graph-data" type="application/json">',
    payload,
    "</" + "script>",
    "<script>",
    CLASS_SCRIPT,
    "</" + "script>",
    "</body>",
    "</html>",
  ].join("\n")
}

export { escJson }
