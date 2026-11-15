// The /languages console, painted in the Evidence Atlas paper system.
//
// Same reasoning as components/tools/atlas-css.ts: the console has generated
// selection state (see ./family-data.ts), so the paint belongs in one token-driven
// stylesheet rather than in fifty utility colours. Paper ground, ink type, ember
// for the one selected family, hairlines for structure. No dark rail, no icon
// tinting per language (the dataset's per-family hues are a legacy of the old
// dark console and are not used here), no pills.
//
// Specificity note: the panel article carries the shared `.reading` class, so its
// prose inherits the atlas reading measure from globals.css; rules that must
// override a `.reading` element rule are written with three class selectors.

export const LANGUAGES_ATLAS_CSS = `
/* ── the index's own heading block ─────────────────────────────────── */
.atlas .languages-index { padding-top: clamp(28px, 3.4vw, 44px); }
.atlas .lang-index-head {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  padding-bottom: clamp(20px, 2.6vw, 28px);
  border-bottom: 1px solid var(--at-rule-strong);
}
@media (min-width: 900px) {
  .atlas .lang-index-head { grid-template-columns: minmax(0, 1fr) 20rem; gap: 52px; align-items: end; }
}
.atlas .languages-index h2 {
  margin: 0;
  font-family: var(--font-fraunces), Georgia, serif;
  font-weight: 400;
  font-size: clamp(28px, 3vw, 38px);
  line-height: 1.08;
  letter-spacing: -0.022em;
  color: var(--at-ink);
  max-width: 24ch;
}
.atlas .languages-index p.intro {
  margin: 12px 0 0;
  max-width: 66ch;
  font-size: 15.5px;
  line-height: 1.7;
  color: var(--at-ink-2);
}
.atlas .lang-notes {
  margin: 0;
  padding-left: 18px;
  border-left: 1px solid var(--at-rule-strong);
  font-size: 13px;
  line-height: 1.68;
  color: var(--at-muted);
}
.atlas .lang-notes b {
  display: block;
  margin-bottom: 6px;
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--at-muted);
}

/* ── the console frame ─────────────────────────────────────────────── */
.atlas .languages-shell {
  display: grid;
  grid-template-columns: 1fr;
  gap: clamp(28px, 3.6vw, 40px);
  align-items: start;
  padding: clamp(24px, 3vw, 36px) 0 0;
}
@media (min-width: 1020px) {
  .atlas .languages-shell {
    grid-template-columns: minmax(0, 19rem) minmax(0, 1fr);
    gap: clamp(40px, 5vw, 72px);
  }
}

/* ── the rail ──────────────────────────────────────────────────────── */
.atlas .lang-rail {
  min-width: 0;
  max-height: 66vh;
  overflow-y: auto;
  padding-right: 6px;
  scrollbar-width: thin;
}
@media (min-width: 1020px) {
  .atlas .lang-rail { position: sticky; top: 26px; max-height: calc(100vh - 52px); }
}
@media (min-width: 640px) and (max-width: 1019px) {
  .atlas .lang-rail { max-height: none; overflow-y: visible; }
  .atlas .lang-rows { display: grid; grid-template-columns: 1fr 1fr; column-gap: 24px; }
}
.atlas .lang-band + .lang-band { margin-top: 26px; }
.atlas .lang-band-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding-bottom: 7px;
  border-bottom: 1px solid var(--at-rule-strong);
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .lang-band-label .n { color: var(--at-muted); font-variant-numeric: tabular-nums; }
.atlas .lang-rows { list-style: none; margin: 0; padding: 0; }
.atlas .lang-row {
  display: flex;
  align-items: flex-start;
  padding-left: 6px;
  border-bottom: 1px solid var(--at-rule);
  border-left: 2px solid transparent;
  transition: background-color 0.15s ease, border-left-color 0.15s ease;
}
.atlas .lang-row:hover { background-color: rgba(18, 16, 12, 0.04); }
.atlas .lang-row-label {
  display: grid;
  grid-template-columns: 1.7rem minmax(0, 1fr);
  gap: 7px;
  flex: 1;
  min-width: 0;
  padding: 8px 3px 9px 0;
  cursor: pointer;
}
.atlas .lang-row-index {
  font-family: var(--font-jbmono), monospace;
  font-size: 10px;
  line-height: 1.9;
  letter-spacing: 0.06em;
  color: var(--at-muted);
  font-variant-numeric: tabular-nums;
}
.atlas .lang-row-body { min-width: 0; display: block; }
.atlas .lang-row-name {
  display: block;
  font-size: 13.5px;
  font-weight: 550;
  line-height: 1.35;
  letter-spacing: -0.003em;
  color: var(--at-ink-2);
  transition: color 0.15s ease;
}
.atlas .lang-row-extracts {
  display: block;
  margin-top: 2px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--at-muted);
  overflow-wrap: anywhere;
}
.atlas .lang-row-link {
  flex: none;
  padding: 9px 3px;
  font-family: var(--font-jbmono), monospace;
  font-size: 12px;
  line-height: 1;
  color: var(--at-muted);
  transition: color 0.15s ease;
}
.atlas .lang-row-link:hover { color: var(--at-ember); }
.atlas .lang-rail-note {
  margin: 24px 0 0;
  padding-top: 14px;
  border-top: 1px solid var(--at-rule);
  font-size: 13px;
  line-height: 1.65;
  color: var(--at-muted);
}
/* paper needs the darker ember focus ring; the affordance stays the global rule */
.atlas .console-index label:has(> input:focus-visible) { outline-color: var(--at-ember); }

/* ── the record panel ──────────────────────────────────────────────── */
.atlas .languages-panels { min-width: 0; }
.atlas .lang-panel {
  padding-bottom: 8px;
  padding-left: clamp(14px, 1.5vw, 20px);
  border-left: 2px solid transparent;
}
.atlas .lang-panel[data-panel]:target { border-left-color: var(--at-ember); }
.atlas .lang-panel .lang-head {
  padding-bottom: 18px;
  border-bottom: 1px solid var(--at-rule-strong);
}
.atlas .lang-panel .lang-name {
  font-family: var(--font-fraunces), Georgia, serif;
  font-weight: 400;
  font-size: clamp(30px, 3.6vw, 42px);
  line-height: 1.04;
  letter-spacing: -0.024em;
  color: var(--at-ink);
  margin: 0;
  max-width: none;
}
.atlas .lang-panel .lang-band {
  margin: 10px 0 0;
  max-width: none;
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  line-height: 1.5;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--at-muted);
}

/* the audited core: four hairline rows, no boxes */
.atlas .lang-panel .lang-facts { display: grid; gap: 0; margin: 4px 0 0; border-top: 1px solid var(--at-rule); }
.atlas .lang-panel .lang-fact {
  display: grid;
  grid-template-columns: 1fr;
  gap: 3px;
  padding: 11px 0 12px;
  border-bottom: 1px solid var(--at-rule);
}
@media (min-width: 700px) {
  .atlas .lang-panel .lang-fact { grid-template-columns: 12.5rem minmax(0, 1fr); gap: 22px; align-items: baseline; }
}
.atlas .lang-panel .lang-fact dt {
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  line-height: 1.5;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .lang-panel .lang-fact dd {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.62;
  color: var(--at-ink-2);
  overflow-wrap: anywhere;
}
.atlas .lang-panel .lang-fact dd.mono {
  font-family: var(--font-jbmono), monospace;
  font-size: 13.5px;
  color: var(--at-ink);
}
.atlas .lang-panel .lang-chips { display: flex; flex-wrap: wrap; gap: 5px; }
.atlas .lang-panel .lang-chips code {
  font-family: var(--font-jbmono), monospace;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--at-ink);
  background: rgba(18, 16, 12, 0.055);
  border: 1px solid var(--at-rule);
  border-radius: 2px;
  padding: 2px 6px;
}
.atlas .lang-panel .lang-missing {
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--at-muted);
}

/* the editorial teaser — the record's own page holds the rest */
.atlas .lang-panel .lang-depth {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--at-rule);
}
.atlas .lang-panel .lang-depth p.headline {
  margin: 0;
  max-width: 62ch;
  font-family: var(--font-fraunces), Georgia, serif;
  font-size: 18px;
  line-height: 1.52;
  color: var(--at-ink);
}
.atlas .lang-panel .lang-depth p.pending {
  margin: 0;
  max-width: 62ch;
  font-size: 14.5px;
  line-height: 1.7;
  color: var(--at-ink-2);
}
.atlas .lang-panel .lang-depth .lang-more { margin-top: 18px; }
.atlas .lang-panel .lang-depth .lang-more a { color: var(--at-ink); }

/* ── the pipeline + vocabulary model (inside .reading) ─────────────── */
.atlas .lang-model { margin-top: clamp(40px, 5vw, 64px); padding-top: clamp(26px, 3vw, 36px); border-top: 1px solid var(--at-rule-strong); }
.atlas .lang-model h2 { margin-top: 0; }
.atlas .lang-model-lead {
  margin: 0 0 22px;
  max-width: 68ch;
  font-size: 16px;
  line-height: 1.72;
  color: var(--at-ink-2);
}
.atlas .lang-steps {
  list-style: none;
  margin: 26px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
  border-top: 1px solid var(--at-rule-strong);
}
@media (min-width: 720px) {
  .atlas .lang-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (min-width: 1120px) {
  .atlas .lang-steps { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.atlas .lang-step {
  margin: 0;
  padding: 16px 22px 20px 0;
  border-bottom: 1px solid var(--at-rule);
}
@media (min-width: 720px) {
  .atlas .lang-step { border-right: 1px solid var(--at-rule); }
  .atlas .lang-step:nth-child(2n) { border-right: 0; padding-right: 0; padding-left: 22px; }
}
@media (min-width: 1120px) {
  .atlas .lang-step { border-right: 1px solid var(--at-rule); padding: 16px 22px 20px 0; }
  .atlas .lang-step:nth-child(2n) { padding-left: 0; }
  .atlas .lang-step + .lang-step { padding-left: 22px; }
  .atlas .lang-step:last-child { border-right: 0; padding-right: 0; }
}
.atlas .lang-step .k {
  margin: 0;
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .lang-step .step-title {
  margin: 7px 0 0;
  font-family: var(--font-fraunces), Georgia, serif;
  font-size: 21px;
  font-weight: 500;
  line-height: 1.2;
  letter-spacing: -0.012em;
  color: var(--at-ink);
}
.atlas .lang-step p.step-text {
  margin: 8px 0 0;
  max-width: 40ch;
  font-size: 14px;
  line-height: 1.68;
  color: var(--at-ink-2);
}
.atlas .lang-model-more { margin: 20px 0 0; font-size: 14.5px; }
.atlas .lang-model-more a {
  color: var(--at-ember);
  border-bottom: 1px solid rgba(179, 58, 34, 0.35);
}
.atlas .lang-model-more a:hover { border-bottom-color: var(--at-ember); }

/* vocabulary: definitions, then the countable spread */
.atlas .lang-vocab-defs { display: grid; gap: 0; margin: 6px 0 0; border-top: 1px solid var(--at-rule-strong); }
.atlas .lang-vocab-def { padding: 14px 0 16px; border-bottom: 1px solid var(--at-rule); }
.atlas .lang-vocab-def dt {
  font-family: var(--font-jbmono), monospace;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--at-ink);
}
.atlas .lang-vocab-def dd {
  margin: 7px 0 0;
  max-width: 64ch;
  font-size: 15px;
  line-height: 1.72;
  color: var(--at-ink-2);
}
.atlas .lang-vocab-def dd .note {
  display: block;
  margin-top: 5px;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--at-muted);
}
.atlas .lang-spread-wrap { overflow-x: auto; margin-top: 20px; border-top: 1px solid var(--at-rule-strong); }
.atlas .lang-spread-wrap table { margin: 0 0 16px; min-width: 560px; }
.atlas .lang-spread-type {
  font-family: var(--font-jbmono), monospace;
  font-size: 13px;
  color: var(--at-ink);
  white-space: nowrap;
}
.atlas .lang-spread-cell { display: flex; align-items: center; gap: 12px; }
.atlas .lang-spread-count {
  min-width: 2.2rem;
  font-family: var(--font-jbmono), monospace;
  font-size: 13px;
  color: var(--at-ink);
  font-variant-numeric: tabular-nums;
}
.atlas .lang-spread-bar { display: block; height: 5px; width: 100%; max-width: 9rem; background: rgba(18, 16, 12, 0.1); }
.atlas .lang-spread-bar i { display: block; height: 100%; background: var(--at-ember); }
.atlas .lang-spread-note { margin: 4px 0 22px; max-width: 70ch; font-size: 13.5px; line-height: 1.7; color: var(--at-muted); }
.atlas .lang-vocab h3 { margin-top: 34px; }

/* ── the closing source note + doors ──────────────────────────────── */
.atlas .lang-source {
  margin-top: clamp(34px, 4vw, 48px);
  padding-top: 20px;
  border-top: 1px solid var(--at-rule-strong);
  max-width: 900px;
}
.atlas .lang-source p {
  margin: 0 0 12px;
  max-width: 72ch;
  font-size: 14px;
  line-height: 1.72;
  color: var(--at-ink-2);
}
.atlas .lang-source code {
  font-family: var(--font-jbmono), monospace;
  font-size: 0.88em;
  color: var(--at-ink);
  background: rgba(18, 16, 12, 0.055);
  padding: 1px 5px;
  border-radius: 3px;
}
.atlas .lang-doors { display: flex; flex-wrap: wrap; gap: 14px 28px; align-items: center; margin-top: 18px; }
.atlas .lang-doors .mono-note { font-family: var(--font-jbmono), monospace; font-size: 12px; color: var(--at-muted); }
`

// The /languages/<slug> record page. Same paper system; the reading column is
// shared with globals.css, so this block only adds the page's own furniture:
// the breadcrumb, the registry rows, the 14-slot ledger, the authored lists, the
// snippet plate and the exits.
export const LANGUAGE_DETAIL_ATLAS_CSS = `
.atlas .lang-crumb {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px 10px;
  padding-top: clamp(18px, 2.4vw, 26px);
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .lang-crumb a { color: var(--at-muted); border-bottom: 1px solid transparent; }
.atlas .lang-crumb a:hover { color: var(--at-ink); border-bottom-color: var(--at-rule-strong); }
.atlas .lang-crumb .here { color: var(--at-ink-2); }

/* the registry row: the same four facts the console prints, on their own page */
.atlas .lang-detail-facts { display: grid; gap: 0; margin: 22px 0 0; border-top: 1px solid var(--at-rule-strong); }
.atlas .lang-detail-fact {
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  padding: 12px 0 13px;
  border-bottom: 1px solid var(--at-rule);
}
@media (min-width: 700px) {
  .atlas .lang-detail-fact { grid-template-columns: 13rem minmax(0, 1fr); gap: 24px; align-items: baseline; }
}
.atlas .lang-detail-fact dt {
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--at-muted);
}
.atlas .lang-detail-fact dd { margin: 0; font-size: 14.5px; line-height: 1.62; color: var(--at-ink-2); overflow-wrap: anywhere; }
.atlas .lang-detail-fact dd.mono { font-family: var(--font-jbmono), monospace; font-size: 13.5px; color: var(--at-ink); }
.atlas .lang-detail-fact .chips { display: flex; flex-wrap: wrap; gap: 5px; }
.atlas .lang-detail-fact .chips code { font-size: 12.5px; }

/* the 14-slot relationship ledger */
.atlas .lang-ledger-wrap { overflow-x: auto; margin: 22px 0 0; border-top: 1px solid var(--at-rule-strong); }
.atlas .lang-ledger-wrap table { margin: 0 0 16px; min-width: 520px; }
.atlas .lang-ledger-wrap code { font-family: var(--font-jbmono), monospace; font-size: 13px; color: var(--at-ink); }
.atlas .lang-ledger-wrap td.hit { color: var(--at-ink); }
.atlas .lang-ledger-wrap td.miss { color: var(--at-muted); }
.atlas .lang-ledger-note { margin: 2px 0 0; max-width: 70ch; font-size: 13.5px; line-height: 1.7; color: var(--at-muted); }

/* authored lists: limitations, file layout, retrievals */
.atlas .lang-limits, .atlas .lang-where, .atlas .lang-asks { margin: 20px 0 0; padding: 0; list-style: none; border-top: 1px solid var(--at-rule-strong); }
.atlas .lang-limits li, .atlas .lang-where li, .atlas .lang-asks li {
  margin: 0;
  padding: 13px 0 14px;
  border-bottom: 1px solid var(--at-rule);
  max-width: 70ch;
  font-size: 15.5px;
  line-height: 1.72;
  color: var(--at-ink-2);
}
.atlas .lang-limits li { border-left: 2px solid var(--at-ember); padding-left: 16px; }
.atlas .lang-asks { counter-reset: ask; }
.atlas .lang-asks li { display: grid; grid-template-columns: 2rem minmax(0, 1fr); gap: 10px; align-items: baseline; }
.atlas .lang-asks li::before {
  counter-increment: ask;
  content: counter(ask, decimal-leading-zero);
  font-family: var(--font-fraunces-italic), Georgia, serif;
  font-style: italic;
  font-size: 15px;
  color: var(--at-ember);
}
.atlas .lang-where li { padding-left: 0; }

/* the snippet plate: the one night surface on this page */
.atlas .lang-snippet {
  margin: 22px 0 0;
  border: 1px solid var(--at-rule);
  border-radius: 3px;
  overflow: hidden;
  max-width: 100%;
}
.atlas .lang-snippet figcaption {
  padding: 12px 16px;
  border-bottom: 1px solid var(--at-rule);
  font-family: var(--font-jbmono), monospace;
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--at-muted);
  background: var(--at-paper-3);
}
.atlas .lang-snippet pre {
  margin: 0;
  border-radius: 0;
  max-width: 100%;
  overflow-x: auto;
}
.atlas .lang-snippet pre code { font-size: 13px; line-height: 1.8; }

/* the sibling band and the exits */
.atlas .lang-siblings { list-style: none; margin: 20px 0 0; padding: 0; border-top: 1px solid var(--at-rule-strong); }
.atlas .lang-siblings li { border-bottom: 1px solid var(--at-rule); }
.atlas .lang-siblings a {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  padding: 11px 0 12px;
  font-size: 15px;
  color: var(--at-ink-2);
}
.atlas .lang-siblings a:hover { color: var(--at-ink); }
.atlas .lang-siblings .n {
  flex: none;
  font-family: var(--font-jbmono), monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: var(--at-muted);
  font-variant-numeric: tabular-nums;
}
.atlas .detail-source {
  margin-top: clamp(34px, 4vw, 46px);
  padding-top: 18px;
  border-top: 1px solid var(--at-rule-strong);
  max-width: 900px;
}
.atlas .detail-source p { margin: 0; max-width: 76ch; font-size: 14px; line-height: 1.78; color: var(--at-ink-2); }
`
