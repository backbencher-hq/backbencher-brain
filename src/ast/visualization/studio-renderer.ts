/**
 * The composed HTML shell for bb_visualize.
 *
 * It used to be a floating rail of mode buttons over an iframe, and every view
 * painted its own panels into the four corners of the same screen. The review was
 * blunt about the result: four corners of controls, the drawing buried under them,
 * and a second layer of chrome (this shell) on top of the first. So the shell now
 * owns the ONE sidebar — mode, data, filters, encoding, downloads — and the views
 * are chrome-free documents that publish what the sidebar needs through
 * `window.__bbView`.
 *
 * The graph document publishes its census, filters, encoding key and data ports
 * through `window.__bbView`, and the sidebar renders them; a document with no API
 * mounts with empty sections and disabled downloads rather than invented numbers.
 */

const STUDIO_CSS = `
  :root {
    color-scheme: dark;
    --bg: #0b0c0f;
    --side: #121419;
    --ink: #f2efe9;
    --muted: #a9a49b;
    --faint: #7c776d;
    --line: rgba(242, 239, 233, .10);
    --line-2: rgba(242, 239, 233, .20);
    --accent: #e7b56a;
    --accent-soft: rgba(231, 181, 106, .12);
    --warn: #e7b56a;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--ink);
    font: 12.5px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    overflow: hidden; -webkit-font-smoothing: antialiased; }
  #workbench { display: grid; grid-template-columns: 336px minmax(0, 1fr); height: 100%; }
  #side { border-right: 1px solid var(--line); background: linear-gradient(180deg, #14161c, #0e1015);
    overflow-y: auto; overscroll-behavior: contain; padding: 22px 20px 18px; }
  #content { position: relative; min-width: 0; }
  #view { width: 100%; height: 100%; border: 0; display: block; background: var(--bg); }

  /* ── brand ───────────────────────────────────────────────────────────── */
  #brand { padding-bottom: 16px; }
  #brand .mark { color: var(--accent); font-size: 10px; letter-spacing: .22em; font-weight: 700; }
  #brand h1 { margin: 9px 0 3px; font-size: 17px; font-weight: 600; letter-spacing: -.01em; }
  #brand p { margin: 0; color: var(--faint); font-size: 11px; }

  /* ── sections ────────────────────────────────────────────────────────── */
  .sec { padding: 14px 0; border-top: 1px solid var(--line); }
  .secLabel { margin: 0 0 10px; font-size: 10px; font-weight: 600; letter-spacing: .17em;
    text-transform: uppercase; color: var(--faint); }
  .hide { display: none !important; }

  /* ── mode ────────────────────────────────────────────────────────────── */
  #modes { display: grid; grid-template-columns: 1fr; gap: 6px; }
  .mode { display: flex; align-items: center; justify-content: center; gap: 6px; cursor: pointer;
    font: inherit; font-size: 11.5px; color: var(--muted); background: transparent;
    border: 1px solid var(--line); border-radius: 9px; padding: 9px 6px; }
  .mode:hover { color: var(--ink); border-color: var(--line-2); }
  .mode.active { color: var(--ink); border-color: rgba(231, 181, 106, .5); background: var(--accent-soft); }
  .mode .glyph { color: var(--accent); font-size: 12px; }

  /* ── layout choice ───────────────────────────────────────────────────── */
  /* The graph has two arrangements, and which one a reader wants is their call:
     the region map names the project's parts, and the plain force graph is the honest
     shape when those parts do not fall along directory lines. Both are here. */
  #layouts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .lay { font: inherit; font-size: 11.5px; color: var(--muted); cursor: pointer; text-align: center;
    background: transparent; border: 1px solid var(--line); border-radius: 9px; padding: 9px 6px; }
  .lay:hover { color: var(--ink); border-color: var(--line-2); }
  .lay.active { color: var(--ink); border-color: rgba(231, 181, 106, .5); background: var(--accent-soft); }
  .layHint { margin: 9px 0 0; color: var(--faint); font-size: 10.5px; line-height: 1.5; }

  /* ── live state ──────────────────────────────────────────────────────── */
  .live { color: var(--muted); font-variant-numeric: tabular-nums; }
  .live b { color: var(--ink); font-weight: 600; }
  .live .sep { color: var(--faint); padding: 0 5px; }
  /* A caveat the view marked as one, and an explanation that belongs in the same breath as
     the counts around it. Neither may be as loud as a headline number. */
  .live .warn { color: var(--warn); }
  .live .plain { color: var(--muted); }

  /* ── census ──────────────────────────────────────────────────────────── */
  .kv { display: grid; gap: 3px; font-variant-numeric: tabular-nums; }
  .kv .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .kv .v { font-weight: 600; }
  .kv .k { color: var(--muted); text-align: right; }
  .kv .warn .v { color: var(--warn); }
  .note { margin: 10px 0 0; color: var(--faint); font-size: 11px; line-height: 1.5; }

  /* ── filters ─────────────────────────────────────────────────────────── */
  .fgroup + .fgroup { margin-top: 14px; }
  .fhead { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 7px; }
  .flab { color: var(--ink); font-size: 12px; }
  .fclear { font: inherit; font-size: 11px; color: var(--faint); background: none; border: 0;
    border-bottom: 1px dashed var(--line-2); cursor: pointer; padding: 0 0 1px; }
  .fclear:hover { color: var(--accent); border-bottom-color: var(--accent); }
  .fopts { display: flex; flex-wrap: wrap; gap: 5px; }
  .fopt { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; font: inherit;
    font-size: 11px; color: var(--ink); background: rgba(255, 255, 255, .03);
    border: 1px solid var(--line); border-radius: 999px; padding: 4px 9px; }
  .fopt:hover { border-color: var(--line-2); }
  .fopt .sw { width: 8px; height: 8px; border-radius: 50%; background: var(--faint); flex: none; }
  .fopt .sw.line { width: 16px; height: 0; border-top: 2px solid currentColor; border-radius: 0; }
  .fopt .sw.dashed { border-top-style: dashed; }
  .fopt .ct { color: var(--faint); font-variant-numeric: tabular-nums; }
  .fopt.off { color: var(--faint); background: none; }
  .fopt.off .sw { opacity: .3; }
  .fopt.off .ct { opacity: .5; }

  /* ── encoding key ────────────────────────────────────────────────────── */
  .key { display: grid; gap: 6px; }
  .krow { display: flex; align-items: center; gap: 9px; color: var(--muted); font-size: 11.5px; }
  .krow .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .krow .ring { width: 9px; height: 9px; border-radius: 50%; border: 1.5px solid; background: none; flex: none; }
  .krow .bar { width: 22px; height: 0; border-top-width: 2px; border-top-style: solid; flex: none; }
  .krow .langs { width: 14px; height: 9px; border-radius: 3px; flex: none;
    background: conic-gradient(#5eead4 0 25%, #a78bfa 0 50%, #fbbf24 0 75%, #60a5fa 0); }

  /* ── actions ─────────────────────────────────────────────────────────── */
  .actions { display: flex; gap: 6px; }
  .act { flex: 1; font: inherit; font-size: 11.5px; color: var(--ink); cursor: pointer;
    background: rgba(255, 255, 255, .03); border: 1px solid var(--line); border-radius: 8px; padding: 8px 6px; }
  .act:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .act:disabled { color: var(--faint); cursor: default; opacity: .5; }

  /* ── downloads ───────────────────────────────────────────────────────── */
  .dls { display: grid; gap: 6px; }
  .dl { display: block; width: 100%; text-align: left; font: inherit; cursor: pointer;
    background: rgba(255, 255, 255, .03); border: 1px solid var(--line); border-radius: 9px;
    padding: 8px 10px; color: var(--ink); }
  .dl b { display: block; font-size: 11.5px; font-weight: 600; }
  .dl span { display: block; color: var(--faint); font-size: 10.5px; margin-top: 1px; }
  .dl:hover:not(:disabled) { border-color: var(--accent); }
  .dl:hover:not(:disabled) b { color: var(--accent); }
  .dl:disabled { opacity: .38; cursor: default; }

  #status { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line);
    color: var(--faint); font-size: 10.5px; }
  #status.flash { color: var(--accent); }

  @media (max-width: 900px) {
    #workbench { grid-template-columns: 1fr; grid-template-rows: minmax(200px, 42vh) minmax(0, 1fr); }
    #side { border-right: 0; border-bottom: 1px solid var(--line); }

  }
`

function escapeScript(value: string): string {
  return value.replace(/</g, "\\u003c")
}

export function renderVisualizationStudio(documents: {
  graph: string
}): string {
  const payload = escapeScript(JSON.stringify({ graph: documents.graph }))
  const script = `
    (function () {
      var docs = JSON.parse(document.getElementById("bb-studio-data").textContent);
      var frame = document.getElementById("view");
      var modesEl = document.getElementById("modes");
      var buttons = Array.prototype.slice.call(document.querySelectorAll(".mode"));
      var titleEl = document.getElementById("viewTitle");
      var subEl = document.getElementById("viewSub");
      var liveEl = document.getElementById("live");
      var censusEl = document.getElementById("census");
      var noteEl = document.getElementById("note");
      var viewNoteEl = document.getElementById("viewNote");
      var fallbackEl = document.getElementById("fallback");
      var filtersEl = document.getElementById("filters");
      var encodingEl = document.getElementById("encoding");
      var filterSection = document.getElementById("filterSection");
      var encodingSection = document.getElementById("encodingSection");
      var actionSection = document.getElementById("actionSection");
      var layoutSection = document.getElementById("layoutSection");
      var layoutsEl = document.getElementById("layouts");
      var layoutHintEl = document.getElementById("layoutHint");
      var fitBtn = document.getElementById("fit");
      var clearBtn = document.getElementById("clear");
      var statusEl = document.getElementById("status");
      var dlButtons = Array.prototype.slice.call(document.querySelectorAll(".dl"));
      var labels = { graph: "Graph" };
      var liveTimer = 0;
      // The arrangement the READER picked, held by the page rather than by the mount. The
      // documents are static strings, so without this a trip to another mode and back
      // would hand them the layout the file was generated with and quietly undo their
      // choice -- a switch that forgets is a switch the reader has to work twice.
      var chosenLayout = null;

      // WHICH DOCUMENT IS IN THE FRAME, read from the document itself.
      //
      // The sidebar used to key its geometry off the SLOT it had mounted, and the two
      // can disagree the moment a document arrives in the wrong slot. Every renderer
      // declares data-bb-view on its own <html>, and the panel reads that first, so a
      // document that describes itself is described correctly wherever it lands.
      function documentView() {
        var doc = frame.contentDocument;
        var declared = doc && doc.documentElement && doc.documentElement.getAttribute("data-bb-view");
        return declared || frame.dataset.mode;
      }
      /** The mounted view's published API, or null for a view that has none yet. */
      function api() {
        try {
          var win = frame.contentWindow;
          return (win && win.__bbView) || null;
        } catch (e) { return null; }
      }
      function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
      function span(cls, text) { var s = document.createElement("span"); s.className = cls; if (text != null) s.textContent = text; return s; }

      // ── the live line: what the view actually holds right now ─────────────
      // ── the live line: what the VIEW says is on screen right now ─────────────
      //
      // The rows come from the view, in the view's own words. The line used to be composed
      // HERE, out of st.visibleNodes, st.visibleEdges and st.regionLinks, so the shell had to
      // know what a region link was. A view publishes state(); it can publish what to print
      // with it.
      function updateLive() {
        var view = api();
        if (!view || !view.state) { liveEl.textContent = "\\u2014"; return; }
        var rows = view.state().onScreen || [];
        clear(liveEl);
        if (!rows.length) { liveEl.textContent = "\\u2014"; return; }
        rows.forEach(function (r, i) {
          if (i) liveEl.appendChild(span("sep", "\\u00b7"));
          // Three tones, because the view distinguishes them: a headline count (label, bold
          // value), an explanation that belongs in the same breath (plain), and a caveat the
          // reader should notice (warn). A row marked as a caveat must not be the loudest
          // thing in the line.
          var cls = r.warn ? "warn" : r.tone === "plain" ? "plain" : "";
          if (r.label) liveEl.appendChild(span(cls, r.label + " "));
          if (cls) liveEl.appendChild(span(cls, String(r.value)));
          else liveEl.appendChild(bold(r.value));
        });
      }
      function bold(text) { var b = document.createElement("b"); b.textContent = text; return b; }

      // ── the census and the exclusion note, straight from the view ─────────
      function renderData(view) {
        clear(censusEl);
        clear(noteEl);
        if (!view || !view.census) { censusEl.className = "kv"; return; }
        censusEl.className = "kv";
        (view.census() || []).forEach(function (row) {
          var el = document.createElement("div");
          el.className = "row" + (row.warn ? " warn" : "");
          var v = span("v", String(row.value));
          var k = span("k", row.label);
          el.appendChild(v); el.appendChild(k);
          censusEl.appendChild(el);
        });
        if (view.note) noteEl.textContent = view.note();
      }

      // ── filters: this is the "other instructions like relationship types" the
      //    reader asked to keep beside the graph rather than in a corner of it ──
      function renderFilters(view) {
        clear(filtersEl);
        var list = (view && view.filters && view.filters()) || [];
        list.forEach(function (f) {
          var group = document.createElement("div");
          group.className = "fgroup";
          var head = document.createElement("div");
          head.className = "fhead";
          head.appendChild(span("flab", f.label));
          var all = document.createElement("button");
          all.type = "button";
          all.className = "fclear";
          all.textContent = "all";
          all.addEventListener("click", function () {
            f.options.forEach(function (o) { if (f.hidden(o.value)) f.set(o.value, true); });
            renderFilters(view); updateLive();
          });
          head.appendChild(all);
          group.appendChild(head);
          var opts = document.createElement("div");
          opts.className = "fopts";
          f.options.forEach(function (o) {
            var hidden = f.hidden(o.value);
            var b = document.createElement("button");
            b.type = "button";
            b.className = "fopt" + (hidden ? " off" : "");
            b.setAttribute("aria-pressed", hidden ? "false" : "true");
            b.title = hidden ? o.value + " is hidden \\u2014 click to show" : o.value + " \\u2014 click to hide";
            var sw = span("sw" + (o.dash === "dashed" ? " dashed" : ""));
            if (o.color) sw.style.background = o.color;
            b.appendChild(sw);
            b.appendChild(span("fl", o.value));
            b.appendChild(span("ct", String(o.count)));
            b.addEventListener("click", function () {
              f.set(o.value, f.hidden(o.value));
              renderFilters(view);
              updateLive();
            });
            opts.appendChild(b);
          });
          group.appendChild(opts);
          filtersEl.appendChild(group);
        });
        filterSection.classList.toggle("hide", !list.length);
      }

      // ── the layout choice: the graph view's own arrangement, offered where the
      //    reader is already looking. A view that publishes no layouts hides this
      //    section entirely, because a switch that switches nothing is a lie.
      function renderLayouts(view) {
        clear(layoutsEl);
        var list = (view && view.layouts && view.layouts()) || [];
        layoutSection.classList.toggle("hide", !list.length);
        if (!list.length) { layoutHintEl.textContent = ""; return; }
        var current = (view.layout && view.layout()) || "regions";
        list.forEach(function (l) {
          var b = document.createElement("button");
          b.type = "button";
          b.className = "lay" + (l.value === current ? " active" : "");
          b.textContent = l.label;
          b.setAttribute("aria-pressed", l.value === current ? "true" : "false");
          b.title = l.hint || l.label;
          b.addEventListener("click", function () {
            var v = api();
            chosenLayout = l.value;
            if (v && v.setLayout) v.setLayout(l.value);
            refresh();
            flash("layout: " + l.label);
          });
          layoutsEl.appendChild(b);
        });
        var active = list.filter(function (l) { return l.value === current; })[0] || list[0];
        layoutHintEl.textContent = active && active.hint ? active.hint : "";
      }

      // ── the encoding key ─────────────────────────────────────────────────
      function renderEncoding(view) {
        clear(encodingEl);
        var rows = (view && view.encoding && view.encoding()) || [];
        rows.forEach(function (r) {
          var row = document.createElement("div");
          row.className = "krow";
          var sw;
          if (r.color === "lang") sw = span("langs");
          else if (r.swatch === "ring") { sw = span("ring"); sw.style.borderColor = r.color; }
          else if (r.swatch === "line") { sw = span("bar"); sw.style.borderTopColor = r.color; }
          else { sw = span("dot"); sw.style.background = r.color; }
          row.appendChild(sw);
          row.appendChild(span("", r.text));
          encodingEl.appendChild(row);
        });
        encodingSection.classList.toggle("hide", !rows.length);
      }

      // ── downloads ────────────────────────────────────────────────────────
      function download(name, text, mime) {
        try {
          var blob = new Blob([text], { type: mime });
          var url = URL.createObjectURL(blob);
          var a = document.createElement("a");
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
          flash("saved " + name);
        } catch (e) {
          flash("this frame refused the download \\u2014 use the browser Save command");
        }
      }
      function csvCell(value) {
        var s = value == null ? "" : String(value);
        return /[",\\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }
      function csv(headers, rows) {
        return headers.join(",") + "\\n" + rows.map(function (r) { return r.map(csvCell).join(","); }).join("\\n") + "\\n";
      }
      function downloadData(kind) {
        var view = api();
        var data = view && view.data ? view.data() : null;
        if (!data) { flash("this view has no data port yet \\u2014 its sidebar pass is next"); return; }
        if (kind === "json") { download("bb-visualize-data.json", JSON.stringify(data, null, 2), "application/json"); return; }
        if (kind === "nodes") {
          download("bb-visualize-nodes.csv", csv(
            ["id", "name", "type", "language", "file", "line", "lineEnd", "qualifiedName", "gravity", "stale"],
            (data.nodes || []).map(function (n) { return [n.id, n.name, n.type, n.group, n.filePath, n.line, n.lineEnd, n.qualifiedName, n.gravity, n.stale === true]; }),
          ), "text/csv");
          return;
        }
        download("bb-visualize-edges.csv", csv(
          ["source", "target", "type", "occurrences", "confidence", "evidenceTier", "crossLanguage", "stale", "rowId"],
          (data.links || []).map(function (l) { return [l.source, l.target, l.type, l.occurrences, l.confidence, l.evidenceTier, l.crossLanguage === true, l.stale === true, l.rowId]; }),
        ), "text/csv");
      }
      /** Which download ports the mounted view actually has.
       *
       *  Empty is not the same as absent: a view with no edges is asked for its links and
       *  answers with an empty list, which means "there is nothing to download", while a view
       *  with no data port at all means "this is not built yet". The two are reported
       *  differently on the buttons. */
      function dataPorts(view) {
        try {
          var d = view.data();
          return { json: !!d, nodes: !!(d && d.nodes && d.nodes.length), edges: !!(d && d.links && d.links.length) };
        } catch (e) { return null; }
      }
      function flash(message) {
        statusEl.textContent = message;
        statusEl.classList.add("flash");
        setTimeout(function () { statusEl.classList.remove("flash"); statusEl.textContent = labels[frame.dataset.mode] + " view loaded"; }, 3200);
      }

      // ── rebuild everything the sidebar shows for the mounted document ────
      function refresh() {
        var view = api();
        var declared = documentView();
        var label = labels[declared] || "View";
        titleEl.textContent = (view && view.title) || label;
        subEl.textContent = (view && view.subtitle) || "bb_visualize \\u00b7 self-contained \\u00b7 no network";
        renderData(view);
        renderFilters(view);
        renderLayouts(view);
        // A mount that came back in the other arrangement is corrected here, and the
        // switch is re-rendered so the active chip is the one actually drawing.
        if (declared === "graph" && chosenLayout && view && view.layout && view.setLayout && view.layout() !== chosenLayout) {
          view.setLayout(chosenLayout);
          renderLayouts(api());
        }
        renderEncoding(view);
        // The downloads are per PORT, not per view: a control that downloads an empty file
        // is a control that lies, so the port decides, and the title names which one is
        // missing and why.
        var ports = view && view.data ? dataPorts(view) : null;
        dlButtons.forEach(function (b) {
          var kind = b.dataset.dl;
          b.disabled = kind !== "page" && !(ports && ports[kind]);
          b.title = !b.disabled ? ""
            : !ports ? "this view publishes no data port yet"
            : kind === "edges" ? "this view draws no edges"
            : "this view has no " + kind + " port";
        });
        fitBtn.disabled = !(view && view.fit);
        clearBtn.disabled = !(view && view.reset);
        // The instruction line belongs to the VIEW, published as its hint port, for the same
        // reason the rows above do: the shell never holds a sentence about the drawing.
        viewNoteEl.textContent = (view && view.hint) || "";
        fallbackEl.hidden = !!view;
        if (!view) {
          // Accurate about what is on screen: with no API there is no census to print and no
          // data port to download, so the sections are EMPTY and the downloads disabled rather
          // than filled with another view's numbers.
          fallbackEl.textContent = label + " does not publish a sidebar API yet, so the census, the filters, the encoding key and the data downloads below are disabled rather than filled with another view's numbers \\u2014 they arrive in its own pass. The drawing and its own controls are in the frame.";
        }
        updateLive();
      }

      function mount(next) {
        frame.dataset.mode = next;
        frame.addEventListener("load", refresh, { once: true });
        frame.srcdoc = docs[next];
        buttons.forEach(function (button) {
          button.classList.toggle("active", button.dataset.mode === next);
          button.setAttribute("aria-selected", button.dataset.mode === next ? "true" : "false");
        });
        statusEl.textContent = labels[next] + " view loaded";
        if (liveTimer) clearInterval(liveTimer);
        liveTimer = setInterval(updateLive, 700);
      }

      buttons.forEach(function (button) {
        button.addEventListener("click", function () { mount(button.dataset.mode); });
      });
      fitBtn.addEventListener("click", function () { var v = api(); if (v && v.fit) v.fit(); });
      clearBtn.addEventListener("click", function () {
        var v = api();
        if (v && v.reset) v.reset();
        refresh();
      });
      dlButtons.forEach(function (button) {
        button.addEventListener("click", function () {
          var kind = button.dataset.dl;
          if (kind === "page") { download("bb-visualize.html", "<!DOCTYPE html>\\n" + document.documentElement.outerHTML, "text/html"); return; }
          downloadData(kind);
        });
      });
      mount("graph");
    }());
  `
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Backbencher Visualizer</title>",
    "<style>", STUDIO_CSS, "</style>",
    "</head>",
    "<body>",
    '<main id="workbench">',
    '<aside id="side" aria-label="Visualization panel">',
    '<header id="brand">',
    '<div class="mark">BB / VISUALIZE</div>',
    '<h1 id="viewTitle">Graph</h1>',
    '<p id="viewSub">bb_visualize &middot; self-contained &middot; no network</p>',
    "</header>",
    '<section class="sec" id="modeSection">',
    '<h2 class="secLabel">Mode</h2>',
    '<div id="modes" role="tablist" aria-label="Visualization mode">',
    '<button class="mode active" type="button" role="tab" data-mode="graph" aria-selected="true"><span class="glyph">&#9678;</span>Graph</button>',
    "</div>",
    "</section>",
    // The layout choice sits directly under the mode, because it shapes the picture the
    // same way the mode does: which arrangement of the same facts is on screen. Its body
    // is built from the mounted view's own API, so a view with one arrangement (or none)
    // shows no switch.
    '<section class="sec" id="layoutSection">',
    '<h2 class="secLabel">Layout</h2>',
    '<div id="layouts"></div>',
    '<p class="layHint" id="layoutHint"></p>',
    "</section>",
    '<section class="sec" id="liveSection">',
    '<h2 class="secLabel">On screen</h2>',
    '<div id="live" class="live">&mdash;</div>',
    "</section>",
    '<section class="sec" id="dataSection">',
    '<h2 class="secLabel">Data</h2>',
    '<div id="census" class="kv"></div>',
    '<p id="note" class="note"></p>',
    '<p id="fallback" class="note" hidden></p>',
    "</section>",
    '<section class="sec" id="filterSection">',
    '<h2 class="secLabel">Filters</h2>',
    '<div id="filters"></div>',
    "</section>",
    '<section class="sec" id="encodingSection">',
    '<h2 class="secLabel">Encoding</h2>',
    '<div id="encoding" class="key"></div>',
    "</section>",
    '<section class="sec" id="actionSection">',
    '<h2 class="secLabel">View</h2>',
    '<div class="actions">',
    '<button class="act" id="fit" type="button">fit all</button>',
    '<button class="act" id="clear" type="button">show everything</button>',
    "</div>",
    // The whole instruction line lives HERE rather than drawn over the canvas. The view
    // ships the same sentence as a first-run hint that fades on the first gesture; the
    // reader asked for the screen to hold the drawing, the search and what changes, and
    // a permanent banner of instructions is none of those.
    '<p class="note" id="viewNote"></p>',
    "</section>",
    '<section class="sec" id="downloadSection">',
    '<h2 class="secLabel">Download</h2>',
    '<div class="dls">',
    '<button class="dl" type="button" data-dl="page"><b>page &middot; html</b><span>the whole viewer, offline</span></button>',
    '<button class="dl" type="button" data-dl="json"><b>data &middot; json</b><span>everything behind this picture</span></button>',
    '<button class="dl" type="button" data-dl="nodes"><b>nodes &middot; csv</b><span>one row per node or symbol</span></button>',
    '<button class="dl" type="button" data-dl="edges"><b>edges &middot; csv</b><span>one row per stored edge</span></button>',
    "</div>",
    "</section>",
    '<footer id="status" aria-live="polite">Graph view loaded</footer>',
    "</aside>",
    '<div id="content"><iframe id="view" title="Backbencher visualization"></iframe></div>',
    "</main>",
    '<script id="bb-studio-data" type="application/json">', payload, "</script>",
    "<script>", script, "</script>",
    "</body>",
    "</html>",
  ].join("\n")
}
