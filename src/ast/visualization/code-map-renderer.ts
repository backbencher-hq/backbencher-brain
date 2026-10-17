/**
 * The CODE MAP view: the codebase as a rectangulation, in the spirit of the
 * Sourcegraph Chromium map.
 *
 * WHAT THIS IS, PRECISELY, because the difference matters:
 *
 * The Sourcegraph map paints every SOURCE LINE, coloured by token kind. This
 * cannot. The index stores symbols with a line span (line_start, line_end) and a
 * kind (symbol_type) -- it stores no tokens and no per-line classification, and the
 * projection this view receives carries no byte offsets either (brain_symbol HAS
 * byte_start/byte_end, populated; the visualization query never selects them). So
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
 *
 * The document is deliberately CHROME-FREE, like the graph's: it draws the map, the search,
 * the readout that changes, and the box that answers what you picked. The census, the symbol
 * kinds, the filter chips, the layout choice and the download controls live in the one
 * sidebar of the composed viewer, because a view that paints its own copy of them buries the
 * drawing under a second set of controls. What the sidebar renders is published on
 * `window.__bbView`, and the counting it renders is the same code that used to write it here.
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
  /* The map owns the WHOLE frame and clips its own overflow.
     MEASURED, in order: the document used to draw its own sidebar down the left, so the
     map started at left:322px; and before that it used inset:0 against a TRANSLUCENT
     sidebar, which let the world show through the legend while the reader panned. The
     sidebar now belongs to the composed viewer, so the document is the picture and
     nothing else -- there is no column here to avoid, and no panel to read through. */
  #map{position:absolute;inset:0;overflow:hidden;cursor:default}
  /* The world is a fixed 2400x1600 coordinate space placed inside the viewport with
     a transform. Zooming moves the transform rather than re-laying out, so a wheel
     event is one composited write instead of 2,111 layout updates -- which is what
     makes zooming feel like zooming instead of like a pause. */
  #world{position:absolute;left:0;top:0;width:2400px;height:1600px;will-change:transform}
  #map.panning{cursor:grabbing}
  /* A file's name, sized in WORLD units so it grows with the zoom. 13px here is
     deliberate: the map opens at FIT_SCALE 0.82, so this lands at 10.7px at rest and
     33px when fully zoomed in. Sized in screen pixels instead, MEASURED, the names
     opened at 9px -- illegible -- and the group labels ballooned to 26px the moment
     the reader zoomed, because the two were on different scales. */
  .fname{position:absolute;font-size:13px;line-height:17px;color:#eef2ff;pointer-events:auto;
    cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px;
    background:linear-gradient(90deg,rgba(6,8,16,.92),rgba(6,8,16,.66));
    border-left:2px solid rgba(94,234,212,.75);text-shadow:0 1px 2px rgba(0,0,0,.9)}
  .fname:hover{background:rgba(94,234,212,.22);color:#fff}
  /* A SYMBOL's name carries the same bar as a file's, with a white rule instead of the accent
     one: the picture can now name the STRIPE it draws (see chooseLabels), and a reader has to
     be able to tell a cell's name from a stripe's at a glance. */
  .fname.sym-name{border-left-color:rgba(255,255,255,.5);
    background:linear-gradient(90deg,rgba(6,8,16,.95),rgba(6,8,16,.78))}
  /* Everything that floats over the map is ONE kind of thing, and there are four of
     them: where you look (the search), what just happened (the zoom readout), the
     first-run hint, and what you picked (the detail box).

     The census, the symbol kinds, the filter chips, the layout choice and the save
     control are NOT here. They belong to the one sidebar of the composed viewer, and
     this document no longer draws them: the review of the graph view was explicit that
     the drawing should be the screen and everything else one column beside it, and a
     view that keeps a second copy of those panels in a corner of the picture is
     exactly the defect that pass removed. What is left is the picture, the search, the
     readout that changes, and the box that answers what you picked. */
  .ov{position:absolute;z-index:3;background:var(--panel);border:1px solid var(--edge);
    border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5)}
  #search{right:14px;top:14px;z-index:4;padding:8px 10px;display:flex;gap:8px;align-items:center}
  #search input{background:rgba(0,0,0,.35);border:1px solid var(--edge);color:var(--text);
    border-radius:9px;padding:8px 11px;width:220px;outline:none;font:inherit}
  #search input:focus{border-color:var(--accent)}
  #qstat{color:var(--muted);font-size:11.5px;min-width:52px}
  /* The readout is a pill at the bottom centre and it is OPAQUE: a translucent panel
     let the map read through it, which looked like the pill itself was wrong. */
  #zoomstate{display:none;left:50%;transform:translateX(-50%);bottom:14px;border-radius:999px;
    padding:6px 13px;font-size:11.5px;color:var(--muted);white-space:nowrap}
  #zoomstate.on{display:block}
  #zoomhint{left:50%;transform:translateX(-50%);bottom:44px;border-radius:999px;
    padding:6px 14px;font-size:11.5px;color:var(--muted);white-space:nowrap;pointer-events:none;
    transition:opacity .45s ease}
  #zoomhint.gone{opacity:0;pointer-events:none}
  body.detail-open #zoomhint{opacity:0;pointer-events:none}
  /* The picked-item box: TWO controls for two different intentions.

     MEASURED on the graph view, and applied here before it was ever reported rather
     than after: the X used to be the only exit from this panel AND it cleared the
     selection, so getting the box out of the way to see the whole picture cost the
     reader the pick and the zoom they had just asked for. Hiding a panel is not
     clearing a selection. Collapsing keeps the selection and narrows the box to its
     own heading, and the heading always names what is picked -- so a collapsed panel is
     never a panel you have to reopen to remember. */
  #detail{right:14px;bottom:14px;padding:11px 12px 12px;max-width:380px;max-height:46vh;
    overflow:auto;display:none;transition:max-width .2s ease,opacity .2s ease}
  #detail.on{display:block}
  #detail.collapsed{padding:8px 12px;max-width:none;overflow:hidden}
  #detail.collapsed #dbody{display:none}
  #dhead{display:flex;align-items:center;gap:8px}
  #dtitle{flex:1;min-width:0;font-size:11.5px;color:var(--text);overflow:hidden;
    text-overflow:ellipsis;white-space:nowrap}
  #detail.collapsed #dtitle{color:var(--muted)}
  .ctls{display:flex;align-items:center;gap:1px;flex:none}
  .ctl{background:none;border:0;font:inherit;font-size:12px;line-height:1;color:var(--muted);
    cursor:pointer;padding:3px 6px;border-radius:6px}
  .ctl:hover{color:var(--accent);background:rgba(255,255,255,.07)}
  .ctl:focus-visible{outline:1px solid var(--accent)}
  #detail h3{margin:7px 0 6px;font-size:13px}
  #detail dl{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;margin:0;
    font-variant-numeric:tabular-nums}
  #detail dt{color:var(--muted)} #detail dd{margin:0;word-break:break-all}
  @media (max-width:760px){#zoomhint{display:none}#search input{width:150px}}
`,
])

export const CODE_MAP_BODY = assemble([
  `<div id="map"><div id="world"></div></div>
<div class="ov" id="search">
  <input id="q" placeholder="Find a file or symbol&hellip;" autocomplete="off" spellcheck="false">
  <span id="qstat"></span>
</div>
<div class="ov" id="zoomstate"></div>
<div class="ov" id="zoomhint">scroll to zoom &middot; drag to pan &middot; double-click a file to fill the frame with it &middot; click a file or symbol for its stored facts</div>
<div class="ov" id="detail" role="dialog" aria-label="What you picked">
  <div id="dhead"><span id="dtitle">nothing picked</span><span class="ctls"><button class="ctl" id="dcollapse" type="button" aria-expanded="true" title="collapse this panel and keep the selection">&#9662;</button><button class="ctl" id="dclose" type="button" title="close and clear the selection">&#10005;</button></span></div>
  <div id="dbody"></div>
</div>
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
  // §world§ is DECLARED here, and this line is a fix rather than tidying.
  //
  // A browser exposes every element with an id as a global: with id="world" in the markup,
  // a bare §world§ anywhere in this script resolves to that element -- named access on the
  // window object. So §applyView(world)§ in zoomAt() and fitWorld() worked in a browser
  // while referencing no binding at all in this file, and the defect was invisible until
  // the emitted document was executed somewhere a browser's implicit globals do not exist.
  // MEASURED by executing the artifact against a stub DOM (script/m13/verify-visualize-
  // codemap.ts): the very first §draw(); fitWorld()§ threw "world is not defined", the catch
  // block swallowed it into the zoom pill, and the map opened at the fitted SCALE with an
  // unframed position -- a defect a screenshot of the top-left corner would have been read
  // as a panning accident. An id is not a variable; the binding is stated.
  var world = document.getElementById("world")
  var sel = null, hover = null, q = "", groupBy = "dir", box, panelCollapsed = false, SYM_IDX = null
  // Filters, declared with the renderer's other state.
  //
  // Hiding is a DISPLAY decision, and on a treemap it has to be: the areas encode line
  // spans and every file cell is sized from them, so a filter that REMOVED a symbol's
  // band would punch a hole where code demonstrably is and make the picture lie about the
  // one property this view exists to show. A hidden band is therefore drawn MUTED -- the
  // area stays true, the census keeps every row, and the data port keeps every symbol.
  // MEASURED before this pass: the map had no filters at all, so the only way to isolate
  // a symbol kind or a language was to leave the picture and read the JSON.
  var hiddenKinds = {}, hiddenLangs = {}
  // The counts the LAST draw actually produced. state() reads them, so the live line in
  // the sidebar cannot disagree with the frame it describes.
  var last = { syms: 0, lines: 0, files: 0, hits: 0, groups: 0, muted: 0, groupKeys: [], stripes: 0, foldedSyms: 0, foldedFiles: 0, named: 0, unnamedSmall: 0, unnamedBudget: 0, minStripePx: 0, zoom: 1 }
  // ---- the world and the view onto it.
  //
  // The treemap is laid out into a FIXED world rather than into the viewport's pixel
  // size. That is what makes zooming possible at all: if the layout is recomputed to
  // fill whatever space it is given, there is no larger coordinate space to move
  // through, and a wheel event can only rescale pixels that are already sub-pixel.
  //
  // The world is sized from the VIEWPORT, not fixed, and that is a deliberate
  // correction. A fixed 2400x1600 world against a ~974px viewport fitted at 41%, so
  // every file name opened at 4px -- MEASURED, and the labels I had just added were
  // unreadable at the scale the map opens at. The world now measures the viewport
  // divided by FIT_SCALE, so "fit" lands at 82% and labels open near their natural
  // size, while the zoom range still spans 0.08x to 24x: enough depth to go from the
  // whole map down to one symbol's bands.
  //
  // The world is still its own coordinate space, which is what makes zooming work at
  // all -- a treemap laid out directly into the viewport's pixels has nothing larger
  // to move through.
  var FIT_SCALE = 0.82
  // ---- LEVEL OF DETAIL. This is the reason the map was unreadable at scale.
  //
  // MEASURED on the emitted document over src/ (142 files, 1,770 symbols, 3,232 painted
  // stripes), in a real browser: 1,633 of those stripes were UNDER ONE DEVICE PIXEL tall
  // (median 0.94px), cyan covered 52.9% of the frame, and the tone that means "the code
  // between symbols" did not reach the top 14 colours at all. The picture was one wash of
  // the commonest kind, and a reporter's summary of it was exactly right: "the only thing I
  // see is cyan throughout, nothing is readable".
  //
  // A stripe under a pixel is not a small symbol, it is a SMEAR, and drawing 1,633 of them
  // is what made the map a single colour. So a RUN of symbols whose stripes would land under
  // MIN_STRIPE_PX device pixels is drawn as ONE strip whose slices are the lines each kind
  // spans, in source order. The area contract is untouched -- a slice is as tall as the lines
  // its kind covers -- and so is the muted tone (a muted symbol's slice is the muted colour).
  // Nothing is dropped or hidden: positions are unchanged, the census keeps every row, and
  // the folded count is named in the readout and in the encoding key.
  //
  // The threshold is DEVICE pixels and the layout is WORLD pixels, so it is converted at the
  // zoom being drawn: MIN_STRIPE_PX / view.k. That is what makes zooming mean something --
  // scroll in and the same file is redrawn with its stripes back, one relayout per gesture
  // (scheduleLod), rather than the 2,111 layout updates per wheel event the transform-only
  // zoom was written to avoid.
  var MIN_STRIPE_PX = 2
  // How many names may be printed at the fit scale. MEASURED at fit over src/: 59 of 142
  // files were named and 21 of those 59 names were CUT OFF with an ellipsis, so the budget
  // was set to 32 to buy back room. That reason no longer holds: fitWidth now prints a name
  // WHOLE or not at all and drops what does not fit, so clipping is impossible at any budget,
  // and all 32 bought was an emptier picture. MEASURED on the same scope in the same browser:
  // 140 files on screen, 39 names drawn, 111 candidates dropped BY THE BUDGET ALONE -- names
  // that fit their own cell and lost a queue, which is the one reason to withhold a name that
  // costs the reader something for nothing. MEASURED at 96, same document: 84 names drawn,
  // 0 clipped and 0 overlapping, and the queue costs 66 instead of 111. The budget still
  // grows with the zoom.
  var LABEL_BUDGET = 96
  var WORLD_W = 2400, WORLD_H = 1600
  var view = { x: 0, y: 0, k: 1 }
  // Label boxes already claimed this frame, so a file name is never printed over
  // another one. Same collision rule as the dependency map's node labels.
  var labelBoxes = []
  function applyView(el) {
    el.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.k + ")"
    el.style.transformOrigin = "0 0"
  }
  /** Put the world point under (cx, cy) -- viewport pixels -- back under the cursor. */
  function zoomAt(cx, cy, factor) {
    var nk = Math.max(0.08, Math.min(24, view.k * factor))
    var r = map.getBoundingClientRect()
    var mx = cx - r.left - (r.width - WORLD_W * view.k) / 2
    var my = cy - r.top - (r.height - WORLD_H * view.k) / 2
    view.x = mx - (mx - view.x) * (nk / view.k)
    view.y = my - (my - view.y) * (nk / view.k)
    view.k = nk
    applyView(world)
    reportView()
    scheduleLod()
  }
  /** Frame the whole world, with a margin. This is the view the map OPENS at. */
  /** The scale at which the whole world fills the map area, with a 24px margin.
   *
   *  One function, because the readout has to answer the same question the fit answered. The
   *  pill used to compare pixel extents instead, which is a DIFFERENT question, and it
   *  disagreed with reality: MEASURED after the fit was corrected, the map opened fitted
   *  (world 1247x976 inside a 1271x1000 area, 80%) and the pill still printed
   *  "80% - scroll out to see all" - telling the reader to scroll out of a map that was
   *  already whole. */
  function fitScale() {
    var W = map.clientWidth, H = map.clientHeight
    if (!W || !H) return 1
    return Math.max(0.08, Math.min(4, Math.min((W - 24) / WORLD_W, (H - 24) / WORLD_H)))
  }
  function fitWorld() {
    var W = map.clientWidth, H = map.clientHeight
    if (!W || !H) return
    view.k = fitScale()
    view.x = (W - WORLD_W * view.k) / 2
    view.y = (H - WORLD_H * view.k) / 2
    applyView(world)
    reportView()
  }
  /** How much of the map is off screen right now, so a reader is never lost. */
  function reportView() {
    var W = map.clientWidth, H = map.clientHeight
    var w = WORLD_W * view.k, h = WORLD_H * view.k
    // "Whole map" is true while the reader is at or BELOW the scale the fit produced, and it
    // is measured with the same function that performed the fit -- comparing pixel extents
    // asked a different question than the one the fit answered, and a fitted map reported
    // itself as needing a scroll-out.
    //
    // THE COMPARISON WAS THE WRONG WAY ROUND, and the pill was therefore never displayed at
    // any zoom. §view.k >= fitScale()§ is true at the fit AND at every scale above it, so the
    // readout said "whole map \u00b7 scroll to zoom in" while the map was at 338% with three
    // quarters of it off screen, and §el.className§ -- which shows the pill exactly when the
    // whole map is NOT on screen -- kept it hidden for the entire session. MEASURED in a real
    // browser on the emitted src/ document: wheel three notches, published zoom 0.8 -> 3.377,
    // and the pill's own text still read "whole map \u00b7 scroll to zoom in" with no §on§ class.
    // A readout that cannot be wrong out loud is worse than no readout: the reader is told
    // they are looking at everything at the moment they have zoomed into a corner of it.
    var wholeMapOnScreen = view.k <= fitScale() + 1e-6
    var el = document.getElementById("zoomstate")
    if (!el) return
    el.textContent = wholeMapOnScreen
      ? "whole map \u00b7 scroll to zoom in"
      : Math.round(view.k * 100) + "% \u00b7 " + (view.k < 0.9 ? "scroll out to see all" : "drag to pan, scroll to zoom")
    el.className = wholeMapOnScreen ? "" : "on"
  }
  var boxes = []

  // ── the zoom that REVEALS ─────────────────────────────────────────────────────
  //
  // Zooming used to be a transform and nothing else, deliberately: re-laying out on every
  // wheel event was 2,111 layout updates per gesture. But the level of detail is a function
  // of the zoom, so a transform-only zoom would leave a folded map folded all the way in --
  // the one gesture a reader makes to see detail would show them the same smear, larger.
  //
  // So the layout is redrawn ONCE, after the gesture SETTLES, and only when the level of
  // detail has actually changed: the zoom is bucketed in powers of two against the fit
  // scale, so a whole zoom range costs a handful of redraws rather than one per frame. A
  // redraw re-derives the world from the viewport but keeps the reader's view (draw()
  // re-applies view.x/view.y/view.k and never re-fits), so nothing jumps under the cursor.
  var drawnBucket = null, lodTimer = null
  function lodBucket() {
    return Math.round(Math.log(Math.max(1e-6, view.k / FIT_SCALE)) / Math.LN2)
  }
  function scheduleLod() {
    if (lodTimer !== null) clearTimeout(lodTimer)
    lodTimer = setTimeout(function () {
      lodTimer = null
      if (lodBucket() !== drawnBucket) draw()
    }, 160)
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c];
    });
  }

  // ---- one stable colour per symbol kind, and per language
  //
  // THE HUE FAMILIES ARE SPLIT WHERE THE COUNT IS, and that is a correction rather than a
  // preference. This palette used to paint §function§, §method§ and §constructor§ all in
  // §#5eead4§, and in a TypeScript scope those three are 78% of the symbols (821 methods,
  // 551 functions, 1,769 symbols total). The LOD pass below removed the sub-pixel smearing
  // and cyan still covered 41% of the painted frame, because folding does not change the
  // PROPORTIONS of the kinds it folds -- the monochrome wash was a property of the palette,
  // not of the detail level. So the two kinds that dominate the picture now have two hues,
  // on the same principle the graph view already applies to node fill: the channel that
  // carries a category must be spent where the categories actually are.
  //
  // The rare kinds still share a hue, deliberately: a kind with 11 members costs nothing
  // when it is the same colour as one with 19. Two collisions were removed at the same time,
  // because both were in the same channel as a kind: imports no longer share the method hue,
  // and §test§ no longer wears the amber that means "stale since index" everywhere else.
  //
  // MEASURED after the split, same document and viewport: cyan 40.9% -> 9.3%, the method hue
  // 0% -> 24.2%, and the code between symbols 39.8% -> 41.2%. The picture now has two large
  // families a reader can tell apart instead of one wash, and no kind is a colour of its own
  // in the key while sharing a pixel with another one in the drawing.
  var KIND_COLOURS = {
    function: "#5eead4", method: "#60a5fa", constructor: "#818cf8",
    class: "#a78bfa", struct: "#a78bfa", interface: "#c084fc", enum: "#c084fc",
    type: "#c084fc", trait: "#c084fc", module: "#94a3b8", file: "#94a3b8",
    variable: "#fb923c", constant: "#fb923c", field: "#fb923c",
    property: "#fb923c", parameter: "#64748b", local: "#64748b",
    import: "#7dd3fc", export: "#7dd3fc", reference: "#7dd3fc",
    test: "#f472b6", macro: "#f472b6", unknown: "#475569",
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
  // A band hidden by a filter has its OWN tone: not the gap's #1e2130 (which means "code
  // between symbols") and not any kind's colour, so a muted band can never be mistaken for
  // either. The encoding key names it, and only reports a count when something is hidden.
  var MUTED = "#2b3040"

  // ---- the data, grouped
  //
  // A symbol's WEIGHT is its line span, not its byte count. Careful, because the
  // convenient story is false: brain_symbol DOES store byte_start/byte_end, and they
  // are populated on the index this repository builds (231,108 of 231,369 rows in the
  // index measured at the time of writing). What is missing is this projection: the
  // visualization query never selects them, so no byte count reaches this document.
  // Lines are therefore the only size it can state without inventing one -- a
  // LIMITATION OF THIS PIPE, not of the index.
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
      // The language is the PROJECTION'S OWN field, and this read the wrong one.
      //
      // MEASURED on the emitted document: this was §sym.language || "unknown"§, and the
      // node shape carries no §language§ at all -- it carries §group§, the same field the
      // graph's language filter and the tool's own language census read. So EVERY file of
      // every code map was filed under "unknown", the group-by-language arrangement
      // produced exactly one rectangle, and the picked-item box reported a language for no
      // symbol in the project. The fallback stays, so a caller who hands this renderer its
      // own payload with §language§ set is still honoured.
      var lang0 = String(sym.group || sym.language || "unknown")
      if (!rec) { rec = files[f] = { path: f, lang: lang0, syms: [], lines: 0, maxLine: 0 } }
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
      // THICKNESS, which is the row's area divided by that shorter side. The items
      // themselves advance along the LONGER axis: a wide rectangle gets a horizontal
      // row, while a tall rectangle gets a vertical row.
      //
      // The previous implementation confused those axes. Wide rows were given one
      // shared width and stacked vertically, producing giant strips and leaving the
      // supposed treemap looking like a set of wedges. The row must advance along the
      // long axis while its thickness occupies the short axis.
      //
      // viz-13 asserts the two properties a treemap must have, so this cannot come
      // back silently: every pair of rectangles disjoint, and the areas summing to
      // the box.
      var thickness = rowArea / side
      var offset = 0
      for (var j = 0; j < row.length; j++) {
        var frac = row[j].lines * scale / (rowArea || 1)
        if (w >= h) {
          out.push({ item: row[j], x: x + offset, y: y, w: frac * w, h: thickness })
          offset += frac * w
        } else {
          out.push({ item: row[j], x: x, y: y + offset, w: thickness, h: frac * h })
          offset += frac * h
        }
      }
      if (w >= h) { y += thickness; h -= thickness } else { x += thickness; w -= thickness }
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
    labelBoxes = []
    if (!world) return
    // Size the world from the viewport, then lay out into it. Re-derived on every
    // draw rather than cached, so a window resize cannot leave the map laid out for
    // a space it no longer occupies.
    var vw = map.clientWidth, vh = map.clientHeight
    if (!vw || !vh) return
    WORLD_W = Math.max(600, Math.round(vw / FIT_SCALE))
    WORLD_H = Math.max(400, Math.round(vh / FIT_SCALE))
    world.style.width = WORLD_W + "px"
    world.style.height = WORLD_H + "px"
    var W = WORLD_W, H = WORLD_H
    world.innerHTML = ""
    if (!W || !H) return
    // The whole world, with nothing inset.
    //
    // There used to be an inset here, computed to dodge the floating panels, and a
    // second one for the sidebar. Both are gone: the panels live in their own column
    // and the map is a viewport onto a fixed world, so there is nothing for the
    // layout to avoid. A treemap that does not fill its space is not a treemap.
    var inset = { x: 0, y: 0, w: W, h: H }
    var groups = groupFiles()
    var placed = squarify(groups, inset.x, inset.y, inset.w, inset.h, [])
    var needle = q.toLowerCase()
    var hits = 0, totalSyms = 0, totalLines = 0, fileCount = 0, mutedSyms = 0
    var frag = document.createDocumentFragment()
    // File names are collected and appended AFTER the group fragment, so the rectangles
    // do not paint over them. See the note where they are pushed.
    var fnameEls = []
    // The cells that COULD be named, decided after the whole map is placed: a name is worth
    // printing only once it is known what the cell has room for and who else wants a name.
    var labelCandidates = []
    // What this frame could not draw one-to-one. Both counts are published on the §last§
    // record, which is what state() and the sidebar read.
    var foldedSyms = 0, foldedFiles = 0, mixFiles = 0
    gapBands = 0
    // The rectangles already claimed by a drawn group label, as [x0, y0, x1, y1].
    var labelBands = []

    for (var gi = 0; gi < placed.length; gi++) {
      var gcell = placed[gi]
      if (gcell.w < 1 || gcell.h < 1) continue
      var g = document.createElement("div")
      g.style.cssText = "position:absolute;left:" + gcell.x + "px;top:" + gcell.y + "px;width:" +
        Math.max(0, gcell.w - 2) + "px;height:" + Math.max(0, gcell.h - 2) +
        "px;border:1px solid rgba(255,255,255,.10);border-radius:4px;overflow:hidden"
      g.dataset.group = gcell.item.key
      // A label is drawn when the group has room, unless it would land on a label already
      // drawn this frame -- and the claim is a RECTANGLE.
      //
      // MEASURED, in two steps. First a screenshot showed "fingerprint 5.4k lines" and
      // "build_runner 2.9k lines" printed on top of one another, because both groups were wide
      // and short and both qualified on size alone; so the occupied labels began to be tracked.
      // Then the track was kept as a [top, bottom] SPAN, and a span has no x: of two groups
      // placed side by side in one row only the first was ever named. MEASURED by executing the
      // emitted document (script/m13/verify-visualize-codemap.ts): a two-directory map printed
      // ONE directory name, and the second group could not be named at all. Two labels collide
      // when their rectangles overlap, so that is what is tested -- both axes, not one.
      var headerRoom = gcell.h > 26 && gcell.w > 70
      var headW = Math.min(gcell.w, 230)
      var clash = false
      for (var li = 0; li < labelBands.length; li++) {
        var LB = labelBands[li]
        if (gcell.x < LB[2] && gcell.x + headW > LB[0] && gcell.y < LB[3] && gcell.y + 26 > LB[1]) { clash = true; break }
      }
      if (headerRoom && !clash) {
        labelBands.push([gcell.x, gcell.y, gcell.x + headW, gcell.y + 26])
        var gh = document.createElement("div")
        gh.style.cssText = "position:absolute;left:0;top:0;right:0;padding:3px 7px;font-size:15px;" +
          "color:rgba(255,255,255,.72);background:rgba(0,0,0,.42);pointer-events:none;" +
          "white-space:nowrap;overflow:hidden;text-overflow:ellipsis"
        gh.textContent = gcell.item.key + "  " + fmt(gcell.item.lines) + " line" + (gcell.item.lines === 1 ? "" : "s")
        g.appendChild(gh)
      }
      var inner = []
      squarify(gcell.item.files, 0, headerRoom ? 26 : 0, gcell.w, Math.max(1, gcell.h - (headerRoom ? 26 : 0)), inner)
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
        // A HAIRLINE around every file cell, and it is the fix for the other half of "nothing
        // is readable". MEASURED over src/: 83.8% of the frame's pixels were ONE colour (cyan,
        // the function/method family -- and the map is right, 93.7% of the spanned lines there
        // ARE functions and methods, so the wash is the data). But two neighbouring files made
        // of the same kind painted one continuous field: there was no edge anywhere in the
        // picture, so a reader could not tell where one file stopped and the next began, or how
        // many files there were. A one-pixel dark inset edge costs about a pixel per cell and
        // turns the wash into a mosaic of countable, nameable cells.
        fd.style.cssText = "position:absolute;left:" + fcell.x + "px;top:" + fcell.y +
          "px;width:" + Math.max(1, fcell.w) + "px;height:" + Math.max(1, fcell.h) +
          "px;overflow:hidden;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(6,8,16,.72)"
        fd.dataset.file = f.path
        // The file's NAME, once its cell can hold one.
        //
        // MEASURED from a screenshot: not one of 34 files was labelled, so a reader
        // could count rectangles but could not name a single one. The name goes in a
        // bar across the top of the cell, in WORLD units, so it grows as the reader
        // zooms -- which is the point of zooming. It is skipped when the cell is too
        // small to hold it, and when another label already occupies that strip, so
        // names never print over one another: an overlapping name is unreadable and
        // makes the map look broken.
        // WHO gets a name is decided after the whole map is placed -- see chooseLabels.
        // MEASURED before that pass: 59 of src/'s 142 files were named, 21 of the 59 were
        // cut off, and the naming was in PLACEMENT order, so two neighbours 40px wide could
        // take two names while a 300px cell went unnamed because it was placed last.
        //
        // The ladder is the NAME and the name without its extension -- the two forms that are
        // still true of the file -- because a truncated name is not a name. No regex here: a
        // DOT in a pattern inside this template literal is one more escape that can collapse.
        var base = f.path.split("/").pop()
        var dot = base.lastIndexOf(".")
        labelCandidates.push({ kind: "file", x: fcell.x, y: fcell.y, w: fcell.w, h: fcell.h, path: f.path,
          forms: [base, dot > 0 ? base.slice(0, dot) : ""], labelW: 0 })
        // the file's own symbols, as bands in SOURCE ORDER, height = line span.
        // The gaps between them are drawn at their true size, which is the point:
        // a file of many small definitions and a file of a few enormous ones look
        // nothing alike here, and that difference is not visible any other way.
        var cursor = 0
        var syms = f.syms.slice().sort(function (p, r) { return (p.line || 0) - (r.line || 0) })
        // THE FILE'S OWN LINE COUNT, not the sum of its symbols' spans, and this is a fix.
        //
        // MEASURED on the emitted map over src/ before it: the layout divided by the sum of the
        // spans while positioning by ABSOLUTE line numbers, so the two disagreed and the drawn
        // content overflowed its own cell -- ast/real-cpp-analyzer.ts drew 7,760 units of height
        // into a 3,513 budget (2.2x), ast/parallel-indexer.ts 11,268 into 4,242 (2.7x), and 8 of
        // 92 files overflowed. The bottom of such a file was clipped away by the cell's own
        // overflow:hidden, and every gap band was painted at the wrong offset (under the band
        // that follows it), so the encoding key's two promises -- "area = the lines a symbol
        // spans" and "gap = the code between symbols, drawn at its true size" -- were both
        // false. The lines a file spans is the number its last symbol ends on; a symbol covers
        // the lines it covers; and what is left over IS the gap.
        var total = Math.max(1, f.maxLine || f.lines || 1)
        // The stripe this file's height gives one symbol at the zoom being drawn, against the
        // shortest stripe that is still worth drawing at that zoom. Below it a band is a
        // smear -- see the note on MIN_STRIPE_PX -- and a RUN of such symbols becomes one
        // strip instead. Positions are untouched: a strip starts at the first line of its run
        // and is as tall as the run's own lines, and the gaps around it keep their true size,
        // so this changes how a file reads and never what it measures.
        var readableWorld = MIN_STRIPE_PX / Math.max(0.03, view.k)
        // TWO heights per stripe, and they are different questions.
        //
        //   * honestWorld is the share of the cell the symbol's own lines earn: (span / the
        //     file's lines) x the cell's height. This is what READABILITY is judged by, because
        //     it is what the symbol actually is on screen.
        //   * stripeWorld is what gets DRAWN, which is that share subject to a 0.35% floor so a
        //     one-line symbol still paints something. The floor is a drawing device, never a
        //     measure.
        //
        // MEASURED while writing this, and the distinction is not pedantry: judging readability
        // by the floored height made the answer depend on the CELL's shape rather than the
        // file's density, because 0.35% of a full-height cell is 2.6 world px -- just above the
        // 2px floor at the fit scale. A 300-symbol file folded in one arrangement and did not
        // fold in another, and the same payload in a slightly taller viewport changed the
        // picture. Honest shares make the decision a property of the data: 300 one-line symbols
        // in an 898-line file are 0.8px each in a 732px cell, and they fold at any cell shape.
        var honestWorld = function (span) { return (span / total) * fcell.h }
        var stripeWorld = function (span) { return (Math.max(0.35, 100 * span / total) / 100) * fcell.h }
        // ── TWO WAYS TO DRAW ONE FILE, and the choice between them IS the level of detail ──
        //
        // MEASURED, on the first version of this pass: folding only RUNS of sub-pixel stripes
        // folded 1,288 of src/'s 1,769 symbols and did not move the picture by a measurable
        // pixel (52.9% of the frame one colour before, 58.5% after). The reason is in the
        // arithmetic: a symbol alone between two gaps is a run of ONE, and a run of one is
        // drawn at the same 0.35%-of-a-cell floor that was already too small to see. Folding a
        // smear into a smear is not a level of detail.
        //
        // So a file is drawn one of two ways:
        //
        //   * INDIVIDUAL STRIPES when ANY symbol clears the floor at this zoom -- the reader is
        //     at detail level, each readable symbol is its own band, and the ones that still
        //     fall under the floor are folded together with their neighbours;
        //   * ONE COMPOSITION STRIP when NOT ONE symbol clears the floor -- the whole file
        //     becomes a single bar, as tall as its cell, whose slices are the kinds it is made
        //     of AND the code between them, in source order. A file of 400 one-line getters
        //     reads as a barcode of its own composition instead of 400 invisible smears, and
        //     the arithmetic is unchanged: the slices are the same line spans the individual
        //     bands would have been.
        //
        // The threshold is "not one", rather than a share of the symbols, and that is
        // deliberate: MEASURED in the first version of this rule, a file with ONE enormous
        // method and 300 one-liners was drawn as a composition strip, which buried the name of
        // the single largest thing in it. A file that contains something big keeps its stripes,
        // so the big thing can be drawn AND named; a file that contains nothing big becomes
        // one legible bar.
        //
        // Either way nothing is dropped: every symbol is counted, searchable, in the data port,
        // and published in the readout as folded rather than silently merged.
        var countable = 0
        for (var cw2 = 0; cw2 < syms.length; cw2++) if (honestWorld(syms[cw2]._span) >= readableWorld) countable++
        var mixFile = syms.length > 1 && countable === 0
        var fileFolded = false
        if (mixFile) {
          var segs = [], wide = 0, symRefs = []
          for (var mi = 0; mi < syms.length; mi++) {
            var msym = syms[mi]
            // The code before this symbol is part of the bar, drawn in the GAP tone, so the
            // composition a reader sees sums to the file's own line count.
            var mlead = (msym.line || 0) - 1 - wide
            if (mlead > 0) { segs.push({ colour: "#1e2130", span: mlead }); wide += mlead }
            var mmuted = !!hiddenKinds[msym.type || "unknown"] || !!hiddenLangs[String(msym.group || msym.language || "unknown")]
            if (mmuted) mutedSyms++
            var mhit = false
            if (needle) {
              var mnm = (msym.name || "").toLowerCase()
              if (mnm.indexOf(needle) >= 0 || f.path.toLowerCase().indexOf(needle) >= 0) { hits++; mhit = true }
            }
            segs.push({ sym: msym, colour: mmuted ? MUTED : msym.stale ? "#fbbf24" : kindColour(msym.type),
              span: msym._span, sel: (sel && sel.kind === "sym" && sel.id === msym.id) || (hover && hover.kind === "sym" && hover.id === msym.id), match: mhit })
            // cum is measured in the FILE's lines rather than the symbols', so a click resolves
            // to the slice the reader aimed at even though the bar also carries the gaps.
            symRefs.push({ sym: msym, cum: wide + msym._span })
            wide += msym._span
          }
          if (wide < total) segs.push({ colour: "#1e2130", span: total - wide })
          var strip = document.createElement("div")
          strip.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;background:" + mixBackground(segs) + ";"
          var anyHit = false, anyHot = false
          for (var sg = 0; sg < segs.length; sg++) { if (segs[sg].match) anyHit = true; if (segs[sg].sel) anyHot = true }
          if (anyHit) { strip.style.outline = "1px solid #ffffff"; strip.style.outlineOffset = "-1px" }
          if (anyHot) strip.style.outline = "2px solid #ffffff"
          fd.appendChild(strip)
          boxes.push({ kind: "sym", id: symRefs[0].sym.id, el: strip, sym: symRefs[0].sym, file: f, run: symRefs, runLines: total })
          foldedSyms += syms.length
          foldedFiles++
          mixFiles++
          fileFolded = true
        } else {
          var runSegs = [], runLines = 0, runStart = 0
          var flushRun = function () {
            if (!runLines) { runSegs = []; return }
            var b = document.createElement("div")
            b.style.cssText = "position:absolute;left:0;top:" + (100 * runStart / total) + "%;width:100%;height:" +
              Math.max(0.35, 100 * runLines / total) + "%;background:" + mixBackground(runSegs) + ";"
            var hot = false, found = false
            for (var q2 = 0; q2 < runSegs.length; q2++) { if (runSegs[q2].sel) hot = true; if (runSegs[q2].match) found = true }
            if (found) { b.style.outline = "1px solid #ffffff"; b.style.outlineOffset = "-1px" }
            if (hot) b.style.outline = "2px solid #ffffff"
            // The strip stands for a RUN, and a click resolves to the symbol whose slice it
            // landed in (resolveRun), so a reader who clicks the middle of a strip gets the
            // middle symbol rather than whichever one happened to be first.
            boxes.push({ kind: "sym", id: runSegs[0].sym.id, el: b, sym: runSegs[0].sym, file: f, run: runSegs, runLines: runLines })
            runSegs = []; runLines = 0
          }
          for (var si = 0; si < syms.length; si++) {
            var sym = syms[si]
            var at = (sym.line || 0) - 1
            if (at > cursor) {
              // The code between symbols is not part of any mix here: a gap ENDS a run, and is
              // drawn at its true size on its own -- at the offset the source puts it, which is
              // where the previous content ended.
              flushRun()
              pushBand(fd, fcell, (at - cursor) / total, cursor / total, null, f)
            }
            cursor = at
            var isSel = sel && sel.kind === "sym" && sel.id === sym.id
            var isHov = hover && hover.kind === "sym" && hover.id === sym.id
            // A filtered band is drawn MUTED rather than skipped -- see the note on MUTED
            // and on the filter state at the top of this script. It is still counted, still
            // searchable and still in the download, and inside a folded run it is a MUTED
            // SLICE of the strip, so a filter never disappears from the picture either.
            var muted = !!hiddenKinds[sym.type || "unknown"] || !!hiddenLangs[String(sym.group || sym.language || "unknown")]
            if (muted) mutedSyms++
            var colour = muted ? MUTED : sym.stale ? "#fbbf24" : kindColour(sym.type)
            var isHit = false
            if (needle) {
              var nm = (sym.name || "").toLowerCase()
              if (nm.indexOf(needle) >= 0 || f.path.toLowerCase().indexOf(needle) >= 0) { hits++; isHit = true }
            }
            if (honestWorld(sym._span) >= readableWorld) {
              // Readable on its own: close the run that was open, then draw this symbol as
              // itself. A stripe that clears the floor is a symbol a reader can see and hit.
              flushRun()
              var band = document.createElement("div")
              band.style.cssText = "position:absolute;left:0;top:" + (100 * cursor / total) + "%;width:100%;height:" +
                Math.max(0.35, 100 * sym._span / total) + "%;background:" + colour + ";"
              fd.appendChild(band)
              boxes.push({ kind: "sym", id: sym.id, el: band, sym: sym, file: f })
              if (isHit) { band.style.outline = "1px solid #ffffff"; band.style.outlineOffset = "-1px" }
              if (isSel || isHov) band.style.outline = "2px solid #ffffff"
              // A stripe tall enough to hold a line of text is a candidate to be NAMED, and
              // this is the candidate that was missing: MEASURED over src/, the 20 largest
              // symbols hold 57.9% of the drawn area and NOT ONE of them could be named,
              // because only file cells were ever labelled. The area a reader most needs to
              // identify was the one thing the picture could not say. The qualified name is
              // tried first (RealCppAnalyzer.analyze), then its own name, and a name that fits
              // neither is dropped rather than clipped.
              if (stripeWorld(sym._span) >= 16) {
                labelCandidates.push({ kind: "sym", x: fcell.x, y: fcell.y + (cursor / total) * fcell.h,
                  cellTop: fcell.y, w: fcell.w, h: stripeWorld(sym._span), path: f.path, sym: sym.id,
                  forms: [sym.qualifiedName, sym.name], labelW: 0 })
              }
              cursor += sym._span
              runStart = cursor
            } else {
              if (!runLines) runStart = cursor
              runSegs.push({ sym: sym, colour: colour, span: sym._span, cum: runLines + sym._span, sel: isSel || isHov, match: isHit })
              runLines += sym._span
              foldedSyms++
              if (!fileFolded) { fileFolded = true; foldedFiles++ }
              cursor += sym._span
            }
          }
          flushRun()
          // Whatever the file holds after its last symbol is code too, and the cell has room
          // for it: without this band the bottom of every file would read as a symbol.
          if (cursor < total) pushBand(fd, fcell, (total - cursor) / total, cursor / total, null, f)
        }
        g.appendChild(fd)
      }
      frag.appendChild(g)
    }
    world.appendChild(frag)
    // ── which cells are NAMED, now that every cell's size is known ────────────
    //
    // MEASURED on the emitted map over src/ before this pass: 59 of 142 files named, 21 of
    // those 59 names cut off with an ellipsis, and the names chosen in placement order rather
    // than by size -- so a reader could see two neighbouring filenames 40px wide and no name
    // at all on the largest cell in the picture. A clipped name is not a name; a name is
    // printed only when it fits WHOLE, the budget is spent largest-first, and what did not get
    // named is counted and published rather than left to be discovered.
    var labels = chooseLabels(labelCandidates)
    for (var fi3 = 0; fi3 < labels.chosen.length; fi3++) {
      var lc = labels.chosen[fi3]
      var fn = document.createElement("div")
      fn.className = lc.kind === "sym" ? "fname sym-name" : "fname"
      // A symbol's name sits INSIDE the stripe it names, so it starts where the stripe starts
      // and is inset by the 2px the cell's own hairline takes.
      fn.style.cssText = "left:" + (lc.x + (lc.kind === "sym" ? 3 : 2)) + "px;top:" +
        ((lc.labelY != null ? lc.labelY : lc.y) + 1) + "px;width:" + lc.labelW + "px;height:17px"
      fn.textContent = lc.text
      fn.title = lc.kind === "sym" ? lc.text + " — " + lc.path : lc.path
      fn.dataset.fkey = lc.path
      if (lc.kind === "sym") fn.dataset.sym = lc.sym
      fnameEls.push(fn)
    }
    // After, not before: the fragment carries every group and file rectangle, and a
    // label appended first is underneath all of them.
    for (var fi2 = 0; fi2 < fnameEls.length; fi2++) world.appendChild(fnameEls[fi2])
    applyView(world)
    reportView()
    // Which level of detail this frame was drawn at, so a later gesture knows whether it is
    // looking at a frame that still describes the zoom it is at.
    drawnBucket = lodBucket()
    // What this frame actually holds, published rather than painted. The sidebar's census
    // and its live line read these numbers, so neither can describe a different picture
    // than the one on screen.
    last = {
      syms: totalSyms, lines: totalLines, files: fileCount, hits: hits, muted: mutedSyms,
      groups: groups.length, groupKeys: groups.map(function (gc) { return gc.key }),
      // What could NOT be drawn one-to-one, in the same breath as what was: a frame that
      // folded 1,600 stripes into mixes and did not say so would be the same defect the
      // node-budget row was added to fix.
      // The DRAWN element count, published so a gate can tie the picture to the numbers
      // instead of trusting them: every element inside a file cell is one of these three, and
      // the identity is asserted in both gates.
      stripes: totalSyms - mutedSyms - foldedSyms,
      gaps: gapBands,
      foldedSyms: foldedSyms, foldedFiles: foldedFiles, mixFiles: mixFiles,
      named: labels.chosen.length, namedFiles: labels.files, namedSymbols: labels.syms,
      unnamedSmall: labels.small, unnamedBudget: labels.over,
      minStripePx: MIN_STRIPE_PX, zoom: view.k,
    }
    publishSearch()
  }
  var gapBands = 0
  function pushBand(fd, fcell, hFrac, yFrac, colour, f) {
    gapBands++
    var b = document.createElement("div")
    b.style.cssText = "position:absolute;left:0;top:" + (100 * yFrac) + "%;width:100%;height:" +
      (100 * hFrac) + "%;background:#1e2130"
    fd.appendChild(b)
    boxes.push({ kind: "gap", el: b, file: f })
  }
  function fmt(n) { return n >= 1000 ? Math.round(n / 100) / 10 + "k" : String(n) }

  // ---- how wide a name is, and what a run of folded symbols looks like
  //
  // A name is printed only when it fits its cell WHOLE. MEASURED on the emitted map over
  // src/: 21 of the 59 names it printed were cut off with an ellipsis, and a clipped name is
  // not a name. So the width is MEASURED rather than assumed.
  //
  // MEASURED, in the map document's own font at 13px (the label's size), across its own file
  // names: real-xml-analyzer.ts 117.6px, engine.ts 56.5, code-map-renderer.ts 131.2,
  // class-diagram-renderer.ts 154.8, db.bun.ts 58.0, tool-handlers.ts 96.0 -- 6.92px per
  // character on average, and that average is only a FALLBACK: a canvas measures the exact
  // string where a canvas exists, which is everywhere a browser runs this, and the stub DOM
  // the gates use has none. "Segoe UI" is left out of the measuring stack because a quoted
  // family inside this template literal is one more escape that can collapse silently.
  var LABEL_CHROME = 10  // the .fname rule: padding 0 4px, plus its 2px left border
  var LABEL_SAFETY = 1.06 // margin over the measured width, so a fallback font cannot clip it
  var FALLBACK_CHAR_PX = 6.92
  var measureCtx = null, measureTried = false
  function textWidthOf(s) {
    s = String(s)
    if (!measureTried) {
      measureTried = true
      try {
        var cv = document.createElement("canvas")
        measureCtx = cv && cv.getContext ? cv.getContext("2d") : null
        if (measureCtx) measureCtx.font = "13px ui-sans-serif,system-ui,-apple-system,Roboto,sans-serif"
      } catch (e) { measureCtx = null }
    }
    if (measureCtx) {
      try { var w = measureCtx.measureText(s).width; if (w > 0) return w } catch (e2) { measureCtx = null }
    }
    return s.length * FALLBACK_CHAR_PX
  }
  /** ONE strip carrying a RUN of symbols: hard-stop slices whose heights are the lines each
   *  kind spans, in source order.
   *
   *  The area contract survives this exactly -- a slice is as tall as the lines its kind spans
   *  inside the run -- and so does the muted tone: a muted symbol's slice is the muted colour,
   *  so a filtered run cannot be mistaken for an unfiltered one. A one-slice run is its own
   *  kind's colour, which is the same pixel the band it replaces would have painted. */
  function mixBackground(segs) {
    if (!segs.length) return "#1e2130"
    if (segs.length === 1) return segs[0].colour
    var total = 0, i
    for (i = 0; i < segs.length; i++) total += segs[i].span
    if (total <= 0) return segs[0].colour
    var stops = [], at = 0
    for (i = 0; i < segs.length; i++) {
      var from = 100 * at / total
      at += segs[i].span
      stops.push(segs[i].colour + " " + from.toFixed(3) + "% " + (100 * at / total).toFixed(3) + "%")
    }
    return "linear-gradient(to bottom," + stops.join(",") + ")"
  }
  /** The world rectangle the reader is actually looking at, so the label budget is spent on
   *  what is on screen rather than on cells that are already off it. */
  function visibleWorld() {
    var vw = map.clientWidth || 1200, vh = map.clientHeight || 800
    var k = view.k || 1
    return { x0: -view.x / k, y0: -view.y / k, x1: (-view.x + vw) / k, y1: (-view.y + vh) / k }
  }
  /** A name's width, or null when the longest form of it does not fit the room given.
   *
   *  The ladder, and the rule behind it: a name is shown WHOLE or not at all. MEASURED on the
   *  emitted map over src/: it printed 59 names and 21 of them were cut off mid-word with an
   *  ellipsis -- "real-typescript-anal..." names a file a reader cannot look up. So a long name
   *  falls back to the SHORTER TRUE name (a symbol's qualified name, then its own name) and is
   *  dropped rather than truncated. */
  function fitWidth(forms, room) {
    for (var i = 0; i < forms.length; i++) {
      if (!forms[i]) continue
      var need = textWidthOf(forms[i]) * LABEL_SAFETY + LABEL_CHROME
      if (need <= room) return { text: forms[i], width: need }
    }
    return null
  }
  /** Which cells and stripes get a name, largest first, within the budget for this zoom.
   *
   *  Three rules, all measured rather than felt. A name must FIT whole (no ellipsis). The
   *  budget is finite, so the LARGEST things are named -- and that is a change of who wins:
   *  MEASURED over src/, the 20 largest symbols hold 57.9% of the drawn area (one method,
   *  RealCppAnalyzer.analyze, spans 3,500 of its file's 6,183 lines) and NOT ONE of them was
   *  named, because only file cells could be labelled. The biggest thing in the picture was
   *  anonymous. Files and symbols now compete for the same budget by area, each capped by its
   *  own share of it so neither kind can starve the other. A cell that fits but loses the
   *  budget is a different fact from a cell too small to hold its own name, and the two are
   *  counted separately rather than added into one apology. */
  function chooseLabels(cands) {
    var budget = Math.round(LABEL_BUDGET * Math.max(1, Math.min(6, view.k / FIT_SCALE)))
    var win = visibleWorld()
    var chosen = [], small = 0, over = 0, scored = []
    var used = { file: 0, sym: 0 }
    for (var i = 0; i < cands.length; i++) {
      var c = cands[i]
      var room = c.w - 3
      var fit = fitWidth(c.forms, room)
      if (!fit || c.h < 16) { small++; continue }
      c._text = fit.text
      c._need = fit.width
      var vis = c.x < win.x1 && c.x + c.w > win.x0 && c.y < win.y1 && c.y + c.h > win.y0
      scored.push({ c: c, score: (vis ? 1 : 0) * 1e12 + c.w * c.h })
    }
    scored.sort(function (a, b) { return b.score - a.score })
    for (var j = 0; j < scored.length; j++) {
      var cand = scored[j].c
      // Each kind may spend half the budget, so naming 20 enormous methods cannot silently
      // take every file's name away -- or the other way round, on a tree of small files.
      if (chosen.length >= budget || used[cand.kind] >= Math.ceil(budget / 2)) { over++; continue }
      var labelW = cand._need
      // A stripe that starts under the cell's own header cannot be named AT its start without
      // landing on that header -- and the header is the cell's name, so the symbol would simply
      // lose. MEASURED on a fixture with one 9,000-line method: the method's stripe begins at 0.1%
      // of its cell, the file's name is printed there, and the largest symbol in the picture went
      // unnamed because of a one-pixel overlap. A stripe with room moves its name DOWN, below the
      // 17px header, and keeps it. Hiding a name to avoid a clash is not a collision policy.
      var ly = cand.y
      if (cand.kind === "sym" && cand.cellTop != null && cand.y - cand.cellTop < 19 && cand.h >= 35) ly = cand.cellTop + 18
      var clash = false
      for (var lb = 0; lb < labelBoxes.length; lb++) {
        var L = labelBoxes[lb]
        if (cand.x < L[2] && cand.x + labelW > L[0] && ly < L[3] && ly + 17 > L[1]) { clash = true; break }
      }
      if (clash) { over++; continue }
      labelBoxes.push([cand.x, ly, cand.x + labelW, ly + 17])
      cand.labelW = labelW
      cand.labelY = ly
      cand.text = cand._text
      used[cand.kind]++
      chosen.push(cand)
    }
    return { chosen: chosen, small: small, over: over, files: used.file, syms: used.sym }
  }

  // ---- WHAT THE SIDEBAR RENDERS: the census, the kinds, the keys, the chips.
  //
  // These were innerHTML written into this document's own panel. The reader asked for the
  // drawing to be the screen and the data to live in one column beside it, so the counting
  // is unchanged and only the destination is: every function below returns (label, value,
  // warn) rows or (value, count, colour) chips for the mount to render. Nothing here paints.
  function row(k, v, warn) { return { label: k, value: v, warn: !!warn } }
  function kindCounts() {
    var kinds = {}
    for (var i = 0; i < S.length; i++) { var k0 = S[i].type || "unknown"; kinds[k0] = (kinds[k0] || 0) + 1 }
    return kinds
  }
  function staleCount() { var n = 0; for (var i = 0; i < S.length; i++) if (S[i].stale) n++; return n }
  /** How much of the drawn area the largest symbols hold, and it is the answer to "why is this
   *  picture one colour".
   *
   *  MEASURED over src/ (200 symbols, 64,405 lines spanned): the largest 20 symbols are 57.9%
   *  of the area, and the single largest -- RealCppAnalyzer.analyze -- spans 3,500 of its file's
   *  6,183 lines. The wash a reader sees is not the renderer mis-colouring: 93.7% of the spanned
   *  lines in that scope ARE functions and methods, so the map is drawing the shape of the
   *  codebase. This row is published because a reader who is told it looks concentrated deserves
   *  to know that it IS concentrated, and by how much. */
  var CONCENTRATION = null
  function concentration() {
    if (CONCENTRATION) return CONCENTRATION
    var spans = [], total = 0
    for (var i = 0; i < S.length; i++) { var sp = spanOf(S[i]); spans.push(sp); total += sp }
    spans.sort(function (a, b) { return b - a })
    var n = Math.min(20, spans.length), sum = 0
    for (var j = 0; j < n; j++) sum += spans[j]
    CONCENTRATION = { count: n, pct: total ? Math.round(100 * sum / total) : 0 }
    return CONCENTRATION
  }
  function groupUnit() { return groupBy === "lang" ? "languages" : last.groups === 1 ? "directory" : "directories" }
  function censusRows() {
    var out = [row("files", last.files), row("symbols", last.syms), row("lines spanned", fmt(last.lines)),
      row(groupUnit(), last.groups)]
    // What this map does NOT show, stated on its face rather than left to be discovered. A
    // rectangle map makes it especially easy to believe you are looking at the whole
    // project, so both cuts are named: the noise filter's exclusions and the node budget's.
    var ex = G.excluded
    if (ex && ex.symbols) out.push(row("excluded as noise", ex.symbols, true))
    var over = Number(G.totalNodesAvailable || 0) - Number(G.shownNodes || 0)
    if (over > 0) out.push(row("cut by the node budget", over, true))
    var stale = staleCount()
    if (stale) out.push(row("stale since index", stale, true))
    if (last.muted) out.push(row("muted by a filter", last.muted, true))
    // Said only when the map really is concentrated, because a row about a shape the picture
    // does not have is the same defect as a key for a mark that is not drawn.
    var conc = concentration()
    if (conc.count > 1 && conc.pct >= 25) out.push(row("largest " + conc.count + " symbols", conc.pct + "% of the drawn area", true))
    return out
  }
  function excludedNote() {
    var ex = G.excluded
    if (!ex || !ex.symbols) return "nothing excluded — this map covers every indexed symbol in its scope"
    var by = Object.keys(ex.byPattern || {}).concat(Object.keys(ex.byRule || {}))
    return ex.symbols + " symbol(s) excluded as noise by " + (by.length ? by.join(", ") : "the default patterns") +
      (ex.includesTestFiles === false ? " (test sources excluded)" : "") + " — this is not the whole project"
  }
  function legendRows() {
    var kinds = kindCounts(), out = []
    for (var k in kinds) out.push({ value: k, count: kinds[k], color: kindColour(k) })
    out.sort(function (a, b) { return b.count - a.count })
    return out
  }
  function encodingRows() {
    var stale = staleCount()
    var out = [
      { swatch: "bar", color: "#5eead4", text: "area = the lines a symbol spans" },
      { swatch: "dot", color: "#5eead4", text: "fill = symbol kind — functions cyan, methods blue, types violet, values amber (see Symbol kinds)" },
      { swatch: "bar", color: "#1e2130", text: "gap = the code between symbols, drawn at its true size" },
      { swatch: "dot", color: "#fbbf24", text: stale ? "amber = stale since index (" + stale + ")" : "amber = stale since index (none in this scope)" },
      { swatch: "ring", color: "#ffffff", text: q ? "white outline = matches the search" : "white outline = matches the search (nothing typed yet)" },
      // Reported only with its count, and only when a filter is actually muting something: a
      // key that explains a mark the picture does not contain is the same defect as a readout
      // that counts rows the frame is not drawing.
      { swatch: "dot", color: MUTED, text: last.muted ? "muted = hidden by a filter (" + last.muted + " bands, counted anyway)" : "muted = hidden by a filter (nothing hidden)" },
    ]
    // The one mark this picture has that the others do not, and it is reported only when the
    // picture contains it: a run of symbols under MIN_STRIPE_PX is drawn as ONE strip whose
    // slices are the lines each kind spans, so the key has to say what a slice means.
    if (last.foldedSyms) {
      out.push({ swatch: "bar", color: "#5eead4", text: "a strip = " + last.foldedSyms + " symbol(s) whose own stripes fall under " + MIN_STRIPE_PX + "px at this zoom — each slice is as tall as the lines its kind spans, in source order" })
    }
    return out
  }
  function toggleInto(map, key, show) { if (show) delete map[key]; else map[key] = 1; changed() }
  function filterOptions() {
    var langs = {}
    for (var i = 0; i < S.length; i++) { var g0 = String(S[i].group || S[i].language || "unknown"); langs[g0] = (langs[g0] || 0) + 1 }
    return [
      { id: "kinds", label: "Symbol kinds", options: legendRows(),
        hidden: function (v) { return !!hiddenKinds[v] },
        set: function (v, show) { toggleInto(hiddenKinds, v, show) } },
      { id: "languages", label: "Languages",
        options: Object.keys(langs).sort().map(function (g) { return { value: g, count: langs[g], color: langColour(g) } }),
        hidden: function (v) { return !!hiddenLangs[v] },
        set: function (v, show) { toggleInto(hiddenLangs, v, show) } },
    ]
  }
  /** A filter change redraws and NOTHING ELSE moves.
   *
   *  MEASURED on the graph view, and kept here deliberately: the files keep their cells and
   *  the treemap's geometry does not depend on what is muted, so re-fitting on a filter
   *  toggle would throw a reader who had zoomed into one file back out to the whole map. The
   *  map is only re-framed when the arrangement itself changes -- see setLayout below. */
  function changed() { draw(); notify() }
  function notify() { /* the mount polls state(); a cross-frame event would be redundant */ }
  function publishSearch() {
    var el = document.getElementById("qstat")
    if (!el) return
    el.textContent = q ? last.hits + " match" + (last.hits === 1 ? "" : "es") : ""
  }
  function symById() {
    if (!SYM_IDX) { SYM_IDX = {}; for (var i = 0; i < S.length; i++) SYM_IDX[S[i].id] = S[i] }
    return SYM_IDX
  }
  function detailVisible() { var d = document.getElementById("detail"); return !!d && d.classList.contains("on") }
  function panelState() {
    return { collapsed: panelCollapsed, visible: detailVisible(), title: dtitleEl ? dtitleEl.textContent : "" }
  }
  function selectedName() {
    if (!sel) return null
    if (sel.kind === "file") return sel.path
    var s = symById()[sel.id]
    return s ? (s.name || sel.id) : sel.id
  }
  /** The rows the sidebar's "On screen" line prints, in THIS view's own vocabulary.
   *
   *  MEASURED while building this pass: the shell composed that line from
   *  visibleNodes/totalNodes and edges -- the GRAPH's words -- so a mounted code map would
   *  have reported "nodes 1412 of 1412 · edges 0 of 0": a sentence about a different
   *  picture, in a vocabulary this view does not have. The view publishes the rows and the
   *  shell prints them, which is the same division of labour as the census. */
  function onScreenRows() {
    var out = [
      row("symbols", (last.syms - last.muted) + " of " + last.syms),
      row("files", last.files + " in " + last.groups + " " + groupUnit()),
    ]
    // WHAT THE FRAME COULD NOT DRAW ONE-TO-ONE, said in the same breath as what it drew.
    // MEASURED before this pass: over src/, 1,633 of 3,232 stripes were under one device
    // pixel tall and nothing anywhere in the artifact said so -- the census counted symbols
    // the frame was painting as a smear. A fold count is published only when something IS
    // folded, because a readout about a mark the picture does not contain is the defect the
    // muted row was already fixed for.
    out.push(row("stripe detail", last.foldedSyms
      ? last.foldedSyms + " of " + last.syms + " folded \u00b7 " + last.mixFiles + " file(s) as one composition strip (zoom in)"
      : "every symbol drawn on its own", !!last.foldedSyms))
    out.push(row("names", last.namedFiles + " files \u00b7 " + last.namedSymbols + " symbols" +
      (last.unnamedSmall ? " \u00b7 " + last.unnamedSmall + " with no room for a name" : ""),
      !!(last.unnamedSmall || last.unnamedBudget)))
    if (last.muted) out.push({ label: "", value: last.muted + " muted by a filter", warn: true })
    if (last.hits) out.push(row("matches", last.hits))
    out.push(row("zoom", Math.round(view.k * 100) + "%"))
    var name = selectedName()
    if (name) out.push(row("selected", name))
    return out
  }
  function viewState() {
    return {
      visibleSymbols: last.syms - last.muted, totalSymbols: last.syms, mutedSymbols: last.muted,
      visibleFiles: last.files, totalFiles: last.files, groups: last.groups, zoom: view.k,
      groupBy: groupBy, search: q, selected: selectedName(),
      layout: groupBy, panel: panelState(), onScreen: onScreenRows(),
      // What the frame drew one-to-one and what it folded, so a gate (and the graph's own view
      // of itself) can read the level of detail rather than infer it from a screenshot.
      lod: {
        minStripePx: MIN_STRIPE_PX, zoom: view.k, bucket: lodBucket(),
        stripesDrawn: last.stripes, gapBands: last.gaps, drawnElements: last.stripes + last.gaps + last.mixFiles,
        foldedSymbols: last.foldedSyms, foldedFiles: last.foldedFiles, compositionStrips: last.mixFiles,
        named: last.named, namedFiles: last.namedFiles, namedSymbols: last.namedSymbols,
        unnamedSmall: last.unnamedSmall, unnamedBudget: last.unnamedBudget,
      },
    }
  }
  /** The data port: what the picture was drawn from, in the shape the sidebar's downloads
   *  already speak.
   *
   *  The nodes carry the projection's own field names, because that is what every other
   *  consumer of a node in this tool reads -- §group§ is the language and §type§ the kind.
   *  This view draws no edges, and says so with an EMPTY list rather than by omitting the
   *  key, so the mount can disable the edges download instead of handing out a CSV of
   *  nothing. Muted items stay in the port: a filter is a display decision. */
  var DATA = null
  function dataPort() {
    if (DATA) return DATA
    var nodes = []
    for (var i = 0; i < S.length; i++) {
      var s = S[i]
      nodes.push({
        id: s.id, name: s.name, type: s.type || "unknown", group: String(s.group || s.language || "unknown"),
        filePath: s.filePath, line: s.line, lineEnd: s.lineEnd, qualifiedName: s.qualifiedName,
        gravity: s.gravity, stale: s.stale === true, lines: spanOf(s),
        muted: !!(hiddenKinds[s.type || "unknown"] || hiddenLangs[String(s.group || s.language || "unknown")]),
      })
    }
    DATA = {
      view: "codemap", scope: G.scope, target: G.target, nodes: nodes, links: [],
      symbols: S, excluded: G.excluded, totalNodesAvailable: G.totalNodesAvailable, shownNodes: G.shownNodes,
    }
    return DATA
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
  /** Which SYMBOL of a folded strip a point lands on: the slice the strip's own gradient
   *  draws under that point, so the pick and the picture cannot disagree. MEASURED need: a
   *  strip can stand for a whole file's worth of definitions, and answering every click on it
   *  with the run's FIRST symbol would make a reader's pick depend on the order the index
   *  happened to return rather than on where they aimed. */
  function resolveRun(b, cy) {
    if (!b.run || b.run.length < 2) return b
    var r = b.el.getBoundingClientRect()
    if (!r.height) return b
    var t = (cy - r.top) / r.height
    if (!(t >= 0)) t = 0
    if (t > 0.9999) t = 0.9999
    var at = t * (b.runLines || 1)
    for (var i = 0; i < b.run.length; i++) {
      if (at < b.run[i].cum) {
        return { kind: "sym", id: b.run[i].sym.id, el: b.el, sym: b.run[i].sym, file: b.file, run: b.run, runLines: b.runLines }
      }
    }
    var lastRef = b.run[b.run.length - 1]
    return { kind: "sym", id: lastRef.sym.id, el: b.el, sym: lastRef.sym, file: b.file, run: b.run, runLines: b.runLines }
  }
  // ── the pick is the MAP's, not the document's ─────────────────────────────────
  //
  // Both listeners were on §document§, so every click anywhere in the page was read as a
  // click on the map -- including a click on this document's own overlays, which is how it
  // was found. MEASURED in a real browser (script/m13/verify-visualize-browser.ts, V10): the X
  // cleared the selection and then the same click, bubbling on to §document§, picked whatever
  // band lay under the panel and put the box straight back with the OLD subject on it -- so
  // the one control that exists to clear a pick could not clear one. Typing in the search box
  // had the same effect, and hovering the box re-picked what was under it. The graph view is
  // immune because its canvas listener never sees a click on a DOM overlay above it; here the
  // listener belongs to the MAP for the same reason.
  map.addEventListener("mousemove", function (ev) {
    var b = boxAt(ev.clientX, ev.clientY)
    if (b === hover) return
    if (hover && hover.el) hover.el.style.cursor = ""
    hover = b
    if (b) { b.el.style.cursor = "pointer"; show(resolveRun(b, ev.clientY)) }
  })
  map.addEventListener("click", function (ev) {
    var b = boxAt(ev.clientX, ev.clientY)
    if (!b) { sel = null; hide(); draw(); return }
    if (b.kind === "sym") { var rb = resolveRun(b, ev.clientY); sel = { kind: "sym", id: rb.sym.id }; show(rb) }
    else { sel = { kind: "file", path: b.file.path }; show(b) }
    draw()
  })
  // ── the picked-item box: two controls, two different intentions ────────────────
  //
  // MEASURED on the graph view and fixed here before it was ever reported rather than
  // after: the X was the only exit from this panel AND it cleared the selection, so getting
  // the box out of the way to see the whole picture cost the reader the pick and the zoom
  // they had just asked for. Hiding a panel is not clearing a selection. The collapse keeps
  // the selection and narrows the box to its own heading, and the heading always names what
  // is picked, so a collapsed panel never has to be reopened to remember.
  var dtitleEl = document.getElementById("dtitle")
  var collapseEl = document.getElementById("dcollapse")
  function applyPanel() {
    var det = document.getElementById("detail")
    det.classList.toggle("collapsed", panelCollapsed)
    if (!collapseEl) return
    collapseEl.innerHTML = panelCollapsed ? "&#9652;" : "&#9662;"
    collapseEl.setAttribute("aria-expanded", panelCollapsed ? "false" : "true")
    collapseEl.setAttribute("title", panelCollapsed ? "expand this panel (the selection stays)" : "collapse this panel and keep the selection")
  }
  function setPanel(opts) {
    if (opts && opts.collapsed != null) panelCollapsed = !!opts.collapsed
    applyPanel()
    return panelState()
  }
  if (collapseEl) collapseEl.onclick = function () { setPanel({ collapsed: !panelCollapsed }) }
  applyPanel()
  document.getElementById("dclose").onclick = function () { hide(); sel = null; draw(); notify() }
  function hide() {
    document.getElementById("detail").classList.remove("on")
    document.body.classList.remove("detail-open")
  }
  /** What the box is about, in one line: this heading IS the collapsed panel. */
  function summaryOf(b) {
    if (!b) return "nothing picked"
    if (b.kind === "sym") {
      var s = b.sym
      return (s.name || s.id) + " · " + (s.type || "symbol") + " · " + (s.filePath || "unknown file") +
        (s.line != null ? ":" + s.line : "")
    }
    return b.file.path + " · " + b.file.syms.length + (b.file.syms.length === 1 ? " symbol" : " symbols")
  }
  function show(b) {
    var det = document.getElementById("detail"), body = document.getElementById("dbody")
    if (!b) { hide(); return }
    var rows, heading
    if (b.kind === "sym") {
      var s = b.sym
      heading = "Symbol"
      // The language comes from the same field the grouping reads, so the box and the map
      // can never name two different languages for one symbol.
      rows = [["name", s.name], ["kind", s.type], ["language", String(s.group || s.language || "unknown")],
              ["file", s.filePath], ["lines", (s.line || "?") + (s.lineEnd ? "-" + s.lineEnd : "")],
              ["lines spanned", s._span], ["qualified name", s.qualifiedName || "—"],
              ["gravity", s.gravity != null ? s.gravity : "—"],
              ["stale", s.stale ? "yes — file changed since index" : "no"]]
      // A symbol inside a folded strip IS drawn, as a slice of that strip, and the box says
      // so: a reader who picks one should not have to wonder why its own band is missing.
      if (b.run && b.run.length > 1) rows.push(["drawn as", "one slice of a strip for " + b.run.length + " symbols — they fall under " + MIN_STRIPE_PX + "px at this zoom"])
      if (b.run && b.run.length === 1) rows.push(["drawn as", "its own band, at the shortest size that still renders"])
    } else {
      heading = "File"
      rows = [["file", b.file.path], ["language", b.file.lang], ["symbols", b.file.syms.length],
              ["lines spanned", b.file.lines], ["last line", b.file.maxLine]]
    }
    body.innerHTML = "<h3>" + heading + "</h3><dl>" +
      rows.map(function (r) { return "<dt>" + esc(r[0]) + "</dt><dd>" + esc(r[1]) + "</dd>" }).join("") + "</dl>"
    if (dtitleEl) dtitleEl.textContent = summaryOf(b)
    det.classList.add("on")
    document.body.classList.add("detail-open")
    applyPanel()
    notify()
  }

  // The arrangement is the sidebar's Layout section now, so there are no group-by buttons
  // here: the mount calls setLayout on the API below, which is the same code these used to
  // run. §sel§ deliberately survives it -- the files are the same files, only the cells move.
  var input = document.getElementById("q")
  input.addEventListener("input", function () { q = input.value; draw(); notify() })
  // ---- zoom, pan, and the two ways out
  //
  // Wheel zooms about the CURSOR, not about the centre of the viewport, because the
  // point under the cursor is the point the reader is looking at; zooming about the
  // centre slides whatever they were examining out from under them. Drag pans.
  //
  // The gesture that ENDS the interaction is as important as the one that starts it:
  // double-click frames a single file, which is the "show me this part" move that a
  // 1,400-symbol map otherwise has no answer for. Without it, zooming is a one-way
  // trip into a picture with no way back.
  // The instruction line is a FIRST-RUN hint, not a permanent banner. The composed viewer
  // prints the same sentence in its own View section (published as §hint§), so a pill that
  // never went away would be chrome lying over the drawing -- which is the defect this pass
  // exists to remove. The first gesture retires it, and so does a timeout, so a reader who
  // never touches the map is not left with it forever either.
  var hintEl = document.getElementById("zoomhint"), hintGone = false
  function dismissHint() { if (!hintGone && hintEl) { hintEl.classList.add("gone"); hintGone = true } }
  setTimeout(dismissHint, 6000)
  map.addEventListener("wheel", function (ev) {
    ev.preventDefault()
    dismissHint()
    zoomAt(ev.clientX, ev.clientY, Math.exp(-ev.deltaY * 0.0016))
  }, { passive: false })
  var drag = null
  map.addEventListener("mousedown", function (ev) {
    dismissHint()
    drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false }
    map.classList.add("panning")
  })
  window.addEventListener("mousemove", function (ev) {
    if (!drag) return
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    view.x = drag.vx + dx; view.y = drag.vy + dy
    applyView(document.getElementById("world"))
    reportView()
  })
  window.addEventListener("mouseup", function () {
    map.classList.remove("panning")
    drag = null
  })
  map.addEventListener("dblclick", function (ev) {
    var fkey = null
    if (ev.target && ev.target.dataset && ev.target.dataset.fkey) fkey = ev.target.dataset.fkey
    if (fkey) frameFile(fkey)
    else fitWorld()
  })
  /** Zoom so one file fills the viewport, keeping its aspect. */
  function frameFile(path) {
    var el = document.querySelector('[data-file="' + path.replace(/"/g, '\\\\"') + '"]')
    if (!el) return fitWorld()
    var r = map.getBoundingClientRect()
    var box = el.getBoundingClientRect()
    if (!box.width || !box.height) return fitWorld()
    // The element's rect is ALREADY in viewport pixels, so it has to be taken BACK
    // through the transform before it can be re-centred under a new one. Treating the
    // viewport-space centre as if it were a world coordinate centred the view on
    // whichever file happened to be nearby instead -- MEASURED, double-clicking
    // mod.rs framed the region to its right, with future_incompat.rs half off screen.
    //
    // The half-extent has to be added BEFORE dividing by k, or this converts the
    // file's LEFT edge to world space and centres that instead of the file: the
    // second attempt put the file's top-left corner exactly at the viewport centre.
    var worldCx = (box.left + box.width / 2 - r.left - view.x) / view.k
    var worldCy = (box.top + box.height / 2 - r.top - view.y) / view.k
    var k = Math.max(0.08, Math.min(24, Math.min((r.width - 40) / box.width, (r.height - 40) / box.height)))
    view.k = k
    view.x = r.width / 2 - worldCx * k
    view.y = r.height / 2 - worldCy * k
    applyView(document.getElementById("world"))
    reportView()
    scheduleLod()
  }

  // ---- save as
  //
  // Reported more than once, and the gap it fills is real: the artifact arrives as a
  // blob of text, and a reader who wants to keep it, mail it, or open it without a
  // tool in the loop has no way to. So the page can save ITSELF.
  //
  // It re-serialises the live document rather than shipping a copy of the source
  // string, so what is saved is what is on screen. A Blob and an object URL are used
  // rather than a data: URI because a data: URI of a multi-megabyte document is
  // rejected by several browsers, and this document is routinely 2-7 MB.
  // THE CONTROL MOVED TO THE SIDEBAR; THE ABILITY STAYS HERE.
  //
  // Reported as "the save as button does not work", and the fix was to attach it by
  // delegation before anything that could throw, because an exception during layout used
  // to leave a visible, styled, completely inert button. The button itself is gone now:
  // a save control in the corner of the picture is the chrome this pass removes, and the
  // composed viewer's own Download section saves the whole page. The document keeps the
  // ability, published as saveHtml on the API below, so a stand-alone copy of the map can
  // still be written -- and the outcome is reported by whoever asked for it, since a save
  // whose only feedback was a pill over the drawing is a save the reader cannot see fail.
  function saveSelf(name) {
    try {
      var blob = new Blob(["<!DOCTYPE html>" + String.fromCharCode(10) + document.documentElement.outerHTML], { type: "text/html" })
      var url = URL.createObjectURL(blob)
      var a = document.createElement("a")
      a.href = url
      a.download = name
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(function () { URL.revokeObjectURL(url) }, 4000)
      return true
    } catch (e) { return false }
  }

  window.addEventListener("resize", function () {
    // The world is derived from the viewport, so a resize means the layout has to be
    // recomputed. But a reader who had zoomed IN is not thrown back out to the
    // overview for having resized the window: their scale is kept, and only the
    // geometry moves under them.
    var wasZoomed = view.k > FIT_SCALE * 1.05
    draw()
    if (wasZoomed) { applyView(document.getElementById("world")); reportView() }
    else fitWorld()
  })

  // ── THE PUBLISHED API ────────────────────────────────────────────────────────
  //
  // The composed viewer renders ONE sidebar -- mode, layout, on-screen, data, filters,
  // encoding, view, download -- and the mounted document is what knows those facts. A view
  // that paints its own copies of them puts the drawing in a corner of its own chrome; this
  // one publishes functions instead, and the sidebar is the only place they are drawn.
  //
  // Same shape as the graph view's, deliberately: the shell reads one contract whatever is
  // mounted, and the rows it prints are the VIEW's words (see onScreenRows) rather than a
  // vocabulary borrowed from another picture.
  window.__bbView = {
    kind: "codemap",
    title: "Symbol map",
    // The subtitle states the encoding AND what the view is NOT, because the name it used to
    // carry ("code map") is the name of a different artifact: Sourcegraph's Chromium map draws
    // every TOKEN of every file. This draws symbols, sized by the lines they span, because the
    // index stores line spans and no tokens. Saying so here is cheaper than being asked.
    subtitle: "bb_visualize \u00b7 area = the lines each SYMBOL spans, nested directory \u203a file \u203a symbol \u00b7 colour = symbol kind, language from the index \u00b7 this is a SYMBOL map, not a token-level code map",
    hint: "scroll to zoom \u00b7 drag to pan \u00b7 double-click a file to fill the frame with it \u00b7 click a file or symbol for its stored facts",
    census: censusRows,
    note: excludedNote,
    legend: legendRows,
    encoding: encodingRows,
    filters: filterOptions,
    state: viewState,
    // The two arrangements this document can draw, and which one is on screen. The choice
    // is the sidebar's Layout section; before this pass it was two buttons in this file's
    // own panel, which is the same duplication the census had.
    layouts: function () { return [
      { value: "dir", label: "Directories", hint: "group files into the directory they live in -- the nesting is the one thing a force graph cannot show" },
      { value: "lang", label: "Languages", hint: "group files by the language they are written in, so each language's mass is one rectangle" },
    ] },
    layout: function () { return groupBy },
    setLayout: function (next) {
      var mode = next === "lang" ? "lang" : "dir"
      if (mode === groupBy) return groupBy
      groupBy = mode
      // Re-framed, because the arrangement the reader was looking at has moved underneath
      // them. A picked FILE survives: it is the same file, in a different cell.
      draw()
      fitWorld()
      notify()
      return groupBy
    },
    panel: panelState,
    setPanel: setPanel,
    data: dataPort,
    fit: function () { fitWorld() },
    // "show everything": the filters are the only thing this view hides, and the search and
    // the pick are the reader's own position rather than a state to be undone.
    reset: function () { hiddenKinds = {}; hiddenLangs = {}; changed() },
    saveHtml: function () { return saveSelf("bb-code-map.html") },
  }
  try {
    // draw() FIRST, then fit. MEASURED: #world measures the viewport divided by FIT_SCALE and
    // is only recomputed inside draw(), so fitting before the first draw framed the DEFAULT
    // 2400x1600 world and then left the reader looking at a 52% view of a world that no longer
    // existed -- the map opened smaller than the space it had, said scroll-out-to-see-all,
    // and the labels were scaled down with it. Frame the world that was actually laid out.
    draw()
    fitWorld()
  } catch (e) {
    var z = document.getElementById("zoomstate")
    if (z) { z.className = "on"; z.textContent = "This map could not be laid out (" + String(e).slice(0, 120) + "). The symbols are still in the page as JSON." }
  }
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
    '<html lang="en" data-bb-view="codemap">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Backbencher Symbol Map</title>",
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
