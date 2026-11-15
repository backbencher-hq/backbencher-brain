// The console's shared vocabulary — derived once from the dataset, read by the
// index, the panels and the hash sync, so three surfaces can never disagree
// about a family.
//
// WHY A DERIVED LAYER EXISTS
// --------------------------
// brain-languages.ts is byte-format-pinned (verify-languages-surface.ts parses
// its rows out of the source), so nothing may be added to a PARSERS row. But the
// console needs three things the dataset does not carry: a stable index per
// family (the hidden radio id and the generated :has() rule), the ecosystem band
// a family belongs to (an index assertion, not a family attribute), and the URL
// slug (owned by language-depth). Those are computed here rather than smuggled
// into the data file, and every count on the page is derived from PARSERS at
// render time — no language number is ever hand-typed.
//
// WHAT IS NOT HERE ANYMORE, AND WHY
// ---------------------------------
// A `tier` of full / structural / generic, and the per-family promise that came
// with it. The tier was never defined anywhere in src/, and it ranked the
// product backwards: it put Svelte above JSON on a relationship count, and it
// filed PowerShell (measured 81% coverage, 20% fabrication) in the same bucket
// as TOML (measured 100% of admitted files, 0% fabrication). Round 1 of this
// page printed that verdict in large type, including four false claims that no
// language had a dedicated analyzer. Every one of those 48 modules exists; the
// four languages in question resolve between five and eight relationship types
// each.
//
// What replaced it is `emits`: the relationship vocabulary a family's analyzer
// can actually construct, derived from the analyzer modules. An absent type is
// then a fact about the FORMAT rather than a verdict on the analyzer — a heading
// cannot call anything, and TOML defines no include, no import and no
// reference mechanism for a `path = "src/main.rs"` string to be one.

import { BANDS, EMITS_COUNTS, PARSERS, RELATIONSHIP_TYPES } from "@/data/brain-languages"
import type { LangFamily, RelationshipTypeName } from "@/data/brain-languages"
import { slugFor } from "@/data/language-depth"

/**
 * The relationship types one family publishes.
 *
 * The dataset spells `emits` as a space-separated list of the engine's enum
 * names, and this accessor normalises whatever shape arrives — list or string —
 * to the declared vocabulary only. A token the engine's enum does not declare is
 * dropped rather than rendered, so a chip on this page is always a type an
 * agent can actually query for.
 */
export function emitsOf(family: LangFamily): RelationshipTypeName[] {
  const raw: unknown = family.emits
  const tokens = Array.isArray(raw) ? raw.map(String) : String(raw ?? "").split(/\s+/)
  return tokens.filter((token): token is RelationshipTypeName =>
    (RELATIONSHIP_TYPES as readonly string[]).includes(token),
  )
}

/** Which ecosystem band a family sits in, read off BANDS rather than retyped. */
export const BAND_OF: Record<string, string> = Object.fromEntries(
  BANDS.flatMap((band) => band.names.map((name) => [name, band.label] as const)),
)

/** One console row: the family, its radio index, its band, its URL and its vocabulary. */
export type FamilyRow = {
  parser: LangFamily
  /** Position in PARSERS. Stable, and the only thing the CSS rules key on. */
  index: number
  band: string
  slug: string
  emits: RelationshipTypeName[]
}

/** Hidden-radio id for a row. Ids beat class names here: they are index-based,
 *  and display names are human strings ("HCL / Terraform", "Objective-C"). */
export const radioId = (index: number): string => `lang-family-${index}`

export const ROWS: FamilyRow[] = PARSERS.map((parser, index) => ({
  parser,
  index,
  band: BAND_OF[parser.name] ?? "",
  slug: slugFor(parser.name),
  emits: emitsOf(parser),
}))

/**
 * The vocabulary spread, widest first.
 *
 * This is a coverage claim a reader can falsify by counting rows on the page:
 * the number beside a type is how many of the 47 families publish it, computed
 * from the same `emits` the panels render. The spread is the point — `contains`
 * is close to universal and `exports` is not, and the difference is a property
 * of the formats, not a league table. Sorting widest-first is a reading aid and
 * nothing more: no family is ranked by it anywhere on this page.
 */
export const EMITS_SPREAD = [...EMITS_COUNTS].sort(
  (a, b) => b.families - a.families || a.type.localeCompare(b.type),
)

/** The widest count in the spread — the denominator for the coverage bars. */
export const EMITS_MAX = EMITS_SPREAD[0]?.families ?? 1

/** Families whose derived vocabulary came back empty, by name. */
export const EMITS_EMPTY = ROWS.filter((row) => row.emits.length === 0).map((row) => row.parser.name)

/**
 * The one thing the browser-side fragment sync needs to know, and nothing else.
 * Kept as a bare projection of the slugs so a `'use client'` module can import it
 * without dragging the language table and every icon in it into the client
 * bundle. The radios are already in the document and already carry their slug as
 * their `value`, so the sync matches against those rather than re-deriving an
 * index.
 */
export const SYNC_SLUGS = ROWS.map((row) => row.slug)

/**
 * The console stylesheet, generated from the dataset and injected by the page.
 *
 * globals.css owns the shared defaults (`.languages-shell [data-panel]` hidden,
 * the focus ring on `.console-index label`, the rise animation). This block only
 * has to flip one panel visible per checked radio, so the per-family rules are
 * emitted here rather than hand-written 47 times — a family added to the dataset
 * becomes selectable with no edit to this file.
 *
 * The radio is matched by the `.lang-tab-N` class the input already carries
 * rather than by its id. `:has()` inherits the specificity of its most specific
 * argument, so the class form keeps every generated rule at (0,4,0) instead of
 * (1,1,0) — low enough that the arrival and focus rules below still layer on top
 * of it without `!important`.
 */
export const CONSOLE_CSS = [
  ...ROWS.map((row) =>
    [
      `.languages-shell:has(.lang-tab-${row.index}:checked) [data-panel=${JSON.stringify(
        row.parser.name,
      )}] { display: block; }`,
      // A fragment deep-link must also light its row without JavaScript. The
      // radio cannot follow the fragment on its own, so :has() reads the targeted
      // panel and paints the row that owns it — same paint as the checked state.
      `.languages-shell:has([data-panel=${JSON.stringify(row.parser.name)}]:target) label[data-rail-row="${
        row.index
      }"] { background-color: rgba(179,58,34,0.055); border-left-color: var(--at-ember); }`,
    ].join("\n"),
  ),
  // Nothing checked yet. Deliberately NOT a `defaultChecked` radio on the first
  // row: a pre-checked row and a `:target` panel both paint, so arriving on a
  // shared /languages#nim link would show Nim's record AND whatever row happened
  // to be first. With no row pre-checked the console opens on one panel and a
  // deep link opens on exactly the panel it names.
  `.languages-shell:not(:has(input[name="lang-family"]:checked)) [data-panel]:first-of-type { display: block; }`,
  // …and the rail row that goes with it, so the record on the right and the row
  // on the left agree on the first paint. Same declaration as the checked state
  // below, keyed on the row's dataset index.
  `.console-index:not(:has(input[name="lang-family"]:checked)) label[data-rail-row="0"] { background-color: rgba(179,58,34,0.055); border-left-color: var(--at-ember); }`,
  // Arriving on /languages#<slug> must visibly select that family, or a shared
  // link silently shows whichever panel happened to be first. Panels carry the
  // slug as their id, so :target is the whole mechanism — no JavaScript, and it
  // degrades to "the console still works" if scripting never runs.
  //
  // This rule ADDS a panel; it never hides one. The obvious stronger version —
  // hide every non-targeted panel while a fragment is present — is one line and
  // looks better, but it breaks the console for a reader with scripting off: the
  // fragment they arrived on outranks the row they then click, so clicking
  // appears to do nothing. Adding is the only version where the degraded state is
  // console that still works, which is the whole promise of the radio.
  `.languages-shell [data-panel]:target { display: block; border-left-color: var(--at-ember); }`,
  // The selected row in the rail, drawn the same way globals.css draws the focus
  // ring on it: the radio is sr-only, so the state has to be painted on the
  // label that owns it.
  `.console-index label:has(> input:checked) { background-color: rgba(179,58,34,0.055); border-left-color: var(--at-ember); }`,
  // Without :has() no rule above can match, which would leave the column empty.
  // Degrade to the first panel rather than to nothing.
  `@supports not selector(:has(*)) { .languages-shell [data-panel]:first-of-type { display: block; } }`,
].join("\n")
