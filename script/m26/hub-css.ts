// script/m26/hub-css.ts — M44.U2 (issue #689): the hub stylesheet.
//
// The W6 shell shipped with NO styles at all — the hub rendered as raw
// unstyled text (owner test, 2026-09-07: "one does not even know what is
// going on there"). This module is the SINGLE owner of the hub's CSS: a
// static, repo-controlled string (no user data, no interpolation, nothing
// dynamic) injected by the shell as a NONCE-BOUND <style> block — the strict
// W6 CSP (style-src 'nonce-…') is unchanged and still enforced.
//
// Laws (gated by script/m26/verify-webview-harness.ts AH6 + the W6 shell):
//   - affordances are visible WITHOUT hover: left accent + chevron + cursor
//     are always on; hover/focus only intensify them (§13.3).
//   - keyboard parity: :focus-visible carries the same outline the click
//     affordance implies (the bridge posts the same navigate message for
//     Enter/Space on a focused row).
//   - theme adaptation via the editor's CSS custom properties where the host
//     provides them, with sane fallbacks (one CSS serves every editor).

export const HUB_CSS = `
.bb-hub, .bb-hub-view { font-family: var(--vscode-editor-font-family, ui-monospace, Menlo, monospace); font-size: 13px; color: var(--vscode-foreground, #ccc); line-height: 1.45; }
.bb-hub-controls { display: flex; gap: 6px; margin: 0 0 10px 0; }
.bb-hub-controls button { background: var(--vscode-button-secondaryBackground, #2a2d2e); color: var(--vscode-button-secondaryForeground, #ccc); border: 1px solid var(--vscode-panel-border, #333); border-radius: 3px; padding: 3px 10px; font: inherit; cursor: pointer; }
.bb-hub-controls button:hover { background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #fff); }
.bb-hub-summary { color: var(--vscode-descriptionForeground, #999); margin: 2px 0 8px 0; font-size: 12px; }
.bb-hub-group { margin: 0 0 10px 0; }
.bb-hub-group-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #888); margin: 0 0 3px 0; }
.bb-hub-row { position: relative; display: flex; align-items: baseline; gap: 8px; padding: 3px 8px 3px 10px; border-left: 2px solid var(--vscode-panel-border, #333); border-radius: 2px; margin: 1px 0; }
.bb-hub-row[data-clickable="1"] { cursor: pointer; }
.bb-hub-row[data-clickable="1"]:hover { background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); border-left-color: var(--vscode-focusBorder, #4fc1ff); }
.bb-hub-row[data-clickable="1"]:focus-visible { outline: 1px solid var(--vscode-focusBorder, #4fc1ff); outline-offset: -1px; background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); }
.bb-hub-row-main { display: flex; align-items: baseline; gap: 8px; min-width: 0; flex: 1 1 auto; }
.bb-hub-row-name { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); font-weight: 600; white-space: nowrap; }
.bb-hub-row[data-clickable="1"] .bb-hub-row-name { text-decoration: underline; text-decoration-color: transparent; text-underline-offset: 3px; }
.bb-hub-row[data-clickable="1"]:hover .bb-hub-row-name, .bb-hub-row[data-clickable="1"]:focus-visible .bb-hub-row-name { text-decoration-color: var(--vscode-focusBorder, #4fc1ff); }
.bb-hub-row-meta { color: var(--vscode-descriptionForeground, #888); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bb-hub-chevron { flex: 0 0 auto; color: var(--vscode-descriptionForeground, #777); font-size: 11px; margin-left: auto; }
.bb-hub-row[data-clickable="1"]:hover .bb-hub-chevron { color: var(--vscode-focusBorder, #4fc1ff); }
.bb-hub-relchips { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.bb-hub-relchip { display: inline-block; font-size: 10.5px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--vscode-panel-border, #444); color: var(--vscode-descriptionForeground, #aaa); white-space: nowrap; }
.bb-badge-structural { border-color: rgba(97,175,239,0.55); color: var(--vscode-symbolIcon-classForeground, #61afef); }
.bb-badge-import_based { border-color: rgba(229,192,123,0.5); color: var(--vscode-symbolIcon-namespaceForeground, #e5c07b); }
.bb-badge-usage_contextual, .bb-badge-reference_qualified { border-color: rgba(152,195,121,0.5); color: var(--vscode-symbolIcon-variableForeground, #98c379); }
.bb-badge-inferred { border-color: rgba(156,220,254,0.35); color: var(--vscode-descriptionForeground, #9cdcff); }
.bb-badge-mixed { border-color: rgba(198,120,221,0.5); color: var(--vscode-symbolIcon-moduleForeground, #c678dd); }
.bb-hub-enrichment { font-size: 10.5px; color: var(--vscode-symbolIcon-moduleForeground, #c678dd); }
.bb-hub-enriched[data-enriched="1"] { border-left-color: rgba(198,120,221,0.65); }
.bb-hub-row-external { opacity: 0.8; }
.bb-hub-filelevel { margin: 8px 0; padding: 6px 8px; border: 1px dashed var(--vscode-panel-border, #444); border-radius: 3px; }
.bb-hub-filelevel-title { display: block; font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-bottom: 3px; }
.bb-hub-flrow { font-size: 11.5px; color: var(--vscode-descriptionForeground, #aaa); padding: 1px 0; }
.bb-hub-empty { color: var(--vscode-descriptionForeground, #888); font-style: italic; padding: 8px 0; }
.bb-truncation-marker { color: var(--vscode-editorWarning-foreground, #e5c07b); font-size: 12px; margin: 6px 0; }
.bb-stale-marker { color: var(--vscode-editorWarning-foreground, #e5c07b); font-size: 12px; margin: 0 0 8px 0; }
.bb-legend { margin: 14px 0 4px 0; padding: 8px 10px; border: 1px solid var(--vscode-panel-border, #333); border-radius: 3px; display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: baseline; }
.bb-legend-title { display: block; width: 100%; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #888); }
.bb-legend-item { display: inline-flex; align-items: baseline; gap: 5px; font-size: 11.5px; color: var(--vscode-descriptionForeground, #aaa); }
.bb-legend-swatch { display: inline-block; width: 9px; height: 9px; border-radius: 2px; border: 1px solid var(--vscode-panel-border, #555); }
.bb-legend-swatch.bb-badge-structural { background: rgba(97,175,239,0.25); }
.bb-legend-swatch.bb-badge-import_based { background: rgba(229,192,123,0.25); }
.bb-legend-swatch.bb-badge-usage_contextual, .bb-legend-swatch.bb-badge-reference_qualified { background: rgba(152,195,121,0.25); }
.bb-legend-swatch.bb-badge-inferred { background: rgba(156,220,254,0.18); }
.bb-stale-swatch-fresh { background: rgba(152,195,121,0.35); }
.bb-stale-swatch-stale { background: var(--vscode-editorWarning-foreground, #e5c07b); border-color: var(--vscode-editorWarning-foreground, #e5c07b); }
.bb-stale-swatch-missing { background: var(--vscode-errorForeground, #f44747); border-color: var(--vscode-errorForeground, #f44747); }
.bb-stale-swatch-unknown { background: transparent; border-style: dashed; }
.bb-hub-view { margin: 0 0 18px 0; }
/* U3: the call tree nests — children indent under their parent row, and a
   collapsed wrapper hides (the renderer declares it; the bridge toggles it). */
.bb-hub-subtree { margin: 0 0 10px 0; }
.bb-hub-subtree-label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--vscode-descriptionForeground, #888); margin: 0 0 3px 0; }
.bb-hub-children { margin-left: 16px; padding-left: 4px; border-left: 1px solid var(--vscode-panel-border, #333); }
.bb-hub-children.bb-hub-collapsed { display: none; }
.bb-hub-expander { order: -1; flex: 0 0 auto; width: 15px; text-align: center; cursor: pointer; user-select: none; color: var(--vscode-descriptionForeground, #999); border-radius: 3px; font-size: 11px; }
.bb-hub-expander:hover, .bb-hub-expander:focus-visible { color: var(--vscode-focusBorder, #4fc1ff); background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.06)); outline: 1px solid var(--vscode-focusBorder, #4fc1ff); outline-offset: -1px; }
`
