// script/m60/grammar-lanes-source.ts — the ONE parse of the repo's grammar
// declaration sites, shared by the registry generator and its gate.
//
// WHY THIS FILE EXISTS. The first version of the gate reported three hard
// failures — `nim`, `protobuf`, `vb` "in the registry but declared nowhere" —
// and all three were the VERIFIER's bug, not the registry's: the generator read
// engine.ts's SUPPORTED_LANGUAGES including the `__generic__` lanes, while the
// gate's regex only matched `"tree-sitter-` values and so could not see them.
//
// That is the exact defect class this work exists to kill — two places parsing
// one source and disagreeing — reproduced one level up, inside the fix for it.
// So the parse lives here once, and both the generator and the gate import it.
// A second parser is not a convenience here; it is the bug.
//
// LANE NAME DIVERGENCE. A lane's name is not the same string in every
// declaration site, and pretending otherwise is how a lane silently loses its
// guard. `objective-c` is the engine and analyzer-doc name; the M14 sweep map
// and the F10 result rows call it `objc`. A gate that looked up `objective-c`
// there would conclude the lane has no F5 differential and no parse-success
// floor, which is false — sdwebimage:objc and afnetworking:objc are both pinned
// floors. SWEEP_LANE_NAME carries those equivalences explicitly, so a reader can
// see which name is which instead of debugging a missing row.

import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"

export const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")

export const WASM_DIR = path.join(ROOT, "wasm")
export const SPEC_DIR = path.join(ROOT, "script", "m14", "spec")
export const DOCS_DIR = path.join(ROOT, "docs", "analyzers")
export const MANIFEST = path.join(ROOT, "validation", "m12", "corpus-manifest.json")
export const M12_RESULTS = path.join(ROOT, "validation", "m12", "results")
export const REVIEWS_DIR = path.join(ROOT, "reviews")
export const F1_BASELINE = path.join(ROOT, "validation", "m14", "grammar-audit-baseline.json")
export const F10 = path.join(ROOT, "validation", "m14", "results", "M14.0.F10.json")
export const F10_BASELINE = path.join(ROOT, "validation", "m14", "parse-success-baseline.json")
export const DIFFERENTIAL = path.join(ROOT, "script", "m14", "differential.ts")
export const ENGINE = path.join(ROOT, "src", "ast", "engine.ts")

/** Bound a `{` … `}` region of a source file by brace depth. */
function braceRegion(src: string, from: number): string {
  const start = src.indexOf("{", from)
  if (start < 0) return ""
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++
    else if (src[i] === "}") {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  return src.slice(start)
}

/**
 * The lane -> grammar-name map, read out of engine.ts. `__generic__` is a real
 * lane that has no grammar, so the value is kept: dropping it here is what made
 * the gate report three phantom rows.
 */
export function parseEngineLanes(): Record<string, string> {
  const src = readFileSync(ENGINE, "utf8")
  const at = src.indexOf("const SUPPORTED_LANGUAGES")
  if (at < 0) throw new Error("grammar-lanes-source: SUPPORTED_LANGUAGES not found in engine.ts")
  const region = braceRegion(src, at)
  const map: Record<string, string> = {}
  for (const m of region.matchAll(/"?([a-z0-9_+-]+)"?:\s*"([^"]+)"/g)) map[m[1]] = m[2]
  return map
}

/** Lanes the loader actually resolves to a grammar wasm (excludes `__generic__`). */
export function parseEngineGrammarLanes(): string[] {
  return Object.entries(parseEngineLanes())
    .filter(([, v]) => v !== "__generic__")
    .map(([k]) => k)
}

/** Lanes routed to GenericAnalyzer — real lanes that deliberately have no grammar. */
export function parseGenericLanes(): string[] {
  return Object.entries(parseEngineLanes())
    .filter(([, v]) => v === "__generic__")
    .map(([k]) => k)
}

/**
 * The wasm resolution chain per lane, read from the loader's own switch.
 * The map holds a grammar NAME (`tree-sitter-sql`) while the loader builds
 * `<name>/<name>.wasm`, and four lanes carry a FALLBACK — so the filename is not
 * derivable from the map and the chain is not uniform. Reading the loader's
 * `resolveWasm` literals is the only parse that cannot drift from it.
 *
 * TWO STRUCTURAL HAZARDS, both of which produced silently WRONG chains rather
 * than an error, which is why they are spelled out.
 *
 * 1. FALLTHROUGH LABELS. The loader writes
 *        case "css":
 *        case "scss":
 *        case "sass": {
 *          languageWasmPath = resolveWasm("tree-sitter-css/tree-sitter-css.wasm")
 *    A parser matching only `case "x": {` sees none of those three, because the
 *    brace arrives after the LAST label. css, scss and hcl came back with an
 *    empty chain, `shipped.sha256` was null, and H5 — the check that exists to
 *    catch a silent grammar swap — silently protected nothing for those lanes. A
 *    guard covering 46 of 49 lanes while reporting "0 failures" is worse than no
 *    guard, because it reads as coverage.
 *
 * 2. TWO SWITCHES OVER THE SAME NAMES. `getAnalyzer` further down the file
 *    switches on `language` again, with bare fallthrough labels and NO
 *    `resolveWasm`. A whole-file scan therefore runs one switch's chain into the
 *    other's labels: css, hcl, typescript and make were all handed
 *    `tree-sitter-make/…`. The scan is scoped to the one `switch (language)`
 *    whose region actually contains `resolveWasm`.
 */
export function parseWasmChains(): Record<string, string[]> {
  const src = readFileSync(ENGINE, "utf8")

  // Scope to the switch that resolves wasm. There are several `switch (language)`.
  let regionStart = -1
  let regionEnd = src.length
  for (const m of src.matchAll(/switch\s*\(\s*language\s*\)/g)) {
    const body = braceRegion(src, m.index)
    if (body.includes("resolveWasm")) {
      regionStart = m.index
      regionEnd = m.index + body.length
      break
    }
  }
  if (regionStart < 0) throw new Error("grammar-lanes-source: no `switch (language)` containing resolveWasm in engine.ts")
  const region = src.slice(regionStart, regionEnd)

  // Every case label in that region, with whether it opens a block.
  const labels: Array<{ lane: string; i: number; opensBlock: boolean }> = []
  for (const m of region.matchAll(/case\s+"([^"]+)"\s*:(?=\s*\{|\s*case\s|\s*\n\s*case\s)/g)) {
    labels.push({ lane: m[1] as string, i: m.index, opensBlock: /^\s*\{/.test(region.slice(m.index + m[0].length)) })
  }

  const out: Record<string, string[]> = {}
  for (let k = 0; k < labels.length; k++) {
    if (!labels[k].opensBlock) continue
    // This block runs to the next label that OPENS one.
    let end = region.length
    for (let j = k + 1; j < labels.length; j++) {
      if (labels[j].opensBlock) {
        end = labels[j].i
        break
      }
    }
    const paths = [...region.slice(labels[k].i, end).matchAll(/resolveWasm\(\s*"([^"]+)"\s*\)/g)].map((x) => x[1] as string)
    if (!paths.length) continue
    // The chain belongs to the opening label AND to the bare fallthrough labels
    // immediately ABOVE it, which is where a grouped case puts its siblings.
    let j = k
    for (;;) {
      out[labels[j].lane] = paths
      if (j === 0 || labels[j - 1].opensBlock) break
      j--
    }
  }
  return out
}

/** Lanes sharing one grammar: the primary owns the row, the rest are aliases. */
export function parseAliasMap(): Record<string, string> {
  const lanes = parseEngineLanes()
  const byAsset: Record<string, string[]> = {}
  for (const [l, a] of Object.entries(lanes)) {
    if (a === "__generic__") continue
    ;(byAsset[a] = byAsset[a] ?? []).push(l)
  }
  const aliasOf: Record<string, string> = {}
  for (const [asset, ls] of Object.entries(byAsset)) {
    if (ls.length < 2) continue
    const stem = asset.replace(/^tree-sitter-/, "")
    const primary = ls.find((l) => l === stem) ?? ls[0]
    for (const l of ls) if (l !== primary) aliasOf[l] = primary
  }
  return aliasOf
}

export function manifestLanes(): string[] {
  const j = JSON.parse(readFileSync(MANIFEST, "utf8"))
  return j.analyzers.map((a: { analyzer: string }) => a.analyzer as string)
}

export function docLanes(): string[] {
  return readdirSync(DOCS_DIR)
    .filter((f) => /^real-.*-analyzer\.md$/.test(f))
    .map((f) => f.replace(/^real-/, "").replace(/-analyzer\.md$/, ""))
}

export function docFileFor(lane: string): string {
  return path.join(DOCS_DIR, `real-${lane}-analyzer.md`)
}

/**
 * The lane name the M14 sweep (`differential.ts` LANGS, and the F10 result rows)
 * uses for this lane. Only real divergences are listed.
 */
const SWEEP_LANE_NAME: Record<string, string> = {
  "objective-c": "objc",
}
export function sweepLaneName(lane: string): string {
  return SWEEP_LANE_NAME[lane] ?? lane
}

/** Lane names present in the M14 differential sweep map. */
export function parseF5Lanes(): Set<string> {
  const src = readFileSync(DIFFERENTIAL, "utf8")
  const at = src.indexOf("export const LANGS")
  if (at < 0) return new Set()
  const region = braceRegion(src, at)
  return new Set([...region.matchAll(/"?([a-z0-9_-]+)"?:\s*\{/g)].map((m) => m[1] as string))
}

export function hasF5Lane(lane: string): boolean {
  return parseF5Lanes().has(sweepLaneName(lane))
}

/** Lanes the F1 grammar-audit baseline covers. */
export function parseF1Lanes(): Set<string> {
  if (!existsSync(F1_BASELINE)) return new Set()
  return new Set(Object.keys(JSON.parse(readFileSync(F1_BASELINE, "utf8")).counts ?? {}))
}

export function hasF1Lane(lane: string): boolean {
  return parseF1Lanes().has(sweepLaneName(lane))
}

/** Per-lane pinned damage floors, keyed `<repo>:<sweepLaneName>`. */
export function f10FloorsFor(lane: string): Record<string, unknown> | null {
  if (!existsSync(F10_BASELINE)) return null
  const want = sweepLaneName(lane)
  const j = JSON.parse(readFileSync(F10_BASELINE, "utf8"))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries<any>(j.lanes ?? {})) {
    if (k === want || k.endsWith(`:${want}`)) out[k] = { eitherPct: v.eitherPct, sampleDigest: v.sampleDigest }
  }
  return Object.keys(out).length ? out : null
}

/** The F10 measurement rows for a lane. */
export function f10RowsFor(lane: string): Array<Record<string, unknown>> {
  if (!existsSync(F10)) return []
  const want = sweepLaneName(lane)
  const j = JSON.parse(readFileSync(F10, "utf8"))
  return (j.data?.rows ?? [])
    .filter((r: any) => r.lang === want)
    .map((r: any) => ({
      lane: `${r.repo}:${r.lang}`,
      which: r.which,
      files: r.files,
      errorFiles: r.errorFiles,
      missingFiles: r.missingFiles,
      eitherPct: r.eitherPct,
      emptyFiles: r.emptyFiles,
      sampleDigest: r.sampleDigest,
    }))
}
