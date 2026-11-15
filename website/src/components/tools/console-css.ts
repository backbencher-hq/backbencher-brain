import { GROUP_ORDER, BRAIN_TOOLS, toolsInGroup } from '@/data/brain-tools'

// The rules a static page cannot express with utilities, generated from the
// registry so a seventeenth tool cannot ship without them.
//
// 1. THE UNSELECTED CONSOLE. No radio is checked on arrival (see ToolRail), so
//    the first row of the index stands in as the selection until the reader or
//    a fragment says otherwise. Both halves — the panel that shows and the row
//    that lights — are derived from the same computation the rail renders, so
//    they cannot disagree about which tool is first.
//
// 2. THE FRAGMENT. A plain #bb_impact cannot reach a radio, so the fragment
//    reveals the panel it names, with an ember rule down its edge: a deep link
//    is never a silent no-op. ToolConsoleSync then ticks the matching radio so
//    the rail agrees, and writes the selection back into the address bar so the
//    visible panel is always a link worth copying.
//
// 3. RAIL AGREEMENT. The index rows paint their own selected state from the
//    radio, but peer-checked cannot cross into a row's nested text, and cannot
//    fire at all when the selection arrived as a fragment. Both cases are
//    written here rather than as sixteen hand-written class strings — including
//    the record meter, so the selected row's bar is the ember one.
//
// 2026-11-07 — the console moved onto the Evidence Atlas paper surface, so the
// paint below is atlas tokens (paper ground, ink name, ember for the selected
// rule) instead of the old warm-dark card. The rules are unchanged; only the
// values are. A colour here is never decoration: ember means "this is the row
// you are reading".
//
// Everything is emitted from BRAIN_TOOLS, so this file contains no tool name as
// a literal and no fact of any kind.

/** The rail's first row — see the identical walk in ToolRail. */
const FIRST_TOOL = GROUP_ORDER.map((group) => toolsInGroup(group)).find((tools) => tools.length > 0)![0]!.name

/** Selected-row paint. Reused by every rule that can select a row. */
const ROW_SELECTED = `border-left-color: var(--at-ember);
  background-color: rgba(179, 58, 34, 0.055);`

/** Every selector under which tool `name` is the row a reader is looking at. */
function selectedBy(name: string): string[] {
  return [
    // the radio is checked — the ordinary click
    `.tools-shell:has(#t-${name}:checked) label[for="t-${name}"]`,
    // the panel is the fragment target — a deep link, before or without script
    `.tools-shell:has([data-panel="${name}"]:target) label[for="t-${name}"]`,
  ]
}

/** …and the console has not been touched yet, so the first row stands in. */
function selectedByDefault(name: string): string[] {
  return name === FIRST_TOOL
    ? [`.tools-shell:not(:has(input[name="tool-reference"]:checked)):not(:has([data-panel]:target)) label[for="t-${name}"]`]
    : []
}

function railRules(name: string): string {
  const sel = [...selectedBy(name), ...selectedByDefault(name)]
  return `${sel.join(',\n')} {
  ${ROW_SELECTED}
}
${sel.map((s) => `${s} .rail-name`).join(',\n')} { color: var(--at-ink); }
${sel.map((s) => `${s} .rail-role`).join(',\n')} { color: var(--at-ink-2); }
${sel.map((s) => `${s} .rail-meter-track`).join(',\n')} { background-color: rgba(18, 16, 12, 0.22); }
${sel.map((s) => `${s} .rail-meter-fill`).join(',\n')} { background-color: var(--at-ember); }
${sel.map((s) => `${s} .rail-words`).join(',\n')} { color: var(--at-ink-2); }`
}

const PANEL_DEFAULT = `
/* Nothing checked, nothing targeted: the console opens on the first tool. */
.tools-shell:not(:has(input[name="tool-reference"]:checked)):not(:has([data-panel]:target)) [data-panel="${FIRST_TOOL}"] { display: block; }
/* The fragment reveals the panel it names. */
.tools-shell [data-panel] { scroll-margin-top: 5.5rem; }
.tools-shell [data-panel]:target {
  display: block;
  border-left-color: var(--at-ember);
}
/* Deliberately NOT "!important over every other panel": a radio click cannot
   change the fragment, so a fragment that outranked the selection would pin one
   panel and quietly kill the rail for a reader without JavaScript. The radio
   stays the authority on which panel is SELECTED; the fragment only ever
   reveals one. With JavaScript — the normal case — ToolConsoleSync settles the
   two into the same panel in the same tick. */
`

export const CONSOLE_CSS = [
  PANEL_DEFAULT,
  ...BRAIN_TOOLS.map((tool) => railRules(tool.name)),
].join('\n')
