/**
 * The shared HTML shell for bb_visualize.
 *
 * Each view remains an independently generated, self-contained document. The
 * studio only owns navigation: it mounts one document at a time in an iframe,
 * so switching views never requires another command or another index query.
 */

const STUDIO_CSS = `
  :root {
    color-scheme: dark;
    --ink: #f5f1e8;
    --muted: #a39d91;
    --line: rgba(245, 241, 232, .14);
    --panel: rgba(19, 22, 27, .92);
    --accent: #e7b56a;
    --accent-soft: rgba(231, 181, 106, .16);
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #090b0e; color: var(--ink);
    font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; overflow: hidden; }
  body::before { content: ""; position: fixed; inset: 0; pointer-events: none;
    background: radial-gradient(circle at 78% 12%, rgba(231,181,106,.09), transparent 34%),
      linear-gradient(115deg, rgba(255,255,255,.025), transparent 32%); }
  #studio { position: relative; height: 100%; isolation: isolate; }
  #viewport { position: absolute; inset: 0; }
  #view { width: 100%; height: 100%; border: 0; display: block; background: #090b0e; }
  #rail { position: absolute; z-index: 5; left: 18px; top: 18px; bottom: 18px; width: 56px;
    display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 12px 8px;
    border: 1px solid var(--line); border-radius: 28px; background: var(--panel);
    box-shadow: 0 18px 55px rgba(0,0,0,.42); transition: width .28s ease, border-radius .28s ease; }
  #rail.open { width: 248px; border-radius: 20px; align-items: stretch; padding: 14px; }
  #brand { color: var(--accent); font-size: 10px; letter-spacing: .18em; writing-mode: vertical-rl;
    transform: rotate(180deg); font-weight: 700; }
  #rail.open #brand { writing-mode: horizontal-tb; transform: none; padding: 4px 8px 10px; }
  #toggle { border: 1px solid var(--line); color: var(--ink); background: transparent; border-radius: 50%;
    width: 36px; height: 36px; cursor: pointer; font-size: 18px; }
  #rail.open #toggle { align-self: flex-end; margin-top: -46px; }
  #modes { display: flex; flex-direction: column; gap: 7px; margin-top: 10px; }
  .mode { border: 1px solid transparent; border-radius: 12px; background: transparent; color: var(--muted);
    cursor: pointer; padding: 10px 8px; text-align: left; font: inherit; }
  .mode:hover { color: var(--ink); border-color: var(--line); }
  .mode.active { color: var(--ink); border-color: rgba(231,181,106,.55); background: var(--accent-soft); }
  .mode .glyph { display: inline-grid; place-items: center; width: 28px; height: 22px; color: var(--accent);
    font-weight: 700; }
  .mode .label { display: none; margin-left: 6px; }
  #rail.open .mode .label { display: inline; }
  #status { display: none; margin-top: auto; color: var(--muted); font-size: 11px; padding: 8px; }
  #rail.open #status { display: block; border-top: 1px solid var(--line); }
  @media (max-width: 720px) {
    #rail { left: 10px; right: 10px; top: auto; bottom: 10px; width: auto; height: 54px;
      flex-direction: row; border-radius: 18px; justify-content: space-between; }
    #brand { writing-mode: horizontal-tb; transform: none; }
    #modes { flex-direction: row; margin: 0; }
    #rail.open { width: auto; height: auto; flex-direction: column; align-items: stretch; }
    #rail.open #modes { flex-direction: column; }
  }
`

function escapeScript(value: string): string {
  return value.replace(/</g, "\\u003c")
}

export function renderVisualizationStudio(documents: {
  graph: string
  codemap: string
  class: string
}): string {
  const payload = escapeScript(JSON.stringify(documents))
  const script = `
    (function () {
      var docs = JSON.parse(document.getElementById("bb-studio-data").textContent);
      var frame = document.getElementById("view");
      var rail = document.getElementById("rail");
      var status = document.getElementById("status");
      var buttons = Array.prototype.slice.call(document.querySelectorAll(".mode"));
      var labels = { graph: "Graph", codemap: "Code map", class: "UML" };
      function tuneViewport() {
        var doc = frame.contentDocument;
        if (!doc) return;
        var style = doc.createElement("style");
        style.textContent = [
          "@media (max-width:760px) {",
          "#hud { width: 210px !important; max-width: 210px !important; padding: 12px 14px !important; }",
          "#stats { grid-template-columns: auto minmax(0, 1fr) !important; gap: 2px 12px !important; }",
          "#stats span { overflow-wrap: anywhere !important; }",
          "#search { width: 170px !important; }",
          "#search input { width: 100% !important; }",
          "}"
        ].join("");
        doc.head.appendChild(style);
      }
      function mount(mode) {
        frame.addEventListener("load", tuneViewport, { once: true });
        frame.srcdoc = docs[mode];
        buttons.forEach(function (button) {
          button.classList.toggle("active", button.dataset.mode === mode);
          button.setAttribute("aria-selected", button.dataset.mode === mode ? "true" : "false");
        });
        status.textContent = labels[mode] + " view loaded";
      }
      document.getElementById("toggle").addEventListener("click", function () {
        var open = rail.classList.toggle("open");
        this.setAttribute("aria-expanded", open ? "true" : "false");
        this.textContent = open ? "×" : "＋";
      });
      buttons.forEach(function (button) {
        button.addEventListener("click", function () { mount(button.dataset.mode); });
      });
      mount("graph");
    }());
  `
  return [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Backbencher Visualization Studio</title>",
    "<style>", STUDIO_CSS, "</style></head><body>",
    '<main id="studio">',
    '<div id="viewport"><iframe id="view" title="Backbencher visualization"></iframe></div>',
    '<nav id="rail" aria-label="Visualization views">',
    '<div id="brand">BB / VISUALIZE</div>',
    '<button id="toggle" type="button" aria-label="Open visualization menu" aria-expanded="false">＋</button>',
    '<div id="modes" role="tablist" aria-label="Visualization mode">',
    '<button class="mode active" type="button" role="tab" data-mode="graph" aria-selected="true"><span class="glyph">◌</span><span class="label">Graph</span></button>',
    '<button class="mode" type="button" role="tab" data-mode="codemap" aria-selected="false"><span class="glyph">▦</span><span class="label">Code</span></button>',
    '<button class="mode" type="button" role="tab" data-mode="class" aria-selected="false"><span class="glyph">◇</span><span class="label">UML</span></button>',
    "</div>",
    '<div id="status" aria-live="polite">Graph view loaded</div>',
    "</nav></main>",
    '<script id="bb-studio-data" type="application/json">', payload, "</script>",
    "<script>", script, "</script></body></html>",
  ].join("\n")
}
