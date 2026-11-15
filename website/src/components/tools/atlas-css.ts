// The /tools console, painted in the Evidence Atlas paper system.
//
// WHY A STYLESHEET AND NOT UTILITIES
// ----------------------------------
// The console is one interaction repeated sixteen times: a rail row selects a
// panel, a fragment selects one too, and the selected row paints itself. That
// is generated state (see ./console-css.ts) and it has to be expressed as CSS
// anyway — so the rest of the surface lives in the same stylesheet, in the
// atlas tokens, rather than mixing fifty utility colours with sixteen generated
// rules that would then disagree about what "selected" looks like.
//
// Every value here is a token from the `.atlas` scope in globals.css: paper
// ground, ink type, ember for the one selected thing, hairlines for structure.
// No dark plate, no card-on-card, no rounded-loud surface: the row and the
// panel are separated by rules, not by boxes. Type sizes obey the atlas floor
// (13px for anything a reader must read; mono only for data).
//
// Specificity note: the panel article carries the shared `.reading` class, so
// the prose inside inherits the atlas reading measure from globals.css. Every
// rule below that must override a `.reading` element rule is written with three
// class selectors (`.atlas .tool-panel .x`), which outranks `.atlas .reading p`.

export const TOOLS_ATLAS_CSS = `
/* ── the console frame ─────────────────────────────────────────────── */
.atlas .tools-shell {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(30px, 4vw, 44px);
  align-items: start;
  padding: clamp(26px, 3.2vw, 40px) 0 0;
}
@media (min-width: 1000px) {
  .atlas .tools-shell {
    grid-template-columns: minmax(0, 19rem) minmax(0, 1fr);
    gap: clamp(40px, 5vw, 76px);
  }
}

/* ── the index (left rail) ─────────────────────────────────────────── */
.atlas .tools-shell > * { min-width: 0; }
.atlas .tools-rail { min-width: 0; }
@media (min-width: 1000px) {
  .atlas .tools-rail { position: sticky; top: 26px; }
}
.atlas .tools-rail-scroll {
  max-height: 64vh;
  overflow-y: auto;
  padding-right: 6px;
  scrollbar-width: thin;
}
@media (min-width: 1000px) {
  .atlas .tools-rail-scroll { max-height: calc(100vh - 52px); }
}
@media (min-width: 640px) and (max-width: 999px) {
  .atlas .tools-rail-scroll { max-height: none; overflow-y: visible; }
  .atlas .tools-rows { display: grid; grid-template-columns: 1fr 1fr; column-gap: 26px; }
}
.atlas .tools-group + .tools-group { margin-top: 30px; }
.atlas .tools-group-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--at-rule-strong);
  font-family: var(--font-jbmono), monospace;
  font-size: 11px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .tools-group-label .n {
  color: var(--at-muted);
  font-variant-numeric: tabular-nums;
}
.atlas .tools-rows { list-style: none; margin: 0; padding: 0; }
.atlas .tools-row {
  display: grid;
  grid-template-columns: 1.9rem minmax(0, 1fr);
  gap: 9px;
  align-items: start;
  padding: 11px 10px 12px 8px;
  border-bottom: 1px solid var(--at-rule);
  border-left: 2px solid transparent;
  cursor: pointer;
  transition: background-color 0.15s ease, border-left-color 0.15s ease;
}
.atlas .tools-row:hover { background-color: rgba(18, 16, 12, 0.04); }
.atlas .tools-row-index {
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  line-height: 1.95;
  letter-spacing: 0.08em;
  color: var(--at-muted);
  font-variant-numeric: tabular-nums;
}
.atlas .tools-row-body { min-width: 0; display: block; }
.atlas .tools-row-name {
  display: block;
  font-family: var(--font-jbmono), monospace;
  font-size: 13.5px;
  font-weight: 500;
  line-height: 1.35;
  color: var(--at-ink-2);
  transition: color 0.15s ease;
}
.atlas .tools-row-role {
  display: none;
  margin-top: 3px;
  font-family: var(--font-hanken), system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.5;
  color: var(--at-ink-2);
}
@media (min-width: 640px) {
  .atlas .tools-row-role { display: block; }
}
.atlas .tools-row-meter {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 8px;
}
.atlas .rail-meter-track {
  display: block;
  height: 2px;
  min-width: 0;
  flex: 1;
  background-color: rgba(18, 16, 12, 0.14);
}
.atlas .rail-meter-fill {
  display: block;
  height: 100%;
  background-color: #8A7F6E;
  transition: background-color 0.15s ease;
}
.atlas .rail-words {
  flex: none;
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  line-height: 1;
  color: var(--at-muted);
  font-variant-numeric: tabular-nums;
  transition: color 0.15s ease;
}
.atlas .tools-rail-note {
  margin: 26px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--at-rule);
  font-family: var(--font-hanken), system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.65;
  color: var(--at-muted);
}
/* The paper surface needs the darker ember ring, not the bright one the legacy
   dark canvas uses; the affordance itself is the global rule's (kept intact for
   the design gate), only its colour is re-scoped here. */
.atlas .console-index label:has(> input:focus-visible) {
  outline-color: var(--at-ember);
}

/* ── the panel (right) ─────────────────────────────────────────────── */
.atlas .tool-panel { min-width: 0;
  padding-bottom: 10px;
  padding-left: clamp(14px, 1.5vw, 20px);
  border-left: 2px solid transparent;
}
.atlas .tool-panel[data-panel]:target { border-left-color: var(--at-ember); }
.atlas .tool-panel .tool-head {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  padding-bottom: 22px;
  border-bottom: 1px solid var(--at-rule-strong);
}
@media (min-width: 760px) {
  .atlas .tool-panel .tool-head { grid-template-columns: minmax(0, 1fr) 13rem; align-items: end; gap: 34px; }
}
.atlas .tool-panel .tool-name {
  font-family: var(--font-jbmono), monospace;
  font-size: clamp(26px, 3.4vw, 34px);
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.01em;
  color: var(--at-ink);
  margin: 0;
  max-width: none;
}
.atlas .tool-panel .tool-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  margin: 12px 0 0;
  max-width: none;
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  line-height: 1.5;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .tool-panel .tool-tags span {
  border: 1px solid var(--at-rule);
  border-radius: 2px;
  padding: 3px 7px;
}
.atlas .tool-panel .tool-record { display: block; min-width: 0; }
.atlas .tool-panel .tool-record-label {
  margin: 0 0 6px;
  max-width: none;
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  line-height: 1.4;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .tool-panel .tool-record-value {
  display: flex;
  align-items: baseline;
  gap: 9px;
  margin: 0;
  max-width: none;
}
.atlas .tool-panel .tool-record-value b {
  font-family: var(--font-jbmono), monospace;
  font-size: 24px;
  font-weight: 500;
  line-height: 1;
  color: var(--at-ink);
  font-variant-numeric: tabular-nums;
}
.atlas .tool-panel .tool-record-value span { font-size: 13px; line-height: 1.35; color: var(--at-ink-2); }
.atlas .tool-panel .tool-record-meter {
  display: block;
  height: 3px;
  margin-top: 12px;
  background-color: rgba(18, 16, 12, 0.14);
}
.atlas .tool-panel .tool-record-meter i { display: block; height: 100%; background-color: var(--at-ember); }
.atlas .tool-panel .tool-record-note {
  margin: 10px 0 0;
  max-width: none;
  font-size: 13px;
  line-height: 1.6;
  color: var(--at-muted);
}

/* the decision sentence — the panel's one editorial claim, marked by a rule */
.atlas .tool-panel .tool-use {
  border-left: 2px solid var(--at-ember);
  padding: 2px 0 2px 18px;
  margin: 26px 0 0;
}
.atlas .tool-panel .tool-use-label {
  margin: 0 0 6px;
  max-width: none;
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  line-height: 1.4;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--at-ember);
}
.atlas .tool-panel .tool-use p.when {
  margin: 0;
  max-width: 58ch;
  font-family: var(--font-fraunces), Georgia, serif;
  font-size: 19px;
  line-height: 1.45;
  color: var(--at-ink);
}

/* section spacing inside the reading column */
.atlas .tool-panel h3 { margin-top: 36px; }
.atlas .tool-panel > h3:first-of-type { margin-top: 0; }
.atlas .tool-panel p.lead {
  font-size: 18px;
  line-height: 1.65;
  color: var(--at-ink);
  max-width: 62ch;
}

/* the declared limits — one commitment per row, hairline separated */
.atlas .tool-panel .tool-limits { border-top: 1px solid var(--at-rule-strong); margin-top: 4px; }
.atlas .tool-panel .tool-limits p {
  margin: 0;
  padding: 14px 0 15px;
  border-bottom: 1px solid var(--at-rule);
  max-width: 68ch;
}
.atlas .tool-panel .tool-limits p::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-right: 12px;
  background: var(--at-ember);
  vertical-align: 2px;
}

/* the questions map: a term and the field that answers it */
.atlas .tool-panel .tool-questions { display: grid; gap: 0; margin: 6px 0 0; border-top: 1px solid var(--at-rule); }
.atlas .tool-panel .tool-question {
  display: grid;
  grid-template-columns: 1fr;
  gap: 3px;
  padding: 10px 0;
  border-bottom: 1px solid var(--at-rule);
}
@media (min-width: 620px) {
  .atlas .tool-panel .tool-question { grid-template-columns: 12rem minmax(0, 1fr); gap: 20px; align-items: baseline; }
}
.atlas .tool-panel .tool-question dt {
  font-family: var(--font-jbmono), monospace;
  font-size: 12.5px;
  color: var(--at-ember);
  overflow-wrap: anywhere;
}
.atlas .tool-panel .tool-question dd { margin: 0; font-size: 14.5px; line-height: 1.6; color: var(--at-ink-2); max-width: 62ch; }

/* the shape of the call: two columns, unboxed */
.atlas .tool-panel .tool-shape { display: grid; grid-template-columns: 1fr; gap: 26px; }
@media (min-width: 1080px) {
  .atlas .tool-panel .tool-shape { grid-template-columns: minmax(0, 1fr) minmax(0, 20rem); gap: 46px; }
}
.atlas .tool-panel .tool-sheet { display: grid; gap: 20px; align-content: start; }
.atlas .tool-panel .tool-sheet .sheet-block {
  display: block;
  padding-top: 12px;
  border-top: 1px solid var(--at-rule);
}
.atlas .tool-panel .tool-sheet .k,
.atlas .tool-panel .tool-kicker {
  margin: 0;
  max-width: none;
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  line-height: 1.4;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .tool-panel .tool-modes { display: flex; flex-wrap: wrap; gap: 5px; margin: 9px 0 0; padding: 0; list-style: none; }
.atlas .tool-panel .tool-modes li {
  border: 1px solid var(--at-rule);
  border-radius: 2px;
  padding: 3px 6px;
  margin: 0;
  font-family: var(--font-jbmono), monospace;
  font-size: 12px;
  line-height: 1.5;
  color: var(--at-ink-2);
}
.atlas .tool-panel .tool-defaults { margin: 9px 0 0; padding: 0; list-style: none; display: grid; gap: 5px; }
.atlas .tool-panel .tool-defaults li { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--at-ink-2); }
.atlas .tool-panel .tool-sheet pre {
  margin: 9px 0 0;
  padding: 12px 14px;
  background: var(--at-night);
  color: var(--at-bone);
  border-radius: 3px;
  overflow-x: auto;
  font-family: var(--font-jbmono), monospace;
  font-size: 12px;
  line-height: 1.7;
  max-width: 100%;
}
.atlas .tool-panel .tool-sheet pre code { background: transparent; color: inherit; padding: 0; font-size: 12px; }
.atlas .tool-panel .tool-sheet code {
  font-family: var(--font-jbmono), monospace;
  font-size: 12.5px;
  color: var(--at-ink);
  background: rgba(18, 16, 12, 0.055);
  padding: 1px 4px;
  border-radius: 2px;
}
.atlas .tool-panel .tool-ref {
  margin: 9px 0 0;
  max-width: none;
  font-family: var(--font-jbmono), monospace;
  font-size: 12px;
  line-height: 1.6;
  color: var(--at-ink-2);
  overflow-wrap: anywhere;
}
.atlas .tool-panel .tool-note-empty { margin: 9px 0 0; font-size: 13.5px; line-height: 1.6; color: var(--at-muted); }

/* parameters: a real table, hairline rules, the wrapper scrolls */
.atlas .tool-panel .tool-table-wrap { overflow-x: auto; border-top: 1px solid var(--at-rule-strong); }
.atlas .tool-panel .tool-table-wrap table { margin: 0 0 22px; min-width: 640px; }
.atlas .tool-panel .tool-param-name { font-family: var(--font-jbmono), monospace; font-size: 13px; color: var(--at-ink); }
.atlas .tool-panel .tool-param-type { font-family: var(--font-jbmono), monospace; font-size: 12px; color: var(--at-muted); }
.atlas .tool-panel .tool-param-req {
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--at-ink-2);
}
.atlas .tool-panel .tool-param-req[data-required="true"] { color: var(--at-ember); }

/* evidence on request: a disclosure row, hairline, no card */
.atlas .tool-panel .tool-more { margin-top: 36px; border-top: 1px solid var(--at-rule-strong); }
.atlas .tool-panel .tool-more > summary {
  cursor: pointer;
  padding: 14px 0;
  font-family: var(--font-jbmono), monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--at-ink-2);
}
.atlas .tool-panel .tool-more > summary:hover { color: var(--at-ink); }
.atlas .tool-panel .tool-more[open] > summary { color: var(--at-ink); }
.atlas .tool-panel .tool-more section { padding: 4px 0 18px; border-top: 1px solid var(--at-rule); }
.atlas .tool-panel .tool-more h3 { margin-top: 22px; }

/* ── the closing note + doors ──────────────────────────────────────── */
.atlas .tools-foot {
  margin-top: clamp(34px, 4vw, 48px);
  padding-top: 20px;
  border-top: 1px solid var(--at-rule-strong);
  max-width: 900px;
}
.atlas .tools-foot p {
  margin: 0 0 12px;
  max-width: 70ch;
  font-size: 14px;
  line-height: 1.7;
  color: var(--at-ink-2);
}
.atlas .tools-foot code {
  font-family: var(--font-jbmono), monospace;
  font-size: 0.88em;
  color: var(--at-ink);
  background: rgba(18, 16, 12, 0.055);
  padding: 1px 5px;
  border-radius: 3px;
}
.atlas .tools-doors { display: flex; flex-wrap: wrap; gap: 14px 28px; align-items: center; margin-top: 18px; }
.atlas .tools-doors .mono-note { font-family: var(--font-jbmono), monospace; font-size: 12px; color: var(--at-muted); }
`
