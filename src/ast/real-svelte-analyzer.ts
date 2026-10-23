/**
 * Author: Muhammad Ishaq Khan
 *
 * Svelte analyzer. A two-layer parse — tree-sitter-svelte for the SFC skeleton, then each `<script>`
 * body under tree-sitter-javascript/typescript via the engine pre-parse — so template component usages,
 * `on:` event handlers, props, reactive declarations and script imports/calls/exports are all read from
 * the AST, never from text. Fully regex-free.
 *
 * Relationship types it covers: renders (template component usages — plain, dotted-namespace and
 * dynamic `this=` tags), calls (`on:` handlers and script calls), imports, exports, contains,
 * references, uses, extends, overrides and **implements**; its script-body delegate contributes
 * `instantiates` (script `new` only, RENDERS is the SFC template relation), `decorates`, `mixes_in`
 * and `part_of`, copied by the seam with `metadata.sfcDelegated`.
 * `implements` is load-bearing here: this lane emits class-heritage implements edges, and its contract
 * row was once MISSING the kind — the same shape as ruby's row. If the heritage handling below changes,
 * re-check that row: a kind emitted but absent from the row fails section B in the other direction.
 *
 * Grammar: `wasm/tree-sitter-svelte.wasm` for the SFC skeleton; tree-sitter-javascript/typescript for
 * the script bodies (engine pre-parse, `context.sfcScriptTrees`).
 *
 * Where the rest of the lane lives: docs/analyzers/svelte.md · docs/analyzers/real-svelte-analyzer.md ·
 * spec script/m14/spec/svelte-completeness.json · fixtures validation/m14/fixtures/svelte/ ·
 * validation validation/m14/results/ and validation/m14/verification/SVELTE-FIX-admitted.txt.
 *
 * WHEN THIS FILE CHANGES, EDIT THESE TOO: `src/ast/real-javascript-analyzer.ts` and
 * `src/ast/real-typescript-analyzer.ts` (the script-body contract this lane delegates to — a change
 * there moves this lane's symbols) · `src/ast/engine.ts` (the SFC script-tree pre-parse and the range
 * offsets back to SFC lines) · `script/m14/spec/svelte-completeness.json` ·
 * `validation/m14/fixtures/svelte/*.expectation.json` · `script/m14/completeness-inventory.ts`
 * (Lead-owned: this lane's requiredKinds/docs rows) · `docs/analyzers/real-svelte-analyzer.md`.
 */
// Svelte Intelligence Engine
// M12.13 rewrite: C#-family contract, pure-AST, fully regex-free.
//   - Two-layer parse: (1) tree-sitter-svelte gives the SFC skeleton — the
//     component root, template component usages, event-directive handlers,
//     and the <script> blocks whose bodies are `raw_text` nodes with exact
//     byte offsets; (2) each script body is parsed with
//     tree-sitter-javascript/typescript (engine pre-parse, see
//     ASTEngine.parseFile → context.sfcScriptTrees) and extracted via the
//     JS/TS family analyzer, with ranges offset back to SFC lines.
//   - Symbols: component (name = file module, Class); script bindings via the
//     JS contract (no locals/params); Svelte props (export let → Property,
//     $props() destructure → Property); reactive declarations ($: target →
//     Variable); rune/`$` reactive vars via the JS contract.
//     Template elements/attributes/directives are NEVER symbols.
//   - Relationships: template component usages → instantiates (leaf tag
//     names, HTML/Svelte builtins filtered); on: event directives → calls
//     (leaf handler identifier from the expression); script imports/calls/
//     exports via the JS contract; compiler macros/rune calls ($state,
//     $derived, $effect, $props, $inspect, $bindable, $host, $render)
//     filtered; contains from ownerName.
//
// Svelte 5 runes ($state/$derived/$effect/$props) are compiler macros — the
// vars they initialize are first-class symbols, the rune CALLS are not.

import type { Node, Tree } from "web-tree-sitter"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "path"
import { ASTEngine } from "./engine"
import { RealJavaScriptAnalyzer } from "./real-javascript-analyzer"
import { RealTypeScriptAnalyzer } from "./real-typescript-analyzer"

/**
 * M49 #868 — the SFC seam must shift the delegate's metadata LINE MIRRORS, not
 * only its `line_number`/symbol ranges.
 *
 * Measured on a decorated class inside a .vue script block (the same container
 * logic the svelte twin uses): the row `references Service -> sealed` carried
 * `line_number=6` — the line `@sealed` is actually written on — while its own
 * metadata still said `decoratorLine=5`, the SCRIPT-relative value, unshifted.
 * The applied offset was recorded on that very row (`sfcLineOffset: 1`), so the
 * payload contradicted both itself and the file, and a tool reading the mirror
 * got a line above the decorator it names.
 *
 * Only keys whose NAME is a line (`decoratorLine`, `line`, `decoratorLines`)
 * are touched, and only numeric values: a decorator whose line was never
 * recorded stays null rather than becoming a number (never invent a line, #823).
 */
function shiftMetadataLineMirrors(md: Record<string, unknown> | undefined, lineOffset: number): void {
  if (!md || lineOffset === 0) return
  for (const [k, v] of Object.entries(md)) {
    if (!keyCarriesALine(k)) continue
    if (typeof v === "number") md[k] = v + lineOffset
    else if (Array.isArray(v) && v.some((x) => typeof x === "number")) {
      md[k] = v.map((x) => (typeof x === "number" ? x + lineOffset : x))
    }
  }
}

// ============================================================================
// THE PACKAGES A PROJECT PUBLISHES — the evidence behind every claim below
// ============================================================================

/**
 * ONTOLOGY-WORKSTREAM SVELTE4 (2026-10-16). The lane's unresolved residual is 1,570
 * edges and most of it is not a missing computation — it is a reason the analyzer
 * already holds and publishes on a key nothing reads (the fleet-wide finding in
 * `validation/m14/verification/RESIDUAL-CLASSIFICATION-41-LANES.md`, finding (a)).
 *
 * A bare module specifier is NOT automatically external, and THIS lane's corpus is the
 * counterexample rather than a hypothetical one: the `svelte` checkout declares the
 * package name `svelte` in `package.json`, and its own tests import `svelte`,
 * `svelte/store` and `svelte/elements` — measured on this lane's own 400-file draw,
 * 24 of the 55 `svelte`-rooted import records sit in that repository and every one of
 * them names a declaration that IS in the checkout (`packages/svelte/src/…`). A shape
 * test alone would publish a false external claim on all 24.
 *
 * So the test is a FACT, not a shape: the names the project itself publishes. The read
 * is bounded and cached per project root — one `package.json` at the root plus one per
 * `packages/*` and `apps/*` (3 files for this corpus's monorepos; 6 project roots in
 * the whole admitted population) — and it happens only when a bare specifier needs the
 * test. Absent, unreadable or non-JSON files contribute NO name, which fails toward
 * not claiming: a name we do not have cannot excuse an external claim.
 */
const PROJECT_PUBLISHED_PACKAGES = new Map<string, Set<string>>()

function projectPublishedPackages(projectRoot: string): Set<string> {
  const cached = PROJECT_PUBLISHED_PACKAGES.get(projectRoot)
  if (cached) return cached
  const names = new Set<string>()
  const read = (p: string): void => {
    try {
      const j = JSON.parse(readFileSync(p, "utf8")) as { name?: unknown }
      if (typeof j?.name === "string" && j.name.trim() !== "") names.add(j.name.trim())
    } catch {
      // absent / unreadable / not JSON — no name, and no name means no excuse
    }
  }
  read(path.join(projectRoot, "package.json"))
  for (const dir of ["packages", "apps"]) {
    let entries: string[]
    try {
      entries = readdirSync(path.join(projectRoot, dir))
    } catch {
      continue
    }
    for (const e of entries) read(path.join(projectRoot, dir, e, "package.json"))
  }
  PROJECT_PUBLISHED_PACKAGES.set(projectRoot, names)
  return names
}

// ============================================================================
// BUILTIN TAG FILTERS — template component-usage detection
// ============================================================================

const HTML_BUILTIN_TAGS = new Set([
  "a", "abbr", "address", "area", "article", "aside", "audio", "b", "base", "bdi", "bdo",
  "blockquote", "body", "br", "button", "canvas", "caption", "cite", "code", "col",
  "colgroup", "data", "datalist", "dd", "del", "details", "dfn", "dialog", "div", "dl",
  "dt", "em", "embed", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2",
  "h3", "h4", "h5", "h6", "head", "header", "hgroup", "hr", "html", "i", "iframe", "img",
  "input", "ins", "kbd", "label", "legend", "li", "link", "main", "map", "mark", "menu",
  "meta", "meter", "nav", "noscript", "object", "ol", "optgroup", "option", "output", "p",
  "picture", "pre", "progress", "q", "rp", "rt", "ruby", "s", "samp", "script", "search",
  "section", "select", "slot", "small", "source", "span", "strong", "style", "sub",
  "summary", "sup", "table", "tbody", "td", "template", "textarea", "tfoot", "th", "thead",
  "time", "title", "tr", "track", "u", "ul", "var", "video", "wbr",
  // SVG
  "svg", "path", "g", "rect", "circle", "ellipse", "line", "polyline", "polygon",
  "text", "tspan", "use", "defs", "linearGradient", "radialGradient", "stop", "mask",
  "pattern", "marker", "view", "symbol", "clipPath",
  // SVG — the FILTER module and the rest of the element vocabulary (F30, 2026-10-12).
  //
  // Kept in LOCKSTEP with the vue lane's list: script/m14/verify-cross-language-consistency.ts
  // extracts both sets and both against the oracle's ORACLE_HTML_TAGS, and fails if they
  // differ, because whether a tag is markup or a component is a fact about the tag, not
  // about the language it is written in. NO DOUBLE QUOTES OR CLOSING-BRACKET-PAREN PAIR in
  // this comment: the parity gate slices this literal to the first such pair and treats
  // every quoted string in the slice as a tag.
  //
  // Measured on THIS lane's corpora before assuming, and the number is zero: 0 of the
  // 6,436 .svelte files on disk (svelte 4,561 + shadcn-svelte 1,878) contain a filter
  // primitive or a `<filter>` element at all. So this lane inherits the vocabulary from
  // the parity rule rather than from a defect anyone can see here today — the live
  // measurement is the vue lane's, and this lane's obligation is that it USES the set,
  // which is what svelte/svg-filter-builtin-tags pins and
  // svelte/reemit-svg-filter-tags regresses.
  // The defect it fixes was measured on the vue corpus (<filter>
  // and every filter PRIMITIVE published `instantiates` edges to targets no file declares:
  // 377 edges, 6 primitives); this lane has the same gap by construction, and the svelte
  // fixture set carries the twin check through the parity gate rather than a second corpus
  // measurement it has no draw for. An unknown namespace still fails toward VISIBILITY (see
  // BUILTIN_NAMESPACES); an element the SVG spec DEFINES is markup.
  "filter", "feBlend", "feColorMatrix", "feComponentTransfer", "feComposite",
  "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight",
  "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR",
  "feGaussianBlur", "feImage", "feMerge", "feMergeNode", "feMorphology", "feOffset",
  "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
  // the rest of SVG 2's element list, plus the SVG 1.1 elements browsers still parse —
  // the SPEC's vocabulary, counted separately from the measured block above.
  "switch", "foreignObject", "desc", "metadata", "textPath", "tref", "mpath",
  "animate", "animateMotion", "animateTransform", "set", "discard", "solidColor",
  "mesh", "meshgradient", "meshpatch", "meshrow", "hatch", "hatchpath",
  "altGlyph", "altGlyphDef", "altGlyphItem", "glyphRef", "animateColor", "cursor",
  "color-profile", "font", "font-face", "font-face-format", "font-face-name",
  "font-face-src", "font-face-uri", "glyph", "hkern", "missing-glyph", "vkern",
])

const SVELTE_BUILTIN_TAGS = new Set([
  "slot", "svelte:component", "svelte:self", "svelte:element", "svelte:window",
  "svelte:document", "svelte:body", "svelte:head", "svelte:options", "svelte:fragment",
  "svelte:boundary",
])

// --- D12: THE DIRECTIVE CARRIER SPACE ---------------------------------------
// Svelte carries behaviour and data through ATTRIBUTE NAMES, not through elements
// or expressions. Three families, three different obligations, and this lane
// implemented only the `on:` one until the census's carrier dimension measured the
// rest as silent across ~2,049 corpus occurrences.
//
//   READS A MEMBER -> `uses`, on the S1 argument (the template reads the
//     component's own state). `bind:` is two-way; the READ half is what the `uses`
//     vocabulary can express, and the write half is recorded as a declared
//     non-emission rather than invented as a new relationship type.
//   INVOKED BY THE FRAMEWORK -> `calls`, on the D8 argument: `on:click={h}` is a
//     call because the framework calls `h`, and Svelte calls an ACTION on mount and
//     a TRANSITION on state change by exactly the same mechanism. Their silence was
//     an internal inconsistency, not a position.
//   DECLARES, DOES NOT READ -> silent. `let:x` on a component is the component
//     naming a slot prop it ACCEPTS, so there is no member read to publish.
//
// Tailwind cannot collide with any of this: `md:grid-cols-2` and `after:absolute`
// live INSIDE a quoted `class` value, and only ATTRIBUTE NAMES are examined. The
// census measures the same distinction, which is why `after:*` does not appear in
// the corpus's carrier set at all.
const SVELTE_MEMBER_READ_DIRECTIVES = new Set(["bind", "class", "style"])
const SVELTE_INVOKED_DIRECTIVES = new Set(["use", "transition", "in", "out", "animate"])
const SVELTE_DECLARING_DIRECTIVES = new Set(["let"])

// Svelte compiler macros / runes — calls to these are never relationships.
const SVELTE_RUNES = new Set([
  "$state", "$state.raw", "$state.snapshot", "$state.eager", "$derived", "$derived.by",
  "$effect", "$effect.pre", "$effect.tracking", "$effect.root", "$effect.untracked", "$effect.pending",
  "$props", "$props.id", "$props.is_safe", "$bindable", "$host", "$inspect",
  "$inspect.trace", "$render", "$props",
])

// ============================================================================
// PURE-STRING HELPERS (regex-free)
// ============================================================================

/**
 * Values that are SPELLED like identifiers and are accepted by `isIdentifier`, but are
 * not names anything can be called ON.
 *
 * R7, standing rule, measured. `isIdentifier` tests the first character against
 * `[A-Za-z_$]`, so `null`, `undefined`, `true`, `false`, `NaN`, `Infinity` and `this` all
 * pass it. Two real corpus files hand the analyzer exactly that:
 *
 *   svelte/packages/svelte/tests/runtime-legacy/samples/component-events-nullish/main.svelte
 *       <Widget on:click={null} {logs} />
 *   svelte/packages/svelte/tests/runtime-runes/samples/undefined-event-handler/main.svelte
 *       <button onmouseenter={undefined}></button>
 *
 * Both produced a `calls` edge whose TARGET was the literal — `calls
 * component-events-nullish -> null` and `calls undefined-event-handler -> undefined`. That
 * is the fabrication class the workstream calls the most expensive mistake available: an
 * edge naming a value where the ontology means a callable, so `bb_impact` would report
 * that editing a symbol named `null` breaks a component. It is also the standing rule's
 * own shape — a placeholder-literal edge endpoint — and it survived a differential because
 * the oracle's mirrored handler rule has the same acceptance set: both sides emitted the
 * same wrong edge, so they agreed.
 *
 * SCOPE, stated rather than implied: this filters the HANDLER and INVOKED-CARRIER
 * extraction only. A member genuinely named `unknown` still emits, and two corpus files
 * declare one: `css/samples/omit-scoping-attribute-class-dynamic/input.svelte` has
 * `export let unknown = 'whatever'` and
 * `runtime-runes/samples/proxy-coercive-assignment-warning/main.svelte` has
 * `const unknown = (node) => …`. Those are the user's own bindings, an edge to them is
 * faithful, and R7 is about ANALYZER-SUPPLIED placeholders rather than about a source
 * identifier that happens to collide with one. Measured over the whole 6,439-file corpus
 * by `script/m14/svelte-r7-probe.mts`: 12 placeholder-literal sites, of which 10 are
 * those two files' faithful `unknown` bindings and 2 were these handler literals.
 *
 * The first two entries are JavaScript keywords and can never be a binding at all; the
 * rest are globals a name could shadow, and a handler named after one is a call to nothing
 * this file declares, which is the same fabrication by another route.
 */
const NON_CALLABLE_LITERALS = new Set(["null", "undefined", "true", "false", "NaN", "Infinity", "this"])

function isIdentifier(text: string): boolean {
  if (text.length === 0) return false
  const first = text[0]
  if (!((first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_" || first === "$")) return false
  for (let i = 1; i < text.length; i++) {
    const c = text[i]
    if (!((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$")) return false
  }
  return true
}

/** ECMAScript WhiteSpace + LineTerminator, READ BY CODE POINT — the set `\s` matched in the
 *  module-specifier refusal this replaces. A module specifier cannot legally carry any of them,
 *  so the check is a REFUSAL and must not be narrower than the rule it replaced: tab, LF, VT,
 *  FF, CR, SP, NBSP, U+1680, U+2000–U+200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
 *  A character walk, because a regex over source text matches comments and string literals,
 *  misses nested syntax and breaks silently on the next grammar version (the fleet's rule). */
export function containsWhitespace(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 160 || c === 5760) return true
    if (c >= 8192 && c <= 8202) return true
    if (c === 8232 || c === 8233 || c === 8239 || c === 8287 || c === 12288 || c === 65279) return true
  }
  return false
}

/** `^[a-zA-Z][a-zA-Z0-9+.-]*:` — a URI scheme (`virtual:`, `http:`, `data:`). Written as a
 *  colon split with the HEAD validated by character class, the same accept set as the pattern
 *  it replaces: at least one character before the colon, the first a letter, the rest
 *  letter/digit/`+`/`.`/`-`. Anything else is not a scheme and is left to the package rules. */
export function isUriSchemeSpecifier(spec: string): boolean {
  const colon = spec.indexOf(":")
  if (colon <= 0) return false
  for (let i = 0; i < colon; i++) {
    const c = spec.charCodeAt(i)
    const letter = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    if (i === 0) {
      if (!letter) return false
      continue
    }
    const digit = c >= 48 && c <= 57
    if (!letter && !digit && c !== 43 && c !== 46 && c !== 45) return false
  }
  return true
}

/** `^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$` — a plain identifier or a
 *  dotted identifier chain (`Icon`, `AccordionPrimitive.Root`). A SINGLE segment is valid.
 *  THE EMPTY SEGMENT IS THE CASE A HAND-WRITTEN LOOP GETS WRONG: `a..b`, `.a` and `a.` must
 *  all be false. Each segment is validated by the analyzer's existing char-walk `isIdentifier`,
 *  so an empty segment fails by the same rule an empty whole string does — construction, not
 *  an off-by-one. Proved by `script/m14/svelte-ident-checks.ts` (`bun run`). */
export function isDottedIdentifierChain(text: string): boolean {
  let start = 0
  while (true) {
    const dot = text.indexOf(".", start)
    const end = dot < 0 ? text.length : dot
    if (!isIdentifier(text.slice(start, end))) return false
    if (dot < 0) return true
    start = dot + 1
  }
}

/**
 * `{#await promise then value}` / `{#await promise as value}` — split the head
 * fragment into the PROMISE expression and everything after the `then`/`as`
 * keyword. Returns undefined when the fragment carries no such keyword, which
 * is the `{:then}`/block form.
 *
 * A char walk, and deliberately the same accept set as the pattern it replaces:
 * the keyword must be preceded by a whitespace run and followed by a whitespace
 * run, so `sometimes` (`then` with no leading space) and `has` (`as` not at a
 * word start) do NOT match — `has` in particular, because a promise named `as`
 * is the only thing that would be lost and Svelte has no such binding.
 * `head` is everything before the keyword's whitespace run; `matchLength` is
 * the length of the whole match, so `text.slice(matchLength)` is the remainder.
 */
export function splitAwaitHead(text: string): { head: string; matchLength: number } | undefined {
  const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r"
  let i = 0
  while (i < text.length) {
    if (!isSpace(text[i])) {
      i++
      continue
    }
    const wsStart = i
    while (i < text.length && isSpace(text[i])) i++
    const kwStart = i
    let kwLen = 0
    if (text.startsWith("then", i)) kwLen = 4
    else if (text.startsWith("as", i)) kwLen = 2
    if (kwLen > 0 && i + kwLen < text.length && isSpace(text[i + kwLen])) {
      let after = i + kwLen
      while (after < text.length && isSpace(text[after])) after++
      return { head: text.slice(0, wsStart), matchLength: after }
    }
    i = kwStart + 1
  }
  return undefined
}

/**
 * `key` names a LINE (`decoratorLine`, `line`, `decoratorLines`) as a
 * case-insensitive substring test, with no pattern literal. Only the KEY NAME
 * is examined; the value's type is decided by the caller.
 */
function keyCarriesALine(key: string): boolean {
  return key.toLowerCase().indexOf("line") >= 0
}

/**
 * `/^on[a-z]+$/` as a char walk — the Svelte-5 event-attribute spelling test
 * (`on` + one or more lowercase letters, nothing else). M49.R2: the AST regex
 * census counted the literal as review-class debt, and a fixed prefix plus a
 * lowercase run needs no regex.
 */
function isOnEventAttrName(name: string): boolean {
  if (name.length < 3 || name[0] !== "o" || name[1] !== "n") return false
  for (let i = 2; i < name.length; i++) {
    const c = name[i]
    if (c < "a" || c > "z") return false
  }
  return true
}

// ============================================================================
// ANALYZER
// ============================================================================

// Last segments of dotted runes - a '$'-prefixed callee whose leaf is one of
// these is a rune call; '$'-prefixed USER functions with other names pass.
const RUNE_LEAF_SEGMENTS = new Set([
  "state", "raw", "snapshot", "derived", "by", "effect", "pre", "tracking",
  "root", "untracked", "props", "id", "is_safe", "bindable", "host",
  "inspect", "trace", "render",
])

// D7 (RULED 2026-09-27): a rune that INVOKES its argument turns a named function
// reference into a real call site, exactly as `on:click={inc}` is one. The set is
// the invoking half of Svelte's rune surface, and the split is the whole ruling —
// it is not "any `$`-call with an argument", because the value-taking runes
// (`$derived(count)`, `$state(0)`, `$bindable(v)`) hand over a VALUE that is
// never called, and an edge there would point a call at an expression.
//
//   INVOKING   — the primitive calls what it is given: $effect, $effect.pre,
//                $effect.root, $effect.untracked, $derived.by, $host.
//   VALUE-TAKING, deliberately absent: $derived (an expression), $state and its
//                raw/snapshot forms, $props/$props.id/$props.is_safe, $bindable,
//                $inspect/$inspect.trace, $render, and $effect.tracking (no
//                argument at all).
// A user's own `$`-prefixed function is not in either set, so `$myHelper(fn)`
// stays out — the same reason `isRuneCallee` refuses a bare `$` prefix.
const SVELTE_INVOKING_RUNES = new Set([
  "$effect", "$effect.pre", "$effect.root", "$effect.untracked", "$derived.by", "$host",
])

function isInvokingRune(calleeExpression: string): boolean {
  return SVELTE_INVOKING_RUNES.has(calleeExpression)
}

// `$state.eager` and `$effect.pending` are added as EXACT names, never as leaf
// segments in RUNE_LEAF_SEGMENTS, and that is load-bearing rather than stylistic.
// Measured over the 6,143-file corpus: the same `$name.member` SHAPE is also how
// ordinary user data is written — `$order.scoops` (6), `$value.foo` (6),
// `$a.foo` (5), `$formData.dob` (5), `$storeDeeper.items` (3) — plus SvelteKit's
// import aliases `$lib` (3,549) and `$app` (25) and 78 distinct dotted forms in
// total. Adding the bare leaves `eager`/`pending` would suppress any
// `$anything.eager`, and a framework primitive leaking into the graph is exactly
// what this filter exists to prevent. Before the fix both leaked: `$state.eager(0)`
// published `calls -> eager` and `$effect.pending()` published `calls -> pending`,
// naming framework plumbing as though it were a component member.
//
// Found by the construct census (`script/m14/verify-svelte-census.ts`), which
// consults NEITHER this analyzer nor the F5 oracle — a census that read either
// side would inherit the same omission, which is how a shared premise survives a
// 100% differential.
function isRuneCallee(calleeExpression: string): boolean {
  if (!calleeExpression.startsWith("$")) return false
  if (SVELTE_RUNES.has(calleeExpression)) return true
  const leaf = calleeExpression.split(".").pop() ?? ""
  return RUNE_LEAF_SEGMENTS.has(leaf)
}

/**
 * THE DELEGATE'S FILE-LEVEL ACTOR — the spelling the JavaScript delegate uses for an
 * edge whose actor is the FILE rather than a symbol, and which THIS seam must translate.
 *
 * `"(file)"` is the family's declared sentinel (`real-javascript-analyzer.ts`
 * `FILE_LEVEL_SOURCE`, paired there with `metadata.fileLevel: true` and pinned by that
 * lane's own fixtures; rust, scala, kotlin, zig, graphql and nim publish it too). `(` and
 * `)` cannot appear in an identifier at all, so it can never collide with a name.
 *
 * WHY THE SEAM TRANSLATES IT. This seam runs the delegate with the SFC's OWN file path
 * (see the `new RealJavaScriptAnalyzer().analyze(…, filePath, …)` call), so every
 * module-scope row the delegate produces is a statement about THIS component — the
 * component symbol is the module's identity. `(file)` names no symbol in a `.svelte`
 * file, so a row left carrying it dangles and `svelte/relationship-kind-catalog`'s
 * `imports` pin (sourced at the component) cannot be reached.
 *
 * TRANSLATION, NOT SUPPRESSION: `metadata.fileLevel` and `metadata.scopeName` stay exactly
 * as the delegate wrote them, so the row is still marked module-scope and the delegate's
 * module name is preserved. Only the ACTOR is respelled as the artifact it belongs to.
 */
const DELEGATE_FILE_ACTOR = "(file)"

export class RealSvelteAnalyzer implements ASTEngine.LanguageAnalyzer {
  analyze(
    rootNode: Node,
    content: string,
    filePath: string,
    context?: ASTEngine.AnalyzeContext,
  ): ASTEngine.ParseResult & { metadata: Partial<ASTEngine.FileMetadata> } {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    const patterns: Record<string, boolean> = {}
    const moduleName = path.basename(filePath, path.extname(filePath))
    patterns["Svelte SFC"] = true

    // --- Error collection (svelte grammar) -----------------------------------
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if (n.type === "ERROR" || n.isMissing) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        // ALL children, not `namedChild`: a MISSING node carries the grammar's
        // expected token, and for a tag terminator that token is the ANONYMOUS `>`.
        // Walking named children only therefore made the analyzer blind to exactly
        // the recovery case it was written to report — measured on a real corpus
        // file (`parser-legacy/samples/loose-unclosed-tag/input.svelte`), where the
        // engine reported `Syntax error (missing node)` at L16 and this analyzer
        // reported nothing. Nothing was lost operationally, because the engine's own
        // walk uses `children` and covers it — but the analyzer's three-part
        // contract (report at the node's OWN span, bypass it, keep publishing) was
        // honoured for ERROR and silently not for MISSING, and a contract that
        // depends on a caller to be complete is not a contract. The engine's walk is
        // the model, and this now matches it.
        for (let i = n.childCount - 1; i >= 0; i--) {
          const child = n.child(i)
          if (child) errStack.push(child)
        }
      }
    }

    // --- 1. Component symbol ---------------------------------------------------
    symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Class,
      range: this.nodeToRange(rootNode),
      scope: "",
      visibility: "public",
      metadata: { isSvelteComponent: true, isSfc: true },
    })

    // --- 2. Template pass: component usages → renders; on: → calls ------
    // Walk the SFC tree; skip <script>/<style> subtrees; every non-builtin
    // element tag is a component usage (leaf tag name as written). on: event
    // directives produce a call to the leaf handler identifier in the
    // expression value.
    // Each stack frame carries a mutable lexical scope shared by siblings.
    // This is necessary for {@const}: its binding becomes visible to later
    // siblings in the enclosing block, but must not leak to the parent or a
    // nested block.
    const seenUsages = new Set<string>()
    let templateDecisions = 0
    // S1 (#419): template expressions reference script-side members — collect
    // the identifiers from expressions ({count}, label={label}, {#each items
    // as item}, {#await promise then value}, {@html raw}, {@const total},
    // {@debug x}, <svelte:component this={Comp}>) during the walk; the member
    // symbols only exist after the script pass, so the Uses edges are emitted
    // after the merge (step 3b).
    //
    // The svelte grammar exposes template expressions as opaque svelte_raw_text
    // (no child AST), so identifier extraction is by text scan (the documented
    // fallback).
    //
    // Scope (vue V4 lesson, applied pre-fix): template-LOCAL bindings shadow
    // members — {#each items as item, i} binds item+i; {#await promise then
    // value} binds value; {:catch err} binds err; {#snippet row(label)}
    // binds label+count. A shadowed name must NOT emit a use.
    const templateExprNames = new Map<string, number>()
    // ONTOLOGY-WORKSTREAM SVELTE3 — the collapse, DECLARED rather than hidden.
    //
    // `templateExprNames` is a `Map<name, line>`, so a second read of one member
    // OVERWRITES the first, and the `seenUses` dedupe then publishes exactly ONE
    // `uses` edge whose `line_number` is the LAST site. Every earlier site is
    // unrecoverable from the edge. Reproduced on a fixture with four reads of
    // `count` (lines 6, 8, 9, 10): one edge, line 10, lines 6/8/9 gone.
    //
    // Measured over shadcn-svelte's 1,878 files: 2,953 template-sourced `uses`
    // edges, of which 979 (33.2%) name a member the template writes on MORE THAN
    // ONE line, standing in for 2,106 template read sites that reach no edge at
    // all. The edge is therefore not wrong — "this template reads this member" is
    // true — but a consumer asking WHERE reads one line and gets the last of
    // several, which is a false answer presented as a fact.
    //
    // The fix records EVERY site rather than emitting one edge per site. One edge
    // per read would add 2,106 edges (+7.6% of the svelte payload) to express N
    // copies of the SAME set-membership fact, and would make a consumer count reads
    // by counting edges — which is what made this projection lossy in the first
    // place. The edge count is unchanged and `line_number` keeps its existing
    // meaning (the last site, unchanged for every existing fixture); what changes is
    // that the full set is now machine-readable on the edge.
    const templateReadSites = new Map<string, number[]>()
    // D12: framework-invoked carriers (`use:`, `transition:`, `in:`, `out:`,
    // `animate:`) are CALL SITES. Accumulated here and emitted after the walk, so
    // the edges pass through the same DEDUPE and the same central `classifyEvidenceTier`
    // as every other edge rather than hardcoding a tier here.
    const directiveCalls: Array<{ leaf: string; line: number; context: string }> = []
    const seenDirectiveCalls = new Set<string>()
    // `name@line` for every member read contributed by a `bind:`/`class:`/`style:`
    // carrier, so the emitted `uses` edge can say which carrier produced it.
    const carrierReadKeys = new Set<string>()
    // H2 (review wave): `this=` targets on svelte:component/svelte:element
    // with a bare-identifier value are DYNAMIC component references,
    // resolved post-merge (imports are unknown until the script pass).
    const thisTargets = new Map<string, number>()
    // F22 (2026-10-12): THE SITE MAP for the same references, because
    // `thisTargets` is a `Map<name, line>` and a name written at several sites
    // silently lost every one but the last. The fixture's own corpus measurement:
    // 125 bare-identifier `this={X}` sites in 73 files over 6,439 corpus `.svelte`
    // files, of which 11 files write one name at more than one site and 36 sites
    // collapse — `svelte-component/input.svelte` writes `Component` 11 times and
    // `stuff` 8 times in one file. The EDGE was right in every case, which is why
    // no gate ever saw the loss: only the payload's reach into the earlier sites
    // was gone. `line_number` keeps the LAST site on purpose (the fixture pins
    // 33 for `Widget`, not 25, so no shared payload baseline moves), and the whole
    // set travels in `metadata.dynamicTargetLines`.
    const thisTargetSites = new Map<string, number[]>()
    // ONTOLOGY-WORKSTREAM SVELTE3: a DOTTED component tag — `<Card.Root/>` — is
    // Svelte's namespaced-component syntax, resolved by reading the NAMESPACE OBJECT
    // bound to `Card`. Three measured facts make the old shape wrong:
    //
    //   1. The target string `Card.Root` is not a symbol. Measured over 1,878
    //      shadcn-svelte files: 7,845 of 11,706 `instantiates` edges (67.0%) carry a
    //      dotted target, and 0 of those 7,845 name a symbol the file publishes or
    //      the corpus holds. Every one of them is an edge `bb_graph` cannot follow.
    //   2. The tag's FIRST segment is checkable. `Card` is an import binding in
    //      99.3% of those edges (7,791 of 7,845), so the edge can name the MODULE
    //      the component comes from — the strongest fact this analyzer can prove,
    //      since the module itself lives outside the corpus.
    //   3. A dotted tag whose segment 0 is NOT imported names nothing Svelte can
    //      resolve: the compiler rejects the file. 54 edges in the corpus are in
    //      that state, and they are dropped for exactly the reason the reserved
    //      `svelte:` namespace is dropped above (D9/D11, gap X4) — an undeclared
    //      name in a reserved position is a compile error, not a component.
    //
    // WHY THE TARGET STAYS AS WRITTEN. Naming the member leaf instead (`Root`) is
    // what this analyzer's OWN `calls` and `{@render}` rules do for a dotted
    // expression (`on:click={box.open}` -> `open`, `{@render ns.row(it)}` -> `row`),
    // and it was tempting on symmetry grounds alone. It is refused because `Root` is
    // a global name the analyzer has NOT seen: the module is outside the corpus, so
    // asserting that it exports `Root` is a fabrication, which the workstream counts
    // against the lane and which poisons bb_graph / bb_impact / bb_migrate. The tag as
    // written is a FACT; the module behind it is now recorded; the member inside it is
    // declared unverified in `resolution`. The D4 asymmetry (first segment here, last
    // segment there) is deliberate and is the cost of not inventing a symbol.
    //
    // Resolved POST-MERGE for the same reason as `thisTargets` above: the import
    // records do not exist until the script pass has run.
    const dottedTags = new Map<string, { line: number; templateLocal: boolean }>()
    const templateStack: Array<{ node: Node; scope: { shadowed: Set<string> } }> = [
      { node: rootNode, scope: { shadowed: new Set() } },
    ]
    while (templateStack.length > 0) {
      const { node: n, scope } = templateStack.pop()!
      const t = n.type
      if (t === "script_element" || t === "style_element") continue
      const shadowed = scope.shadowed
      // A block gets an isolated scope shared by all of its children. Ordinary
      // nodes keep the current scope so {@const} can update the enclosing
      // block for later siblings without leaking across nested blocks.
      const opensScope =
        t === "each_statement" || t === "await_statement" ||
        t === "if_statement" || t === "else_if_block" ||
        t === "key_statement" || t === "snippet_statement"
      const childScope = opensScope ? { shadowed: new Set(shadowed) } : scope
      const childShadowed = childScope.shadowed
      // {#snippet name(params)} — reusable template functions; the name is
      // a component-owned Method, and {@render name(...)} calls it.
      if (t === "snippet_statement") {
        const nm = this.findDescendant(n, (c) => c.type === "snippet_name")
        if (nm && !seenUsages.has("snippet:" + nm.text)) {
          seenUsages.add("snippet:" + nm.text)
          symbols.push({
            name: nm.text,
            kind: ASTEngine.SymbolKind.Method,
            range: this.nodeToRange(n),
            scope: moduleName,
            ownerName: moduleName,
            ownerKind: ASTEngine.SymbolKind.Class,
            visibility: "public",
            metadata: { isSnippet: true },
          })
          // snippet params ({#snippet row(label)} of) are template-local — and
          // F28: a parameter DEFAULT is a read on the same line.
          this.collectSnippetParams(n, templateExprNames, childShadowed, templateReadSites)
        }
      }
      if (t === "render_tag") {
        // render_tag content is OPAQUE TEXT in this grammar (no child
        // nodes) - the snippet name is scanned from the raw tag text.
        const text = n.text.replace("{@render", "").trim()
        let end = 0
        while (end < text.length && (isIdentifier(text.slice(0, end + 1)))) end++
        let targetName = text.slice(0, end)
        // D4 (second review): dotted render targets (`{@render ns.row(it)}`)
        // resolved to the FIRST segment while on: handlers resolve dotted
        // leaves to the LAST (`box.open` -> open) — same shape, opposite
        // answers. The callable leaf is the last all-identifier segment
        // (optional-chaining and the trailing call parens stripped); anything
        // else keeps the leading-identifier fallback (`children?.()` -> children).
        const afterLead = text.slice(end).trimStart()
        if (targetName && (afterLead.startsWith(".") || afterLead.startsWith("?."))) {
          const leaf = this.dottedRenderLeaf(text)
          if (leaf) targetName = leaf
        }
        const target = targetName ? { text: targetName } : undefined
        if (target && isIdentifier(target.text)) {
          relationships.push({
            source: moduleName,
            target: target.text,
            type: ASTEngine.RelationshipType.Calls,
            confidence: 0.9,
            // M59 (#825): the `{@render ...}` tag the name is written in.
            line_number: n.startPosition.row + 1,
            metadata: { context: "Svelte {@render} tag" },
          })
          // F24 (2026-10-12): THE ARGUMENTS ARE READS, and they are the only part
          // of a render tag that is. The branch above publishes the CALLEE as a
          // `calls` edge and the argument list was read by nothing at all: on the
          // fixture, `{@render row(alpha)}` published `calls -> row` and not one
          // `uses` row, so a snippet call's inputs were invisible to the graph.
          //
          // Three boundaries are the fixture's, and each is a forbid row of its
          // own rather than a consequence of this code:
          //
          //   the CALLEE is excluded (sliced off with the paren), because it
          //     belongs to the `calls` edge — publishing it here would
          //     double-count one fact as two;
          //   a member LEAF stays out (`row(obj.eps)` reads `obj`): the
          //     collector's receiver-only dot rule already refuses a dot-preceded
          //     token, and that rule is deliberately reused rather than
          //     re-implemented;
          //   a SNIPPET PARAMETER stays out (`{#snippet row(u)}` above), because
          //     the walk's shadow set still holds it — the control that this
          //     sweep did not simply read the whole fragment.
          //
          // The BASE LINE is the tag's own row plus the newlines before the
          // argument list, so the multiline form's identifiers land on THEIR
          // lines (41/42, not the tag's 40) — the M59 #825 rule this lane follows
          // for every other template read, and the fixture forbids the tag-line
          // spelling on both arguments.
          const open = text.indexOf("(")
          if (open >= 0) {
            const args = text.slice(open + 1, text.endsWith(")") ? text.length - 1 : text.length)
            if (args.trim()) {
              this.collectIdentifiersFromText(
                args, templateExprNames, childShadowed,
                n.startPosition.row + 1 + RealSvelteAnalyzer.linesBefore(text, open + 1),
                templateReadSites,
              )
            }
          }
        }
      }
      // Template DECISION constructs: {#if}/{:else if} branches, {#each}
      // loops, {#await} branches — they branch rendering like code.
      if (
        t === "if_statement" || t === "else_if_block" ||
        t === "each_statement" || t === "await_statement" || t === "key_statement"
      ) {
        templateDecisions++
      }
      // S1: {#each items as item, i} — the collection is a member use, but
      // the loop vars (item, i) are template-LOCAL.
      if (t === "each_statement") {
        this.collectEachExpression(n, templateExprNames, childShadowed, templateReadSites)
      }
      // S1: {#await promise then value} {:catch err} — the promise is a member
      // use; then/catch vars are template-LOCAL.
      if (t === "await_statement") {
        this.collectAwaitExpression(n, templateExprNames, childShadowed, templateReadSites)
      }
      // D5 (second review): {#if cond}, {:else if cond} and {#key exp}
      // conditions are opaque svelte_raw_text under if_start/else_if_start/
      // key_start — no `expression` node ever visits them, so conditions
      // referencing ONLY the condition (masked in every fixture by duplicate
      // reads elsewhere) emitted nothing. Pure reads, no bindings.
      if (t === "if_statement" || t === "else_if_block" || t === "key_statement") {
        this.collectConditionExpression(n, templateExprNames, childShadowed, templateReadSites)
      }
      if (t === "expression") {
        // {count}, label={label}, this={Comp}, {@const total}, {@debug x},
        // {@html raw} — every expression body is a member read.
        this.collectExpressionIdentifiers(n, templateExprNames, childShadowed, templateReadSites)
      }
      // {@html raw} / {@const total = expr} / {@debug expr} carry the body
      // directly as svelte_raw_text (no `expression` wrapper node).
      if (t === "html_tag" || t === "const_tag" || t === "debug_tag") {
        this.collectTagExpressionIdentifiers(n, templateExprNames, childShadowed, templateReadSites)
        // {@const total = expr} BINDS `total` as a template-LOCAL that
        // shadows any same-named member within this subtree — register the
        // binding name into childShadowed so later {total} reads don't emit a
        // false member use (S5, {@const} shadow case).
        if (t === "const_tag") {
          const body = this.expressionText(n)
          const eq = this.topLevelEq(body)
          if (eq >= 0) this.collectShadowNames(body.slice(0, eq), childShadowed)
        }
      }
      if (t === "element" || t === "self_closing_tag") {
        const tag = this.elementTagName(n)
        // D9/D11 (RULED 2026-09-27): the `svelte:` prefix is a RESERVED NAMESPACE.
        // Only the elements in SVELTE_BUILTIN_TAGS exist; an undeclared `svelte:*`
        // is a compile error and cannot name a component, so it must not become an
        // `instantiates` target. Without this, `<svelte:selfdestructive x="{x-1}"/>`
        // — a deliberate near-miss of `svelte:self` in the corpus's own
        // `compiler-errors/samples/` — published `instantiates ->
        // svelte:selfdestructive`, naming a component that cannot exist.
        //
        // THE INTERESTING PART IS THAT NO GATE COULD SEE IT. The F5 oracle's emit
        // condition is `!ORACLE_HTML_TAGS.has(name) && !VUE_STYLE_BUILTINS.has(name)`,
        // and that name is in neither set either — so the oracle derived the SAME
        // edge. Both sides agreed, the differential reported 0 missing and 0
        // unexplained, and the lane read clean. A shared-premise defect is strictly
        // worse than an ordinary one: it is invisible to the only gate that compares
        // the two sides, which is why the construct census exists. Recorded as gap
        // X4, owner the oracle; the analyzer is the side that can be fixed here.
        if (tag && tag.startsWith("svelte:") && !SVELTE_BUILTIN_TAGS.has(tag)) {
          // reserved namespace, undeclared member — deliberately not a component
        } else if (tag && tag.includes(".") && !seenUsages.has(tag)) {
          // A NAMESPACE-qualified tag (`<Card.Root/>`). Deferred to the post-merge
          // pass below, which is the first point where the file's import bindings
          // exist. See the `dottedTags` declaration for why the target is not
          // rewritten to its member leaf.
          seenUsages.add(tag)
          const tagNode = this.elementTagNameNode(n)
          const nsSegment = tag.slice(0, tag.indexOf("."))
          // THE TEMPLATE-LOCAL CASE, and it is not a corner. `{#each items as item}`
          // followed by `<item.icon/>` is a legal Svelte DYNAMIC component: `item` is
          // a block-local the loop declares, not an import. Measured on
          // shadcn-svelte's own blocks: `nav-secondary.svelte:22` (`<item.icon/>`
          // under `{#each items as item}`), `demo-sidebar-menu.svelte`
          // (`<project.icon/>`), `demo-sidebar-icon.svelte` (`<team.logo/>`,
          // `<activeTeam.logo/>`), `+page.svelte` (`<data.component/>`).
          //
          // The FIRST version of this rule tested the import bindings alone and so
          // DROPPED all of them — and the 400-file differential reported exactly
          // that, 12 MISSING in its sample, every one a loop-variable component. A
          // rule that removed 12 real edges to fix 54 unbindable ones was the wrong
          // trade, and the gate that found it is the one whose job is comparing the
          // two sides. The shadow set is the analyzer's own record of the bindings
          // this template declares, so the check is structural, not a name guess.
          dottedTags.set(tag, {
            line: tagNode ? tagNode.startPosition.row + 1 : 0,
            templateLocal: shadowed.has(nsSegment),
          })
        } else if (tag && !HTML_BUILTIN_TAGS.has(tag) && !SVELTE_BUILTIN_TAGS.has(tag) && !seenUsages.has(tag)) {
          seenUsages.add(tag)
          const tagNode = this.elementTagNameNode(n)
          relationships.push({
            source: moduleName,
            target: tag,
            // RENDERS, NOT INSTANTIATES (2026-10-23, extended vocabulary). A component tag creates
            // an element the HOST RENDERER mounts; the source contains no `new`, so an
            // `instantiates` edge claimed an allocation site the file does not have (types.ts'
            // Renders contract). `instantiates` keeps its OWN sites: the JS/TS delegate's script
            // `new` rows, copied by the seam below — the two relations stay distinct.
            type: ASTEngine.RelationshipType.Renders,
            confidence: 0.95,
            // M59 (#825): the `<Child/>` tag as written.
            ...(tagNode ? { line_number: tagNode.startPosition.row + 1 } : {}),
            metadata: { isComponentUsage: true },
          })
        }
        // H2: svelte:component/svelte:element `this={X}` — record bare
        // identifiers for post-merge resolution (below).
        if (tag === "svelte:component" || tag === "svelte:element") {
          const thisTag = this.findChildByType(n, "start_tag") || this.findChildByType(n, "self_closing_tag")
          if (thisTag) {
            for (let i = 0; i < thisTag.namedChildCount; i++) {
              const attr = thisTag.namedChild(i)
              if (!attr || attr.type !== "attribute" || this.attributeName(attr) !== "this") continue
              const valueNode = this.findChildByType(attr, "expression")
              if (!valueNode) continue
              let vt = valueNode.text.trim()
              if (vt.startsWith("{") && vt.endsWith("}")) vt = vt.slice(1, -1).trim()
              if (vt && isIdentifier(vt)) {
                const siteLine = valueNode.startPosition.row + 1
                thisTargets.set(vt, siteLine)
                const prior = thisTargetSites.get(vt)
                if (prior) prior.push(siteLine)
                else thisTargetSites.set(vt, [siteLine])
              }
            }
          }
        }
        // H1/H3 (review wave): shorthand {value} and spread {...props}
        // carry the whole expression in the attribute NAME with no
        // expression child, so no other walk ever visits them. Named
        // attributes WITH an expression child (this={Comp}, label={x})
        // are already covered by the generic expression branch — skip
        // those here to avoid double collection. (on: handlers keep
        // their own calls path above and are skipped too.)
        const startTag2 = this.findChildByType(n, "start_tag") || this.findChildByType(n, "self_closing_tag")
        if (startTag2) {
          for (let i = 0; i < startTag2.namedChildCount; i++) {
            const attr = startTag2.namedChild(i)
            if (!attr || attr.type !== "attribute") continue
            const attrName = this.attributeName(attr)
            if (!attrName || attrName.startsWith("on:")) continue
            if (this.findChildByType(attr, "expression")) continue
            if (attrName.startsWith("{") && attrName.endsWith("}")) {
              const inner = attrName.slice(1, -1).trim()
              const expr = inner.startsWith("...") ? inner.slice(3) : inner
              // The shorthand lives in the attribute NAME, so the line is the
              // attribute's (the name is written on the tag it belongs to).
              this.collectIdentifiersFromText(expr, templateExprNames, childShadowed, attr.startPosition.row + 1, templateReadSites)
            }
          }
        }
        // --- D12: the directive carrier space ---------------------------------
        // `on:` is handled below, and everything else that Svelte spells as
        // `prefix:name` on an attribute was silent until this. Two obligations, one
        // table each, and the member-read half feeds the SAME `templateExprNames`
        // the block constructs use, so a `bind:value={m}` read and a `{m}` read are
        // indistinguishable downstream — which is the point: they are the same fact.
        // `startTag2` is NULL for a bare self-closing tag: the node IS the
        // `self_closing_tag`, so `findChildByType(n, "self_closing_tag")` looks for
        // a child of that type and finds none. The shorthand pass above guards for
        // exactly this and my first version did not, so every self-closing tag with
        // an expression-valued attribute — `<input bind:value={m} />`,
        // `<svelte:component this={C} />` — threw and the engine returned a BASIC
        // PARSE RESULT: zero symbols for the whole file.
        for (let i = 0; startTag2 && i < startTag2.namedChildCount; i++) {
          const attr = startTag2.namedChild(i)
          if (!attr || attr.type !== "attribute") continue
          const attrName = this.attributeName(attr)
          if (!attrName) continue
          const colon = attrName.indexOf(":")
          if (colon <= 0) continue
          const prefix = attrName.slice(0, colon)
          const rest = attrName.slice(colon + 1)
          if (!rest) continue
          if (attrName.startsWith("on:")) continue // its own pass below
          if (SVELTE_DECLARING_DIRECTIVES.has(prefix)) continue

          const exprNode = this.findChildByType(attr, "expression")
          // The READ families: collect from the value expression at the value's own
          // line, falling back to the attribute's for the valueless forms.
          if (SVELTE_MEMBER_READ_DIRECTIVES.has(prefix)) {
            const text = exprNode ? this.expressionText(exprNode) : ""
            if (!text) continue
            const base = exprNode ? exprNode.startPosition.row + 1 : attr.startPosition.row + 1
            const before = new Set(templateExprNames.keys())
            this.collectIdentifiersFromText(text, templateExprNames, childShadowed, base, templateReadSites)
            // D12 provenance. The read joins the SAME `templateExprNames` the block
            // constructs use, which is deliberate — a `bind:value={m}` read and a
            // `{m}` read are the same fact — but it means the collection site is
            // otherwise unrecoverable from the edge. Recording WHICH CARRIER produced
            // it is information a consumer wants in its own right: "is this member read
            // a two-way binding, a class toggle or a style value?" is not answerable
            // from `uses` alone, and `bind:` is the one family that is two-way.
            for (const nm of templateExprNames.keys()) if (!before.has(nm)) carrierReadKeys.add(`${nm}@${templateExprNames.get(nm)}`)
            continue
          }
          // The INVOKED families: the target is the directive's own name, written in
          // the attribute name, so the line is the attribute's — the same rule the
          // shorthand pass uses for a name that lives in the attribute name.
          if (SVELTE_INVOKED_DIRECTIVES.has(prefix)) {
            if (rest === moduleName) continue
            // A dotted directive value is a namespace (`transition:helpers.slide`),
            // and the callable leaf is what a `calls` edge can name.
            const leaf = rest.includes(".") ? rest.slice(rest.lastIndexOf(".") + 1) : rest
            if (!leaf) continue
            // Same rule as the handler extraction, for the same reason: `use:null` names a
            // value, and a `calls` edge naming a value is the fabrication class. Note this
            // filters the DIRECTIVE'S OWN NAME, not its argument — `use:action={null}`
            // still emits `calls -> action`, because the framework invokes the name written
            // in the attribute and the argument's value does not change what is invoked.
            if (NON_CALLABLE_LITERALS.has(leaf)) continue
            seenDirectiveCalls.add(`${leaf}@${attr.startPosition.row + 1}`)
            directiveCalls.push({
              leaf,
              line: attr.startPosition.row + 1,
              context: `Svelte ${prefix} directive ${attrName}`,
            })
          }
        }
        // on: directives — the handler is the first call-target identifier or
        // bare-identifier leaf of the expression value (`on:click={inc}` →
        // inc; `on:click={() => bump()}` → bump; `on:greet={greet}` → greet).
        // Svelte 5 `onclick`-style attributes (`onclick={save}`) are the same
        // edge through the modern spelling — but ONLY on intrinsic tags. On a
        // component, `onclick` is a *prop* (parent→child data flow reads the
        // value as uses elsewhere, never a call). `on:` stays universal
        // (component event-listener syntax); bare `onclick` on a component
        // must not fabricate. Short words (`on`, `once`, `only`) are never
        // events.
        const startTag = this.findChildByType(n, "start_tag") || this.findChildByType(n, "self_closing_tag")
        if (startTag) {
          for (let i = 0; i < startTag.namedChildCount; i++) {
            const attr = startTag.namedChild(i)
            if (!attr || attr.type !== "attribute") continue
            const attrName = this.attributeName(attr)
            if (!attrName) continue
            const isOnDirective = attrName.startsWith("on:")
            const isOnclickAttr =
              !isOnDirective &&
              isOnEventAttrName(attrName) &&
              attrName.length > 4 &&
              !!tag &&
              tag[0] === tag[0].toLowerCase() &&
              !tag.includes(".") &&
              (!tag.includes(":") || tag.startsWith("svelte:"))
            if (!isOnDirective && !isOnclickAttr) continue
            // The handler's LINE is where its identifier starts, not where
            // the expression opens — a multiline arrow body
            // (`onsubmit={(e) => {\n e.preventDefault()\n}}`) names its callee
            // lines below the attribute. Same rule for both spellings.
            const handlerSite = this.onHandlerCall(attr)
            const handler = handlerSite?.name
            if (handler && handler !== moduleName) {
              relationships.push({
                source: moduleName,
                target: handler,
                type: ASTEngine.RelationshipType.Calls,
                confidence: 0.85,
                ...(typeof handlerSite.line === "number" ? { line_number: handlerSite.line } : {}),
                metadata: {
                  context: isOnDirective
                    ? `Svelte event directive ${attrName}`
                    : `Svelte event attribute ${attrName}`,
                },
              })
            }
          }
          // {@attach handler} / {@attach handler(args)} — Svelte 5 attachment
          // directives. The pinned grammar has no rule for them: they parse as
          // a stable ERROR shape — `{`, `@`, ERROR[attach], the handler
          // expression, `}` (measured in script/m14/tmp/web-adv-attach-tree.ts,
          // the adversarial round on the M12 census residual). The lane reads
          // that shape structurally: identifier and call forms emit a calls
          // edge at the handler's own line; any other expression (arrow
          // params, member chains) emits nothing — the same no-fabrication
          // policy as the event lane. Attach is a behavior hook on intrinsic
          // AND component tags.
          for (let i = 0; i < startTag.childCount; i++) {
            const directive = startTag.child(i)
            if (!directive || directive.type !== "ERROR") continue
            const kids: Node[] = []
            for (let j = 0; j < directive.childCount; j++) {
              const c = directive.child(j)
              if (c) kids.push(c)
            }
            const attachIdx = kids.findIndex((k) => k.type === "ERROR" && k.text === "attach")
            if (attachIdx < 0) continue
            const nameTok = kids[attachIdx + 1]
            if (!nameTok || !isIdentifier(nameTok.text)) continue
            const afterText = (kids[attachIdx + 2]?.text ?? "}").trim()
            if (afterText !== "}" && afterText !== "(") continue
            const attachHandler = nameTok.text
            if (attachHandler === moduleName) continue
            relationships.push({
              source: moduleName,
              target: attachHandler,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.8,
              line_number: nameTok.startPosition.row + 1,
              metadata: { context: "Svelte attach directive" },
            })
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const child = n.namedChild(i)
        if (child) templateStack.push({ node: child, scope: childScope })
      }
    }

    // --- 3. Script pass: nested JS/TS parse (engine-provided trees) -----------
    // Multiple <script> blocks are allowed (context="module" + instance);
    // each is parsed independently and offset back to SFC lines.
    const scriptTrees: Tree[] = context?.sfcScriptTrees ?? []
    const scriptLines: number[] = context?.sfcScriptLines ?? []
    const scriptCols: number[] = context?.sfcScriptCols ?? []
    // H4 (review wave): SFC byte base per block for index coherence (same
    // engine field the Vue wave added; absent in hand-built contexts it
    // defaults to 0, preserving old behavior exactly).
    const scriptStartIdx: number[] = (context as any)?.sfcScriptStartIndex ?? []
    let scriptDecisions = 0
    for (let bi = 0; bi < scriptTrees.length; bi++) {
      const scriptTree = scriptTrees[bi]
      const scriptStartLine = scriptLines[bi]
      const scriptStartColumn = scriptCols[bi]
      const scriptBlockIndex = scriptStartIdx[bi] ?? 0
      if (!scriptTree || scriptStartLine === undefined) continue
      const scriptContent = scriptTree.rootNode?.text ?? ""
      const lineOffset = scriptStartLine - 1
      const colOffset = scriptStartColumn ?? 0
      // Dispatch by the block's lang attribute — lang="ts" blocks were run
      // through the JS analyzer even though the engine pre-parses them with
      // the TS grammar, silently dropping TS-only declarations.
      // #903: `tsx` is TypeScript too (the engine parses it with the
      // JSX-capable tsx grammar and reports the block's own lang here).
      const isTs = context?.sfcScriptLangs?.[bi] === "ts" || context?.sfcScriptLangs?.[bi] === "tsx"

      let sub: ASTEngine.ParseResult
      try {
        sub = isTs
          ? new RealTypeScriptAnalyzer().analyze(scriptTree.rootNode, scriptContent, filePath)
          : new RealJavaScriptAnalyzer().analyze(scriptTree.rootNode, scriptContent, filePath, context)
      } catch (e: any) {
        sub = { symbols: [], relationships: [], imports: [], exports: [], errors: [], metadata: {} } as any
        errors.push({
          message: `script sub-parse failed: ${e?.message?.slice(0, 120)}`,
          range: { startLine: scriptStartLine, startColumn: 0, endLine: scriptStartLine, endColumn: 0 },
          severity: "warning",
        })
      }

      // 3a. Svelte-specific symbols from the script tree: $props() destructure
      //     → Property; $: reactive declaration targets → Variable.
      this.extractSvelteDeclarations(scriptTree.rootNode, moduleName, symbols, lineOffset, colOffset, scriptBlockIndex)

      // 3a-runes (D7): a named function handed to an INVOKING rune is a call
      // site. The JS sub-analyzer sees `$effect(fn)` and correctly suppresses the
      // rune itself, but `fn` is an ordinary argument and the delegate emits no
      // edge for it — so before the ruling the component's own graph could not
      // show that it runs `fn` on every effect tick. The ARROW form
      // `$effect(() => ...)` is deliberately untouched: its body is already walked,
      // and an arrow is not a name. Only a bare identifier argument qualifies.
      this.extractRuneInvocations(scriptTree.rootNode, moduleName, relationships, lineOffset)

      // Block-kind: context="module" exports are MODULE API, never
      // component props. Only instance-block export-let/const bindings are
      // the component's public prop surface.
      const isModuleBlock = this.isModuleContextBlock(rootNode, bi)

      // 3b. Merge JS analyzer output, offset to SFC lines, filter rune calls.
      // S2 (#419): the names declared by $props() destructuring are emitted as
      // component-owned Properties by extractSvelteDeclarations below; the JS
      // sub-analyzer ALSO emits them as destructured Variables. Drop the JS
      // duplicates so each rune-prop binding is declared EXACTLY once.
      const runePropNames = new Set<string>()
      this.collectPropsDestructuredNames(scriptTree.rootNode, runePropNames)
      const runePropNamesLowered = new Set(scriptContent.length > 0 ? [...runePropNames] : [])
      // S6: a `$:` reactive target is component state declared by
      // extractSvelteDeclarations below; the JS sub-analyzer's plain copy of
      // the same `let` variable is DUPLICATE — drop it so the component-owned
      // reactive symbol is the only one.
      const reactiveTargetNames = new Set<string>()
      this.collectReactiveTargetNames(scriptTree.rootNode, reactiveTargetNames)
      for (const s of sub.symbols ?? []) {
        if (runePropNamesLowered.has((s.name ?? "") as string)) continue
        if (reactiveTargetNames.has((s.name ?? "") as string)) continue
        // H4: full SFC coherence — lines + first-line cols + byte indices
        // (same single-line endColumn rule as the Vue wave).
        const firstLine = s.range.startLine === 1
        s.range.startLine += lineOffset
        s.range.endLine += lineOffset
        if (firstLine && colOffset) {
          s.range.startColumn += colOffset
          if (s.range.endLine === s.range.startLine) s.range.endColumn += colOffset
        }
        if (scriptBlockIndex && s.range.startIndex !== undefined) s.range.startIndex += scriptBlockIndex
        if (scriptBlockIndex && s.range.endIndex !== undefined) s.range.endIndex += scriptBlockIndex
        // M49 #868: the symbol's own metadata line mirrors travel with its range
        // (metadata.decoratorLines is a SCRIPT-relative list of line numbers).
        shiftMetadataLineMirrors(s.metadata as Record<string, unknown> | undefined, lineOffset)
        // Svelte prop: `export let x` — JS analyzer reports Variable + export;
        // reclassify as Property (the component's public prop API). Exported
        // bindings (export let/const/function/class) are component-owned
        // (contains + owner) like Vue props.
        if (!isModuleBlock && this.isExported(sub.exports ?? [], s.name)) {
          const wasVariable = s.kind === ASTEngine.SymbolKind.Variable
          if (wasVariable) {
            s.kind = ASTEngine.SymbolKind.Property
            // annotate ONLY actual props - a false isSvelteProp key on
            // every exported binding polluted the payload
            s.metadata = { ...(s.metadata ?? {}), isSvelteProp: true }
          }
          s.ownerName = moduleName
          s.ownerKind = ASTEngine.SymbolKind.Class
          s.scope = moduleName
        }
        symbols.push(s)
      }
      const moduleExportNames = new Set(
        isModuleBlock ? (sub.exports ?? []).map((e) => e.name) : [],
      )
      // THE DELEGATE'S ENDPOINT SPELLING IS NOT THE SFC'S, AND THIS SEAM IS WHERE
      // THE TWO ARE RECONCILED (M14 cross-lane, 2026-10-13; the html seam carries
      // the same block — see real-html-analyzer.ts).
      //
      // The javascript delegate re-spelled two endpoint classes for its OWN
      // resolver's reasons: a LOCAL module's `imports` target moved from
      // `<specifier>:<item>` to the bare `<item>` with the specifier moved into
      // `metadata.module`, and an `overrides` target moved from `<Base>.<member>`
      // to the bare `<member>`. Both halves below fire only on the re-spelled shape
      // and leave every already-qualified target alone.
      //
      // These pins are BYTE-IDENTICAL at the recording revision `cd8e1011b` and at
      // original main `1b71d837c`, and PASS at both:
      //
      //   svelte/bare-module-block    imports   -> `./palette.js:PALETTE`
      //   svelte/error-recovery       imports   -> `./Alpha.svelte:Alpha` · `./Beta.svelte:Beta`
      //   svelte/relationship-kinds   imports   -> `./helper:helper` · overrides -> `Base.render`
      //   svelte/template-lines-825   imports   -> `./Child.svelte:Child`
      //   svelte/dynamic-target-sites imports   -> `./Widget.svelte:Widget` · `./Panel.svelte:Panel`
      //
      // TRANSLATION, NOT SUPPRESSION — the same contract the `(file)` actor below
      // gets: every metadata field the delegate wrote is kept (`module` included),
      // and only the endpoint the SFC publishes is respelled.
      const delegateBases = new Map<string, string>()
      for (const rb of (sub.relationships ?? []) as any[]) {
        if (rb?.type !== ASTEngine.RelationshipType.Extends) continue
        if (typeof rb.source === "string" && rb.source !== "" && typeof rb.target === "string" && rb.target !== "") {
          delegateBases.set(rb.source, rb.target)
        }
      }

      for (const r of sub.relationships ?? []) {
        const tgt = (r.target ?? "") as string
        if (SVELTE_RUNES.has(tgt)) continue
        // module-block exports are module API, not component members
        if (r.type === ASTEngine.RelationshipType.Contains && isModuleBlock && moduleExportNames.has(tgt)) continue
        // Dotted runes ($derived.by, $effect.root, $props.id): the JS
        // call-target extractor keeps the LAST segment ('by', 'root',
        // 'id'), so the exact-name filter above never fired for them.
        // PRECISE RULE: full dotted name is a known rune, OR the callee is
        // '$'-prefixed with a RUNE LEAF segment. A bare '$'-prefix alone
        // would also swallow USER-defined $functions - silent data loss.
        const callee = (r.metadata?.calleeExpression ?? "") as string
        if (isRuneCallee(callee) || (r.source === "(script)" && SVELTE_RUNES.has(tgt))) continue
        // M59 (#825): the delegate's lines are SCRIPT-RELATIVE — shift them to
        // file lines here, the same rule the symbols/imports/exports merges
        // apply. Measured before this: svelte 19 of 58 line-bearing edges
        // INCONSISTENT (vue 562 of 585). The applied offset is recorded on the
        // edge so the seam is auditable and testable (see the vue twin).
        if (typeof r.line_number === "number") r.line_number += lineOffset
        // M49 #868: the metadata line mirrors move with it (see the helper).
        shiftMetadataLineMirrors(r.metadata as Record<string, unknown> | undefined, lineOffset)
        // THE DELEGATE'S FILE-LEVEL ACTOR NAMES THIS COMPONENT. Before the javascript
        // lane respelled its module-scope actor (M14 cross-lane, 2026-10-11) this row
        // arrived sourced at the SFC stem, because the delegate was handed this file's
        // path; the sentinel broke that, and the pin that requires the delegated
        // `imports` row to source at the component went red. See the constant above.
        if (r.source === DELEGATE_FILE_ACTOR) r.source = moduleName
        // 1. `<specifier>:<item>` — the module half the delegate moved into metadata.
        //    A colon is the delegate's OWN qualified form and a `/` means a
        //    path-shaped target, never a bare item name; both are left alone.
        if (r.type === ASTEngine.RelationshipType.Imports) {
          const mod = r.metadata?.module
          if (
            typeof mod === "string" &&
            mod !== "" &&
            typeof r.target === "string" &&
            r.target !== "" &&
            !r.target.includes(":") &&
            !r.target.includes("/")
          ) {
            r.target = `${mod}:${r.target}`
          }
        }
        // 2. `<Base>.<member>` — the owner half the delegate dropped, read back from
        //    the delegate's OWN `extends` row for the source's owner. A dotted target
        //    is already qualified and is left alone.
        if (r.type === ASTEngine.RelationshipType.Overrides) {
          if (typeof r.source === "string" && typeof r.target === "string" && r.target !== "" && !r.target.includes(".")) {
            const owner = r.source.slice(0, r.source.lastIndexOf("."))
            const base = owner === "" ? undefined : delegateBases.get(owner)
            if (base) r.target = `${base}.${r.target}`
          }
        }
        r.metadata = { ...(r.metadata ?? {}), sfcDelegated: true, sfcLineOffset: lineOffset }
        relationships.push(r)
      }
      for (const i of sub.imports ?? []) {
        if (i.range) {
          const firstLine = i.range.startLine === 1
          i.range.startLine += lineOffset
          i.range.endLine += lineOffset
          if (firstLine && colOffset) {
            i.range.startColumn += colOffset
            if (i.range.endLine === i.range.startLine) i.range.endColumn += colOffset
          }
          if (scriptBlockIndex && i.range.startIndex !== undefined) i.range.startIndex += scriptBlockIndex
          if (scriptBlockIndex && i.range.endIndex !== undefined) i.range.endIndex += scriptBlockIndex
        }
        imports.push(i)
      }
      // M49 exports invariant: component-owned svelte props (export let →
      // Property, ownerName = component above) are component MEMBERS —
      // membership rides Contains, they are not module exports. Only
      // module-block exports (`<script context="module">` — the module's
      // true importable API) flow into the export list.
      // D1 (second review): these were pushed raw with script-relative
      // ranges — shift to SFC coherence like every other script artifact.
      if (isModuleBlock) {
        for (const e of sub.exports ?? []) {
          const r = (e as any).range
          if (r) {
            const firstLine = r.startLine === 1
            r.startLine += lineOffset
            r.endLine += lineOffset
            if (firstLine && colOffset) {
              r.startColumn += colOffset
              if (r.endLine === r.startLine) r.endColumn += colOffset
            }
            if (scriptBlockIndex && r.startIndex !== undefined) r.startIndex += scriptBlockIndex
            if (scriptBlockIndex && r.endIndex !== undefined) r.endIndex += scriptBlockIndex
          }
          exports.push(e)
        }
      }
      // H4: sub-errors are script-relative — shift to SFC coherence.
      for (const er of sub.errors ?? []) {
        const r = er.range as any
        if (r) {
          const firstLine = r.startLine === 1
          r.startLine += lineOffset
          r.endLine += lineOffset
          if (firstLine && typeof r.startColumn === "number") {
            r.startColumn += colOffset
            r.endColumn += colOffset
          }
          if (typeof r.startIndex === "number") {
            r.startIndex += scriptBlockIndex
            r.endIndex += scriptBlockIndex
          }
        }
        errors.push(er)
      }
      scriptDecisions += Math.max(0, ((sub.metadata as any)?.cyclomaticComplexity ?? 1) - 1)
    }

    // --- 3c. Template expression uses (S1) ------------------------------------
    // The template reads the component's own members: {count}, label={label},
    // {#each rows as row} (collection rows), {#await promise}, {@html raw},
    // {@const total}, <svelte:component this={inc}> — each is a Use of a
    // member symbol. Emit only for identifiers that resolve to a member;
    // template-locals (already filtered by the shadow scope) and intrinsics
    // stay silent — no junk edges.
    if (templateExprNames.size > 0) {
      const memberNames = new Set(symbols.map((s) => s.name))
      const seenUses = new Set<string>()
      for (const [name, line] of templateExprNames) {
        // Svelte store auto-subscription: `{$store}` reads the VALUE of the
        // `store` member (`$:` rules don't apply in markup). A single-`$`
        // name that matches no member resolves through the sigil to a member
        // that does — measured on a `writable` store read with zero edges.
        // Exact matches win first (a member literally named `$x` keeps its
        // edge); `$$` legacy specials (`$$props`) never strip.
        let resolved = name
        if (
          !memberNames.has(name) &&
          name.startsWith("$") &&
          !name.startsWith("$$") &&
          memberNames.has(name.slice(1))
        ) {
          resolved = name.slice(1)
        }
        if (!memberNames.has(resolved)) continue
        const key = `${moduleName}:${resolved}`
        if (seenUses.has(key)) continue
        seenUses.add(key)
        // ONTOLOGY-WORKSTREAM SVELTE3: the sites this member is read on, in
        // document order and de-duplicated. One edge, the complete set — see the
        // `templateReadSites` declaration for why this is not one edge per read.
        const sites = templateReadSites.get(name) ?? (resolved === name ? undefined : templateReadSites.get(resolved))
        relationships.push({
          source: moduleName,
          target: resolved,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 0.95,
          // M59 (#825): the line the identifier is WRITTEN on, recorded where
          // the text was scanned. `0` can only appear if a caller passed no
          // base line for a fragment it could not locate — the oracle counts
          // that as a wrong line rather than a silent pass. This is the LAST site;
          // the whole set is in `templateReadSites` below.
          ...(line > 0 ? { line_number: line } : {}),
          metadata: {
            isTemplateExpression: true,
            // D12: present only for a carrier-sourced read. Absent means the read came
            // from a block construct, a store subscription or a tag expression, so a
            // consumer can tell a two-way binding from an ordinary template read.
            ...(carrierReadKeys.has(`${resolved}@${line}`) ? { carrierDirective: true } : {}),
            // Present only when the member is read on MORE THAN ONE site, so a
            // single-read edge carries no extra key. `templateReadSitesCollapsed`
            // is the machine-readable statement that `line_number` above is one
            // of several and not the only place to look.
            ...(sites && sites.length > 1
              ? { templateReadSites: [...sites], templateReadSitesCollapsed: sites.length }
              : {}),
          },
        })
      }
    }

    // ONTOLOGY-WORKSTREAM SVELTE3: resolve the NAMESPACE-qualified tags collected
    // above. Post-merge because the import records do not exist before it.
    //
    // And a DEFECT FIXED ON THE WAY, which was making this rule's sibling dead:
    // `thisTargets` below built its binding set from `imp.items` VERBATIM, and the
    // JS analyzer does not write bare binding names there. Measured on the real
    // analyzer-local import records:
    //     import * as Card from "./card"     -> items: ["* as Card"],  alias: "Card"
    //     import { alpha as beta } from "./b" -> items: ["alpha as beta"], alias: undefined
    // So the set received the literal strings `"* as Card"` and `"alpha as beta"`,
    // never `Card` or `beta`, and `<svelte:component this={Card}/>` published
    // NOTHING. Both spellings are the corpus's own idiom — 1,052 of shadcn-svelte's
    // 1,878 files contain a namespace import — so the rule was silent on exactly
    // the dynamic-component form it was written for. `importLocalBindings` is the
    // one derivation both rules now use, so the two cannot drift again.
    if (dottedTags.size > 0) {
      const nsBindings = new Map<string, string>()
      for (const imp of imports) {
        for (const b of this.importLocalBindings(imp)) nsBindings.set(b.name, b.module)
      }
      const declaredNames = new Set(symbols.map((s) => s.name))
      for (const [tag, site] of dottedTags) {
        const dot = tag.indexOf(".")
        const ns = tag.slice(0, dot)
        const module = nsBindings.get(ns)
        // Svelte resolves `<Ns.M>` by reading the object bound to `Ns`, and there
        // are THREE places `Ns` can be bound — all structural, all provable here:
        //
        //   1 an IMPORT        `import * as Card` — a static namespaced component.
        //   2 a TEMPLATE-LOCAL the walk recorded — `{#each items as item}` then
        //     `<item.icon/>`, which is what the FIRST version of this rule dropped
        //     and what the 400-file differential reported as 12 MISSING.
        //   3 a SCRIPT SYMBOL  `const status = $derived(statuses.find(...))` then
        //     `{#if status}<status.icon/>` — a component held in state. The
        //     differential found this one too, on
        //     `docs/src/routes/(app)/(layout)/examples/tasks/components/
        //     data-table-status-cell.svelte:11`.
        //
        // If none of the three binds it, the compiler rejects the file and the tag
        // names nothing: the same reasoning D9/D11 already applies to the reserved
        // `svelte:` prefix. Note case 3 is a RUNTIME namespace — whether `Ns.M` is
        // a component is not knowable here, which is why every dotted edge sits at
        // 0.9 with a reason code rather than at the plain-tag 0.95.
        if (module === undefined && !site.templateLocal && !declaredNames.has(ns)) continue
        relationships.push({
          source: moduleName,
          target: tag,
          // RENDERS: the dotted tag is a component render, exactly like the plain tag above.
          type: ASTEngine.RelationshipType.Renders,
          confidence: 0.9,
          ...(site.line > 0 ? { line_number: site.line } : {}),
          metadata: {
            isComponentUsage: true,
            resolution: "namespace-member",
            // The MODULE is deliberately NOT copied onto the edge. It is already in
            // this same result's `imports` records, keyed by `namespaceBinding`, and
            // repeating a module specifier on every edge cost 45 bytes × 7,802 corpus
            // edges: measured +903 KiB (+16.6%) on shadcn-svelte's serialized
            // relationship payload before this was removed, for information the
            // consumer already had. `namespaceBinding` is the key into it.
            ...(module !== undefined ? { namespaceBinding: ns } : {}),
            ...(module === undefined && site.templateLocal ? { namespaceLocal: true } : {}),
            ...(module === undefined && !site.templateLocal ? { namespaceSymbol: true } : {}),
          },
        })
      }
    }

    // H2 (review wave): dynamic `this=` targets that did NOT resolve as
    // member uses. An import-bound bare identifier in component position is
    // a component usage (the standard dynamic-dispatch pattern); anything
    // else stays silent per the no-junk rule. Member-resolved targets
    // already carry a Uses edge above and are skipped (no double emission).
    if (thisTargets.size > 0) {
      const memberNames = new Set(symbols.map((s) => s.name))
      // ONTOLOGY-WORKSTREAM SVELTE3: was `imp.items` verbatim, which held
      // `"* as Card"` for `import * as Card` and `"alpha as beta"` for
      // `import { alpha as beta }` — so neither `Card` nor `beta` was ever in the
      // set and this branch published nothing for either. See the `dottedTags`
      // block above; `importLocalBindings` is the shared derivation.
      const importBindings = new Set<string>()
      for (const imp of imports) {
        for (const b of this.importLocalBindings(imp)) importBindings.add(b.name)
      }
      for (const [name, line] of thisTargets) {
        if (memberNames.has(name) || !importBindings.has(name)) continue
        const sites = thisTargetSites.get(name)
        relationships.push({
          source: moduleName,
          target: name,
          // RENDERS: a `<svelte:component this={X}/>` mounts X — a component render, not a `new`.
          type: ASTEngine.RelationshipType.Renders,
          confidence: 0.95,
          // M59 (#825): the `this={X}` value's line. F22: the LAST site, kept
          // deliberately — see the site map's declaration.
          ...(line > 0 ? { line_number: line } : {}),
          metadata: {
            isComponentUsage: true,
            // F22: the full site set, sorted ascending so two runs agree.
            //
            // EMITTED FOR A SINGLE SITE TOO, and that is a PIN rather than a
            // preference: `svelte/dynamic-target-sites` requires
            // `dynamicTargetLines: [30]` for its one-site `Panel`, while
            // `svelte/multi-site-read-record` requires the read map to be ABSENT
            // (`templateReadSites: null`) for its one-site reads. The two
            // conventions therefore DIVERGE, and the divergence is recorded here
            // rather than smoothed over: unifying them is a payload change on one
            // fixture or the other, not a fix, and it belongs to whichever round
            // decides which of the two shapes a consumer should read.
            ...(sites && sites.length > 0 ? { dynamicTargetLines: [...sites].sort((a, b) => a - b) } : {}),
          },
        })
      }
    }

    // --- 4. contains from ownerName -------------------------------------------
    for (const s of symbols) {
      if (s.ownerName) {
        relationships.push({
          source: s.ownerName,
          target: s.name,
          type: ASTEngine.RelationshipType.Contains,
          confidence: 1.0,
          // M59 (#825): the MEMBER's declaration line (already in SFC
          // coordinates) — the edge names the member.
          ...(s.range?.startLine ? { line_number: s.range.startLine } : {}),
          metadata: {},
        })
      }
    }

    // --- Metadata ---------------------------------------------------------------
    const architecturalScore = Math.min(100, Math.max(0, 100 - errors.length * 5))
    const detectedPatterns = Object.keys(patterns)
    const frameworkPatterns = detectedPatterns.map((p) => ({
      framework: "Svelte",
      patterns: [{ type: "usage", detected: true, description: p }],
    }))

    // D12: the invoked-carrier call edges, emitted HERE so they flow through the
    // dedupe below and the central evidence-tier classifier with everything else.
    // The target is the directive's own name — written in the ATTRIBUTE NAME, so the
    // line is the attribute's — and the confidence matches the `on:` handler tier
    // (0.85), because it is the same argument: the framework invokes this name.
    for (const dc of directiveCalls) {
      relationships.push({
        source: moduleName,
        target: dc.leaf,
        type: ASTEngine.RelationshipType.Calls,
        confidence: 0.85,
        line_number: dc.line,
        metadata: { context: dc.context },
      })
    }

    // DEDUPE: sub-analyzers emit their own contains edges; combined with
    // the ownerName-based pass above, identical triples appeared twice.
    //
    // F29 (2026-10-12): AND THE ROW THAT LOSES IS RECORDED, not just dropped. The
    // delegate's rows are pushed in step 3b and the template read pass runs in 3c, so
    // when a component reads the same member in its SCRIPT and in its TEMPLATE the
    // TEMPLATE row loses — measured on the 3,085 corpus files where an independent
    // read oracle's shadow model is provably equivalent to this analyzer's (no
    // `{#each}`, `{#await}`, `{#snippet}` or `{@const}` anywhere in the file): 384 of
    // 5,781 template reads, 6.6%, and every one of them had a script twin. The
    // surviving row carried the script's line and the script's 0.6 confidence with no
    // `isTemplateExpression`, so a consumer could not tell that the member is ALSO
    // read by the template. `line_number` and `confidence` are deliberately NOT
    // touched (a payload field the shared budget and the differential baseline pin),
    // and the graph contract is unchanged: still one edge per triple.
    const relSeen = new Map<string, ASTEngine.UniversalRelationship>()
    const uniqueRelationships: ASTEngine.UniversalRelationship[] = []
    for (const r of relationships) {
      const key = `${String(r.type)}|${String(r.source)}|${String(r.target)}`
      const prior = relSeen.get(key)
      if (!prior) {
        relSeen.set(key, r)
        uniqueRelationships.push(r)
        continue
      }
      RealSvelteAnalyzer.recordDroppedTemplateRead(prior, r)
    }
    relationships.length = 0
    relationships.push(...uniqueRelationships)

    // ONTOLOGY-WORKSTREAM SVELTE4 (2026-10-16): publish the resolution claims this lane
    // already holds — the module half of an import, and the provenance of an imported
    // binding — on the keys the arbiter reads. AFTER the dedupe, so each surviving edge is
    // decided once. See `publishResolutionClaims` for what is claimed, what is deliberately
    // NOT claimed, and why no target is rebased.
    this.publishResolutionClaims(relationships, imports, symbols, filePath, context?.projectRoot)

    // Evidence tiers on EVERY edge (#419-D) — same rules as the Vue/JVM family.
    this.classifyEvidenceTier(relationships)
    const cyclomaticComplexity = 1 + templateDecisions + scriptDecisions

    return {
      language: "svelte",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // Real cyclomatic complexity: script decisions + template decision
        // blocks. Was the synthetic symbols+relationships heuristic with a
        // hardcoded cyclomatic of 1 (fourth analyzer with this disease).
        complexity: cyclomaticComplexity,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity,
        framework: "Svelte",
        patterns: detectedPatterns,
        detectedFrameworks: ["Svelte"],
        frameworkPatterns,
        architecturalInsights: [],
        architecturalScore,
        hasFrameworkIntelligence: true,
        hasTypeInference: false,
      },
    }
  }

  // ============================================================================
  // SVELTE-SPECIFIC DECLARATION EXTRACTION
  // ============================================================================

  /**
   * S2 (#419): the binding names declared by a $props() destructure
   * (`let { a, b, c = 5 } = $props()`). These are component-owned Properties
   * emitted by extractSvelteDeclarations; the JS sub-analyzer's parallel
   * destructured Variables are dropped to avoid double declaration.
   */
  private collectPropsDestructuredNames(root: Node, out: Set<string>): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        const callee = n.childForFieldName?.("function") ?? n.namedChild(0)
        if (callee && (callee.text === "$props" || callee.text === "$props()")) {
          const declarator = this.findAncestor(n, (p) => p.type === "variable_declarator")
          if (declarator) {
            const pattern = declarator.childForFieldName?.("name") ?? this.findChildByType(declarator, "object_pattern")
            const names = pattern ? this.objectPatternNames(pattern) : []
            names.forEach((nm) => out.add(nm))
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  private objectPatternNames(pattern: Node): string[] {
    return this.objectPatternPairs(pattern).map((p) => p.name)
  }

  /**
   * M59 (#825) follow-up, measured on a `$props()` rename destructure: the
   * pair VALUE binds, not the key (`let { renamed: local }` binds `local`).
   * The old key-side naming emitted a phantom Property `renamed` AND defeated
   * the merge dedupe (the JS delegate's correct `local` survived alongside
   * it — one binding, two symbols). Each pair also carries its node so the
   * symbol ranges at its own NAME line, not the whole declarator.
   */
  private objectPatternPairs(pattern: Node): Array<{ name: string; node: Node }> {
    const out: Array<{ name: string; node: Node }> = []
    const take = (n: Node): void => {
      if (
        n.type === "identifier" ||
        n.type === "shorthand_property_identifier" ||
        n.type === "shorthand_property_identifier_pattern"
      ) {
        out.push({ name: n.text, node: n })
      } else if (n.type === "pair_pattern") {
        const value = n.childForFieldName?.("value")
        if (value) take(value)
      } else if (n.type === "rest_pattern") {
        const inner = n.namedChild(0)
        if (inner) take(inner)
      } else if (n.type === "assignment_pattern") {
        const left = n.childForFieldName?.("left") ?? n.namedChild(0)
        if (left) take(left)
      } else if (n.type === "object_assignment_pattern") {
        // `{ a = default }` binds `a`; `default` is a VALUE, not a binding.
        //
        // This node used to be grouped with the container patterns below, which
        // published BOTH children — so a default that names another binding made
        // that binding a prop. Measured on
        // `shadcn-svelte/docs/src/lib/registry/ui/chart/chart-container.svelte`,
        // whose `let { id = uid, … } = $props()` published the module-level
        // `const uid = $props.id()` as a component Property
        // (`isSvelteProp: true`, `contains chart-container -> uid`), and because
        // the same name list drives the merge dedupe, the delegate's correct
        // `uid` Constant was DROPPED — one binding, two false facts and the true
        // declaration lost. Found by the lane's own truth
        // (script/m14/svelte-truth.ts), which derives ownership from the
        // grammar and disagreed on exactly these edges.
        const left = n.childForFieldName?.("left") ?? n.childForFieldName?.("pattern") ?? n.namedChild(0)
        if (left) take(left)
      } else if (
        // `object_assignment_pattern_deprecated` was a dead disjunct: measured
        // 2026-10-08, the pinned svelte grammar declares no assignment-pattern
        // type at all, and the pinned typescript/javascript grammars declare
        // `object_assignment_pattern` and `assignment_pattern` with no deprecated
        // spelling. A real parse of `let { a = 1, ...rest } = obj` builds
        // `object_pattern` -> `object_assignment_pattern`, which is the shape the
        // arm ABOVE already handles; this container branch is for the patterns
        // whose children are all bindings.
        n.type === "object_pattern" ||
        n.type === "array_pattern"
      ) {
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) take(c)
        }
      }
    }
    take(pattern)
    return out
  }

  /**
   * S6 (#419): collect the target names of every `$:` reactive declaration
   * (`$: doubled = expr` → `doubled`). Used at the merge to drop the JS/TS
   * sub-analyzer's PLACE COPY of such a variable, so the component-owned
   * reactive symbol emitted by extractSvelteDeclarations is the ONLY one —
   * the same dedupe S2 applies to $props() bindings.
   */
  private collectReactiveTargetNames(root: Node, out: Set<string>): void {
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "labeled_statement") {
        const label = n.namedChild(0)
        if (label && label.text === "$") {
          const assignment = this.findDescendant(n, (c) => c.type === "assignment_expression")
          const left = assignment?.childForFieldName?.("left") ?? assignment?.namedChild(0)
          if (left && left.type === "identifier") out.add(left.text)
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /** D7 (RULED 2026-09-27): `calls` edges for named functions passed to an
   *  INVOKING rune. See SVELTE_INVOKING_RUNES for why the set is the invoking
   *  half of the rune surface and not all of it.
   *
   *  Only a BARE IDENTIFIER argument produces an edge. An arrow function is not a
   *  name and its body is already walked; a call argument (`$effect(doThing())`)
   *  is a use, not a call of `doThing`; a member expression (`$effect(obj.m)`)
   *  names a method the analyzer does not resolve here. Emitting for those would
   *  be the fabrication class this lane already fixed twice.
   */
  private extractRuneInvocations(
    root: Node,
    componentName: string,
    relationships: any[],
    lineOffset: number,
  ): void {
    const seen = new Set<string>()
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const n = stack.pop()!
      if (n.type === "call_expression") {
        const callee = n.childForFieldName?.("function") ?? n.namedChild(0)
        const calleeText = callee?.text ?? ""
        if (isInvokingRune(calleeText)) {
          const argsField = n.childForFieldName?.("arguments")
          const argList: Node[] = []
          if (argsField) {
            for (let i = 0; i < argsField.namedChildCount; i++) {
              const a = argsField.namedChild(i)
              if (a) argList.push(a)
            }
          }
          const line = this.nodeToRange(n).startLine + lineOffset
          for (const arg of argList) {
            if (arg.type !== "identifier") continue
            const name = arg.text
            // A rune is never its own argument, and a call to the component
            // itself is not an invocation of one of its members.
            if (name === componentName || isRuneCallee(name)) continue
            const key = `${calleeText}|${name}|${line}`
            if (seen.has(key)) continue
            seen.add(key)
            relationships.push({
              source: componentName,
              target: name,
              type: ASTEngine.RelationshipType.Calls,
              confidence: 0.85,
              line_number: line,
              metadata: { context: `Svelte rune ${calleeText}`, runeCallee: calleeText, evidenceClass: "structural" },
            })
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  private extractSvelteDeclarations(
    root: Node,
    componentName: string,
    symbols: ASTEngine.UniversalSymbol[],
    lineOffset: number,
    colOffset: number,
    indexOffset = 0,
  ): void {
    const stack: Node[] = [root]
    // S6 (#419): a `$:` target assigned from MULTIPLE reactive blocks is still
    // ONE variable — track already-declared targets so we never push a second
    // identical symbol for the same name.
    const reactiveTargets = new Set<string>()
    while (stack.length > 0) {
      const n = stack.pop()!
      // $props() destructure → Property symbols (`let { a, b } = $props()`)
      if (n.type === "call_expression") {
        const callee = n.childForFieldName?.("function") ?? n.namedChild(0)
        if (callee && (callee.text === "$props" || callee.text === "$props()")) {
          const declarator = this.findAncestor(n, (p) => p.type === "variable_declarator")
          if (declarator) {
            const pattern = declarator.childForFieldName?.("name") ?? this.findChildByType(declarator, "object_pattern")
            // M59 (#825): each binding ranges at its OWN name node — a wrapped
            // `$props()` destructure stamped the whole declarator line for
            // every member. Pairs carry value-side names (see
            // objectPatternPairs), so a rename binds `local`, not `renamed`.
            const pairs = pattern && pattern.type === "object_pattern" ? this.objectPatternPairs(pattern) : []
            for (const { name, node: nameNode } of pairs) {
              symbols.push({
                name,
                kind: ASTEngine.SymbolKind.Property,
                range: this.offsetRange(this.nodeToRange(nameNode), lineOffset, colOffset, indexOffset),
                scope: componentName,
                ownerName: componentName,
                ownerKind: ASTEngine.SymbolKind.Class,
                visibility: "public",
                metadata: { isSvelteProp: true, fromRunes: true },
              })
            }
          }
        }
      }
      // $: reactive declaration → Variable (`$: doubled = expr`)
      if (n.type === "labeled_statement") {
        const label = n.namedChild(0)
        if (label && label.text === "$") {
          const assignment = this.findDescendant(n, (c) => c.type === "assignment_expression")
          if (assignment) {
            const left = assignment.childForFieldName?.("left") ?? assignment.namedChild(0)
            if (left && left.type === "identifier") {
              // S6: a target already declared by an earlier $: block is the SAME
              // variable — only the first block declares it.
              if (reactiveTargets.has(left.text)) continue
              reactiveTargets.add(left.text)
              symbols.push({
                name: left.text,
                kind: ASTEngine.SymbolKind.Variable,
                range: this.offsetRange(this.nodeToRange(assignment), lineOffset, colOffset, indexOffset),
                scope: componentName,
                ownerName: componentName,
                ownerKind: ASTEngine.SymbolKind.Class,
                visibility: "public",
                metadata: { isReactiveDeclaration: true },
              })
            }
          }
        }
      }
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
  }

  /**
   * Is the bi-th <script> block a MODULE block? Module-block exports are
   * module-level API - they must NOT become component props.
   *
   * Svelte spells this two ways and BOTH are real: `context="module"` and the
   * bare `module` attribute (the Svelte 3/4 shorthand, still what the corpus
   * writes - `sv-addons/registry/template/src/lib/registry/ui/button/button.svelte`
   * opens `<script lang="ts" module>`). The old predicate compared the whole
   * start-tag TEXT for the literal `context="module"`, so every bare-`module`
   * block was read as an INSTANCE block: its exports became component props
   * (ownerName = the component, plus a `contains` edge) and the `exports[]`
   * channel stayed empty. Measured on the 200-file sample: exports[] 0 rows,
   * and the 22 `exports` edges all arrived from the JS delegate's own
   * `export const` handling rather than from the module API they are.
   *
   * Both spellings are now read STRUCTURALLY, off the attribute nodes: an
   * `attribute` whose `attribute_name` is `context` with value `module`, or one
   * whose `attribute_name` is `module` with no value. No pattern literal, and a
   * single-quoted `context='module'` is now found for the same reason the
   * double-quoted one always was: by construction, not by spelling.
   */
  private isModuleContextBlock(rootNode: Node, index: number): boolean {
    // Document-order scan - a LIFO stack walk visits later siblings first,
    // which INVERTED the block indices (module block treated as instance).
    const blocks: Node[] = []
    const walk = (n: Node): void => {
      if (n.type === "script_element") {
        blocks.push(n)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c) walk(c)
      }
    }
    walk(rootNode)
    const block = blocks[index]
    if (!block) return false
    const startTag = this.findChildByType(block, "start_tag")
    if (!startTag) return false
    for (let i = 0; i < startTag.namedChildCount; i++) {
      const attr = startTag.namedChild(i)
      if (!attr || attr.type !== "attribute") continue
      const name = this.attributeName(attr)
      if (name === "module") return true
      if (name === "context" && this.attributeValue(attr) === "module") return true
    }
    return false
  }

  /** The `attribute_value` text of an attribute, however it is quoted. */
  private attributeValue(attr: Node): string {
    const value = this.findChildByType(attr, "attribute_value")
    if (value) return value.text
    const quoted = this.findChildByType(attr, "quoted_attribute_value")
    if (!quoted) return ""
    const inner = this.findChildByType(quoted, "attribute_value")
    return inner ? inner.text : ""
  }

  private isExported(exportInfos: ASTEngine.ExportInfo[], name: string): boolean {
    for (const e of exportInfos) {
      if (e.name === name && !e.isDefault) return true
    }
    return false
  }

  /**
   * ONTOLOGY-WORKSTREAM SVELTE3 — the LOCAL BINDING an `import` introduces, which
   * is the only name Svelte's template can legitimately write.
   *
   * The JS/TS sub-analyzer does not write bare binding names in `items`; it writes
   * the item AS SPELLED. Measured on real analyzer-local records:
   *
   *   import * as Card from "./card"      -> items ["* as Card"],  alias "Card"
   *   import { alpha as beta } from "./b" -> items ["alpha as beta"], alias undefined
   *   import Foo from "./foo"             -> items ["Foo"], alias undefined
   *   import { qux } from "./qux"         -> items ["qux"], alias undefined
   *
   * So a consumer that adds `items` to a set of binding names holds `"* as Card"`
   * and `"alpha as beta"` and never `Card` or `beta`. Two rules were reading that
   * set and both were silent on the forms above; this is the one derivation they
   * share now.
   *
   * Pure String operations — the `as` split is `indexOf`/`slice`, never a regex
   * (the lane is regex-free by contract).
   */
  private importLocalBindings(imp: ASTEngine.ImportInfo): Array<{ name: string; isNamespace: boolean; module: string }> {
    const module = String(imp?.module ?? "")
    const out: Array<{ name: string; isNamespace: boolean; module: string }> = []
    // A bare side-effect import binds nothing.
    if (imp?.isSideEffectImport === true) return out
    const items = Array.isArray(imp?.items) ? imp.items : []
    // `alias` is set for the namespace form and is the namespace's local name, so it
    // wins over the `* as X` spelling in `items`.
    const alias = typeof (imp as any)?.alias === "string" ? String((imp as any).alias).trim() : ""
    if (alias) {
      out.push({ name: alias, isNamespace: items.some((i) => String(i).trim().startsWith("*")), module })
      return out
    }
    for (const raw of items) {
      let item = String(raw).trim()
      if (!item) continue
      const isNamespace = item.startsWith("*")
      if (isNamespace) {
        // `* as X` is covered by the alias branch above; a bare `*` has no local name.
        item = item.startsWith("* as ") ? item.slice(4).trim() : ""
        if (!item) continue
      }
      // `X as Y` binds Y, never X.
      const asIdx = item.indexOf(" as ")
      if (asIdx >= 0) item = item.slice(asIdx + 4).trim()
      if (!item) continue
      out.push({ name: item, isNamespace, module })
    }
    return out
  }

  /**
   * IS THIS MODULE SPECIFIER A PACKAGE THE PROJECT DOES NOT PUBLISH?
   *
   * The NEGATIVE cases are the whole rule, and each one is a shape that would otherwise be
   * claimed wrongly:
   *
   *   * `.` / `..` / `/` — a FILE, not a package. That question belongs to the file claim
   *     (`importProjectFile`) and is answered separately below.
   *   * `$lib`, `$app`, `$env` — a framework ALIAS into the project's own tree. In this
   *     corpus the app root is not the project root (`shadcn-svelte/docs/src/lib`), so the
   *     analyzer cannot even spell the file it names; calling it external would be a false
   *     statement that the admitted file list happens to confirm, which is the laundering
   *     shape and is refused here rather than discovered later.
   *   * a URI scheme (`virtual:`, `http:`, `data:`) — not a package at all.
   *   * a bare name the project PUBLISHES (`projectPublishedPackages`) — the monorepo
   *     self-reference, measured above at 24 import records in the `svelte` checkout.
   *
   * A single-segment specifier IS eligible, and that is deliberately wider than the shape
   * rule `sourcePathClaim`'s own docstring states for FILE targets (`"dependency"`,
   * `"SubProjectB"`): a module specifier with no separator and no extension cannot name a
   * relative file in ESM, and the thing that stops a self-reference is the published-name
   * table rather than the shape. Measured after the change: 0 of the resulting claims was
   * refuted by the project's own file list.
   */
  private isExternalPackageSpecifier(spec: string, published: Set<string>): boolean {
    if (spec === "" || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("$")) return false
    if (spec.includes("\\") || containsWhitespace(spec)) return false
    if (isUriSchemeSpecifier(spec)) return false
    const segs = spec.split("/").filter((s) => s !== "")
    if (segs.length === 0) return false
    const root = spec.startsWith("@") ? segs.slice(0, 2).join("/") : segs[0]
    if (root === "" || root === "@") return false
    return !published.has(root)
  }

  /**
   * PUBLISH THE CLAIM THE LANE ALREADY HOLDS — the module half of an import edge, and the
   * PROVENANCE of an imported binding.
   *
   * THE DEFECT IS NOT A MISSING COMPUTATION. Three of this lane's four largest unresolved
   * shapes are edges where the answer is already computed and thrown away one line later:
   *
   *   imports (616 of 616 unresolved)  the edge publishes `<specifier>:<item>` and
   *     `metadata.module` carries the specifier, but NO claim key is set — so a dependency
   *     the project HAS (142 relative `.svelte` specifiers in this draw) and a dependency the
   *     project CANNOT have (bare npm packages) both read "no answer". `externalClaimOf`
   *     reads `importProjectFile` and `sourcePathClaim`; neither was ever set here.
   *   instantiates / calls / uses / references  a target whose ROOT binding is an import
   *     from a package the project does not publish (`TrendingUpIcon` from
   *     `@lucide/svelte/icons/minus`, `AccordionPrimitive.Root` from `bits-ui`) names a
   *     declaration outside the population — which is precisely what `isExternal` claims,
   *     and what the checkout's own package names can PROVE from provenance instead of
   *     guessing from the name.
   *
   * WHAT IS DELIBERATELY NOT DONE, and this is the trap refused in CODE rather than in
   * prose: **no target is ever rebased.** `<Card.Root/>` is not rewritten to `Root` or to
   * the module's file stem `card`; `$lib/utils.js:cn` is not rewritten to `cn`. That rewrite
   * moves edges out of `unresolved` and into `collRes` — a tie-break the indexer measures
   * 37,318 of 49,729 WRONG — and the names it would land on in this corpus (`Root`,
   * `Header`, `Title`, `Trigger`, `Button`, `card`) are exactly the registry's recurring
   * ones. A claim is not a resolution: `classifyEdge` reads an external marker or a cause
   * ONLY where the target names nothing (`decls === 0`), so no edge here can become
   * `resolved` and the ambiguity columns cannot move.
   *
   * AND THE `$lib` / RELATIVE NON-FILE HALF IS LEFT ALONE ON PURPOSE. 251 `$lib` import
   * edges and the 214 component/read edges bound to `$lib` or relative modules name
   * declarations that ARE in the project (the module resolves under `src/lib`; the component
   * is `button.svelte`'s own `button` symbol). No honest claim exists for them, and the
   * module-namespace member (`<Card.Root/>`, 419 edges — this lane's top cause) has no
   * name-keyed identity at all. Both are ruled in `validation/m14/verification/SVELTE-FIX.md`
   * §2 with the file-level evidence.
   */
  private publishResolutionClaims(
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    symbols: ASTEngine.UniversalSymbol[],
    filePath: string,
    projectRoot: string | undefined,
  ): void {
    // NO ROOT, NO CLAIM. Every rule below is a statement about the PROJECT — is this file in
    // it, is this package its own — and an analyzer that cannot name the project cannot make
    // one. Per-file callers (the fixture runner, the differential's probe arm) pass no
    // `projectRoot`, so for them this method returns before touching an edge.
    if (!projectRoot) return
    const published = projectPublishedPackages(projectRoot)
    /** local binding name -> the module specifier that binds it (first binding wins). */
    const bindings = new Map<string, string>()
    for (const imp of imports) {
      for (const b of this.importLocalBindings(imp)) if (!bindings.has(b.name)) bindings.set(b.name, b.module)
    }
    const declaredHere = new Set(symbols.map((s) => String(s.name ?? "")))
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      const tgt = String(r.target ?? "")
      if (String(r.type) === ASTEngine.RelationshipType.Imports) {
        const spec = typeof md.module === "string" ? md.module : ""
        if (spec === "") continue
        if (spec.startsWith("./") || spec.startsWith("../")) {
          // (a) THE FILE CLAIM — a relative specifier that NAMES A `.svelte` FILE IN THIS
          //     PROJECT. The candidate is the repo-relative spelling the arbiter's own file
          //     list uses (`path.relative(projectRoot, …)`, POSIX separators), and it is
          //     emitted only when the file is actually there: a DANGLING relative import is a
          //     real defect and must not be excused by a claim the file list would refute.
          //     A `.js`/`.ts` specifier is left alone — the lane's population holds `.svelte`
          //     files only, so a claim naming a `.ts` file would be refuted by construction.
          if (!spec.endsWith(".svelte")) continue
          const abs = path.resolve(path.dirname(filePath), spec)
          let isFile = false
          try {
            isFile = statSync(abs).isFile()
          } catch {
            isFile = false
          }
          if (!isFile) continue
          const rel = path.relative(projectRoot, abs).split(path.sep).join("/")
          if (rel === "" || rel.startsWith("..")) continue
          md.importProjectFile = rel
          continue
        }
        // (b) THE SOURCE-PATH CLAIM — a bare specifier for a package the project does not
        //     publish. Its own falsifier is the admitted file list: the moment the checkout
        //     carries a file that resolves to this written specifier, the claim is refuted
        //     and counted against the lane.
        if (this.isExternalPackageSpecifier(spec, published)) md.sourcePathClaim = [spec]
        continue
      }
      // (c) THE OWNER CLAIM — a target whose ROOT binding is an import from a package the
      //     project does not publish. Provenance, not a name guess: the analyzer read the
      //     import that binds the name. A target the file ITSELF declares is skipped,
      //     because there the claim would be refutable by the file's own declaration.
      // a plain identifier or a dotted identifier chain — never a path, a URI or a member
      // spelling; the helper rejects an EMPTY segment (`a..b`), which the single-segment form
      // below would otherwise slice into a bogus root.
      if (!isDottedIdentifierChain(tgt)) continue
      const root = tgt.includes(".") ? tgt.slice(0, tgt.indexOf(".")) : tgt
      if (declaredHere.has(root)) continue
      const spec = bindings.get(root)
      if (spec === undefined) continue
      if (!this.isExternalPackageSpecifier(spec, published)) continue
      md.isExternal = true
    }
  }

  // ============================================================================
  // S1 TEMPLATE EXPRESSION EXTRACTION
  // ============================================================================

  /** Extract the opaque expression text from a node (svelte_raw_text child). */
  /** The `svelte_raw_text` node the expression body lives in — the node that
   *  gives the expression a LINE (M59 #825). `expressionText` returns only the
   *  string, which is exactly why every template read in this analyzer claimed
   *  no line at all. */
  private expressionTextNode(node: Node): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (m.type === "svelte_raw_text") return m
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private expressionText(node: Node): string {
    return this.expressionTextNode(node)?.text ?? ""
  }

  /** Every `svelte_raw_text` node under `root`, in document order — text AND
   *  position from the same node, so a fragment's line cannot drift from the
   *  fragment the name was read out of. */
  private rawTextNodes(root: Node): Node[] {
    const out: Node[] = []
    const stack: Node[] = [root]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (m.type === "svelte_raw_text") out.push(m)
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return out.sort((a, b) => a.startIndex - b.startIndex)
  }

  /** Line breaks before `end` — how far into a fragment a match sits. */
  private static linesBefore(text: string, end: number): number {
    let n = 0
    for (let i = 0; i < end && i < text.length; i++) if (text[i] === "\n") n++
    return n
  }

  /**
   * Shadow-binding sites only: the names are DEFINITIONS, so no line is ever
   * claimed for them — but they MUST land in `shadowed`.
   *
   * Careful: the pre-#825 call sites did this by passing the shadow set as the
   * collector's `out` (`collectIdentifiersFromText(vars, shadowed, new Set())`),
   * which is where the bindings were registered. Now that `out` is a Map, that
   * shape silently registers nothing — measured: `{#each rows as row}` and
   * `{#await p then value}` stopped shadowing, so `row`/`item`/`total`/`value`/
   * `d` all came back as template READS (two existing fixtures caught it:
   * svelte/each-shadow-collision and svelte/await-inline-shadow). So the names
   * are collected into a scratch Map and then transferred, preserving the
   * original semantics exactly.
   */
  private collectShadowNames(text: string, shadowed: Set<string>): void {
    const names = new Map<string, number>()
    this.collectIdentifiersFromText(text, names, new Set())
    for (const n of names.keys()) shadowed.add(n)
  }

  private collectIdentifiersFromText(text: string, out: Map<string, number>, shadowed: Set<string>, baseLine = 0, sites?: Map<string, number[]>): void {
    // M2+M3 (review wave): the flat identifier regex read string contents
    // (`f("a=b")` -> Uses(a), Uses(b)) and chain leaves (`item.id` -> member
    // `id`) as member reads. Character walk with quote states (backslash
    // escapes honored; backtick ${...} re-enters code, brace-tracked) and
    // receiver-only emission (dot/?./#-preceded tokens skipped) — the same
    // contract as the Vue D1/M1 machine, implemented here because the two
    // analyzers share no template code.
    // D3 (second review): `//` and `/* */` comments are code-skipped — a
    // `{f(a) /* b */}` comment must not read member b. (Vue's twin machine
    // has the same hole; flagged as a family follow-up, fixed here where
    // probe-proven.) Comment detection runs in code context only, so string
    // contents (URLs, '//' literals) are unaffected.
    const isIdentStart = (ch: string): boolean =>
      (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || ch === "_" || ch === "$"
    const isIdentPart = (ch: string): boolean => isIdentStart(ch) || (ch >= "0" && ch <= "9")
    const isSpace = (ch: string): boolean => ch === " " || ch === "\t" || ch === "\n" || ch === "\r"
    const stack: string[] = []
    // F27 (2026-10-12): the open-bracket stack and a per-depth "a `?` is pending"
    // flag, which is what the OBJECT-KEY rule needs to be positional rather than
    // textual. Both are parallel to `stack` by construction — every push/pop of one
    // is a push/pop of all three.
    const brackets: string[] = []
    const ternary: boolean[] = []
    /**
     * F27: is the identifier that ENDS at `end - 1` the KEY of an object literal?
     *
     * M60 SVELTE-D3. `{ month: d.desktop }` WRITES `month`; `{ foo }` READS it;
     * `{ [k]: v }` reads `k`. The flat walker could not tell them apart and
     * published both, which the fixture's rationale measures at 49 edges over 38 of
     * the 6,439 corpus files — every one naming a member the template never reads,
     * and the worst of them RESOLVED, because `chart-pie-stacked.svelte` declares
     * `{#snippet tooltip()}` and so published `uses -> tooltip` off a Recharts
     * config key.
     *
     * The rule is positional and TERNARY-AWARE, because `? :` and `: ` are the same
     * character:
     *   a word is a KEY  <=>  the next non-space character is `:` AND the innermost
     *                         open bracket is `{` AND no `?` is pending at this depth;
     *   a `:` that RESOLVES a pending `?` is a ternary else and leaves the word a
     *                         read (`cond ? a : b` reads both `a` and `b`).
     * An optional chain (`?.`) and a nullish coalesce (`??`) are not ternaries and
     * must not arm the flag, so both are recognised before it is set.
     *
     * A COMPUTED key (`{ [k]: v }`) is inside `[`, so the innermost bracket is not
     * `{` and its contents stay reads — which is the fixture's third shape, and the
     * reason this asks about the BRACKET rather than about the following colon alone.
     */
    const isObjectKey = (end: number): boolean => {
      let j = end
      while (j < text.length && isSpace(text[j])) j++
      if (text[j] !== ":") return false
      const top = brackets.length > 0 ? brackets[brackets.length - 1] : ""
      if (top !== "{") return false
      const t = ternary.length > 0 ? ternary[ternary.length - 1] : false
      return !t
    }
    const emit = (word: string, start: number): void => {
      let k = start - 1
      while (k >= 0 && isSpace(text[k])) k--
      const prev = k >= 0 ? text[k] : ""
      const prev2 = k - 1 >= 0 ? text[k - 1] : ""
      // M60 SVELTE-SPREAD / F27: `...foo` is a SPREAD ARGUMENT, which is a READ,
      // and the receiver-only dot rule suppressed it because the token before `foo`
      // is a dot — `[...list]` and `f(...list)` published nothing. A run of exactly
      // one dot is a receiver; `?.` is optional chaining and still a receiver; three
      // dots is a spread. The fixture pins both sides: `list` on line 60 must be a
      // read, `rows.`/`foo.` leaves must not.
      if (prev === "." && prev2 !== ".") return
      if (prev2 === "?" && prev === ".") return
      if (prev === "#") return
      if (shadowed.has(word)) return
      if (isObjectKey(start + word.length)) return
      const site = baseLine + RealSvelteAnalyzer.linesBefore(text, start)
      out.set(word, site)
      if (sites) {
        const arr = sites.get(word)
        if (arr) { if (arr[arr.length - 1] !== site) arr.push(site) }
        else sites.set(word, [site])
      }
    }
    let i = 0
    while (i < text.length) {
      const ch = text[i]
      const top = stack.length > 0 ? stack[stack.length - 1] : ""
      if (top === "'" || top === '"') {
        if (ch === "\\") { i += 2; continue }
        if (ch === top) stack.pop()
        i++
        continue
      }
      if (top === "`") {
        if (ch === "\\") { i += 2; continue }
        if (ch === "$" && text[i + 1] === "{") { stack.push("${"); brackets.push("{"); ternary.push(false); i += 2; continue }
        if (ch === "`") { stack.pop(); brackets.pop(); ternary.pop(); i++; continue }
        i++
        continue
      }
      if (ch === "'" || ch === '"' || ch === "`") { stack.push(ch); i++; continue }
      if (ch === "{") { stack.push(ch); brackets.push("{"); ternary.push(false); i++; continue }
      // `(` and `[` are pushed only so the KEY rule can tell an object literal's
      // brace from a computed key's bracket — nothing else reads them.
      if (ch === "(" || ch === "[") { stack.push(ch); brackets.push(ch); ternary.push(false); i++; continue }
      if (ch === "}") {
        if (top === "{" || top === "${") { stack.pop(); brackets.pop(); ternary.pop() }
        else if (top === "(") { stack.pop(); brackets.pop(); ternary.pop() }
        i++
        continue
      }
      if (ch === ")") { if (top === "(") { stack.pop(); brackets.pop(); ternary.pop() } i++; continue }
      if (ch === "]") { if (top === "[") { stack.pop(); brackets.pop(); ternary.pop() } i++; continue }
      if (ch === "?") {
        // `?.` optional chain and `??` nullish coalesce are not ternaries, so both
        // are recognised BEFORE the flag is armed — otherwise every `a?.b : c`
        // would look like a ternary else.
        if (text[i + 1] === "?" || text[i + 1] === ".") { i += 2; continue }
        if (ternary.length > 0) ternary[ternary.length - 1] = true
        i++
        continue
      }
      if (ch === ":") {
        // A `:` at object-literal depth is the key/value separator, and one that
        // resolves a pending `?` is a ternary else. Both CLEAR the flag: the value
        // side is a value, whichever it was.
        if (ternary.length > 0) ternary[ternary.length - 1] = false
        i++
        continue
      }
      // D3: comment skipping (code context only — quote states returned
      // above, so '//' inside strings/regex-shaped text is literal).
      if (ch === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
        if (text[i + 1] === "/") {
          const nl = text.indexOf("\n", i + 2)
          i = nl >= 0 ? nl + 1 : text.length
        } else {
          const end = text.indexOf("*/", i + 2)
          i = end >= 0 ? end + 2 : text.length
        }
        continue
      }
      if (!isIdentStart(ch)) { i++; continue }
      let j = i + 1
      while (j < text.length && isIdentPart(text[j])) j++
      emit(text.slice(i, j), i)
      i = j
    }
  }

  /** {#each items as item, i} — collection is a use; loop vars shadow. */
  private collectEachExpression(node: Node, out: Map<string, number>, shadowed: Set<string>, sites?: Map<string, number[]>): void {
    const start = this.findDescendant(node, (c) => c.type === "each_start")
    if (!start) return
    const rawTexts = this.rawTextNodes(start)
    // each_start has two raw_text children: [collection, vars]
    const collection = rawTexts[0]
    if (collection) this.collectIdentifiersFromText(collection.text, out, shadowed, collection.startPosition.row + 1, sites)
    // S5 (#419): the loop-var list (rawTexts[1], e.g. `row, i` / `[a, b]` /
    // `{ id }`) binds template-LOCAL names that SHADOW same-named members. They
    // must be registered into `shadowed` (the set the children inherit) so a
    // `{row}`/`{row.id}` reading the loop element never emits a false Use of a
    // member function `row`. Previously this was never seeded — the shadow
    // machinery was dead for `{#each}` and only "passed" fixtures where no
    // same-named member existed to collide (the vue V4 bug class).
    const vars = rawTexts[1]
    const varsText = vars?.text ?? ""
    // F25 (2026-10-12): THE KEYED FORM (`{#each rows as row (keyExpr)}`). The
    // grammar keeps the key INSIDE the second fragment — `{#each rows as row}`
    // gives `row` and `{#each rows as row (row.id)}` gives `row (row.id)` — so the
    // whole fragment went through the flat word collector above, with two measured
    // consequences over the 6,439-file corpus (the keyed form occurs 699 times in
    // 486 files):
    //
    //   1. a FALSE SHADOW. Every word of the key was registered as a template-local
    //      binding, so `{#each todos as todo (todo.id)}` silenced a member named
    //      `id` for the whole block — a binding it never was.
    //   2. NO READ. The key itself published nothing, while the COLLECTION on the
    //      same line does: `{#each rows as row (keyOf(row))}` published `uses rows`
    //      and nothing for `keyOf`.
    //
    // So the head is the binding list and the parenthesised tail is an EXPRESSION,
    // on the same S1 argument the collection is: a template expression naming a
    // member is a use of it. The collector's own dot rule then skips the key's
    // property LEAVES, which is why the ordinary keyed block (`(row.id)`) still
    // contributes no read of `id` — the fixture pins that as a forbid row — and
    // only a key naming something else (`(keyOf(row))`, `(sortKey)`) adds an edge.
    // That is the whole point of the rule.
    //
    // F28 (2026-10-12): the head is a BINDING PATTERN, not a word list, so
    // `{#each rows as { [firstString]: firstProp }}` reads `firstString` and binds
    // `firstProp` (and `firstProp` is never a read), which `collectShadowNames`
    // could not express: it put every word in the shadow set, losing 27 measured
    // reads and fabricating shadows for 81 sites' worth of computed keys.
    const varsBase = (vars?.startPosition.row ?? 0) + 1
    const keyClause = RealSvelteAnalyzer.patternKeySplit(varsText)
    if (keyClause) {
      this.collectBindingPattern(keyClause.pattern, out, shadowed, varsBase, sites)
      this.collectIdentifiersFromText(
        keyClause.keyText, out, shadowed,
        varsBase + RealSvelteAnalyzer.linesBefore(varsText, keyClause.keyAt), sites,
      )
    } else {
      this.collectBindingPattern(varsText, out, shadowed, varsBase, sites)
    }
  }

  /** {#await promise then value} {:catch err} — promise is a use; vars shadow. */
  private collectAwaitExpression(node: Node, out: Map<string, number>, shadowed: Set<string>, sites?: Map<string, number[]>): void {
    const start = this.findDescendant(node, (c) => c.type === "await_start")
    const thenBlk = this.findDescendant(node, (c) => c.type === "then_start")
    const catchBlk = this.findDescendant(node, (c) => c.type === "catch_start")
    if (start) {
      const rawNodes = this.rawTextNodes(start)
      const rawTexts = rawNodes.map((r) => r.text)
      // await_start raw_text: `promise then value` / `promise as value`
      const text = rawTexts.join(" ")
      // The promise expression (everything before `then`/`as`) is entirely
      // inside the FIRST fragment, so that fragment's own line is its base.
      const firstLine = rawNodes[0] ? rawNodes[0].startPosition.row + 1 : 0
      // the promise expression is everything up to then/as; then/catch vars
      // shadow. Simpler: collect all identifiers but drop the then/catch vars
      // (already added to childShadowed), and only the promise survives.
      const m = splitAwaitHead(text)
      const promiseExpr = m ? m.head : text
      this.collectIdentifiersFromText(promiseExpr, out, shadowed, firstLine)
      // M4 (review wave): the INLINE then/as vars (`then value` with no
      // then_block node) were never registered — {value} later leaked as a
      // member use. Register the remainder as template-local bindings.
      // F28: it is a PATTERN, so `then { [k]: v = fallback }` reads `k` and
      // `fallback` and binds `v`; the base line is the one the `then` keyword's own
      // fragment starts on, because the inline form is one fragment.
      if (m) {
        this.collectBindingPattern(
          text.slice(m.matchLength), out, shadowed,
          firstLine + RealSvelteAnalyzer.linesBefore(text, m.matchLength), sites,
        )
      }
    }
    // then/catch var names shadow members within their block.
    // M1 (review wave): no phantom entries — an earlier revision appended a
    // literal " x" here, shadowing every member named x in every await block
    // subtree (probe: real {x} read suppressed). Empty blocks collect
    // nothing on their own, which is already correct.
    for (const blk of [thenBlk, catchBlk]) {
      if (!blk) continue
      // F28: a PATTERN again (`{:then { a, b = c }}`), and this time the pattern's
      // own expressions DO carry a line: a default value is a read, so the block's
      // first fragment is the base and `value`/`err` still bind with no line
      // claimed for them.
      const rawNodes = this.rawTextNodes(blk)
      this.collectBindingPattern(
        rawNodes.map((r) => r.text).join(" "), out, shadowed,
        rawNodes[0] ? rawNodes[0].startPosition.row + 1 : 0, sites,
      )
    }
  }

  /** D5: {#if cond} / {:else if cond} / {#key exp} — the condition is a
   *  svelte_raw_text child of if_start/else_if_start/key_start (no
   *  `expression` wrapper, unlike mustache bodies). Every identifier is a
   *  member read; these heads bind nothing, so no shadow registration. */
  private collectConditionExpression(node: Node, out: Map<string, number>, shadowed: Set<string>, sites?: Map<string, number[]>): void {
    const start = this.findDescendant(node, (c) =>
      c.type === "if_start" || c.type === "else_if_start" || c.type === "key_start")
    if (!start) return
    const rawNodes = this.rawTextNodes(start)
    // if_start's raw_text INCLUDES the {#if marker text? No — block_start_tag
    // is a separate child holding `#if`; raw_text holds only the condition.
    // (Verified against the live grammar: if_start->[block_start_tag,
    // svelte_raw_text]; the tag child contributes no raw text.)
    // M59 (#825): the condition node's own line is the base; a multi-fragment
    // head (`{#key a}` + separate text) then offsets from the first fragment, so
    // the claimed line is still a line the name is written on.
    const baseLine = rawNodes[0] ? rawNodes[0].startPosition.row + 1 : 0
    this.collectIdentifiersFromText(rawNodes.map((r) => r.text).join(" "), out, shadowed, baseLine, sites)
  }

  /**
   * {#snippet row(label, count)} heads — params are template-local.
   *
   * F28: `{#snippet counter(c = count)}` binds `c` and READS `count`, and the
   * grammar hands the parameter list over WITHOUT its parens or the snippet name
   * (measured: `snippet_start` raw text is `c = count` for exactly that head), so the
   * pattern scanner takes the fragment as-is. A parameter annotation is a type and
   * the bare `{#snippet typed(c: number = 4)}` spelling is the fixture's shape for
   * it: `number` is neither a read nor a binding.
   */
  private collectSnippetParams(node: Node, out: Map<string, number>, shadowed: Set<string>, sites?: Map<string, number[]>): void {
    const start = this.findDescendant(node, (c) => c.type === "snippet_start")
    if (!start) return
    const rawNodes = this.rawTextNodes(start)
    this.collectBindingPattern(
      rawNodes.map((r) => r.text).join(" "), out, shadowed,
      rawNodes[0] ? rawNodes[0].startPosition.row + 1 : 0, sites,
    )
  }

  /** A template expression body ({count}, label={label}, {@html raw}). */
  private collectExpressionIdentifiers(node: Node, out: Map<string, number>, shadowed: Set<string>, sites?: Map<string, number[]>): void {
    const textNode = this.expressionTextNode(node)
    const text = textNode?.text ?? ""
    // F23 (2026-10-12): AN EVENT CARRIER'S ARROW PARAMETERS ARE LOCALS OF THIS
    // EXPRESSION, and the walk published them as members. `<button
    // on:click={(evt) => { payload = evt }}>` emitted `uses -> evt` — an
    // endpoint that resolves to nothing in the file or the corpus — and a
    // DESTRUCTURED parameter is the same defect one shape further in
    // (`({ data }) => { payload = data }` published `data`, which in this
    // fixture is the script's own `let data = 3`). The fixture's second shape is
    // also the trap: a first version of the parameter scan took the FIRST WORD
    // of the pattern and still published this name.
    //
    // The shadow set is widened ONLY for the two spellings that bind a parameter
    // — `on:click={…}` and the Svelte-5 `onclick={…}` on an intrinsic tag — and
    // only for this expression, because the set is per-expression: which is what
    // `eventCarrierName` asks structurally rather than by name guessing.
    // F26 (2026-10-12): A DECLARATION TAG BINDS. `{let counter = …}` and
    // `{const doubler = …}` are Svelte 5.36 template declarations, and the walk
    // read them as ordinary mustaches — so the declared name was published as a
    // member READ of a declaration it shadows, and the shadow it creates was
    // never registered, which is why a LATER sibling using that name still
    // resolved to a member.
    //
    // The split is positional and keyword-bounded: `declarationTagSplit` requires
    // a leading `let`/`const` followed by a word boundary AND a top-level `=`, so
    // `{letter = 5}` — an assignment to a member named `letter` — is not a tag,
    // and `{constantly}` / `{letter}` are untouched. The HEAD is the binding list
    // (registered into the walk's shadow set by MUTATION, which is what carries it
    // to the following siblings, exactly as the `{#each}` var list does above) and
    // the TAIL is an initialiser EXPRESSION, collected as reads — `{const n = limit}`
    // reads `limit` and binds `n`.
    const decl = RealSvelteAnalyzer.declarationTagSplit(text)
    if (decl) {
      // F28: the head is a PATTERN too — `{let { [k]: v = d } = src}` binds `v` and
      // reads `k`, `d` and `src`, and `{let x = 1}` is the degenerate one-name case.
      this.collectBindingPattern(decl.head, out, shadowed, textNode ? textNode.startPosition.row + 1 : 0, sites)
      this.collectIdentifiersFromText(
        decl.tail, out, shadowed,
        (textNode ? textNode.startPosition.row + 1 : 0) + RealSvelteAnalyzer.linesBefore(text, decl.eqAt + 1),
        sites,
      )
      return
    }
    const scope = this.eventCarrierName(node.parent) ? this.withArrowParams(shadowed, text) : shadowed
    this.collectIdentifiersFromText(text, out, scope, textNode ? textNode.startPosition.row + 1 : 0, sites)
  }

  /**
   * M60 SVELTE-D6 / F26: split a Svelte 5.36 declaration tag `{let x = …}` /
   * `{const x = …}` into its binding head and its initialiser. Returns null for
   * an ordinary mustache, which is the overwhelming majority. A leading
   * `let`/`const` is REQUIRED and so is the word boundary after it: without the
   * boundary `{letter = 5}` — an assignment to a member named `letter` — parses as
   * a `let` tag binding `ter`, a fabricated shadow rather than a real one.
   */
  private static declarationTagSplit(text: string): { head: string; tail: string; eqAt: number } | null {
    const ws = (i: number): number => {
      while (i < text.length && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r")) i++
      return i
    }
    const i = ws(0)
    const kw = text.startsWith("let", i) ? "let" : text.startsWith("const", i) ? "const" : null
    if (!kw) return null
    const after = i + kw.length
    const next = text[after]
    const boundary = next === "{" || next === "[" || next === " " || next === "\t" || next === "\n" || next === "\r"
    if (!boundary) return null
    const body = ws(after)
    // the head must actually contain a top-level `=` — `{const}` alone is not a tag
    let depth = 0
    for (let j = body; j < text.length; j++) {
      const ch = text[j]
      if (ch === "(" || ch === "[" || ch === "{") depth++
      else if (ch === ")" || ch === "]" || ch === "}") depth--
      else if (ch === "=" && depth === 0) {
        if (text[j + 1] === "=" || text[j - 1] === "=" || text[j - 1] === "!" || text[j - 1] === "<" || text[j - 1] === ">") continue
        return { head: text.slice(body, j), tail: text.slice(j + 1), eqAt: j }
      }
    }
    return null
  }

  /**
   * F28 (2026-10-12): A BINDING PATTERN HAS READ POSITIONS AND BINDING POSITIONS.
   *
   * Every template site that writes a PATTERN — `{#each rows as …}`, `{#await p
   * then …}`, `{:catch …}`, `{#snippet name(…)}`, `{let …}` / `{@const …}` heads —
   * used to hand its text to the flat word collector, which did two wrong things at
   * once:
   *
   *   a LOST READ     `{#snippet counter(c = count)}` binds `c` and READS `count`;
   *   a FALSE SHADOW  `{#each xs as { a: b }}` binds `b` alone — `a` is a PROPERTY
   *                   name, so registering it silenced a member named `a` for the
   *                   whole block.
   *
   * Measured before this fix over the 6,439-file corpus (svelte 4,561 + shadcn-svelte
   * 1,878 git-tracked .svelte files) with the grammar-derived oracle
   * (`script/m14/tmp/svelte-uses-oracle.ts`, which re-parses each template fragment
   * with the JAVASCRIPT grammar and so decides the split from
   * `assignment_pattern.right` and `computed_property_name` rather than from a
   * character walk): 35 template reads the payload does not publish, 27 of them this
   * class, over 81 sites carrying a computed key or a default value.
   *
   * The split, and nothing wider than the split:
   *   COMPUTED KEY  `{ [k]: v }`      the inside of `[ ]` is an EXPRESSION (a read)
   *   DEFAULT VALUE `x = expr`        `expr` is an EXPRESSION (a read) and `x` binds
   *   PROPERTY NAME `{ a: b }`        `a` is neither a read nor a binding
   *   VALUE         `{ a: b }`        `b` binds, recursively (nested patterns too)
   *   SHORTHAND     `{ a }`           `a` binds
   *   REST          `...props`        `props` binds
   *   ANNOTATION    `c: number = 4`   `number` is neither: it is a type
   *   BOUND EARLIER `{ idx, [idx - 1]: last }`  `idx` is a template-local by the
   *                   time the computed key reads it, so it publishes NOTHING
   *
   * The last rule is why the walk is ONE LEFT-TO-RIGHT PASS that mutates the shadow
   * set as it binds: a reader that collects all reads before all bindings publishes
   * a false edge on the first entry of every `{ name, [name …] }` pattern, and that
   * is the one row the fixture pins as forbidden precisely because it would silently
   * ADD edges rather than lose them.
   *
   * Pure-String scanning: this family's regex census is 0 and stays 0.
   */
  private collectBindingPattern(text: string, out: Map<string, number>, shadowed: Set<string>, baseLine = 0, sites?: Map<string, number[]>): void {
    if (!text) return
    const isSpace = (c: string): boolean => c === " " || c === "\t" || c === "\n" || c === "\r"
    const isIdentStart = (c: string): boolean =>
      (c >= "A" && c <= "Z") || (c >= "a" && c <= "z") || c === "_" || c === "$"
    const isIdentPart = (c: string): boolean => isIdentStart(c) || (c >= "0" && c <= "9")
    const skipWs = (i: number, e: number): number => {
      while (i < e && isSpace(text[i])) i++
      return i
    }
    const identAt = (i: number): { name: string; end: number } | null => {
      if (i >= text.length || !isIdentStart(text[i])) return null
      let j = i + 1
      while (j < text.length && isIdentPart(text[j])) j++
      return { name: text.slice(i, j), end: j }
    }
    /** The expression `[s, e)` is a READ, at the line its offset falls on. */
    const read = (s: number, e: number): void => {
      if (s >= e) return
      this.collectIdentifiersFromText(
        text.slice(s, e), out, shadowed,
        baseLine + RealSvelteAnalyzer.linesBefore(text, s), sites,
      )
    }
    const bind = (name: string): void => { if (isIdentifier(name)) shadowed.add(name) }
    /** `{@const …}` — the first top-level `=` splits the head from the initialiser. */
    const atTopLevel = (i: number, e: number, ch: string): number => {
      let d = 0
      let j = i
      while (j < e) {
        const c = text[j]
        if (c === "'" || c === '"' || c === "`") { j = RealSvelteAnalyzer.skipQuoted(text, j); continue }
        if (c === "(" || c === "[" || c === "{") { d++; j++; continue }
        if (c === ")" || c === "]" || c === "}") { d--; j++; continue }
        if (c === ch && d === 0) {
          const prev = j > 0 ? text[j - 1] : ""
          const next = text[j + 1] ?? ""
          if (ch === "=" && (next === "=" || prev === "=" || prev === "!" || prev === "<" || prev === ">")) { j++; continue }
          return j
        }
        j++
      }
      return -1
    }
    /** One parameter or one entry VALUE: a name, a nested pattern, a rest, a default. */
    const scanValue = (s0: number, e: number): void => {
      const s = skipWs(s0, e)
      if (s >= e) return
      if (text.startsWith("...", s)) { const w = identAt(skipWs(s + 3, e)); if (w) bind(w.name); return }
      const ch = text[s]
      if (ch === "{" || ch === "[") {
        const close = RealSvelteAnalyzer.matchingBracket(text, s)
        const end = close < 0 || close > e ? e : close
        if (ch === "{") scanObject(s + 1, end)
        else scanArray(s + 1, end)
        return
      }
      const w = identAt(s)
      if (!w) { read(s, e); return }
      let k = skipWs(w.end, e)
      // `d?: string` — the optional marker is part of the ANNOTATION spelling.
      if (k < e && text[k] === "?" && text[k + 1] === ":") k = skipWs(k + 1, e)
      if (k < e && text[k] === ":") {
        // a TypeScript ANNOTATION: the type is neither a read nor a binding, so
        // only a DEFAULT after it is an expression.
        bind(w.name)
        const eq = atTopLevel(k + 1, e, "=")
        if (eq >= 0) read(eq + 1, e)
        return
      }
      if (k < e && text[k] === "=") { bind(w.name); read(k + 1, e); return }
      bind(w.name)
    }
    /** `{ … }` entries, left to right, binding as it goes. */
    const scanObject = (s: number, e: number): void => {
      for (const [a, b] of RealSvelteAnalyzer.splitTopLevel(text, s, e)) {
        const i = skipWs(a, b)
        if (i >= b) continue
        if (text.startsWith("...", i)) { const w = identAt(skipWs(i + 3, b)); if (w) bind(w.name); continue }
        const ch = text[i]
        if (ch === "[") {
          // a COMPUTED key is a READ; what follows it is the bound value (or, on a
          // computed key with a default, an expression and no binding at all).
          const close = RealSvelteAnalyzer.matchingBracket(text, i)
          const end = close < 0 || close > b ? b : close
          read(i + 1, end)
          const k = skipWs(end + 1, b)
          if (k < b && text[k] === ":") scanValue(k + 1, b)
          else if (k < b && text[k] === "=") read(k + 1, b)
          continue
        }
        if (ch === "'" || ch === '"' || ch === "`") {
          // a STRING key is a property name; only a rename's value binds.
          const k = skipWs(RealSvelteAnalyzer.skipQuoted(text, i), b)
          if (k < b && text[k] === ":") scanValue(k + 1, b)
          continue
        }
        const w = identAt(i)
        if (!w) { read(i, b); continue }
        const k = skipWs(w.end, b)
        if (k < b && text[k] === ":") { scanValue(k + 1, b); continue } // rename: the key is a property name
        if (k < b && text[k] === "=") { bind(w.name); read(k + 1, b); continue } // shorthand with a default
        bind(w.name) // shorthand
      }
    }
    /** `[ … ]` positions: each one is a parameter (a nested pattern binds). */
    const scanArray = (s: number, e: number): void => {
      for (const [a, b] of RealSvelteAnalyzer.splitTopLevel(text, s, e)) scanValue(a, b)
    }
    // entry point: a comma-separated parameter list, with or without its parens.
    let s = skipWs(0, text.length)
    let e = text.length
    if (s < e && text[s] === "(") {
      const close = RealSvelteAnalyzer.matchingBracket(text, s)
      if (close >= 0 && skipWs(close + 1, e) >= e) { s = s + 1; e = close }
    }
    for (const [a, b] of RealSvelteAnalyzer.splitTopLevel(text, s, e)) scanValue(a, b)
  }

  /**
   * `i` is at a quote: the index just past its closing quote (or the end of the
   * text when it never closes). A TEMPLATE literal's `${ … }` re-enters code, so its
   * braces are tracked — otherwise a `,` inside an interpolation would split a
   * parameter list. Structural scanning only; the READ side is the ordinary
   * character collector, which has its own (identical) quote machine.
   */
  private static skipQuoted(text: string, i: number): number {
    const q = text[i]
    let j = i + 1
    let depth = 0
    while (j < text.length) {
      const c = text[j]
      if (c === "\\") { j += 2; continue }
      if (q === "`") {
        if (c === "$" && text[j + 1] === "{") { depth++; j += 2; continue }
        if (c === "}" && depth > 0) { depth--; j++; continue }
      }
      if (c === q && depth === 0) return j + 1
      j++
    }
    return text.length
  }

  /** Index of the bracket matching the opener at `open`, or -1 when unbalanced. */
  private static matchingBracket(text: string, open: number): number {
    const closerOf = (c: string): string => (c === "(" ? ")" : c === "[" ? "]" : c === "{" ? "}" : "")
    const stack: string[] = []
    let i = open
    while (i < text.length) {
      const ch = text[i]
      if (ch === "'" || ch === '"' || ch === "`") { i = RealSvelteAnalyzer.skipQuoted(text, i); continue }
      const expect = closerOf(ch)
      if (expect) { stack.push(expect); i++; continue }
      if (ch === ")" || ch === "]" || ch === "}") {
        if (stack.length === 0 || stack[stack.length - 1] !== ch) return -1
        stack.pop()
        if (stack.length === 0) return i
      }
      i++
    }
    return -1
  }

  /** `[s, e)` split on TOP-LEVEL commas: quotes, brackets and `${…}` are skipped whole. */
  private static splitTopLevel(text: string, s: number, e: number): Array<[number, number]> {
    const segs: Array<[number, number]> = []
    let start = s
    let i = s
    while (i < e) {
      const ch = text[i]
      if (ch === "'" || ch === '"' || ch === "`") { i = RealSvelteAnalyzer.skipQuoted(text, i); continue }
      if (ch === "(" || ch === "[" || ch === "{") {
        const close = RealSvelteAnalyzer.matchingBracket(text, i)
        i = close < 0 || close >= e ? e : close + 1
        continue
      }
      if (ch === ",") { segs.push([start, i]); start = i + 1; i++; continue }
      i++
    }
    segs.push([start, e])
    return segs
  }

  /**
   * F25/F28: split a loop binding list's trailing KEY CLAUSE off its pattern —
   * `row (keyOf(row))` gives the pattern `row ` and the key `keyOf(row)`.
   *
   * The grammar keeps the key INSIDE the same fragment as the bindings
   * (`{#each rows as row}` gives `row`, `{#each rows as row (row.id)}` gives
   * `row (row.id)`), so the two halves have to be separated by hand. The test is
   * STRUCTURAL rather than `indexOf("(")`: the key clause is the parenthesised group
   * that ends the list, which keeps a `(` inside a pattern's own default
   * (`{ [k]: v = f() }`) from being mistaken for it.
   */
  private static patternKeySplit(text: string): { pattern: string; keyText: string; keyAt: number } | null {
    let e = text.length
    while (e > 0 && (text[e - 1] === " " || text[e - 1] === "\t" || text[e - 1] === "\n" || text[e - 1] === "\r")) e--
    if (e === 0 || text[e - 1] !== ")") return null
    let depth = 0
    let openAt = -1
    for (let i = 0; i < e; i++) {
      const ch = text[i]
      if (ch === "'" || ch === '"' || ch === "`") { i = RealSvelteAnalyzer.skipQuoted(text, i) - 1; continue }
      if (ch === "(" || ch === "[" || ch === "{") {
        if (depth === 0 && ch === "(") openAt = i
        depth++
        continue
      }
      if (ch === ")" || ch === "]" || ch === "}") {
        depth--
        if (depth === 0) {
          if (i === e - 1 && openAt >= 0) {
            return { pattern: text.slice(0, openAt), keyText: text.slice(openAt + 1, e - 1), keyAt: openAt + 1 }
          }
          openAt = -1
        }
      }
    }
    return null
  }

  /**
   * F29: record the TEMPLATE read a dedupe drop would otherwise lose.
   *
   * Called only from the graph dedupe, for a row that is being DROPPED in favour of a
   * row already published for the same `type|source|target`. It does nothing unless
   * the dropped row is a template read and the survivor is not one — the case the
   * fixture measures — and it writes onto the SURVIVOR:
   *
   *   `isTemplateRead: true`        "this row stands for a template read too"
   *   `templateReadSites: [ … ]`    WHICH sites, merged with any already recorded
   *
   * The site list is written even for a SINGLE site, unlike the read map's
   * `templateReadSites` convention (present only when a member is read on more than
   * one line). The two are not inconsistent, and the difference is what
   * `line_number` means on each: on a template-read row `line_number` IS a site, so a
   * one-element list adds nothing; here `line_number` is the SCRIPT's line, so for a
   * single dropped site the list is the only place that site exists. The divergence
   * is recorded in `docs/analyzers/BRANCH-INVENTORY-2026-10-07.md` rather than smoothed
   * over. Returns whether anything was recorded, so a caller could assert the empty
   * case.
   */
  private static recordDroppedTemplateRead(
    survivor: ASTEngine.UniversalRelationship,
    dropped: ASTEngine.UniversalRelationship,
  ): boolean {
    if (dropped.metadata?.isTemplateExpression !== true) return false
    if (survivor.metadata?.isTemplateExpression === true) return false
    const sites = new Set<number>((survivor.metadata?.templateReadSites as number[] | undefined) ?? [])
    for (const s of (dropped.metadata?.templateReadSites as number[] | undefined) ?? []) {
      if (typeof s === "number") sites.add(s)
    }
    if (typeof dropped.line_number === "number") sites.add(dropped.line_number)
    if (sites.size === 0) return false
    survivor.metadata = {
      ...(survivor.metadata ?? {}),
      isTemplateRead: true,
      templateReadSites: [...sites].sort((a, b) => a - b),
    }
    return true
  }

  /**
   * F23: is this attribute one of the two EVENT CARRIERS — the two spellings that
   * make their value a function Svelte calls, and therefore the only two whose
   * arrow parameters bind?
   *
   * `eventCarrierName` is deliberately narrower than "an attribute whose name
   * starts with on": `onclick` is an event only on an INTRINSIC tag (on a
   * component it is a prop, and the parent attribute node does not carry the tag
   * this walk already resolved), so the caller's own `on:`/`onclick` decision is
   * what this reads. A bare `on:click={save}` has no arrow at all and
   * `arrowParams` returns nothing, which is correct: a bare identifier is a call
   * target and is handled by `onHandlerCall`.
   */
  private eventCarrierName(parent: Node | null): string | null {
    if (!parent || parent.type !== "attribute") return null
    const name = this.attributeName(parent)
    if (!name) return null
    if (name.startsWith("on:")) return name
    return isOnEventAttrName(name) && name.length > 4 ? name : null
  }

  /** `shadowed` widened by the parameters written at the head of `text`. */
  private withArrowParams(shadowed: Set<string>, text: string): Set<string> {
    const params = RealSvelteAnalyzer.arrowParams(text)
    if (params.length === 0) return shadowed
    const out = new Set(shadowed)
    for (const p of params) out.add(p)
    return out
  }

  /**
   * F23: the bound names of an arrow function's parameters, read off the text
   * before the FIRST top-level `=>`. Pure-String scanning, no regex — this
   * family's regex census is 0 and stays 0.
   *
   * `(evt) =>` gives `evt`; `() =>` gives nothing; `async ({ data }) =>` gives
   * `data`. Inside a DESTRUCTURING pattern an identifier immediately after a `:`
   * is the rename KEY (`{ a: local }` binds `local`, not `a`) and one inside
   * `[ ]` is a COMPUTED key, which is a read rather than a binding — both are
   * skipped rather than over-shadowed, because over-shadowing silently drops a
   * true read instead of publishing a false one.
   */
  private static arrowParams(text: string): string[] {
    const out: string[] = []
    let depth = 0
    let arrow = -1
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (c === "(" || c === "[" || c === "{") depth++
      else if (c === ")" || c === "]" || c === "}") depth--
      else if (depth === 0 && c === "=" && text[i + 1] === ">") { arrow = i; break }
      else if (c === ";") break
    }
    if (arrow < 0) return out
    let head = text.slice(0, arrow).trim()
    if (head.startsWith("async")) head = head.slice(5).trim()
    if (head.startsWith("(") && head.endsWith(")")) head = head.slice(1, -1)
    else if (!isIdentifier(head)) return out
    const isWordChar = (ch: string): boolean =>
      (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9") || ch === "_" || ch === "$"
    /** One parameter: `name`, `name = default`, `name: Type`, `{ a, b: c }`. */
    const binding = (raw: string): void => {
      let t = raw.trim()
      if (!t) return
      if (t.startsWith("...")) t = t.slice(3).trim()
      if (!t) return
      const destructured = t.indexOf("{") >= 0 || t.indexOf("[") >= 0
      if (!destructured) {
        let end = t.length
        for (let i = 0; i < t.length; i++) {
          if (t[i] === "=" || t[i] === ":") { end = i; break }
        }
        const w = t.slice(0, end).trim()
        if (isIdentifier(w)) out.push(w)
        return
      }
      let bracket = 0
      let i = 0
      while (i < t.length) {
        const c = t[i]
        if (c === "[") { bracket++; i++; continue }
        if (c === "]") { if (bracket > 0) bracket--; i++; continue }
        if (bracket > 0 || !isWordChar(c) || (c >= "0" && c <= "9")) { i++; continue }
        let j = i
        while (j < t.length && isWordChar(t[j])) j++
        const w = t.slice(i, j)
        let k = i - 1
        while (k >= 0 && (t[k] === " " || t[k] === "\t")) k--
        if (!(t[k] === ":")) out.push(w)
        i = j
      }
    }
    let d = 0
    let token = ""
    for (const ch of head) {
      if (ch === "(" || ch === "[" || ch === "{") { d++; token += ch; continue }
      if (ch === ")" || ch === "]" || ch === "}") {
        d--
        if (d < 0) break
        token += ch
        if (d === 0) binding(token)
        token = ""
        continue
      }
      if (d === 0 && ch === ",") { binding(token); token = ""; continue }
      token += ch
    }
    binding(token)
    return [...new Set(out)]
  }

  /** D4: last all-identifier segment of a dotted render target
   *  (`ns.row(it)` -> row; `a . b . c()` -> c). Returns undefined unless
   *  every segment is a bare identifier — the caller keeps its fallback. */
  private dottedRenderLeaf(text: string): string | undefined {
    // cut the trailing `}` and any call arguments `(...)`
    let body = text.trim()
    if (body.endsWith("}")) body = body.slice(0, -1)
    const paren = body.indexOf("(")
    if (paren >= 0) body = body.slice(0, paren)
    const parts = body.split(".").map((p) => {
      // strip whitespace and one optional-chaining marker by hand (no
      // regex — the R2 census gates every pattern literal in this family)
      let q = p.trim()
      if (q.endsWith("?")) q = q.slice(0, -1).trim()
      return q
    })
    if (parts.length < 2 || !parts.every((p) => isIdentifier(p))) return undefined
    return parts[parts.length - 1]
  }

  /** {@html raw} / {@const total = expr} / {@debug expr} — body is a direct
   *  svelte_raw_text child of the tag (no `expression` wrapper). */
  private collectTagExpressionIdentifiers(node: Node, out: Map<string, number>, shadowed: Set<string>, sites?: Map<string, number[]>): void {
    const textNode = this.expressionTextNode(node)
    const baseLine = textNode ? textNode.startPosition.row + 1 : 0
    let text = textNode?.text ?? ""
    // {@const total = expr} — `total` is the const's OWN template-local
    // BINDING, not a member use; only the RHS expression reads members (and
    // the RHS loop vars are already shadowed). Strip the binding LHS so the
    // declared name never leaks as a use (S5, {@const} shadow case).
    let base = baseLine
    if (node.type === "const_tag") {
      const eq = this.topLevelEq(text)
      if (eq >= 0) {
        // F28: the LHS is a binding PATTERN — `{@const { [labelKey]: bound =
        // pick(obj.a) } = obj}` binds `bound` and READS `labelKey`, `pick` and `obj`
        // (the last one from the trailing initialiser, below). Before this the head
        // was dropped entirely, so a computed key or a default in it published
        // nothing AND the bound name was never registered as a template-local.
        this.collectBindingPattern(text.slice(0, eq), out, shadowed, baseLine, sites)
        // The RHS starts after the `=` — advance the base by the breaks the
        // `{@const name =` prefix contains, so the line stays the expression's.
        base = baseLine + RealSvelteAnalyzer.linesBefore(text, eq + 1)
        text = text.slice(eq + 1)
      }
    }
    this.collectIdentifiersFromText(text, out, shadowed, base, sites)
  }

  /** Index of the first top-level `=` (not inside () / [] / {}) in `text`.*/
  private topLevelEq(text: string): number {
    let depth = 0
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (c === "(" || c === "[" || c === "{") depth++
      else if (c === ")" || c === "]" || c === "}") depth--
      else if (c === "=" && depth === 0) return i
    }
    return -1
  }

  /**
   * M59 (#825) follow-up, measured on shadcn-svelte forms: the handler's
   * NAME and its LINE travel together. The old text-only leaf plus the
   * expression node's line split them across lines for multiline arrow
   * bodies. Same three rules as before (first call target, bare identifier,
   * dotted callable leaf), each now carrying its offset into the raw text.
   */
  private onHandlerCall(attr: Node): { name: string; line: number } | undefined {
    // The maintained grammar (v0.6.0, Svelte 5) wraps attribute expression
    // values as `attribute > expression > svelte_raw_text`; older grammars
    // used `expr_attribute_value > raw_text_expr`. Handle both shapes.
    // Pinned wasm shape: attribute > expression (older grammars used
    // expr_attribute_value — dead here per grammar audit).
    const value = this.findChildByType(attr, "expression")
    if (!value) return undefined
    // The svelte grammar exposes template expressions as an opaque
    // raw_text_expr/svelte_raw_text leaf — the handler text must be scanned
    // with pure-String ops (the documented fallback for constructs the
    // grammar can't express).
    let text = ""
    let baseLine = 0
    const stack: Node[] = [value]
    while (stack.length > 0) {
      const m = stack.pop()!
      if (m.type === "svelte_raw_text") {
        text = m.text
        baseLine = m.startPosition.row + 1
        break
      }
      for (let i = m.namedChildCount - 1; i >= 0; i--) {
        const c = m.namedChild(i)
        if (c) stack.push(c)
      }
    }
    if (!text) return undefined
    const at = (offset: number): number => baseLine + RealSvelteAnalyzer.linesBefore(text, offset)
    // 1. First FREE identifier immediately followed by `(` = call target
    //    (`() => bump()` → bump; `() => onSelect(title)` → onSelect).
    //    FREE = not a member call: an identifier preceded by `.` (which also
    //    covers `?.`) names a property of the receiver (`rest?.onclick()`,
    //    `deferred.shift()`, `console.log('…')`) — emitting it fabricated a
    //    calls edge to a name that may not even exist in scope (#898, all six
    //    arrow-body cases). Member-call targets stay unemitted: the receiver
    //    resolution is a different, not-yet-built lane.
    // 2. Else, if the whole text is a bare identifier → that identifier
    //    (`nextPage` → nextPage).
    // 3. Else (arrow params, property access, etc.) → nothing.
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]
      if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "$") {
        let end = i
        while (end < text.length) {
          const c = text[end]
          if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_" || c === "$") end++
          else break
        }
        const ident = text.slice(i, end)
        if (end < text.length && text[end] === "(") {
          let back = i - 1
          while (back >= 0 && (text[back] === " " || text[back] === "\t" || text[back] === "\n")) back--
          if (back < 0 || text[back] !== ".") return { name: ident, line: at(i) }
        }
        // not a call target — move past this identifier
        i = end
      }
    }
    // Bare-identifier check. A literal that merely LOOKS like an identifier is not a
    // handler name — see NON_CALLABLE_LITERALS, and the two corpus files that produced
    // `calls -> null` and `calls -> undefined` before this test existed.
    if (isIdentifier(text) && !NON_CALLABLE_LITERALS.has(text)) return { name: text, line: at(0) }
    // Dotted member leaf: `on:click={box.open}` binds the method reference -
    // the CALLABLE LEAF is the last segment. (Previously emitted nothing.)
    const parts = text.split(".")
    if (parts.length > 1 && parts.every((p) => isIdentifier(p))) {
      const leaf = parts[parts.length - 1]
      if (NON_CALLABLE_LITERALS.has(leaf)) return undefined
      return { name: leaf, line: at(text.lastIndexOf(leaf)) }
    }
    return undefined
  }

  /**
   * #419-D - evidence-tier classification for EVERY emitted relationship.
   * Same rules as the Vue/JVM family. Template RENDERS are
   * usage_contextual (component usage by tag name); the delegate's script `new`
   * `instantiates` rows keep their structural tier.
   */
  private classifyEvidenceTier(relationships: ASTEngine.UniversalRelationship[]): void {
    for (const r of relationships) {
      const md = r.metadata ?? (r.metadata = {})
      if (md.evidenceClass) continue
      const t = String(r.type ?? r.relationshipType ?? "")
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (t === "contains" || t === "exports") { md.evidenceClass = "structural"; continue }
      if (t === "references") {
        md.evidenceClass = md.isImport ? "import_based" : "reference_qualified"
        continue
      }
      if (t === "extends" || t === "implements" || t === "overrides") {
        md.evidenceClass = conf >= 1 ? "structural" : conf >= 0.85 ? "usage_contextual" : "inferred"
        continue
      }
      if (t === "instantiates") {
        md.evidenceClass = md.isComponentUsage ? "usage_contextual" : "structural"
        continue
      }
      md.evidenceClass = "usage_contextual"
    }
  }

  private findAncestor(node: Node, predicate: (n: Node) => boolean): Node | null {
    let current = node.parent
    while (current) {
      if (predicate(current)) return current
      current = current.parent
    }
    return null
  }

  private findDescendant(node: Node, predicate: (n: Node) => boolean): Node | null {
    const stack: Node[] = [node]
    while (stack.length > 0) {
      const n = stack.pop()!
      // KAD2 sweep: `n !== node` never matched fresh wrappers — but the
      // predicate keys on node TYPE while the root is a container, so no
      // false-positive ever materialized. Span-based exclusion keeps the
      // guard real for root nodes whose type could match.
      if (!(n.startIndex === node.startIndex && n.endIndex === node.endIndex) && predicate(n)) return n
      for (let i = n.namedChildCount - 1; i >= 0; i--) {
        const c = n.namedChild(i)
        if (c) stack.push(c)
      }
    }
    return null
  }

  private elementTagName(el: Node): string | undefined {
    return this.elementTagNameNode(el)?.text
  }

  /** The `tag_name` node itself — the node that SPELLS the tag (M59 #825: the
   *  Instantiates edge for a component usage is about that name, so its line
   *  must come from the tag, not from the element's opening bracket). */
  private elementTagNameNode(el: Node): Node | null {
    // element > start_tag/self_closing_tag > tag_name (for regular elements
    // the tag_name is nested inside the start_tag, not a direct child)
    const startTag = this.findChildByType(el, "start_tag") || this.findChildByType(el, "self_closing_tag")
    if (startTag) {
      const tag = this.findChildByType(startTag, "tag_name")
      if (tag) return tag
    }
    return this.findChildByType(el, "tag_name")
  }

  private attributeName(attr: Node): string {
    const name = this.findChildByType(attr, "attribute_name")
    return name ? name.text : ""
  }

  private offsetRange(
    range: ASTEngine.UniversalSymbol["range"],
    lineOffset: number,
    colOffset: number,
    indexOffset = 0,
  ): ASTEngine.UniversalSymbol["range"] {
    // H4: mirror the Vue offsetRange — endColumn shifts only when the range
    // never leaves the script's first line; indices shift when defined.
    const out = { ...range }
    const firstLine = out.startLine === 1
    out.startLine += lineOffset
    out.endLine += lineOffset
    if (firstLine && colOffset) {
      out.startColumn += colOffset
      if (out.endLine === out.startLine) out.endColumn += colOffset
    }
    if (indexOffset && out.startIndex !== undefined) out.startIndex += indexOffset
    if (indexOffset && out.endIndex !== undefined) out.endIndex += indexOffset
    return out
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      // Columns are 1-based everywhere else in the codebase (+1); this
      // analyzer silently emitted 0-based columns.
      startColumn: node.startPosition.column + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}
