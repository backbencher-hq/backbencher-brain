// The depth index — the one place a surface asks "how deep does bb go here?"
//
// Four band files, split by ecosystem so four authors can fill them without
// touching the same bytes. This module joins them, validates them against the
// dataset, and exports the two lookups the pages need.
//
// VALIDATION IS DELIBERATE. A band file that drifts from PARSERS — a family
// renamed, a key for a language that does not exist, an entry with no honest
// limits — throws at import time instead of rendering a hole in the page. The
// site is statically generated, so this fails the build, which is exactly the
// pressure we want on new content.

import { PARSERS } from "../brain-languages"
import type { LanguageDepth } from "./types"
import { FAMILY_SLUGS } from "./slugs"

import { BAND_DEPTH } from "./band-a-app-systems"
import { BAND_DEPTH as BAND_B } from "./band-b-functional"
import { BAND_DEPTH as BAND_C } from "./band-c-scripting"
import { BAND_DEPTH as BAND_D } from "./band-d-web-data"

export type { LanguageDepth } from "./types"

/** Every authored depth record, keyed by the family's exact display name. */
export const LANGUAGE_DEPTH: Record<string, LanguageDepth> = {
...BAND_DEPTH,
...BAND_B,
...BAND_C,
...BAND_D,
}

// ── validation ─────────────────────────────────────────────────────────

{
const known = new Set(PARSERS.map((p) => p.name))
const unknown = Object.keys(LANGUAGE_DEPTH).filter((name) => !known.has(name))
if (unknown.length) {
  throw new Error(`language-depth: records for languages that do not exist — ${unknown.join(", ")}`)
}
// The URL contract is validated here rather than in slugs.ts, because only
// this module can see the language dataset. A family with no detail page, or
// two families sharing one URL, is a broken link waiting to ship.
const unslugged = PARSERS.map((p) => p.name).filter((name) => !FAMILY_SLUGS[name])
if (unslugged.length) {
  throw new Error(`language-depth/slugs: no detail URL for ${unslugged.join(", ")}`)
}
const slugValues = Object.values(FAMILY_SLUGS)
const dupeSlugs = [...new Set(slugValues.filter((v, i) => slugValues.indexOf(v) !== i))]
if (dupeSlugs.length) {
  throw new Error(`language-depth/slugs: ${dupeSlugs.length} detail URLs are shared by two families — ${dupeSlugs.join(", ")}`)
}
const extraSlugs = Object.keys(FAMILY_SLUGS).filter((name) => !known.has(name))
if (extraSlugs.length) {
  throw new Error(`language-depth/slugs: detail URLs for families that do not exist — ${extraSlugs.join(", ")}`)
}
const dupes = Object.keys(LANGUAGE_DEPTH).filter((k, i, all) => all.indexOf(k) !== i)
if (dupes.length) {
  throw new Error(`language-depth: duplicate record for ${[...new Set(dupes)].join(", ")}`)
}
for (const p of PARSERS) {
  const d = LANGUAGE_DEPTH[p.name]
  if (!d) continue // `hasDepth` exists for exactly this: a surface can degrade
  if (!d.headline || d.headline.length < 40) {
    throw new Error(`language-depth/${p.name}: headline is too thin to explain anything`)
  }
  if (!Array.isArray(d.agentAsks) || d.agentAsks.length < 3) {
    throw new Error(`language-depth/${p.name}: needs at least 3 concrete agent asks`)
  }
  if (!Array.isArray(d.limitations) || d.limitations.length < 2) {
    throw new Error(`language-depth/${p.name}: needs at least 2 real limitations`)
  }
  if (!d.sample?.code?.trim()) {
    throw new Error(`language-depth/${p.name}: sample code is empty`)
  }
  if (!Array.isArray(d.whereItShowsUp) || d.whereItShowsUp.length < 1) {
    throw new Error(`language-depth/${p.name}: needs at least one where-it-shows-up note`)
  }
}
}

// ── lookups ────────────────────────────────────────────────────────────

/** The depth record for a display family, or undefined when not authored yet. */
export function depthFor(familyName: string): LanguageDepth | undefined {
return LANGUAGE_DEPTH[familyName]
}

export function hasDepth(familyName: string): boolean {
return Boolean(LANGUAGE_DEPTH[familyName])
}

/** How many of the dataset's families carry an authored depth record. */
export const DEPTH_COVERAGE = {
authored: Object.keys(LANGUAGE_DEPTH).length,
total: PARSERS.length,
}

/** The families still missing a depth record — a worklist, not a claim. */
export const FAMILIES_WITHOUT_DEPTH = PARSERS.map((p) => p.name).filter((n) => !LANGUAGE_DEPTH[n])

export { FAMILY_SLUGS, slugFor, slugToFamily, languageHref } from "./slugs"
