// Author: Muhammad Ishaq Khan
// WHAT THIS FILE IS: the HTML analyzer — pure tree-sitter AST extraction over elements,
//   attributes, ids/IDREFs and inline handlers, plus the embedded <script>/<style> seam (the
//   "HTML Intelligence Engine" M60.LCM rewrite: single-pass, regex-free).
// RELATIONSHIP SURFACE: contains, references (the IDREF class is html's own), calls, uses,
//   imports, exports, instantiates, extends, overrides — `exports` is NOT html's own (see below).
// DOCS: docs/analyzers/html.md and docs/analyzers/real-html-analyzer.md.
// SPEC + FIXTURES: script/m14/spec/html-completeness.json · validation/m14/fixtures/html/.
// CO-EDIT LIST — edit these when this file changes: both docs above; the completeness spec's
//   handled/silent/gap/design_decision buckets AND its coverage block; every affected
//   expectation under validation/m14/fixtures/html/; script/m14/html-ruled.ts (the RULED table
//   the arbiter reads); the html seat in script/m14/differential.ts; and the lane instruments
//   script/m14/html-ontology-census.ts / html-origin-census.ts when a measured count moves.
// GRAMMAR: `tree-sitter-html` → wasm/tree-sitter-html.wasm (pin: validation/m14/grammar-pins.json);
//   the embedded-script seam is the ENGINE's polyglot path, not this grammar's.
// THE TWO TRUE-AT-ONCE STATEMENTS ABOUT `exports`: html emits the kind only THROUGH THE
//   EMBEDDED-SCRIPT DELEGATION (a `<script type="module">`'s export becomes a relationship on
//   the host document), so the contract row must name it; while three fixtures FORBID a
//   pure-HTML export. Both are right: different LAYERS of one result. Positive witness:
//   `embedded-module-export`; negative controls: `embedded-origin-marks` + the IDREF fixture.
// HTML Intelligence Engine
// M14 (#288) / M60.LCM rewrite: the web-family contract, pure-AST, fully
// regex-free, single-pass O(nodes + attribute bytes).
//
// WHY THIS FILE WAS REWRITTEN. html carried an M12 corpus claim, a regex-census
// row and a passing grammar audit, and NO fixture, NO mutant, NO differential
// oracle and NO completeness spec — every M14/M49/M60 cell read `n/a`, so no
// gate could ask the question. What the missing gates were hiding, measured on
// 139 real corpus documents (vue-core, element-plus, vue-element-admin,
// shadcn-svelte, sqlite, otp, phpmyadmin):
//
//   * 59.9% of emitted symbols carried a NAME THAT IS NOT UNIQUE IN THEIR OWN
//     FILE, and 28.8% carried whitespace, because the name was a whole
//     multi-token `class` value. `class="labeled-input"` on five elements
//     produced five symbols named `labeled-input`.
//   * attribute names were never lowercased while TAG names were, so
//     `<IMG SRC=…>`, `<LINK REL=stylesheet HREF=…>`, `<SCRIPT SRC=…>`,
//     `<A HREF=…>` and `<FORM ACTION=…>` produced ZERO symbols, ZERO
//     relationships and ZERO imports. 4.08% of corpus attributes are
//     non-lowercase; a document containing one lost its whole graph silently.
//   * 88.4% of corpus files carry an inline <script>/<style>; 112 blocks / 74,637
//     characters in the 51-file set produced ZERO symbols, because the engine's
//     polyglot path keys on `metadata.embeddedScriptContent`, which no analyzer
//     has ever set, and the SFC sub-parse seam is gated `vue || svelte`.
//   * eight resource-bearing carriers emitted nothing: <source srcset>,
//     <object data>, <embed src>, <track src>, <input type=image src>,
//     <base href>, SVG <use>/<image href>, and <iframe src>.
//   * every relationship carried NO `line_number` (0 of 505, and 0 of 25 after a
//     real `bb index` — the M59.O2 cell was NULL at the store).
//   * `accessibilityScore`/`semanticScore`/`performanceScore` were computed and
//     dropped by engine.ts, `architecturalInsights` was overwritten by
//     framework-intelligence with an empty array, and every clean file published
//     a hard-won architecturalScore of 100 / "excellent".
//   * a made-up framework name `Targeted/ID-Styling` was published for 88.5% of
//     corpus files (it is a CSS technique, not a framework), and the parse-error
//     walk was UNCAPPED while the engine's is capped at 50 — a 300-line broken
//     file published 350 warnings.
//
// THE RULINGS (each is a decision, not an accident, and each is pinned).
//
// HTML-IDENTITY. "Template elements/attributes/directives are NEVER symbols" is
//   the sentence real-vue-analyzer.ts:13 and real-svelte-analyzer.ts:14 already
//   publish. html IS a template language, so it inherits the rule — and adds the
//   one construct an SFC template does not have: a document-level ADDRESS SPACE.
//   An element becomes a symbol BECAUSE something can address it:
//     - `id` is the document's unique handle (getElementById);
//     - `name`, when there is no `id`, is the form/anchor handle
//       (getElementsByName) — and it is the target of `<label for>`;
//     - `class` is a SHARED STYLING HOOK, never an identity. N elements
//       legitimately carry it, which is exactly why it cannot name one. It stays
//       readable in `metadata.attributes`.
//   The DOCUMENT is the module symbol (name = file stem, `kind: module`), so the
//   containment tree has ONE root instead of N disconnected ones and a
//   document-level resource edge sources from a real, joinable symbol instead of
//   an unjoinable external string.
//
// DUPLICATE-IDENTITY. A duplicate `id` is invalid HTML. The FIRST in document
//   order keeps the plain name — that is what getElementById returns — and later
//   ones take a deterministic `#N` suffix (the rust RSD3 answer to 2,852
//   same-name symbol ids) carrying `metadata.duplicateId`, so no two symbols
//   share a name and the defect stays visible. In-document references resolve to
//   the first and carry `metadata.ambiguousTarget` when a second exists.
//
// SCOPE BARRIERS. `<template>` content is an inert fragment and `<slot>` content
//   is light-DOM fallback: neither is rendered where it is written, so neither
//   is a child of what encloses it in the source. Both are barriers — a named
//   element inside one is owned by the nearest addressable ancestor (the barrier
//   itself when it has an id) and carries `inTemplateFragment` / `isSlotFallback`
//   so a reader can tell a fragment from a live subtree. The pre-fix tree claimed
//   `template contains inner` for markup that never enters the document, and a
//   `<template id="x">` collided with its live-DOM twin as two identical symbols.
//
// RESOURCE MODEL. A table (`RESOURCE_RULES`), not a branch chain, so adding a
//   carrier is one row and the completeness census can enumerate it. An edge is
//   emitted only for something the document actually FETCHES or that is a real
//   in-project dependency. A hyperlink is not a code dependency: absolute URLs,
//   protocol-relative URLs and the `mailto:`/`tel:`/`javascript:`/`data:` schemes
//   produce NO edge and are counted as document metrics, because a page that
//   links to fifty external sites was publishing 237 `uses` edges into a graph
//   whose every edge is scored for architectural criticality. Relative
//   in-project navigation and form actions stay, as `usage_contextual`.
//
// SCHEME ORDER. Entity decoding runs BEFORE scheme detection, because
//   `&#106;avascript:` and `&#0000106;avascript:` are the same string to an HTML
//   parser as `javascript:` and a filter that ran first would miss them.
//
// EVIDENCE TIERS. contains / resolved in-document references = structural; a
//   fetched resource whose target is a project-relative module = import_based
//   (it is mirrored into brain_import, like every other lane's import); anything
//   observed rather than derived = usage_contextual. Three tiers, all inside the
//   Matrix 1d taxonomy.

import type { Node, Tree } from "web-tree-sitter"
import * as path from "path"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { ASTEngine } from "./engine"
// THE ROUTER'S OWN TABLE, imported rather than restated: which extensions this lane's admitted
// file list can contain is a fact about `language-detection.ts`, and a second copy of it here
// would be a second rule (the programme has paid for copied rules more than once).
import { EXTENSION_LANGUAGE } from "./language-detection"

const require = createRequire(import.meta.url)

// The three embedded-block delegates are loaded LAZILY and INDEPENDENTLY, and
// deliberately NOT as static imports. A static import makes a broken delegate a
// load-time failure of THIS module, so a compile error in the CSS analyzer — which
// is being rewritten in parallel, and was mid-rewrite with 5 build errors while
// this line was written — takes the html DOCUMENT surface down with it: the engine
// falls back to `2.0-basic-fallback` and the file yields zero symbols, zero
// relationships and zero imports. That is the worst possible coupling for a
// template language over a script language, and it is invisible until the moment
// a neighbour's work is half-done.
//
// Each delegate is therefore resolved inside `mergeEmbeddedBlocks` in its own
// try/catch, so an unavailable grammar costs exactly the blocks it would have
// served and the document's own elements, containment, resources, references and
// lines are untouched. The failure is DISCLOSED on the result (see
// `metadata.unavailableEmbeddedLangs`) rather than swallowed, because a silently
// missing block set reads as a document with no code in it — which is precisely
// the HTML-G1 defect this seam closed, reappearing through a different door.

// ============================================================================
// PURE-STRING HELPERS — no regular expression anywhere in this file, which the
// M12 regex census and the M49.R2 truth gate both enforce on the committed
// analyzer. Every scan below is an index loop, so each is O(len) with no
// backtracking and no intermediate regular-expression machinery.
// ============================================================================

/** The five ASCII characters HTML treats as whitespace. */
function isHtmlSpace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 12
}

/**
 * ASCII lowercasing without locale surprises.
 *
 * The suffix is what gets lowercased — `slice(0, i)` alone lowercases the
 * characters BEFORE the first capital, which for `i === 0` is the empty string,
 * so this function was the IDENTITY on every string that contained a capital at
 * all. It looked correct because every corpus file it had ever run against was
 * already lowercase, where identity and lowercase agree. Two call sites depend on
 * it and both silently did nothing: the TAG name (`RESOURCE_RULES["LINK"]` is
 * undefined, so an uppercase `<LINK href>` emitted no edge) and the ATTRIBUTE
 * name (`attrs["ID"]`, so `<DIV ID="mixed">` was not addressable). The lowercase
 * inputs that make the corpus look clean are exactly the inputs that hide it.
 *
 * Lowercasing the suffix is correct and idempotent: the characters before `i` are
 * already non-capital by the loop's own exit condition.
 */
function asciiLower(text: string): string {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 65 && c <= 90) return text.slice(0, i) + text.slice(i).toLowerCase()
  }
  return text
}

/**
 * Character-reference decoding (pure-String).
 *
 * The grammar hands us the RAW attribute text, so `href="/a.css?x=1&amp;y=2"`
 * arrives with the reference undecoded and the stored module name is wrong.
 * Bounded single pass: the `&` is located by `indexOf` (no scan of the gaps), the
 * terminating `;` is bounded at 33 characters because the HTML spec caps a named
 * reference there, and an unrecognised or malformed reference is copied through
 * VERBATIM rather than dropped — a document that writes `&notarealentity;` must
 * still yield that text as its URL.
 */
const NAMED_CHARACTER_REFERENCES = new Map<string, string>([
  ["amp", "&"], ["AMP", "&"], ["lt", "<"], ["LT", "<"], ["gt", ">"], ["GT", ">"],
  ["quot", '"'], ["QUOT", '"'], ["apos", "'"], ["nbsp", " "],
  ["copy", "©"], ["reg", "®"], ["trade", "™"], ["hellip", "…"],
  ["mdash", "—"], ["ndash", "–"], ["lsquo", "‘"], ["rsquo", "’"],
  ["ldquo", "“"], ["rdquo", "”"], ["bull", "•"], ["middot", "·"],
  ["deg", "°"], ["plusmn", "±"], ["times", "×"], ["divide", "÷"],
  ["laquo", "«"], ["raquo", "»"], ["sect", "§"], ["para", "¶"],
  ["euro", "€"], ["pound", "£"], ["yen", "¥"], ["cent", "¢"],
  ["dagger", "†"], ["Dagger", "‡"], ["permil", "‰"], ["larr", "←"],
  ["rarr", "→"], ["harr", "↔"], ["darr", "↓"], ["uarr", "↑"],
])

function isReferenceDigits(text: string, hex: boolean): boolean {
  if (text.length === 0) return false
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c >= 48 && c <= 57) continue
    if (hex && ((c >= 97 && c <= 102) || (c >= 65 && c <= 70))) continue
    return false
  }
  return true
}

function decodeCharacterReferences(text: string): string {
  if (text.indexOf("&") === -1) return text // fast path: no '&', no allocation
  let out = ""
  let i = 0
  while (i < text.length) {
    const amp = text.indexOf("&", i)
    if (amp === -1) {
      out += text.slice(i)
      break
    }
    out += text.slice(i, amp)
    const semi = text.indexOf(";", amp + 1)
    // A named reference is at most 32 characters; anything longer is prose, not
    // a reference, and copying '&' alone keeps the rest of the value intact.
    if (semi === -1 || semi - amp > 33) {
      out += "&"
      i = amp + 1
      continue
    }
    const body = text.slice(amp + 1, semi)
    if (body.length === 0) {
      out += "&"
      i = amp + 1
      continue
    }
    if (body.charCodeAt(0) === 35 /* # */) {
      const hex = body.charCodeAt(1) === 120 /* x */ || body.charCodeAt(1) === 88 /* X */ ||
        (body.charCodeAt(1) === 35 && (body.charCodeAt(2) === 120 || body.charCodeAt(2) === 88))
      const digits = hex
        ? (body.charCodeAt(1) === 35 ? body.slice(3) : body.slice(2))
        : body.slice(1)
      if (digits.length > 0 && digits.length <= 8 && isReferenceDigits(digits, hex)) {
        const code = hex ? Number.parseInt(digits, 16) : Number.parseInt(digits, 10)
        if (code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
          out += String.fromCodePoint(code)
          i = semi + 1
          continue
        }
      }
      out += "&"
      i = amp + 1
      continue
    }
    const named = NAMED_CHARACTER_REFERENCES.get(body)
    if (named !== undefined) {
      out += named
      i = semi + 1
      continue
    }
    out += "&"
    i = amp + 1
  }
  return out
}

/** Strip one layer of matching quotes (pure-String; the grammar's own
 *  `attribute_value` child is already unquoted, so this is the empty-value
 *  fallback and the rare unquoted-value path). */
function unquote(text: string): string {
  const n = text.length
  if (n >= 2) {
    const first = text.charCodeAt(0)
    const last = text.charCodeAt(n - 1)
    if ((first === 34 || first === 39) && first === last) return text.slice(1, -1)
  }
  return text
}

/**
 * The scheme of a URL, lowercased, or "" when there is none (pure-String).
 * RFC 3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ) ":". A relative path has
 * no scheme, which is exactly the distinction the resource model needs.
 */
function urlScheme(value: string): string {
  const n = value.length
  for (let i = 0; i < n; i++) {
    const c = value.charCodeAt(i)
    if (c === 58 /* : */) {
      if (i === 0) return ""
      const f = value.charCodeAt(0)
      const alpha = (f >= 65 && f <= 90) || (f >= 97 && f <= 122)
      return alpha ? asciiLower(value.slice(0, i)) : ""
    }
    const alpha = (c >= 65 && c <= 90) || (c >= 97 && c <= 122)
    const digit = c >= 48 && c <= 57
    if (!alpha && !digit && c !== 43 /* + */ && c !== 45 /* - */ && c !== 46 /* . */) return ""
  }
  return ""
}

/** A scheme that is a resource *fetcher* — `https:` IS a fetch, `mailto:` is not. */
function isNetworkScheme(value: string): boolean {
  const s = urlScheme(value)
  return s === "http" || s === "https" || s === "ftp" || s === "ftps"
}

/** `mailto:`, `tel:`, `javascript:`, `data:`, `blob:`, `about:`, `file:` … —
 *  a non-network scheme names no fetchable project resource. */
function isNonResourceScheme(value: string): boolean {
  const s = urlScheme(value)
  if (s === "") return false
  return !isNetworkScheme(value)
}

/** Protocol-relative `//host/path` — a network URL written without a scheme. */
function isProtocolRelative(value: string): boolean {
  return value.length >= 2 && value.charCodeAt(0) === 47 && value.charCodeAt(1) === 47
}

/** A same-document fragment reference (`#id`). */
function fragmentTarget(value: string): string {
  return value.length > 1 && value.charCodeAt(0) === 35 /* # */ ? value.slice(1) : ""
}

/**
 * `srcset` candidate URLs — the WHATWG shape, by index, O(len) once.
 *
 * The pre-fix scanner was "skip spaces and commas, take the first whitespace-
 * delimited token", which cannot tell a candidate from a descriptor: it split
 * `a.png 1x, b.png 2x` correctly only by accident, mis-handled a URL that
 * itself contains a comma, and silently dropped a trailing candidate that
 * carried no descriptor. This walks the real algorithm: skip leading whitespace
 * and commas, read the URL to the next whitespace, then read descriptors to the
 * next top-level comma (parentheses nest, so `image-set()` survives).
 */
function srcsetCandidates(value: string): string[] {
  const out: string[] = []
  const n = value.length
  let i = 0
  while (i < n) {
    while (i < n && (isHtmlSpace(value.charCodeAt(i)) || value.charCodeAt(i) === 44 /* , */)) i++
    if (i >= n) break
    const urlStart = i
    while (i < n && !isHtmlSpace(value.charCodeAt(i))) i++
    const url = value.slice(urlStart, i)
    // A URL that ends in a comma carries no descriptor (the commas are stripped).
    let trimmed = url
    while (trimmed.length > 0 && trimmed.charCodeAt(trimmed.length - 1) === 44) {
      trimmed = trimmed.slice(0, -1)
      i++
    }
    if (trimmed.length > 0) out.push(trimmed)
    // Descriptors run to the next top-level comma.
    let depth = 0
    while (i < n) {
      const c = value.charCodeAt(i)
      if (c === 40 /* ( */) depth++
      else if (c === 41 /* ) */ && depth > 0) depth--
      else if (c === 44 && depth === 0) {
        i++
        break
      }
      i++
    }
  }
  return out
}

/** First whitespace-delimited token — `sizes`/media-query attribute readers. */
function firstToken(text: string): string {
  const n = text.length
  let start = 0
  while (start < n && isHtmlSpace(text.charCodeAt(start))) start++
  if (start >= n) return ""
  let end = start
  while (end < n && !isHtmlSpace(text.charCodeAt(end))) end++
  return text.slice(start, end)
}

// ============================================================================
// LOOKUP TABLES AND MAPS — every one on a NULL prototype.
// ============================================================================
//
// WHY. Every vocabulary below is keyed by a string THE DOCUMENT SUPPLIES: a tag
// name, a `<link rel>` token, a `<param name>`, an attribute name, an `id`. On a
// plain object literal such a lookup answers `Object.prototype.<key>` for any key
// the table does not declare, and the caller cannot tell that from a real entry.
// A tag name is an arbitrary author-chosen string, so this is a reachable input,
// not a malformed one.
//
// MEASURED, on this lane's own corpus (1,185 git-tracked html documents across 24
// repositories, `validation/m14/probes/html/construct-probe.mts` §4):
//
//   1 document, 4 elements — `RESOURCE_RULES["constructor"]` is the `Object`
//   FUNCTION, so `rules.length` is 1 (its arity), `rules[0]` is `undefined`, and
//   the loop dereferences `undefined.attr`. The file is
//   `csharp-sample/extensions/copilot/src/platform/parser/test/node/fixtures/chatSetup.ts.getStructure.html`
//   — a TypeScript code-dump fixture with `<CONSTRUCTOR>` at line 174 — and it is
//   88,229 bytes. Production `parseFile` reports
//   `analyzer timeout, returning basic parse result … "undefined is not an object
//   (evaluating 'rule.attr')"` and the document publishes ZERO symbols, ZERO
//   relationships and no metadata at all, while every other document over 4 KiB in
//   the same draw publishes both. One file, and the whole document is gone.
//
//   The truthiness tables fail the same way WITHOUT throwing, which is why they
//   are fixed here too and not only the one site that crashes: `SEMANTIC_ELEMENTS
//   ["tostring"]`, `INTERACTIVE_ELEMENTS["tostring"]` and `FORM_ELEMENTS["valueof"]`
//   are all truthy, so `<tostring>` counts as a landmark, an interactive control
//   AND a form element — three wrong facts and a wrong `semanticScore`, published
//   without an error anywhere.
//
// The handle maps need it for a second reason: `obj["__proto__"] = v` on a plain
// object writes the PROTOTYPE rather than a key, so `<div id="__proto__">` made
// `handleToSymbol["__proto__"]` answer `Object.prototype` instead of `undefined`
// and started the duplicate-suffix walk from `Object.prototype`. Measured: 0
// occurrences of an `id`/`name` handle that is an inherited member across 1,185
// documents — recorded as NOT-YET-REACHED rather than as absent, because the
// corpus is not the input space and a tag name is author-chosen.
/** A lookup table with no prototype, so an undeclared key answers `undefined`
 *  instead of `Object.prototype[key]`. */
function table<V>(entries: Record<string, V>): Record<string, V> {
  return Object.assign(Object.create(null) as Record<string, V>, entries)
}

/** A per-call map keyed by a document-supplied string. Same reason as `table`. */
function map<V>(): Record<string, V> {
  return Object.create(null) as Record<string, V>
}

// ============================================================================
// ELEMENT VOCABULARIES
// ============================================================================

const SEMANTIC_ELEMENTS: Record<string, boolean> = table<boolean>({
  "header": true, "nav": true, "main": true, "section": true, "article": true,
  "aside": true, "footer": true, "h1": true, "h2": true, "h3": true, "h4": true,
  "h5": true, "h6": true, "figure": true, "figcaption": true, "time": true,
  "data": true, "mark": true, "details": true, "summary": true, "dialog": true,
  "meter": true, "progress": true, "search": true, "address": true, "hgroup": true,
})

const INTERACTIVE_ELEMENTS: Record<string, boolean> = table<boolean>({
  "button": true, "input": true, "select": true, "textarea": true, "a": true,
  "details": true, "summary": true, "dialog": true, "menu": true, "option": true,
  "optgroup": true, "label": true, "fieldset": true, "output": true, "area": true,
})

const FORM_ELEMENTS: Record<string, boolean> = table<boolean>({
  "form": true, "input": true, "select": true, "textarea": true, "button": true,
  "fieldset": true, "legend": true, "label": true, "datalist": true,
  "optgroup": true, "option": true, "output": true, "meter": true, "progress": true,
})

/** Elements whose content is NOT rendered where it is written (scope barriers). */
const TEMPLATE_BARRIERS: Record<string, boolean> = table<boolean>({ "template": true, "slot": true })

/** `<link rel>` values that fetch a real subresource. `preconnect` and
 *  `dns-prefetch` name a HOST for a connection warm-up, not a document — the
 *  pre-fix analyzer mirrored both into `imports`, so `bb` claimed a dependency on
 *  `/f.ico`-style hints that nothing serves. */
const LINK_FETCHABLE_RELS: Record<string, boolean> = table<boolean>({
  "stylesheet": true, "icon": true, "shortcut icon": true, "apple-touch-icon": true,
  "apple-touch-icon-precomposed": true, "mask-icon": true, "manifest": true,
  "preload": true, "prefetch": true, "preload-stylesheet": true, "modulepreload": true,
  "import": true, "subresource": true, "alternate": true, "canonical": true,
})

/** The `resourceType` a fetchable `<link rel>` is recorded under, so an edge
 *  says WHAT it loads rather than only that a link exists. */
const LINK_RESOURCE_TYPES: Record<string, string> = table<string>({
  "stylesheet": "stylesheet",
  "icon": "icon",
  "shortcut icon": "icon",
  "apple-touch-icon": "icon",
  "apple-touch-icon-precomposed": "icon",
  "mask-icon": "icon",
  "manifest": "manifest",
  "preload": "preload",
  "modulepreload": "preload",
  "prefetch": "prefetch",
  "import": "import",
  "alternate": "alternate",
  "canonical": "canonical",
})

/** `<param name>` values that make the param's `value` a real resource. */
const PARAM_RESOURCE_NAMES: Record<string, boolean> = table<boolean>({
  "movie": true, "src": true, "url": true, "codebase": true, "archive": true,
})

/** Directives that make a template CONDITIONAL — html's decision points, and
 *  therefore the honest basis for a cyclomatic number that is not a constant. */
const CONDITIONAL_DIRECTIVE_SUFFIXES: readonly string[] = ["if", "else", "elseif", "when", "unless", "show", "test"]
const REPEAT_DIRECTIVE_SUFFIXES: readonly string[] = ["for", "each", "repeat"]

// ============================================================================
// RESOURCE RULE TABLE
//
// One row per (tag, attribute) pair that can name a fetchable project resource.
// The pre-fix analyzer was an `if/else if` chain over tag names, which is why
// eight carriers were invisible: a carrier nobody thought of in the chain simply
// did not exist. A table can be ENUMERATED — by a reader, by the F6 dead-literal
// check, by the F8 census — and adding a carrier is one row.
//
//   attr        the attribute carrying the URL
//   type        the `resourceType` recorded on the edge
//   candidates  "srcset" when the attribute holds a candidate list, not one URL
//   import      mirror the target into brain_import (a module dependency)
//   link        the edge is a hyperlink/endpoint, not a fetch
// ============================================================================

interface ResourceRule {
  attr: string
  resourceType: string
  /** The attribute holds a CANDIDATE LIST (`srcset`), not one URL. */
  candidates?: "srcset"
  /** Mirror the target into brain_import — a module dependency. */
  import?: boolean
  /** The target is a hyperlink/endpoint, not a fetch. */
  link?: boolean
  /** …and specifically a NAVIGATION (`<a href>`, `<area href>`), as opposed to a
   *  form endpoint. Both are `link`, but only one is a navigation, and the flag
   *  is what a consumer reads to tell "the user can click away" from "this posts
   *  data to a backend". */
  navigation?: boolean
  /** A fragment here is a REFERENCE into the document's own address space, so
   *  it is resolved after the walk against `id`/`name` — the same deferred
   *  resolution `<label for>` uses. Without this a `<a href="#orders">` was
   *  emitted as an edge to the literal text `#orders`, which resolves to no
   *  symbol and to no file. */
  fragmentRef?: boolean
  /** `rel` decides whether an href is a document the page fetches or a bare
   *  connection hint, and which resourceType it is. */
  relFilter?: Record<string, boolean>
  /** `param name` decides whether the param's value is a resource at all. */
  paramNameFilter?: Record<string, boolean>
  /** The rule applies only when the element's OWN `http-equiv` equals this,
   *  case-folded. `<meta content>` is a URL only for `http-equiv=refresh`; for
   *  every other pragma the content is free text (`charset`, `description`, a
   *  viewport string) and treating it as a URL would manufacture an edge to a
   *  sentence. The gate runs before any emission, exactly like `relFilter`. */
  httpEquiv?: string
  /** The attribute holds a CONTENT string with a URL inside it rather than a
   *  bare URL, as `<meta http-equiv=refresh content="0; url=/next">` does. */
  contentUrl?: boolean
  /** The attribute holds a whitespace-separated list of URLs (`<a ping>`), as
   *  opposed to one URL or a `srcset` candidate list. */
  valueList?: "space"
  /** Overrides the evidence tier for a rule whose default would misdescribe it.
   *  A `cite` is a written reference, not a written-down fetch, so it must not
   *  inherit `import_based` — the tier classifier in every gated lane reads that
   *  field, and a citation graded as a structural import overstates it. */
  evidenceClass?: string
}

/**
 * `<a ping>` is a SPACE-separated list of URLs the browser fetches when the
 * hyperlink is activated — several per attribute, with no descriptor and no
 * comma, which is what separates it from `srcset` (comma-separated, each with a
 * descriptor). The pre-fix analyzer had no rule for it, so a page that pings an
 * analytics endpoint published no edge at all: the fetch is real, it happens on
 * click, and it is invisible. Handled in the same table-driven path as every
 * other carrier rather than as a special case, so it inherits the scheme
 * contract, the owner attribution and the `import` mirror for free.
 */
function spaceSeparatedUrls(value: string): string[] {
  const out: string[] = []
  let start = 0
  for (let i = 0; i <= value.length; i++) {
    if (i !== value.length && !isHtmlSpace(value.charCodeAt(i))) continue
    if (i > start) out.push(value.slice(start, i))
    start = i + 1
  }
  return out
}

/**
 * `<meta http-equiv="refresh" content="0; url=/next">` — the refresh PRAGMA,
 * which makes the browser navigate. Per the HTML standard the content is a
 * time interval, an optional `;`, and then `url=` followed by the destination;
 * a bare interval with no `url=` reloads the SAME document, which names nothing
 * new and so yields "".
 *
 * This is a NAVIGATION, not a fetch, and it is the same class as a form action:
 * the browser performs it, the code under analysis does not, so it is a
 * dependency and never a `calls` edge. It was entirely absent from the carrier
 * table, and a census of one corpus found 26 real files and 40 occurrences of
 * it — the single largest unhandled carrier by live weight, and invisible to the
 * differential because the oracle shares the table.
 *
 * Parsed in pure String, with no regex: find the first `;`, require the
 * remainder to begin `url=` after a case-fold, and strip one layer of quotes
 * because the whole value is a quoted attribute and authors write the inner URL
 * quoted as well as the attribute.
 */
function refreshContentUrl(content: string): string {
  // The caller passes the DECODED content, so everything here operates on the
  // form the target will actually have. An earlier version parsed the raw text
  // and stripped quotes from the raw slice using the decoded form's quote
  // POSITIONS, which is unsound: `&quot;` is six characters of source and one of
  // value, so slicing the raw string by the decoded offsets cut `&quot;` down to
  // `quot;` and published that as a path. The decode is not a length-preserving
  // transform and must never be used to index another representation.
  const semi = content.indexOf(";")
  if (semi === -1) return "" // a bare interval reloads this document: nothing to name
  if (!asciiLower(content.slice(semi + 1).trim()).startsWith("url=")) return ""
  const inner = content.slice(semi + 1).trim().slice(4).trim()
  if (inner.length < 2) return inner
  const first = inner[0]
  const last = inner[inner.length - 1]
  // Authors write the inner URL quoted inside the attribute, and the quotes are
  // frequently entities — `content="0; url=&quot;/next&quot;"`, which arrives here
  // already decoded. Leaving them on published an edge to `"/next"`: a path that
  // resolves to no file, which is the unresolvable-identity class wearing a URL's
  // clothes.
  if ((first === '"' || first === "'") && first === last) return inner.slice(1, -1).trim()
  return inner
}

const RESOURCE_RULES: Record<string, ResourceRule[]> = table<ResourceRule[]>({
  script: [
    { attr: "src", resourceType: "script", import: true },
    // SVG2 spells a script's source `href`, not `src`. Inside `<svg>` that is the
    // ONLY spelling there is, so a table with `src` alone dropped every inline SVG
    // script's dependency. The row is keyed on the tag, not the namespace, which
    // is safe because an HTML `<script>` has no `href` to read — the lookup finds
    // no attribute and emits nothing, rather than needing a namespace test the
    // table has no way to express.
    { attr: "href", resourceType: "svg-script", import: true },
  ],
  link: [
    // `rel` decides both WHETHER the href is a document the page fetches and
    // WHICH kind it is: `rel=stylesheet` is a stylesheet, `rel=icon` an icon,
    // and `rel=preconnect`/`dns-prefetch` name a host for a connection warm-up
    // rather than a subresource — the pre-fix analyzer mirrored those into
    // `imports`, so the index claimed a dependency on a URL nothing serves.
    { attr: "href", resourceType: "link", import: true, relFilter: LINK_FETCHABLE_RELS },
  ],
  img: [
    { attr: "src", resourceType: "img", import: true },
    { attr: "srcset", resourceType: "img-srcset", candidates: "srcset", import: true },
    { attr: "longdesc", resourceType: "img-longdesc", import: true },
  ],
  // `<source>` carries BOTH a single `src` and a `srcset` candidate list, and
  // the pre-fix analyzer read only `src` and only when the IMMEDIATE parent was
  // picture/audio/video — so `<video><div><source src=…></div></video>` lost the
  // resource. A candidate's own `media` attribute is the context test, and the
  // ancestor test is now a bounded walk (see `isMediaContext`).
  source: [
    { attr: "src", resourceType: "media-source", import: true },
    { attr: "srcset", resourceType: "img-srcset", candidates: "srcset", import: true },
  ],
  video: [
    { attr: "src", resourceType: "video", import: true },
    { attr: "poster", resourceType: "video-poster", import: true },
  ],
  audio: [{ attr: "src", resourceType: "audio", import: true }],
  track: [{ attr: "src", resourceType: "track", import: true }],
  embed: [{ attr: "src", resourceType: "embed", import: true }],
  // `<object data>` names the resource itself; `<object archive>` names the
  // ADDITIONAL resources needed to instantiate it, and the HTML specification
  // defines it as a SPACE-separated list of URIs — the same shape as `<a ping>`
  // and for the same reason (several per attribute, no descriptor, no comma).
  //
  // It was missing, and the carrier census found it rather than the ontology gate:
  // `script/m14/verify-carrier-census.ts` reports `object@archive` as UNREVIEWED at
  // 4 occurrences in 2 documents, and a carrier nobody has ruled is a carrier
  // nobody has decided about. Measured on the tree over 1,699 corpus documents
  // (aspnetcore/src/Mvc/test/Mvc.FunctionalTests/compiler/resources/
  // RazorWebSite.UrlResolution.Index.html and its .Encoded.html twin):
  //
  //   object@archive   4 occurrences, 2 files   — 3 real URLs, 1 Razor artifact
  //
  // That is a small population and the verdict does not pretend otherwise; the
  // construct is real, it occurs, and the rule for it is one table row. It is a
  // FETCH like `data`, so it takes the same shape and the same `import` mirror.
  object: [
    { attr: "data", resourceType: "object", import: true },
    { attr: "archive", resourceType: "object-archive", import: true, valueList: "space" },
  ],
  input: [{ attr: "src", resourceType: "input-image", import: true }],
  iframe: [{ attr: "src", resourceType: "iframe", import: true }],
  frame: [{ attr: "src", resourceType: "frame", import: true }],
  // SVG reference carriers. `xlink:href` is the legacy spelling; both are read
  // and the attribute map is already lowercased, so `XLINK:HREF` lands here too.
  use: [
    // `href="#icon"` is the ordinary SVG form and is a same-document reference;
    // `href="sprite.svg#icon"` is an external file and a fetch. Both spellings of
    // the attribute are read, and the attribute map is lowercased, so the legacy
    // `XLINK:HREF` lands on the same rule.
    { attr: "href", resourceType: "svg-use", import: true, fragmentRef: true },
    { attr: "xlink:href", resourceType: "svg-use", import: true, fragmentRef: true },
  ],
  image: [
    { attr: "href", resourceType: "svg-image", import: true, fragmentRef: true },
    { attr: "xlink:href", resourceType: "svg-image", import: true, fragmentRef: true },
  ],
  param: [{ attr: "value", resourceType: "param", import: true, paramNameFilter: PARAM_RESOURCE_NAMES }],
  a: [
    { attr: "href", resourceType: "navigation", link: true, navigation: true, fragmentRef: true },
    // `ping` is a whitespace-separated list of URLs FETCHED when the link is
    // activated. It is a fetch, not a navigation — the browser requests it; the
    // user never goes there — so it takes the resource path and the `import`
    // mirror, and the scheme contract filters an external endpoint.
    { attr: "ping", resourceType: "ping", import: true, valueList: "space" },
  ],
  area: [{ attr: "href", resourceType: "navigation", link: true, navigation: true, fragmentRef: true }],
  form: [{ attr: "action", resourceType: "form-action", link: true }],
  button: [{ attr: "formaction", resourceType: "form-action", link: true }],
  html: [{ attr: "manifest", resourceType: "manifest", import: true }],
  meta: [
    // The refresh PRAGMA. `content` is a URL only under `http-equiv=refresh`,
    // and the gate is what keeps `charset`/`description`/viewport text from
    // becoming an edge to a sentence. 40 occurrences across 26 files in one
    // corpus, and entirely absent from the table until a carrier census looked
    // for it rather than for what the table already knew.
    { attr: "content", resourceType: "meta-refresh", link: true, navigation: true, httpEquiv: "refresh", contentUrl: true },
  ],
  // SVG filter reference. `feImage` pulls an image to paint INTO the filter
  // result, which is a fetch like any other; the tag is lowercased by the
  // walker, so the key is `feimage`.
  feimage: [
    { attr: "href", resourceType: "svg-filter-image", import: true },
    { attr: "xlink:href", resourceType: "svg-filter-image", import: true },
  ],
  // `cite` names where a quotation or a change came FROM. Nothing fetches it and
  // nothing navigates to it, but it IS a written reference out of the document,
  // so it is an edge — recorded as a usage-contextual reference rather than as
  // an import, because grading a citation as a structural fetch overstates it.
  // Four elements carry it, and all four are in the table rather than one, since
  // the ruling is about the attribute's meaning and not about any single tag.
  q: [{ attr: "cite", resourceType: "citation", fragmentRef: true, evidenceClass: "usage_contextual" }],
  blockquote: [{ attr: "cite", resourceType: "citation", fragmentRef: true, evidenceClass: "usage_contextual" }],
  del: [{ attr: "cite", resourceType: "citation", fragmentRef: true, evidenceClass: "usage_contextual" }],
  ins: [{ attr: "cite", resourceType: "citation", fragmentRef: true, evidenceClass: "usage_contextual" }],
  // Legacy presentational background images. Deprecated in HTML5 and still
  // fetched by every shipping browser, so the dependency is real; the
  // `legacy-` resourceType says so at the edge, which is the difference between
  // a recorded fact and an implied one.
  body: [{ attr: "background", resourceType: "legacy-background", import: true }],
  table: [{ attr: "background", resourceType: "legacy-background", import: true }],
})

/** `<input type=submit|image formaction=…>` is a form endpoint, and `type` decides
 *  which of the four `formaction` owners this is — so the rule is keyed on it. */
const FORM_ACTION_INPUT_TYPES: Record<string, boolean> = table<boolean>({ submit: true, image: true })

/** The `formaction` rule for a submit/image `<input>`, as a table row so the
 *  emission path is identical to every other carrier (one code path, not two). */
const INPUT_FORMACTION_RULE: ResourceRule = { attr: "formaction", resourceType: "form-action", link: true }

/**
 * THE DOCUMENT EXTENSIONS THIS LANE'S ADMITTED FILE LIST CAN CONTAIN — derived from the router,
 * never listed here. `EXTENSION_LANGUAGE` maps `html`, `htm`, `xhtml`, `hbs`, `twig`, `pug`,
 * `erb`, `mustache`, `ejs`, `liquid`, `njk`, `jinja`, `j2` to this language; a file claim is a
 * statement about a file the project ADMITS, so it may only be published for a spelling the
 * router itself routes here. A single extension listed by hand would be a second copy of the
 * routing rule and would age independently of it.
 */
const HTML_DOCUMENT_EXTS: ReadonlySet<string> = new Set(
  Object.keys(EXTENSION_LANGUAGE).filter((ext) => EXTENSION_LANGUAGE[ext] === "html"),
)

/** The extension of a resource target, query and fragment stripped (`x/y.css?v=1#a` -> `css`). */
function resourceExtension(value: string): string {
  const clean = value.split("#")[0].split("?")[0]
  const base = clean.slice(clean.lastIndexOf("/") + 1)
  const dot = base.lastIndexOf(".")
  return dot <= 0 ? "" : base.slice(dot + 1).toLowerCase()
}

/**
 * THE PROJECT-RELATIVE FILE A RESOURCE TARGET NAMES — the qualifier this analyzer computed
 * NOWHERE, and which the incoming gate could not answer without.
 *
 * WHY THIS FUNCTION EXISTS. The lane emitted the attribute string verbatim, so a hyperlink
 * written `../index.html` inside `docs/api/x/index.html` reached the graph as the four-character
 * *relative* spelling `../index.html` — a string no declaration and no admitted file can ever
 * answer. MEASURED on the lane's own bounded population (400 of 6,780 admitted `.html` files,
 * `bun run script/m14/incoming-gate.ts html html 400`): **22,260 navigation links and 3,785
 * resource fetches unresolved, 25,041 of the 32,656 residual path-shaped.** The document's own
 * directory is arithmetic, not a corpus lookup, and it was already in hand: `analyze` receives
 * `filePath`, and the arbiter supplies `context.projectRoot` (`incoming-gate.ts:918`) — the same
 * root the project's admitted file list is keyed on.
 *
 * WHAT IT IS NOT. It does not rewrite the edge's `target`: the written spelling stays the target,
 * because that is what the document SAYS and because retargeting a path into a basename stem is
 * the one move this lane was warned off — it mass-moves edges from `unresolved` into `collRes`,
 * where the indexer measures ~75 % of tie-break picks as wrong. This returns a CANDIDATE for a
 * claim, and the claim is verified by the project, never by this analyzer.
 *
 * `null` means "no candidate can be stated": an empty path, the project root itself, or a target
 * that escapes the project (`../../..`, which no admitted file can be).
 */
function rebaseToProject(documentPath: string, projectRoot: string, value: string): string | null {
  const written = value.split("#")[0].split("?")[0]
  if (written.length === 0) return null
  // A root-relative path is rooted at the PROJECT, which is the only root this analyzer knows;
  // anything else is relative to the document that wrote it.
  const abs = written.startsWith("/")
    ? path.resolve(projectRoot, written.slice(1))
    : path.resolve(path.dirname(documentPath), written)
  const rel = path.relative(projectRoot, abs)
  if (rel.length === 0) return null
  const posix = rel.split(path.sep).join("/")
  if (posix.startsWith("..") || path.posix.isAbsolute(posix)) return null
  return posix
}

/**
 * THE IDREF CLASS — attributes whose HTML content model is a space-separated list
 * of element IDs, and which are therefore REFERENCES into the document's own
 * address space rather than resources, navigations or controls.
 *
 * WHY THIS TABLE IS NEW, and why it is a third answer rather than a variant of
 * the resource table. `RESOURCE_RULES` covers attributes that name a DOCUMENT:
 * something the browser fetches, or navigates to, or posts to. These name an
 * ELEMENT: the browser resolves each token through `getElementById` and, when it
 * resolves, wires one element's accessible name/description, the control it
 * belongs to, or its table header scope to another element in the same document.
 * That is a reference in the sense the graph means everywhere else — css's
 * `references` is a `var()` read of a name in scope, scss's is a `$var` read,
 * rust's and typescript's are type references — and it is emphatically not a
 * fetch, so `uses`/`import_based` would misdescribe it.
 *
 * MEASURED before it was written, because the ruling is only reachable with a
 * number (`validation/m14/probes/html/construct-probe.mts` §1, over the same
 * 1,185 git-tracked documents / 24 repositories): 19 sites carrying 19 ID
 * tokens, of which **17 resolve** to an element in the same document. Three
 * carriers carry every one — `aria-labelledby` 6, `aria-describedby` 6,
 * `aria-controls` 4 — plus `list` (2 sites, 1 resolving) and `form`
 * (1 site, 0 resolving). Eight further attributes in the class occur ZERO times
 * (`aria-details`, `aria-errormessage`, `aria-owns`, `aria-flowto`,
 * `td@headers`, `th@headers`, `img@ismap`), which is why the whole class is
 * declared here rather than the three that happen to fire: a census that only
 * records today's hits is how a carrier goes missing for a whole wave, which is
 * the shape of the `overrides` defect the ontology gate exists to catch.
 *
 * 17 edges over 1,185 documents is a small class and it is published as one. A
 * probe finding a non-zero count is what makes the ruling testable, and this one
 * was non-zero, so it is not a ruling.
 *
 * `aria-controls` and `aria-owns` are excluded from that table's `tag`-scoped
 * rows on purpose: they are wildcard, like `aria-labelledby`, and are declared as
 * such below rather than being enumerated per host element — the HTML content
 * model does not restrict them to one host and a table that pretended it did
 * would be a table that goes stale the moment an author uses a newer host.
 *
 * NOT INCLUDED: `slot="name"`. It is a real assignment — to a `<slot name>` in a
 * shadow root — and it is deliberately not read, for two measured reasons. The
 * `slot` element's `name` is not one of this document's identity attributes, so
 * there is no symbol to resolve it to; and the target lives in another tree
 * (the shadow root), so an edge would cross a document boundary to a node that is
 * not in the graph. Recording it would be a placeholder endpoint in exactly the
 * shape R7 forbids. It is listed here so the omission is a decision on the page
 * rather than a hole in it.
 */
interface IdrefRule {
  attr: string
  /** `""` = any element, as the HTML content model states for the aria-* class. */
  tag: string
  /** The `kind` recorded on the deferred reference, so the edge says WHICH
   *  association it is rather than only that a token was found. */
  kind: string
  /** Is this attribute's content model an ID REFERENCE **LIST** or ONE reference?
   *
   *  The row-per-token rule below means the edge count alone cannot answer it: an
   *  `aria-labelledby="a"` (a list that happens to hold one token) and a
   *  `form="outer"` (genuinely single-valued) both publish exactly one row, so a
   *  consumer cannot tell them apart and `input@list`'s "nothing is fetched" reading
   *  is not falsifiable from the row. The flag is published as `metadata.idrefList`
   *  on the LIST carriers only, so "one named element because the model is single"
   *  and "one named element because the author wrote one token" stay distinguishable.
   *
   *  Set from the content model, not from the corpus: the ARIA 1.2 table says
   *  `aria-labelledby`, `aria-describedby`, `aria-details`, `aria-controls`,
   *  `aria-owns` and `aria-flowto` are ID reference LISTs while
   *  `aria-errormessage` and `aria-activedescendant` are single references; the HTML
   *  Standard makes `td`/`th` `headers` and `output` `for` space-separated token
   *  lists while `input@form` and `input@list` name one element. */
  list: boolean
}
const IDREF_RULES: IdrefRule[] = [
  { tag: "", attr: "aria-labelledby", kind: "aria-labelledby", list: true },
  { tag: "", attr: "aria-describedby", kind: "aria-describedby", list: true },
  { tag: "", attr: "aria-details", kind: "aria-details", list: true },
  { tag: "", attr: "aria-errormessage", kind: "aria-errormessage", list: false },
  { tag: "", attr: "aria-controls", kind: "aria-controls", list: true },
  { tag: "", attr: "aria-owns", kind: "aria-owns", list: true },
  { tag: "", attr: "aria-flowto", kind: "aria-flowto", list: true },
  { tag: "", attr: "aria-activedescendant", kind: "aria-activedescendant", list: false },
  { tag: "td", attr: "headers", kind: "table-header", list: true },
  { tag: "th", attr: "headers", kind: "table-header", list: true },
  // The form owner and the datalist an input offers. Both name an element in the
  // same document through its `id`, which is why they are here and not in the
  // resource table: nothing is fetched and nothing is navigated to. Both are
  // SINGLE references, which is why they carry no `idrefList`.
  { tag: "", attr: "form", kind: "form-owner", list: false },
  { tag: "", attr: "list", kind: "datalist", list: false },
  // `<output for>` names the controls whose value the output reports — a
  // space-separated token list, like `headers`.
  { tag: "output", attr: "for", kind: "output-for", list: true },
]

/** What `emitResource` decided, so the caller can keep its document metrics exact
 *  without the emitter reaching back into the walk. */
type ResourceOutcome = "fetch" | "fragment" | "navigation" | "external" | "script-url" | "none"

/** Tag names whose own `class`/`id`-less presence still carries meaning for the
 *  metrics. Kept as data so the census can read the analyzer's own vocabulary. */
const HEADING_ELEMENTS: Record<string, boolean> = table<boolean>({ h1: true, h2: true, h3: true, h4: true, h5: true, h6: true })

/**
 * THE DELEGATE'S FILE-LEVEL ACTOR — the spelling the JavaScript delegate uses for an
 * edge whose actor is the FILE rather than a symbol, and which the embedded-block seam
 * must translate.
 *
 * `"(file)"` is the family's declared sentinel (`real-javascript-analyzer.ts`
 * `FILE_LEVEL_SOURCE`, paired there with `metadata.fileLevel: true` and pinned by that
 * lane's own fixtures; rust, scala, kotlin, zig, graphql and nim publish it too). `(` and
 * `)` cannot appear in an identifier at all, so it can never collide with a name.
 *
 * WHY THE SEAM TRANSLATES IT. The seam hands each delegate the DOCUMENT's own module
 * name as its file path, so a module-scope row a delegate produces is a statement about
 * THIS document — and the document IS the module here, published as its own symbol
 * (`name: moduleName`, kind `module`). `(file)` names no such symbol, so a row left
 * carrying it resolves at nothing, which is what the html pins that source a delegated
 * `imports`/`calls`/`instantiates` row at the document stem exist to catch.
 *
 * TRANSLATION, NOT SUPPRESSION: `metadata.fileLevel` and `metadata.scopeName` stay exactly
 * as the delegate wrote them, so the row is still marked module-scope and the delegate's
 * module name is preserved. Only the ACTOR is respelled as the artifact it belongs to.
 */
const DELEGATE_FILE_ACTOR = "(file)"

export class RealHtmlAnalyzer implements ASTEngine.LanguageAnalyzer {
  /**
   * The embedded-block languages whose delegate analyzer could not be loaded in
   * this process, populated only by `mergeEmbeddedBlocks` and published as
   * `metadata.unavailableEmbeddedLangs`. Non-empty means: this document HAS inline
   * blocks and they were NOT analysed. A field rather than a log line, because a
   * consumer that asks "does this file contain code?" needs to be able to tell
   * "no" from "not measured", and only a published field can say that.
   */
  private unavailableEmbeddedLangs: string[] = []
  /**
   * THE DOCUMENT AND ITS PROJECT ROOT, for the two claim keys a resource edge can carry.
   *
   * Fields rather than two more parameters on `emitResource`, whose six call sites already
   * thread eight arguments each: the values are properties OF THE ANALYSIS (`filePath` and
   * `context.projectRoot`), they are identical for every emission in one document, and
   * `analyze` is synchronous, so the pair is set once at the top of the walk and read by the
   * helper below. Empty `claimProjectRoot` means the caller did not name a project root — the
   * fixture runner does not — and a project-relative candidate is then NOT stated: an
   * unrooted path would be a claim about a file list the caller never supplied.
   */
  private claimDocumentPath = ""
  private claimProjectRoot = ""

  /**
   * THE CLAIM A RESOURCE TARGET CAN CARRY — the reason the edge names something this run cannot
   * resolve to a declaration, published on a key the ARBITER reads.
   *
   * THE DEFECT THIS CLOSES, in this lane's own measurement. `incoming-rule.ts` recognises a fixed
   * list of keys (`EXTERNAL_KEYS`, `:56-80`) plus the file/source-path claim kinds, and the lane
   * published `isExternalResource` on its network-URL fetches — a truthful marker on a spelling
   * that is not in that list, so the arbiter read the edge as an unstated hole. `causeOK` was 0
   * fleet-wide for exactly this reason. The fix is not to invent a new marker but to publish the
   * claim in the vocabulary the arbiter already verifies:
   *
   *   A NETWORK URL (`https:`, `http:`, `//cdn…`) is outside every admitted file list BY
   *   CONSTRUCTION, so the edge carries `sourcePathClaim`. Its polarity is inverted on purpose
   *   (`incoming-rule.ts:317-339`): the project REFUTES the claim the moment a candidate IS an
   *   admitted file, which is what stops this from becoming a laundering channel.
   *
   *   AN HTML DOCUMENT that exists beside this one — `../index.html`, `page.html`, `/guide.html`
   *   — carries `importProjectFile`, the FILE claim, and it is the honest one: the project's own
   *   admitted list then CONFIRMS the file. MEASURED over the lane's bounded population: of
   *   20,470 such targets, 20,295 name a document that is on disk AND admitted, and the other
   *   175 are DEAD LINKS — nothing on disk — which is why existence is probed before the claim is
   *   published. Without that probe the claim would be published on 175 targets that name no file,
   *   and the arbiter would count 175 refutations against the lane: a false statement, not a
   *   better-looking table.
   *
   *   ANYTHING ELSE PATH-SHAPED (`../../styles/main.css`, `/assets/x.js`) carries the same
   *   `sourcePathClaim`: the project admits no file answering the written string, which for an
   *   extension this lane cannot admit is true by construction.
   *
   *   A BARE NAME GETS NOTHING (`details.html` with no file beside it, `main`, `getItem`). The
   *   source-path claim is defined only for a target containing `/` or a scheme
   *   (`incoming-rule.ts:335-337`), and a bare name is exactly the spelling that can also name a
   *   DECLARATION — so publishing a claim on it is the one move that could hide a resolution.
   *
   * EVERY KEY HERE IS ADDITIVE. The target is untouched, no existing metadata key is renamed or
   * removed, and a claim is read by the arbiter only where the target names no declaration
   * (`classifyEdge`), so no edge's resolution can move because of this function.
   */
  private resourceClaimMetadata(value: string, network: boolean): Record<string, unknown> {
    if (network) return { sourcePathClaim: [value] }
    if (this.claimProjectRoot.length > 0 && HTML_DOCUMENT_EXTS.has(resourceExtension(value))) {
      const rebased = rebaseToProject(this.claimDocumentPath, this.claimProjectRoot, value)
      if (rebased !== null && existsSync(path.join(this.claimProjectRoot, rebased))) {
        return { importProjectFile: [rebased] }
      }
    }
    if (value.includes("/") || urlScheme(value).length > 0) return { sourcePathClaim: [value] }
    return {}
  }

  analyze(rootNode: Node, content: string, filePath: string, context?: ASTEngine.AnalyzeContext): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

    // The document identity and its project root, for `resourceClaimMetadata`. Set BEFORE the
    // walk and overwritten on every call, so a reused analyzer instance cannot carry one
    // document's root into the next one's claims.
    this.claimDocumentPath = filePath
    this.claimProjectRoot = context?.projectRoot ?? ""

    // --- Parse errors, ONCE and CAPPED ---------------------------------------
    // The engine already walks the tree for ERROR/MISSING nodes and caps the
    // result at 50 (engine.ts). This analyzer walked them a second time with an
    // UNBOUNDED stack, so a 300-line broken file published 350 warnings for 300
    // lines, and the two walks used different child sets (`namedChildren` here,
    // `children` there) so the duplication was not even reliably 2x. The engine's
    // walk is the authority; this one keeps the analyzer's own view but obeys the
    // same cap so the two can never disagree by an order of magnitude.
    const ERROR_REPORT_CAP = 50
    if (rootNode.hasError) {
      const errStack: Node[] = [rootNode]
      while (errStack.length > 0) {
        const n = errStack.pop()!
        if ((n.type === "ERROR" || n.isMissing) && errors.length < ERROR_REPORT_CAP) {
          errors.push({
            message: `Syntax ${n.type} detected. The Brain Engine is bypassing this broken node.`,
            range: this.nodeToRange(n),
            severity: "warning",
          })
        }
        for (let i = n.namedChildCount - 1; i >= 0; i--) {
          const child = n.namedChild(i)
          if (child) errStack.push(child)
        }
      }
    }

    // --- Document identity ----------------------------------------------------
    // The file stem is the module name, exactly as vue/svelte name a component
    // after its file module. Stable across absolute paths, so a stored edge
    // survives moving the project directory.
    const moduleName = path.basename(filePath, path.extname(filePath)) || "document"
    const documentRange = this.nodeToRange(rootNode)

    // The DOCUMENT is the module symbol. This is what gives the containment tree
    // a single root: pre-fix, every top-level element had `ownerName: undefined`
    // and no edge at all, so a 16-symbol page published 16 disconnected roots
    // and a document-level `<link>` edge sourced from an unjoinable external
    // string that no symbol could ever resolve to.
    // Null-prototype for the reason `table()` states: an element may carry
    // `id="__proto__"`, and on a plain object that writes the prototype rather
    // than a key, so `usedNames[handle]` would answer `Object.prototype` and
    // every duplicate-suffix probe below would walk out of its own range.
    const usedNames = map<number>()
    usedNames[moduleName] = 1
    symbols.push({
      name: moduleName,
      kind: ASTEngine.SymbolKind.Module,
      range: documentRange,
      scope: "",
      visibility: "public",
      complexity: 0, // filled with the addressable-descendant count below
      metadata: {
        htmlSpecific: true,
        isDocument: true,
        doctype: this.findDoctype(rootNode),
        lang: this.documentLanguage(rootNode),
      },
    })

    // `id`/`name` → the FIRST symbol registered under that handle. getElementById
    // returns the first match, so a reference resolves to the first and only the
    // first; `ambiguousCounts` lets the edge say so when a second exists.
    const handleToSymbol = map<string>()
    const ambiguousHandles = map<boolean>()

    // Deferred in-document references: `{label for=…}` and `href="#…"`. Resolved
    // after the walk so a FORWARD reference (a link to an id declared later) is
    // as good as a backward one — HTML allows both. O(L) resolution, O(1) each.
    const deferred: DeferredReference[] = []

    // --- Document metrics (all O(1) per element, no second pass) -------------
    let totalElements = 0
    let semanticCount = 0
    let interactiveCount = 0
    let formElementCount = 0
    let ariaCount = 0
    let headingCount = 0
    let headingLevelSkips = 0
    let imgCount = 0
    let imgWithAltCount = 0
    let iframeWithoutLoadingCount = 0
    // Resource-outcome counters. Kept in ONE object so `emitResource` can stay a
    // pure function of its arguments (it returns what it decided; this folds the
    // decision into the document metrics) instead of reaching back into the walk.
    const counters = { externalLinkCount: 0, internalLinkCount: 0, labelWithoutFor: 0, inputWithoutLabel: 0 }
    let baseHrefCount = 0
    let branchCount = 0
    let maxDepth = 0
    let addressableCount = 0
    let hasForm = false
    let hasExternals = false
    let customElementCount = 0
    let templateFragmentCount = 0
    let lastHeadingLevel = 0
    const frameworks: Record<string, boolean> = table<boolean>({ HTML5: true })
    const insights = map<boolean>()

    // --- Single-pass DFS ------------------------------------------------------
    // `nearestNamed` is the closest ANCESTOR that became a symbol; an element
    // that is not addressable does not create a node, so it passes its parent's
    // identity through and the chain skips structural noise. `barrierDepth` marks
    // whether we are inside a <template>/<slot>, and `insideBarrierOwner` is the
    // addressable ancestor to attribute a fragment's nodes to.
    const stack: Frame[] = [{ node: rootNode, nearestNamed: moduleName, depth: 0 }]

    while (stack.length > 0) {
      const frame = stack.pop()!
      const node = frame.node

      if (node.type === "element" || node.type === "script_element" || node.type === "style_element") {
        totalElements++
        if (frame.depth > maxDepth) maxDepth = frame.depth
        const tagNameNode = this.getElementTagName(node)
        if (tagNameNode) {
          const tagName = asciiLower(tagNameNode.text)
          const { attrs, lines } = this.extractElementAttributes(node)
          const startTag = this.getStartTag(node)
          // The line a resource is WRITTEN on is the line of the ATTRIBUTE, which
          // on a multi-line start tag is strictly more precise than the tag's own
          // line; the tag's line is the fallback for a carrier with no attribute
          // of its own. 1-based, never 0 (M59.O2 / R6).
          const tagLine = startTag ? startTag.startPosition.row + 1 : node.startPosition.row + 1
          const lineOf = (attr: string): number => lines[attr] ?? tagLine

          const isSemantic = !!SEMANTIC_ELEMENTS[tagName]
          const isInteractive = !!INTERACTIVE_ELEMENTS[tagName]
          const isForm = !!FORM_ELEMENTS[tagName]
          const isBarrier = !!TEMPLATE_BARRIERS[tagName]
          if (isSemantic) semanticCount++
          if (isInteractive) interactiveCount++
          if (isForm) { hasForm = true; formElementCount++ }
          if (attrs["aria-label"] || attrs["role"] || attrs["aria-labelledby"] || attrs["aria-describedby"]) ariaCount++
          if (HEADING_ELEMENTS[tagName]) {
            headingCount++
            // A skipped level is a real accessibility defect and a real branch:
            // h1 -> h4 means two unlabelled levels.
            const level = Number.parseInt(tagName.slice(1), 10)
            if (lastHeadingLevel !== 0 && level > lastHeadingLevel + 1) headingLevelSkips += level - lastHeadingLevel - 1
            lastHeadingLevel = level
          }
          if (tagName.indexOf("-") !== -1 && tagName !== "annotation-xml") {
            customElementCount++
            // A hyphen makes a tag a POTENTIAL custom element under the HTML
            // spec's own naming rule. It does not make it a REGISTERED one, and
            // the difference is measured, not stylistic.
            //
            // This block used to assert `frameworks["Web Components"] = true` and
            // the insight "Custom elements declared as web components", on the
            // reasoning that the tag name is "the one thing in a plain-HTML
            // document that a graph can join against a JS class definition of
            // the same name". Registration is `customElements.define(name,
            // class)` in a JavaScript file — a CROSS-FILE fact this analyzer
            // cannot see from a document. Measured over 1,652 corpus documents
            // (script/m14/html-custom-element-join.ts):
            //
            //   2,010 hyphenated-tag occurrences, 1,005 distinct tag names, in
            //   10 of 1,652 documents — and 0 of them in a file whose tag any
            //   indexed js/ts file registers. 0 distinct
            //   customElements.define("<name>", …) names exist in the corpus.
            //   2,000 of the 2,010 are two generated Razor stress fixtures
            //   (1,000 levels of <elem-N>, testing the compiler's recursion
            //   limit); the remaining 10 are five vuejs example pages whose
            //   <demo-grid>/<tree-item>/<transition-group> are Vue components
            //   registered through Vue.createApp, plus one svelte SSR
            //   expected-output fixture.
            //
            // So the old claim was a made-up framework detection on a page that
            // uses none — the same defect class as the `Targeted/ID-Styling`
            // name this analyzer's own header records removing. A file that
            // merely CONTAINS a hyphenated tag now says so, in words that are
            // true, and stops claiming a platform it cannot demonstrate.
            //
            // The COUNT is kept and the count is sound: the spec's term for a
            // hyphenated tag is a potential custom element, and `framework` is
            // still published as "HTML5" unconditionally below because that is
            // what the document IS regardless of its contents.
            insights["Custom-element-shaped tags present (registration is a cross-file fact this analyzer cannot see)"] = true
          }

          // --- html's real decision points, for a cyclomatic number that is
          //     not a hard-coded 1 (the pre-fix value for every file, ever).
          if (this.hasDirective(attrs, CONDITIONAL_DIRECTIVE_SUFFIXES) ||
              this.hasDirective(attrs, REPEAT_DIRECTIVE_SUFFIXES)) branchCount++
          if (isBarrier) branchCount++
          if (attrs["media"]) branchCount++
          if (tagName === "picture") branchCount++

          // --- ADDRESSABILITY (the identity ruling) ---------------------------
          const rawId = attrs["id"] ?? ""
          const rawName = rawId.length > 0 ? "" : (attrs["name"] ?? "")
          const handle = rawId.length > 0 ? rawId : rawName
          let currentId = frame.nearestNamed
          if (handle.length > 0) {
            addressableCount++
            // Duplicate identity: first in document order keeps the plain name.
            // The suffix is DETERMINISTIC (rust RSD3's answer to 2,852 same-name
            // ids), so a rebuild produces byte-identical output.
            let symbolName = handle
            const seen = usedNames[handle]
            if (seen === undefined) {
              usedNames[handle] = 1
            } else {
              // `usedNames[handle]` doubles as the WATERMARK: the highest suffix
              // already allocated for this handle. Advancing it is what keeps this
              // loop amortised O(1).
              //
              // It was pinned at 1 and never moved, so the k-th duplicate of an id
              // re-probed suffixes 2..k from the start every time — O(n) per
              // duplicate, O(n^2) over a file that reuses one id. Measured on a
              // 4,000-element page: 912 ms with unique ids against 15,516 ms with
              // the same id repeated, a 17x gap, and the whole-document figure was
              // quadratic rather than the O(nodes + attribute bytes) this file
              // documents. A generated page that stamps one id across thousands of
              // elements is enough to hit it.
              //
              // The watermark is a lower bound, not an assumption: the loop still
              // probes and skips any suffix that is genuinely occupied, because a
              // document may DECLARE `d#2` as a literal id of its own. So the
              // interleaving `id=d`, `id=d`, `id=d#2` still allocates `d`, `d#2`,
              // `d#3`, `d#2#2` exactly as before — the optimisation is invisible in
              // the output, which is the only acceptable way to make it.
              let n = seen
              do { n++; symbolName = `${handle}#${n}` } while (usedNames[symbolName] !== undefined)
              usedNames[symbolName] = 1
              usedNames[handle] = n
            }
            if (handleToSymbol[handle] === undefined) {
              handleToSymbol[handle] = symbolName
            } else {
              ambiguousHandles[handle] = true
            }
            currentId = symbolName
            symbols.push({
              name: symbolName,
              kind: ASTEngine.SymbolKind.Class,
              range: this.nodeToRange(node),
              scope: "",
              // HTML has one scope: a document. There is no private/package/
              // protected, so `public` is the only truthful value here and it is
              // pinned by fixture rather than left as an unexamined default.
              visibility: "public",
              ownerName: frame.nearestNamed,
              ownerKind: frame.nearestNamed === moduleName ? ASTEngine.SymbolKind.Module : ASTEngine.SymbolKind.Class,
              complexity: 1,
              metadata: {
                tagName,
                attributes: attrs,
                htmlSpecific: true,
                isAddressable: true,
                identityAttribute: rawId.length > 0 ? "id" : "name",
                isSemantic,
                isInteractive,
                isForm,
                ...(rawId.length === 0 && rawName.length > 0 ? { alsoNamed: rawName } : {}),
                ...(symbolName !== handle ? { duplicateId: true, duplicateOf: handle } : {}),
                ...(frame.inBarrier ? { inTemplateBarrier: true } : {}),
                ...(attrs["is"] ? { isCustomElement: attrs["is"] } : {}),
              },
            })
            // --- CONTAINMENT -------------------------------------------------
            // Owner is the nearest addressable ancestor; the edge names the
            // MEMBER, so it carries the member's own declaration line — the same
            // rule svelte's "contains from ownerName" publishes.
            if (frame.nearestNamed !== symbolName) {
              relationships.push({
                source: frame.nearestNamed,
                target: symbolName,
                type: ASTEngine.RelationshipType.Contains,
                confidence: 1.0,
                line_number: this.nodeToRange(node).startLine,
                metadata: {
                  htmlSpecific: true,
                  isDOMHierarchy: true,
                  evidenceClass: "structural",
                  ...(frame.nearestNamed === moduleName ? { isDocumentRoot: true } : {}),
                },
              })
            }
          }

          // --- RESOURCES ------------------------------------------------------
          // A table lookup, O(1), and a candidate split only for a `srcset`.
          const rules = RESOURCE_RULES[tagName]
          if (rules) {
            for (let r = 0; r < rules.length; r++) {
              const rule = rules[r]
              const raw = attrs[rule.attr]
              if (!raw || raw.length === 0) continue
              // `rel`/`name` filters are O(tokens) and run BEFORE any emission,
              // so a carrier that does not qualify produces no row and no edge.
              let effectiveType = rule.resourceType
              if (rule.relFilter) {
                const rel = this.fetchableRelToken(attrs["rel"], rule.relFilter)
                if (rel === null) continue
                effectiveType = LINK_RESOURCE_TYPES[rel] ?? rule.resourceType
              }
              if (rule.paramNameFilter && !rule.paramNameFilter[asciiLower(attrs["name"] ?? "")]) continue
              if (rule.httpEquiv !== undefined && asciiLower(attrs["http-equiv"] ?? "") !== rule.httpEquiv) continue
              const line = lineOf(rule.attr)
              // A resource declared ON an addressable element belongs to THAT
              // element, not to its nearest ancestor: `<img id="gallery" src=…>`
              // is the gallery's dependency. Only a non-addressable element
              // (a bare `<script>` in the head) attributes to the ancestor.
              const owner = currentId
              const attrRange = this.attributeRange(startTag, rule.attr, node, line)
              if (rule.contentUrl) {
                // The URL is INSIDE the attribute (`0; url=/next`), so the raw
                // value is not a URL and the length check above has already
                // confirmed there is content to parse. An interval with no
                // `url=` reloads this document and names nothing.
                const inner = refreshContentUrl(decodeCharacterReferences(raw).trim())
                if (inner.length === 0) continue
                this.countOutcome(
                  this.emitResource(inner, owner, rule, line, attrRange, relationships, imports, deferred, true),
                  counters,
                )
                continue
              }
              if (rule.valueList === "space") {
                const urls = spaceSeparatedUrls(decodeCharacterReferences(raw))
                for (let u = 0; u < urls.length; u++) {
                  this.countOutcome(
                    this.emitResource(urls[u], owner, rule, line, attrRange, relationships, imports, deferred),
                    counters,
                  )
                }
                continue
              }
              if (rule.candidates === "srcset") {
                const candidates = srcsetCandidates(raw)
                for (let c = 0; c < candidates.length; c++) {
                  this.countOutcome(
                    this.emitResource(candidates[c], owner, rule, line, attrRange, relationships, imports, deferred),
                    counters,
                  )
                }
                continue
              }
              this.countOutcome(
                this.emitResource(raw, owner, { ...rule, resourceType: effectiveType }, line, attrRange, relationships, imports, deferred),
                counters,
              )
            }
          }
          // `<input type=submit|image formaction=…>` is a form endpoint; the
          // generic `input` rule carries `src`, not `formaction`, so it is read
          // here — through the same table-driven path, keyed on the type.
          if (tagName === "input" && FORM_ACTION_INPUT_TYPES[asciiLower(attrs["type"] ?? "")]) {
            const fa = attrs["formaction"]
            if (fa && fa.length > 0) {
              this.countOutcome(
                this.emitResource(
                  fa,
                  currentId,
                  INPUT_FORMACTION_RULE,
                  lineOf("formaction"),
                  this.attributeRange(startTag, "formaction", node, lineOf("formaction")),
                  relationships,
                  imports,
                  deferred,
                ),
                counters,
              )
            }
          }

          // --- IN-DOCUMENT REFERENCES ---------------------------------------
          // `<label for>`, an IDREF-class attribute and a fragment href are REAL
          // references in the document's address space, which is exactly why
          // `id`/`name` are the identity attributes. They are DEFERRED so a
          // forward reference (a link to an id declared further down) resolves as
          // well as a backward one — HTML allows both, and the pre-fix analyzer
          // resolved labels through an `idMap` it had already finished building,
          // so a label pointing at a LATER input silently emitted nothing.
          if (tagName === "label") {
            const forAttr = attrs["for"]
            if (forAttr && forAttr.length > 0) {
              deferred.push({
                // THE ELEMENT THAT WRITES THE REFERENCE, not the nearest named
                // ancestor — `currentId` is the label's OWN handle when it is
                // addressable (an `id`/`name`) and the ancestor only when it is not.
                //
                // This branch used `frame.nearestNamed` unconditionally, and it was
                // the ONLY one of the four in-document reference emitters that did:
                // the resource carriers pass `currentId` (`emitResource`'s caller),
                // the IDREF class passes `currentId` (`owner`), the fragment href in
                // `emitResource` passes its caller's `source`, and the lane's own F5
                // oracle `deriveHtmlEdges` passes `next` — which is the element's own
                // symbol name whenever it has one. MEASURED, both documents through
                // `deriveHtmlEdges`:
                //
                //   scope-barriers-and-references.html (labels `lbl-later`,
                //     `lbl-above`, `lbl-twin`, each with an id):
                //     oracle `uses lbl-later -> declared-below`; the analyzer said
                //     `uses app -> declared-below` — 3 rows, 100% of that file's
                //     label associations, sourced at the wrong actor.
                //   idref-carriers.html (`<label id="lbl" for="named-target">`):
                //     oracle `uses lbl -> named-target`; analyzer `uses app -> ...`.
                //
                // A label WITHOUT identity is unaffected: `currentId` is then the
                // nearest named ancestor, which is what identity-addressable's
                // `<label for="query">` (no id, inside `#search-form`) pins and what
                // the oracle also derives (`uses search-form -> query`). So this
                // changes the actor only where an actor was available to name, and it
                // is what makes the analyzer agree with its own truth rather than
                // pinning a divergence in two fixtures.
                source: currentId,
                handle: forAttr,
                kind: "label",
                rel: "uses",
                line: lineOf("for"),
              })
            } else {
              counters.labelWithoutFor++
            }
          }
          // The IDREF class: one deferred entry per ID token, because the content
          // model is a LIST and each token is a separate reference — `aria-labelledby
          // = "first last"` names two elements, and collapsing them into one edge
          // would lose one of the two facts the attribute states. The tokens are
          // split by ASCII whitespace with the same cursor the scheme helper uses,
          // so the value is read exactly as the HTML tokenizer would.
          for (let ir = 0; ir < IDREF_RULES.length; ir++) {
            const rule = IDREF_RULES[ir]
            if (rule.tag.length > 0 && rule.tag !== tagName) continue
            const raw = attrs[rule.attr]
            if (raw === undefined || raw.length === 0) continue
            const line = lineOf(rule.attr)
            const owner = currentId
            let start = 0
            for (let i = 0; i <= raw.length; i++) {
              const atEnd = i === raw.length
              const c = atEnd ? 32 : raw.charCodeAt(i)
              if (!(c === 32 || c === 9 || c === 10 || c === 13 || c === 12)) continue
              if (i > start) {
                deferred.push({
                  source: owner,
                  handle: raw.slice(start, i),
                  kind: rule.kind,
                  rel: "references",
                  list: rule.list,
                  line,
                })
              }
              start = i + 1
            }
          }
          if (tagName === "input") {
            // The five literals below are HTML input-type ATTRIBUTE VALUES, not
            // parse-tree node types, so the grammar audit correctly reports that the
            // grammar declares no node by any of those names — and this branch is
            // LIVE, not dead. `type` is a lowercased attribute string
            // (`<input type="hidden">`), so the comparison is doing exactly what it
            // says. It is waived in grammar-audit-allowlist.json with that
            // justification rather than "fixed", because there is nothing to fix and
            // renaming the comparison to dodge the scanner would only hide the shape.
            const type = asciiLower(attrs["type"] ?? "text")
            if (type !== "hidden" && type !== "submit" && type !== "button" && type !== "reset" && type !== "image") {
              counters.inputWithoutLabel++
            }
          }

          // --- NON-EDGE FACTS -------------------------------------------------
          // `<base href>` rewrites how every relative URL in the file resolves, so
          // it is architecturally load-bearing — but it fetches nothing, and
          // emitting it as a resource claimed a dependency on a URL that is only
          // a resolution base. A metric, not an edge.
          if (tagName === "base" && attrs["href"]) baseHrefCount++
          if (tagName === "iframe" && !attrs["loading"]) iframeWithoutLoadingCount++
          if (tagName === "img") {
            imgCount++
            if (attrs["alt"] !== undefined) imgWithAltCount++
          }

          // The next level's identity is THIS element only if it became a symbol;
          // a barrier stops the chain from crossing into content that is not
          // rendered here, and an addressable barrier owns its own fragment.
          const nextBarrier = isBarrier
          const nextNamed = currentId
          if (isBarrier) {
            templateFragmentCount++
            // An addressable <template>/<slot> owns its fragment; a bare one lets
            // the fragment's nodes belong to the nearest live ancestor, flagged.
            const children = node.namedChildren
            for (let i = children.length - 1; i >= 0; i--) {
              const child = children[i]
              if (child) {
                stack.push({
                  node: child,
                  nearestNamed: nextNamed,
                  depth: frame.depth + 1,
                  inBarrier: true,
                })
              }
            }
            continue
          }
          const children = node.namedChildren
          for (let i = children.length - 1; i >= 0; i--) {
            const child = children[i]
            if (child) {
              stack.push({ node: child, nearestNamed: nextNamed, depth: frame.depth + 1, inBarrier: frame.inBarrier })
            }
          }
          continue
        }
      }

      // Non-element node: pass the frame through unchanged. (The pre-fix walk
      // pushed `currentTagName` down as a `parentTagName` and gated `<source>` on
      // the IMMEDIATE parent being picture/audio/video — the direct cause of a
      // resource vanishing behind one wrapper element. Nothing needs it now.)
      const children = node.namedChildren
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i]
        if (child) {
          stack.push({
            node: child,
            nearestNamed: frame.nearestNamed,
            depth: frame.depth,
            inBarrier: frame.inBarrier,
          })
        }
      }
    }

    // --- Deferred in-document reference resolution (O(L), O(1) each) ---------
    for (let i = 0; i < deferred.length; i++) {
      const ref = deferred[i]
      const target = handleToSymbol[ref.handle]
      // An unresolved handle emits NOTHING: a label pointing at a control that
      // does not exist, an anchor to a missing id, or an `aria-labelledby` naming
      // an id this document never declares, is not a reference. This is the same
      // honesty rule the pre-fix analyzer had and kept, and it is what keeps the
      // IDREF class from becoming a graph of dangling names: measured over 1,185
      // corpus documents the class carries 19 ID tokens and 2 of them do not
      // resolve, and those 2 emit nothing rather than a placeholder target.
      if (target === undefined) continue
      if (ref.rel === "references") {
        // The IDREF class. Confidence 1.0, and the reason it is not 0.9: both ends
        // are symbols in this document, the token was read from the element's own
        // attribute, and the resolution rule is `getElementById` — the same rule
        // the label association and the internal anchor already claim 1.0 under.
        // The 0.9 tier is for an OBSERVED hyperlink, where the target is a
        // document this analyzer never parsed; nothing here is of that kind.
        relationships.push({
          source: ref.source,
          target,
          type: ASTEngine.RelationshipType.References,
          confidence: 1.0,
          line_number: ref.line,
          metadata: {
            htmlSpecific: true,
            isIdref: true,
            idrefKind: ref.kind,
            // Published for the LIST carriers only, never as `idrefList: false`: a
            // single-valued reference and a one-token list must not read alike, and
            // the absent/present test is the only one that survives a consumer's
            // truthiness check (`false` and `undefined` are both falsy).
            ...(ref.list ? { idrefList: true } : {}),
            evidenceClass: "structural",
            ...(ambiguousHandles[ref.handle] ? { ambiguousTarget: true } : {}),
          },
        })
        continue
      }
      if (ref.kind === "label") {
        relationships.push({
          source: ref.source,
          target,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 1.0,
          line_number: ref.line,
          metadata: {
            htmlSpecific: true,
            isLabelAssociation: true,
            evidenceClass: "structural",
            ...(ambiguousHandles[ref.handle] ? { ambiguousTarget: true } : {}),
          },
        })
      } else {
        relationships.push({
          source: ref.source,
          target,
          type: ASTEngine.RelationshipType.Uses,
          confidence: 1.0,
          line_number: ref.line,
          metadata: {
            htmlSpecific: true,
            isInternalAnchor: true,
            evidenceClass: "structural",
            ...(ambiguousHandles[ref.handle] ? { ambiguousTarget: true } : {}),
          },
        })
      }
    }

    // --- Per-symbol complexity: the ADDRESSABLE subtree size -----------------
    // `complexity` was `symbols.length` at file level and absent per symbol, so
    // SPEC section C had nothing to pin. An addressable element's complexity is
    // the number of addressable elements it contains — the DOM analogue of a
    // declaration's statement count, computed in the same O(n) pass by incrementing
    // each ancestor would be O(depth) per node, so it is accumulated on the way
    // back up instead: a single reverse walk over the emitted symbols, O(s log s).
    this.accumulateSubtreeSizes(symbols)

    // --- Scores --------------------------------------------------------------
    // `hasTypeInference`/`hasFrameworkIntelligence` are forced to true by the
    // engine; the three scores below are NOT in engine.ts's metadata literal, so
    // the pre-fix analyzer computed them and the product never saw them. They are
    // now published under names the engine forwards, and mirrored in
    // `architecturalInsights` so the text survives the framework-intelligence
    // overwrite (see that module: it replaces the array wholesale).
    const structural = this.computeScores({
      totalElements,
      semanticCount,
      interactiveCount,
      formElementCount,
      ariaCount,
      headingCount,
      headingLevelSkips,
      imgCount,
      imgWithAltCount,
      iframeWithoutLoadingCount,
      labelWithoutForCount: counters.labelWithoutFor,
      inputWithoutLabelCount: counters.inputWithoutLabel,
      branchCount,
      maxDepth,
      addressableCount,
      customElementCount,
      templateFragmentCount,
    })

    if (addressableCount > 0) insights["Addressable DOM nodes identified by id/name"] = true
    if (semanticCount > 0) insights["Well-structured semantic document"] = true
    if (ariaCount > 0) insights["Commitment to accessibility detected"] = true
    if (headingLevelSkips > 0) insights["Heading levels skip a level"] = true
    if (hasExternals) {
      insights["External resources linked"] = true
      let hasExternalScript = false
      let hasExternalStyle = false
      for (let i = 0; i < imports.length; i++) {
        if (imports[i].metadata?.isScript) hasExternalScript = true
        if (imports[i].metadata?.isStylesheet) hasExternalStyle = true
      }
      if (hasExternalScript) insights["External interactivity linked"] = true
      if (hasExternalStyle) insights["External styling linked"] = true
    }
    if (hasForm) insights["Contains user input forms"] = true
    if (customElementCount > 0) insights["Custom-element-shaped tags present; registration not observable from this document"] = true
    if (templateFragmentCount > 0) insights["Deferred template fragments present"] = true
    if (baseHrefCount > 0) insights["Base URL rewrites relative resource resolution"] = true
    if (counters.externalLinkCount > 0) insights["Outbound cross-origin navigation (recorded, not graphed)"] = true

    const patterns: string[] = []
    if (hasForm) patterns.push("Form Controls Usage")
    if (semanticCount > 0) patterns.push("Semantic HTML5 Structure")
    if (ariaCount > 0) patterns.push("ARIA Accessibility Enhancements")
    if (addressableCount > 0) patterns.push("Addressable DOM Identity")
    if (customElementCount > 0) patterns.push("Custom-element-shaped tag usage")

    const detectedFrameworks: string[] = []
    for (const f in frameworks) detectedFrameworks.push(f)

    const architecturalInsights: string[] = []
    for (const insight in insights) architecturalInsights.push(insight)

    // --- HTML-G1: the inline <script>/<style> bodies -------------------------
    // The seam that feeds this is `ASTEngine.extractHtmlEmbeddedBlocks` +
    // `context.htmlEmbeddedTrees` (engine.ts). Measured before it existed: 5,389
    // of 6,094 corpus files (88.4%) carried an inline block and every one of them
    // produced zero symbols, zero calls and zero imports — on the 51-document
    // hand-written sample, 74,637 characters of JavaScript and 17,266 of CSS.
    //
    // The merge is the same contract the vue/svelte SFC seam publishes, and the
    // discipline the M49 W12 lesson demands: a delegate's ranges and its
    // `line_number` are BLOCK-RELATIVE, so every one is shifted back to file
    // coordinates here, and the applied offset is RECORDED ON THE ROW so the seam
    // is auditable and its regression is catchable by a fixture rather than
    // discoverable by a consumer noticing a line is off.
    if (context && Array.isArray(context.htmlEmbeddedTrees) && context.htmlEmbeddedTrees.length > 0) {
      const unavailable = this.mergeEmbeddedBlocks(context, moduleName, symbols, relationships, imports, exports, errors)
      // DISCLOSED, never silent. A document whose blocks were skipped must not
      // read as a document that has no code in it — that is the HTML-G1 defect
      // returning through a different door, and the honest signal is the absence
      // named rather than the absence implied.
      if (unavailable.length > 0) this.unavailableEmbeddedLangs = [...new Set(unavailable)].sort()
    }

    return {
      language: "html",
      symbols,
      relationships,
      imports,
      exports,
      errors,
      metadata: {
        // Structural depth, not a symbol count: `symbols.length` was the pre-fix
        // value and it is not a complexity measure of anything.
        complexity: maxDepth + 1,
        linesOfCode: content.split("\n").length,
        cyclomaticComplexity: 1 + branchCount,
        elementCount: totalElements,
        addressableNodeCount: addressableCount,
        maxElementDepth: maxDepth,
        framework: "HTML5",
        patterns,
        detectedFrameworks,
        frameworkPatterns: [],
        architecturalInsights,
        architecturalScore: structural.architecturalScore,
        codeQuality: structural.architecturalScore > 80 ? "Excellent" : structural.architecturalScore > 60 ? "Good" : "Fair",
        hasTypeInference: false,
        hasFrameworkIntelligence: true,
        // The three scores are published under engine-forwarded keys AND as
        // metadata.score, so the numbers survive the engine's metadata literal
        // instead of being computed and dropped.
        accessibilityScore: structural.accessibility,
        semanticScore: structural.semantic,
        performanceScore: structural.performance,
        score: structural,
        analysisVersion: "m14-html-identity-v2",
        ...(this.unavailableEmbeddedLangs.length > 0
          ? { unavailableEmbeddedLangs: [...this.unavailableEmbeddedLangs] }
          : {}),
        documentMetrics: {
          totalElements,
          semanticCount,
          interactiveCount,
          formElementCount,
          ariaCount,
          headingCount,
          headingLevelSkips,
          imgCount,
          imgWithAltCount,
          iframeWithoutLoadingCount,
          labelWithoutForCount: counters.labelWithoutFor,
          inputWithoutLabelCount: counters.inputWithoutLabel,
          customElementCount,
          templateFragmentCount,
          baseHrefCount,
          // A hyperlink is not a code dependency, so outbound navigation is a
          // DOCUMENT METRIC rather than 200-odd `uses` edges into a graph whose
          // every edge is scored for architectural criticality.
          externalLinkCount: counters.externalLinkCount,
          internalLinkCount: counters.internalLinkCount,
        },
      },
    }
  }

  // ==========================================================================
  // RESOURCE EMISSION
  // ==========================================================================

  /**
   * One fetch/inline-resource edge, or one hyperlink, or nothing.
   *
   * Returns what it decided so the caller's document metrics stay exact without
   * this method needing a reference to them:
   *   "fetch"        a `uses` edge was emitted for a resource the document loads
   *   "fragment"     a same-document reference; the caller already deferred it
   *   "navigation"   an in-project hyperlink/endpoint, emitted as `uses`
   *   "external"     a cross-origin or non-resource-scheme URL: deliberately
   *                  NOT graphed (see the header) — the caller counts it
   *   "script-url"   a `javascript:` URL: a hazard, not a dependency
   *   "none"         nothing to say
   *
   * The decision table:
   *   - a same-document fragment is NOT a fetch: it is a reference into the
   *     document's own address space, resolved after the walk (deferred).
   *   - a non-resource scheme (`mailto:`, `tel:`, `javascript:`, `data:`, …) is
   *     not a dependency. Decoded BEFORE the scheme test (see the header), so
   *     `&#106;avascript:` and `&#0000106;avascript:` cannot slip past — the
   *     pre-fix filter was a bare `startsWith("javascript:")` and missed both,
   *     AND existed only in the `<a>` branch, so `<form action="javascript:…">`
   *     emitted a `calls` edge and an `imports` row for one.
   *   - a network URL is a fetch, but its target is not a project module, so the
   *     edge is `usage_contextual` and is NOT mirrored into `imports` (mirroring
   *     it put `https://cdn.example.com/x.js` in brain_import, where every other
   *     lane's import is a module the index can resolve).
   *   - anything else is a project-relative module: `import_based`, and mirrored.
   */
  private emitResource(
    rawValue: string,
    source: string,
    rule: ResourceRule,
    line: number,
    range: ASTEngine.UniversalSymbol["range"],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    deferred: DeferredReference[],
    /**
     * Set when the caller already performed the character-reference decode,
     * because it had to decode in order to FIND the URL (`<meta http-equiv=refresh
     * content>`). Character references are not length-preserving, so a second
     * decode is not idempotent — `&amp;amp;` would collapse two levels — and the
     * flag keeps the decode single and owned by one caller instead of being
     * re-applied on the assumption that it is.
     */
    alreadyDecoded = false,
  ): ResourceOutcome {
    const value = (alreadyDecoded ? rawValue : decodeCharacterReferences(rawValue)).trim()
    if (value.length === 0) return "none"

    const fragment = fragmentTarget(value)
    // A BARE `#` is the HTML idiom for "no destination": it is a valid URL that
    // refers to the top of the current document, so there is no target to name.
    // Emitting an edge to the literal text `#` produced a node that is neither a
    // symbol nor a file — the unresolvable-identity class, and a regression
    // against the M12 Negative fixture's documented contract ("`javascript:` and
    // empty `#` anchors emit nothing"). The document module already IS the top of
    // the document, so the reference is satisfied by the node that owns it. An
    // empty value is the same statement with even less ceremony, and the length
    // check above already returned for it.
    if (value === "#") return "none"
    if (fragment.length > 0) {
      if (rule.fragmentRef) {
        // A real reference INTO the document's address space. Deferred, so a
        // FORWARD reference — `<a href="#orders">` above the `<section id=orders>`
        // it names — resolves exactly as a backward one does. Pre-fix this was
        // emitted as an edge whose target was the literal text `#orders`, which
        // joins to no symbol and to no file.
        deferred.push({ source, handle: fragment, kind: "anchor", rel: "uses", line })
        return "fragment"
      }
      // A fetch-only carrier holding a fragment is an authoring error; the target
      // is still emitted as written so the mistake is visible rather than silent.
      relationships.push({
        source,
        target: value,
        type: ASTEngine.RelationshipType.Uses,
        confidence: 1.0,
        line_number: line,
        metadata: {
          htmlSpecific: true,
          resourceType: rule.resourceType,
          isInternalAnchor: true,
          isUnresolvedFragment: true,
          evidenceClass: "structural",
        },
      })
      return "fragment"
    }
    if (isNonResourceScheme(value)) {
      if (urlScheme(value) === "javascript") {
        relationships.push({
          source,
          target: "javascript:",
          type: ASTEngine.RelationshipType.Uses,
          confidence: 1.0,
          line_number: line,
          metadata: {
            htmlSpecific: true,
            resourceType: "javascript-url",
            isScriptUrl: true,
            evidenceClass: "usage_contextual",
          },
        })
        return "script-url"
      }
      return "external"
    }
    const network = isProtocolRelative(value) || isNetworkScheme(value)
    if (rule.link) {
      if (network) return "external"
      relationships.push({
        source,
        target: value,
        type: ASTEngine.RelationshipType.Uses,
        // 0.9, not 1.0: an observed hyperlink is not a derived fact. The tier
        // classifier in every other gated lane reads confidence, and a 1.0 here
        // would claim `structural` for a link that was merely written down.
        confidence: 0.9,
        line_number: line,
        // Honesty contract §4.1: a relationship below 1.0 must carry a
        // MACHINE-READABLE reason code, and the only justification this tier had
        // was the comment above. Measured over this lane's corpus (1,185
        // git-tracked documents, `validation/m14/probes/html/ontology-census.mts`):
        // 60,285 html-native edges sit at this tier — 59,953 `navigation` and 332
        // `form-action` — and not one carried a field a consumer or an audit could
        // read. The code makes the tier machine-checkable without re-reading the
        // analyzer: a consumer filtering "observed, not derived" reads a field.
        metadata: {
          htmlSpecific: true,
          resourceType: rule.resourceType,
          isNavigation: rule.navigation === true,
          // A form endpoint is a dependency on a backend route, which is a
          // materially different fact from "the user can click away".
          isFormEndpoint: rule.navigation !== true,
          evidenceClass: "usage_contextual",
          confidenceReason: "observed-hyperlink-not-derived",
          // THE CLAIM, on the channel the arbiter reads. A hyperlink is the largest
          // unresolved class this lane has (22,260 of 32,656 in the bounded
          // population) and it was emitted as a bare relative spelling, so the
          // document that wrote it was the only thing that could answer it.
          ...this.resourceClaimMetadata(value, false),
        },
      })
      return "navigation"
    }
    relationships.push({
      source,
      target: value,
      type: ASTEngine.RelationshipType.Uses,
      confidence: 1.0,
      line_number: line,
      metadata: {
        htmlSpecific: true,
        resourceType: rule.resourceType,
        isExternalResource: network,
        evidenceClass: rule.evidenceClass ?? (network ? "usage_contextual" : "import_based"),
        // Same claim, same keys: a fetch names a FILE (`../styles/main.css`) or a
        // network URL, and both were published verbatim with no reason attached.
        ...this.resourceClaimMetadata(value, network),
      },
    })
    if (rule.import && !network) {
      // The range is the ATTRIBUTE's, not the element's: it is what makes the
      // stored import checkable against the source, and a whole-element range
      // pointed at the element's first line rather than the line the URL is
      // written on. The pre-fix analyzer passed the element range to every
      // import, which is why a multi-line start tag produced a wrong import line.
      imports.push({
        module: value,
        items: ["*"],
        isDefaultImport: true,
        isNamespaceImport: false,
        range,
        metadata: { isHtmlResource: true, resourceType: rule.resourceType },
      })
    }
    return "fetch"
  }

  /**
   * Merge the sub-analysed inline blocks into the document's own payload.
   *
   * Each block is analysed by the JS/TS/CSS analyzer for its own grammar and the
   * result is re-based onto the document:
   *   - a `line_number` and every metadata key whose NAME is a line move by
   *     `startLine - 1` (the block's first line, 1-based, to file coordinates);
   *   - a `range`'s startLine/endLine move by the same amount and its
   *     startIndex/endIndex by the byte offset, because an index-based consumer
   *     (bb_edit) is misaligned by lines alone;
   *   - a multi-line block is indented, so the FIRST line needs no column shift
   *     and the rest need none either — the block's text is copied verbatim from
   *     the source, so its columns are already the document's;
   *   - the owner of a delegate symbol with no owner is the DOCUMENT, because a
   *     top-level `function` in an inline block is a document-scope declaration,
   *     and `contains` then carries the same line the symbol does.
   *
   * Every shifted row is tagged `htmlEmbedded: true` with the block's language
   * and the offset applied. That tag is what makes the seam falsifiable: a
   * fixture can assert that an inline script's symbol is on the line it is
   * written on, and a mutant that drops the shift fails that pin instead of
   * silently shipping off-by-N lines.
   */
  private mergeEmbeddedBlocks(
    context: ASTEngine.AnalyzeContext,
    moduleName: string,
    symbols: ASTEngine.UniversalSymbol[],
    relationships: ASTEngine.UniversalRelationship[],
    imports: ASTEngine.ImportInfo[],
    exports: ASTEngine.ExportInfo[],
    errors: ASTEngine.ParseError[],
  ): string[] {
    const unavailable: string[] = []
    const trees = (context.htmlEmbeddedTrees ?? []) as Tree[]
    const langs = (context.htmlEmbeddedLangs ?? []) as string[]
    const startLines = (context.htmlEmbeddedStartLines ?? []) as number[]
    const startColumns = (context.htmlEmbeddedStartColumns ?? []) as number[]
    const startIndices = (context.htmlEmbeddedStartIndices ?? []) as number[]
    // Resolved ONCE per merge, per language, each behind its own guard: a module
    // that fails to load disables only the blocks it would have served.
    const delegates = map<any>()
    const delegateFor = (lang: string): any | null => {
      if (delegates[lang] !== undefined) return delegates[lang]
      let instance: any = null
      try {
        // `require` rather than `await import`: `mergeEmbeddedBlocks` is called
        // from the synchronous analyzer body, and a dynamic import would make the
        // whole analyzer async for a benefit the engine already provides (it
        // resolves every analyzer through its own loader). The indirection is
        // deliberate — it is what makes the failure local instead of fatal.
        //
        // THE THREE LITERAL SPECIFIERS ARE LOAD-BEARING. esbuild can only inline a
        // delegate into the `dist/` bundle if the `require` argument is a string it
        // can read at build time, so the calls below are written out rather than
        // routed through `require(SPECIFIERS[lang])`; the latter would leave a
        // runtime call resolving against `dist/`, where the delegates do not exist
        // as files, and the seam would die in the one place it currently works.
        //
        // WHICH IS THE POINT OF THE `catch` BENEATH IT. `require` is a CommonJS
        // global and this package is `"type": "module"`, so under Node it does not
        // exist in an ESM module at all — only under Bun, and only after a bundler
        // has rewritten the call. Measured on this lane's assigned corpus with
        // `--entry=worker` (the entry `audit:pipeline`, `audit:cluster`,
        // `audit:consistency` and `script/m60/payload-matrix.ts` all run through):
        // 22 of vuejs's 25 documents published
        // `metadata.unavailableEmbeddedLangs: ["js"]`, and
        // `packages/vue/__tests__/e2e/hydration-strat-idle.html` fell from
        // 11 symbols / 31 relationships to 2 / 2. Under `bun run` the same 25
        // documents publish the blocks. So two REGISTERED GATES were measuring a
        // payload production never emits, and the seam's own disclosure field made
        // the loss read as a property of the DOCUMENTS rather than of the runtime.
        //
        // `createRequire(import.meta.url)` is the repo's own idiom for this
        // (`pool-worker.ts:12`, `engine.ts`, `framework-detectors.ts`,
        // `parallel-indexer.ts`) and is reached ONLY when the first form is
        // unavailable, so the bundle keeps inlining the three delegates statically
        // and the shipped payload is unchanged.
        const mod =
          lang === "css"
            ? require("./real-css-analyzer")
            : lang === "ts" || lang === "tsx"
              ? require("./real-typescript-analyzer")
              : require("./real-javascript-analyzer")
        const cls =
          lang === "css"
            ? mod.RealCssAnalyzer
            : lang === "ts" || lang === "tsx"
              ? mod.RealTypeScriptAnalyzer
              : mod.RealJavaScriptAnalyzer
        instance = typeof cls === "function" ? new cls() : null
      } catch {
        try {
          const nodeRequire = createRequire(import.meta.url)
          const mod =
            lang === "css"
              ? nodeRequire("./real-css-analyzer")
              : lang === "ts" || lang === "tsx"
                ? nodeRequire("./real-typescript-analyzer")
                : nodeRequire("./real-javascript-analyzer")
          const cls =
            lang === "css"
              ? mod.RealCssAnalyzer
              : lang === "ts" || lang === "tsx"
                ? mod.RealTypeScriptAnalyzer
                : mod.RealJavaScriptAnalyzer
          instance = typeof cls === "function" ? new cls() : null
        } catch {
          instance = null
        }
      }
      if (instance === null) unavailable.push(lang)
      delegates[lang] = instance
      return instance
    }

    for (let i = 0; i < trees.length; i++) {
      const tree = trees[i]
      if (!tree) continue
      const lang = langs[i] ?? "js"
      const lineOffset = (startLines[i] ?? 1) - 1
      const byteOffset = startIndices[i] ?? 0
      const delegate = delegateFor(lang)
      if (delegate === null) continue
      let sub: any
      try {
        // The delegate is handed the DOCUMENT's module name as its file path, not
        // a synthetic `embedded.js`. The JS/TS analyzers name their module scope
        // from the file stem, so a synthetic name made every document-scope edge
        // in the block source from a node that does not exist — the
        // unresolvable-identity defect class, visible as a `calls embedded ->
        // renderBanner` row whose source joins to nothing. The document's own
        // module is the scope an inline script actually has.
        sub = delegate.analyze(tree.rootNode, "", moduleName)
      } catch {
        // A block the delegate cannot analyse is that block's loss, not the
        // document's: the rest of the merge continues.
        continue
      }

      for (const s of (sub.symbols ?? []) as any[]) {
        if (s.range) {
          s.range = {
            ...s.range,
            startLine: s.range.startLine + lineOffset,
            endLine: s.range.endLine + lineOffset,
            startIndex: typeof s.range.startIndex === "number" ? s.range.startIndex + byteOffset : s.range.startIndex,
            endIndex: typeof s.range.endIndex === "number" ? s.range.endIndex + byteOffset : s.range.endIndex,
          }
        }
        if (!s.ownerName) {
          s.ownerName = moduleName
          s.ownerKind = ASTEngine.SymbolKind.Module
          s.scope = moduleName
        }
        s.metadata = {
          ...(s.metadata ?? {}),
          htmlEmbedded: true,
          embeddedLang: lang,
          embeddedLineOffset: lineOffset,
        }
        symbols.push(s)
        // `contains` from the owner, exactly as the vue/svelte SFC seam does it.
        // A delegate symbol with no owner is DOCUMENT-scope — a top-level
        // `function` in an inline block is a document-scope declaration — and
        // without this edge its ownerName would name a node no edge ever reaches,
        // so the block's declarations would be in the symbol table and in no
        // hierarchy. The edge carries the MEMBER's own (already-shifted) line.
        if (s.ownerName && s.ownerName !== s.name && s.range?.startLine) {
          relationships.push({
            source: s.ownerName,
            target: s.name,
            type: ASTEngine.RelationshipType.Contains,
            confidence: 1.0,
            line_number: s.range.startLine,
            metadata: {
              htmlSpecific: true,
              isEmbeddedCode: true,
              // ORIGIN DISCLOSURE (2026-10-05, measured). This row was the ONE
              // merged row that carried no `htmlEmbedded` tag and no
              // `embeddedLineOffset`, while the symbols at :1585, the delegate
              // relationships at :1633 and the imports at :1652 all carried
              // both. Measured on vuejs through the production path: of 921
              // delegate rows, 676 carried `htmlEmbedded === true` and 245 did
              // not — and 245 is the seam-created `contains` class.
              //
              // The consequence is not cosmetic. The header of this method
              // claims "Every shifted row is tagged htmlEmbedded: true"; an
              // auditor who takes that as the origin test concludes these rows
              // are html's OWN, which is exactly the delegation question this
              // lane exists to answer honestly, and gets it backwards for a
              // quarter of the merged graph. html-origin-census.ts answers the
              // same question WITHOUT this tag — by differencing the
              // production path against the seam switched off — and the two
              // numbers have to agree or one of them is wrong.
              //
              // `htmlSpecific: true` on a delegate-created edge is also a lie of
              // the same shape: the row is not a fact about HTML's grammar, it
              // is a fact about the javascript inside a `<script>`. It stays,
              // because it is what tells a consumer the edge arrived through the
              // html module — but `htmlEmbedded` is what tells them WHERE it was
              // written, and that was missing.
              htmlEmbedded: true,
              embeddedLang: lang,
              embeddedLineOffset: lineOffset,
              evidenceClass: "structural",
            },
          })
        }
      }

      // THE DELEGATE'S ENDPOINT SPELLING IS NOT THE HTML LANE'S, AND THIS SEAM IS
      // WHERE THE TWO ARE RECONCILED (M14 cross-lane, 2026-10-13).
      //
      // The javascript (+ typescript) delegate re-spelled two endpoint classes for its
      // OWN resolver's reasons — measured in `real-javascript-analyzer.ts`: a LOCAL
      // module's `imports` target moved from `<specifier>:<item>` to the bare `<item>`
      // with the specifier moved into `metadata.module`, and an `overrides` target moved
      // from `<Base>.<member>` to the bare `<member>`. The html lane PUBLISHES whatever
      // the delegate writes — that is what this seam is — and three of its pins were
      // written against the old spelling. Those three pins are BYTE-IDENTICAL at the
      // recording revision `cd8e1011b` and at original main `1b71d837c` (sha256 checked
      // across all three arms) and PASS at both, while failing here:
      //
      //   html/inline-embedded-code    imports   -> `/lib/helper.js:helper`
      //   html/embedded-origin-marks   imports   -> `/lib/mount.js:mount`
      //   html/embedded-heritage       overrides -> `TrackedShape.describe`
      //
      // The delegate's new spelling is the ONLY difference, so the seam restores the
      // lane's published form. TRANSLATION, NOT SUPPRESSION — the same contract the
      // `(file)` actor gets in the vue and svelte seams: every metadata field the
      // delegate wrote is kept (`module` included, so a consumer that prefers the
      // separated form still has it), and only the endpoint the html lane publishes is
      // respelled.
      //
      // THE BASE FOR AN OVERRIDE IS THE DELEGATE'S OWN HERITAGE ROW, not a re-derivation:
      // the delegate built `<Base>.<member>` from exactly this `extends` edge before it
      // dropped the owner, so reading it back here reconstructs the same value.
      const delegateBases = new Map<string, string>()
      for (const r of (sub.relationships ?? []) as any[]) {
        if (r?.type !== ASTEngine.RelationshipType.Extends) continue
        if (typeof r.source === "string" && r.source !== "" && typeof r.target === "string" && r.target !== "") {
          delegateBases.set(r.source, r.target)
        }
      }

      for (const r of (sub.relationships ?? []) as any[]) {
        // 1. `<specifier>:<item>` — the module half the delegate moved into metadata.
        //    A colon in the target is the delegate's OWN qualified form and is left
        //    alone; a `/` means a path-shaped target (a side-effect import), never a
        //    bare item name, and is left alone too.
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
        // 2. `<Base>.<member>` — the owner half the delegate dropped. A dotted target
        //    is already qualified; a source with no owner has no base to read.
        if (r.type === ASTEngine.RelationshipType.Overrides) {
          if (typeof r.source === "string" && typeof r.target === "string" && r.target !== "" && !r.target.includes(".")) {
            const owner = r.source.slice(0, r.source.lastIndexOf("."))
            const base = owner === "" ? undefined : delegateBases.get(owner)
            if (base) r.target = `${base}.${r.target}`
          }
        }
        if (typeof r.line_number === "number") r.line_number += lineOffset
        if (r.metadata) {
          for (const k of Object.keys(r.metadata)) {
            // Any metadata key that NAMES a line has a block-relative line in it and
            // needs the same shift `line_number` just got. Matched by hand rather than
            // `/line/i.test(k)` because the analyzer's no-regex rule is a hard
            // contract, not a style preference: every regex literal is one more thing
            // to audit for backtracking, and this needs nothing more than a case-fold
            // and a substring test over a handful of short keys.
            if (!asciiLower(k).includes("line")) continue
            const v = (r.metadata as any)[k]
            if (typeof v === "number") (r.metadata as any)[k] = v + lineOffset
            else if (Array.isArray(v) && v.some((x: unknown) => typeof x === "number")) {
              ;(r.metadata as any)[k] = v.map((x: unknown) => (typeof x === "number" ? (x as number) + lineOffset : x))
            }
          }
        }
        // THE DELEGATE'S FILE-LEVEL ACTOR NAMES THIS DOCUMENT (M14 cross-lane, 2026-10-11).
        // The seam hands the delegate the document's module name as its file path, so a
        // module-scope row is a statement about THIS document; the sentinel the javascript
        // lane now publishes for that actor names no symbol here, and three html fixtures
        // (`inline-embedded-code`, `embedded-heritage`, `embedded-origin-marks`) pin rows
        // sourced at the document stem. See the constant above.
        if (r.source === DELEGATE_FILE_ACTOR) r.source = moduleName
        r.metadata = {
          ...(r.metadata ?? {}),
          htmlEmbedded: true,
          embeddedLang: lang,
          embeddedLineOffset: lineOffset,
        }
        relationships.push(r)
      }

      for (const imp of (sub.imports ?? []) as any[]) {
        if (imp.range) {
          imp.range = {
            ...imp.range,
            startLine: imp.range.startLine + lineOffset,
            endLine: imp.range.endLine + lineOffset,
            startIndex: typeof imp.range.startIndex === "number" ? imp.range.startIndex + byteOffset : imp.range.startIndex,
            endIndex: typeof imp.range.endIndex === "number" ? imp.range.endIndex + byteOffset : imp.range.endIndex,
          }
        }
        imp.metadata = { ...(imp.metadata ?? {}), htmlEmbedded: true, embeddedLang: lang }
        imports.push(imp)
      }

      for (const e of (sub.exports ?? []) as any[]) {
        if (e.range) e.range = { ...e.range, startLine: e.range.startLine + lineOffset, endLine: e.range.endLine + lineOffset }
        // ORIGIN DISCLOSURE (2026-10-05, measured). The exports channel was the
        // ONLY merged channel with no embedded-origin marker of any kind: not
        // `htmlEmbedded`, not `embeddedLang`, not the offset. Measured on vuejs
        // through the production path: 72 `exports[]` rows in 1 file, 0 of them
        // html's own, and every one of them indistinguishable from a hypothetical
        // html-authored export. That matters because it is the measurement the
        // lane's own doc got wrong — it read "markup has no module surface,
        // therefore 0 exports" over 1,200 files, and the truth is that the
        // inline-JS delegate contributed every export row while html
        // contributed none. The claim was right for the wrong reason and the
        // graph could not tell.
        //
        // ExportInfo has no `metadata` field in types.ts, so the marker is added
        // under the interface's own index signature rather than a new type. It
        // is read by no consumer today; it exists so a consumer CAN tell.
        // BOTH halves of the same treatment the symbols and the imports got, and
        // both were missing here.
        //
        // 1. LABEL. Every other channel this seam merges is stamped
        //    `htmlEmbedded`/`embeddedLang`/`embeddedLineOffset`, so a consumer can
        //    tell a delegate's row from the document's own. `exports` was the one
        //    channel that was not. Measured on this lane's corpus: 604 rows over
        //    1,185 documents, every one of them unstamped and every one naming a
        //    CSS SELECTOR (`body`, `.item`, `polygon`, `:root`) — because
        //    `real-css-analyzer.ts` publishes a top-level rule as an `exports` row
        //    and `pool-worker.ts` forwards `ParseResult.exports` whole, so those rows
        //    reach the index with no owner at all. An html file therefore claims to
        //    export `body`.
        //
        //    The defect survived a wave because this analyzer CONSTRUCTS no
        //    `exports` at all, which is true — so a reader auditing
        //    `real-html-analyzer.ts` sees no `exports` emission anywhere in it and
        //    no reason to look at the seam. A delegated row that does not name its
        //    source is invisible to exactly the reader who could fix it.
        //
        //    The row is still MERGED rather than dropped: the CSS lane's contract to
        //    publish a rule as an export is that lane's to defend, and dropping it
        //    here would delete another lane's payload from this lane's files. What
        //    this lane owes the index is an OWNER on every row it forwards.
        //
        // 2. COORDINATES. A delegate's range is BLOCK-RELATIVE in lines AND in
        //    bytes, and only the lines were shifted — the same asymmetry the
        //    symbols and imports have not had since the seam was written, because
        //    they were shifted in both axes from the start.
        if (e.range) {
          e.range = {
            ...e.range,
            startLine: e.range.startLine + lineOffset,
            endLine: e.range.endLine + lineOffset,
            startIndex: typeof e.range.startIndex === "number" ? e.range.startIndex + byteOffset : e.range.startIndex,
            endIndex: typeof e.range.endIndex === "number" ? e.range.endIndex + byteOffset : e.range.endIndex,
          }
        }
        e.metadata = { ...(e.metadata ?? {}), htmlEmbedded: true, embeddedLang: lang, embeddedLineOffset: lineOffset }
        exports.push(e)
      }

      // A delegate's errors are BLOCK-relative in lines and in bytes, for the same
      // reason as every other channel above.
      for (const er of (sub.errors ?? []) as any[]) {
        if (er.range) {
          er.range = {
            ...er.range,
            startLine: er.range.startLine + lineOffset,
            endLine: er.range.endLine + lineOffset,
            startIndex: typeof er.range.startIndex === "number" ? er.range.startIndex + byteOffset : er.range.startIndex,
            endIndex: typeof er.range.endIndex === "number" ? er.range.endIndex + byteOffset : er.range.endIndex,
          }
        }
        er.metadata = { ...(er.metadata ?? {}), htmlEmbedded: true, embeddedLang: lang, embeddedLineOffset: lineOffset }
        errors.push(er)
      }
    }
    return unavailable
  }

  /**
   * Fold one emission decision into the document metrics. O(1).
   *
   * A hyperlink that left the project is COUNTED and not graphed: the pre-fix
   * analyzer emitted a `uses` edge for every one, so a page linking to fifty
   * external sites published fifty graph edges that the enrichment pass then
   * scored for architectural criticality, and the differential could not tell a
   * CDN dependency from a hyperlink. The count survives in
   * `documentMetrics.externalLinkCount`, so the information is not lost — it is
   * where it belongs.
   */
  private countOutcome(outcome: ResourceOutcome, counters: { externalLinkCount: number; internalLinkCount: number }): void {
    if (outcome === "external") counters.externalLinkCount++
    else if (outcome === "navigation") counters.internalLinkCount++
  }

  // ==========================================================================
  // NODE / ATTRIBUTE ACCESS — index cursors, no array mapping, no regex
  // ==========================================================================

  /** The element's start_tag or self_closing_tag, or null. */
  private getStartTag(node: Node): Node | null {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child?.type === "start_tag" || child?.type === "self_closing_tag") return child
    }
    return null
  }

  private getElementTagName(node: Node): Node | null {
    const startTag = this.getStartTag(node)
    if (!startTag) return null
    for (let j = 0; j < startTag.childCount; j++) {
      const grandChild = startTag.child(j)
      if (grandChild?.type === "tag_name") return grandChild
    }
    return null
  }

  /**
   * Attribute map, LOWERCASED KEYS, plus the line each attribute is written on.
   *
   * The lowercasing is the whole point and it is the one-line defect that cost
   * this analyzer its entire graph on any document written in mixed case: the tag
   * name was lowercased and the attribute name was not, so `<IMG SRC=…>` matched
   * no rule and produced nothing. HTML attribute names are ASCII
   * case-INSENSITIVE; the grammar hands them over verbatim.
   */
  private extractElementAttributes(node: Node): { attrs: Record<string, string>; lines: Record<string, number> } {
    const attrs = map<string>()
    const lines = map<number>()
    const startTag = this.getStartTag(node)
    if (!startTag) return { attrs, lines }
    for (let j = 0; j < startTag.childCount; j++) {
      const attribute = startTag.child(j)
      if (attribute?.type !== "attribute") continue
      let attrName = ""
      let attrValue = ""
      let attrLine = attribute.startPosition.row + 1
      for (let k = 0; k < attribute.childCount; k++) {
        const attrChild = attribute.child(k)
        const t = attrChild?.type
        if (t === "attribute_name") {
          attrName = attrChild!.text
          attrLine = attrChild!.startPosition.row + 1
        } else if (t === "quoted_attribute_value" || t === "attribute_value") {
          // quoted_attribute_value > attribute_value: the inner node is the
          // unquoted value; for an unquoted attribute `attribute_value` is the
          // direct child. An empty value may lack the inner node, so fall back to
          // a pure-String unquote of the quoted text.
          const inner = this.findChildByType(attrChild!, "attribute_value")
          attrValue = inner ? inner.text : unquote(attrChild!.text)
        }
      }
      if (!attrName) continue
      const key = asciiLower(attrName)
      // First spelling wins, so `<input NAME=… name=…>` cannot have its identity
      // rewritten by a later duplicate.
      if (attrs[key] === undefined) {
        attrs[key] = attrValue
        lines[key] = attrLine
      }
    }
    return { attrs, lines }
  }

  /**
   * The range of ONE attribute of a start_tag, falling back to the element's own
   * range when the grammar gave us no attribute node for it. O(A) over the
   * start_tag's children, A = the tag's attribute count.
   */
  private attributeRange(
    startTag: Node | null,
    attrName: string,
    element: Node,
    line: number,
  ): ASTEngine.UniversalSymbol["range"] {
    if (startTag) {
      for (let j = 0; j < startTag.childCount; j++) {
        const attribute = startTag.child(j)
        if (attribute?.type !== "attribute") continue
        for (let k = 0; k < attribute.childCount; k++) {
          const an = attribute.child(k)
          if (an?.type === "attribute_name" && asciiLower(an.text) === attrName) {
            return {
              startLine: line,
              startColumn: an.startPosition.column + 1,
              endLine: an.endPosition.row + 1,
              endColumn: an.endPosition.column + 1,
              startIndex: attribute.startIndex,
              endIndex: attribute.endIndex,
            }
          }
        }
      }
    }
    const r = this.nodeToRange(element)
    r.startLine = line
    return r
  }

  private findChildByType(node: Node, type: string): Node | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === type) return c
    }
    return null
  }

  /** A directive attribute whose NAME ends with one of `suffixes` — the shape
   *  `v-if` / `ng-repeat` / `:show` / `x-if` all take. Pure-String, O(1) per attr. */
  private hasDirective(attrs: Record<string, string>, suffixes: readonly string[]): boolean {
    for (const key in attrs) {
      for (let s = 0; s < suffixes.length; s++) {
        const suffix = suffixes[s]
        if (key === suffix) return true
        if (key.length > suffix.length + 1 && key.endsWith(suffix) &&
            key.charCodeAt(key.length - suffix.length - 1) === 45 /* - */) {
          return true
        }
      }
    }
    return false
  }

  /**
   * The first FETCHABLE token of a `<link rel>` list, or null.
   *
   * `rel` is a space-separated token list, not one value: the ubiquitous
   * `rel="shortcut icon"` is two tokens, and `rel="preconnect stylesheet"` is a
   * hint plus a real document. Returning the token (rather than a boolean) is
   * what lets the edge say WHICH kind of link it is.
   */
  private fetchableRelToken(rel: string | undefined, filter: Record<string, boolean>): string | null {
    if (rel === undefined || rel.length === 0) return null
    const lowered = asciiLower(rel)
    const n = lowered.length
    let start = 0
    while (start < n) {
      while (start < n && isHtmlSpace(lowered.charCodeAt(start))) start++
      let end = start
      while (end < n && !isHtmlSpace(lowered.charCodeAt(end))) end++
      if (end > start) {
        const token = lowered.slice(start, end)
        if (filter[token]) return token
      }
      start = end
    }
    return null
  }

  private findDoctype(node: Node): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "doctype") {
        // `<!DOCTYPE html SYSTEM "about:legacy-compat">` — the declared root
        // name is the first non-punctuation child; `html` when it is bare.
        for (let j = 0; j < c.childCount; j++) {
          const d = c.child(j)
          if (d && d.type !== "<!" && d.type !== ">" && d.text.trim().length > 0) {
            return firstToken(d.text)
          }
        }
        return "html"
      }
    }
    return null
  }

  private documentLanguage(node: Node): string | null {
    for (let i = 0; i < node.namedChildCount; i++) {
      const c = node.namedChild(i)
      if (c && c.type === "element") {
        for (let j = 0; j < c.childCount; j++) {
          const startTag = c.child(j)
          if (startTag && (startTag.type === "start_tag" || startTag.type === "self_closing_tag")) {
            for (let k = 0; k < startTag.childCount; k++) {
              const a = startTag.child(k)
              if (a?.type === "attribute") {
                for (let m = 0; m < a.childCount; m++) {
                  const an = a.child(m)
                  if (an?.type === "attribute_name" && asciiLower(an.text) === "lang") {
                    const inner = this.findChildByType(a, "attribute_value")
                    return inner ? inner.text : unquote(a.text)
                  }
                }
              }
            }
          }
        }
      }
    }
    return null
  }

  /**
   * Accumulate each addressable element's addressable-subtree size into its
   * `complexity`, bottom-up, without an O(depth) walk per node.
   *
   * One reverse pass over the emitted symbols: a child's count is added to its
   * owner's accumulator. O(s) time, O(1) extra space beyond the accumulator map
   * that the symbol list itself already implies. Symbols whose owner is not in
   * this file (never, for html — every owner is either the module or another
   * emitted symbol) simply do not accumulate further.
   */
  private accumulateSubtreeSizes(symbols: ASTEngine.UniversalSymbol[]): void {
    // Null-prototype: the keys here are element handles, so `id="__proto__"` is a
    // reachable document and would otherwise write the prototype instead of a key.
    const totals = map<number>()
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      totals[s.name] = typeof s.complexity === "number" ? s.complexity : 1
    }
    for (let i = symbols.length - 1; i >= 1; i--) {
      const s = symbols[i]
      const owner = s.ownerName
      if (owner === undefined || totals[owner] === undefined) continue
      totals[owner] += totals[s.name]
    }
    for (let i = 0; i < symbols.length; i++) {
      const s = symbols[i]
      s.complexity = totals[s.name] ?? 1
    }
  }

  // ==========================================================================
  // SCORING — bounded, monotone, and every input is a MEASURED count
  // ==========================================================================

  private computeScores(m: {
    totalElements: number
    semanticCount: number
    interactiveCount: number
    formElementCount: number
    ariaCount: number
    headingCount: number
    headingLevelSkips: number
    imgCount: number
    imgWithAltCount: number
    iframeWithoutLoadingCount: number
    labelWithoutForCount: number
    inputWithoutLabelCount: number
    templateFragmentCount?: number
    branchCount: number
    maxDepth: number
    addressableCount: number
    customElementCount: number
  }): { accessibility: number; semantic: number; performance: number; architecturalScore: number } {
    // Semantic: share of real landmark/heading/sectioning elements. The
    // pre-fix denominator counted `html`/`head`/`body`/`script`/`style` too,
    // which diluted the ratio so hard that one `<h1>` among nine `<div>`s cleared
    // the bonus threshold.
    const countable = m.totalElements > 0 ? Math.max(1, m.totalElements - 4) : 1
    const semanticRatio = m.semanticCount / countable
    let semantic = 50
    if (semanticRatio > 0.05) semantic += 20
    if (semanticRatio > 0.15) semantic += 20
    if (m.headingCount === 0 && m.totalElements > 20) semantic -= 20

    // Accessibility: the four defects that are decidable from the DOM alone.
    let accessibility = 50
    if (m.imgCount > 0) {
      accessibility += Math.round((m.imgWithAltCount / m.imgCount) * 30)
    } else {
      accessibility += 20
    }
    if (m.ariaCount > 0) accessibility += 10
    if (m.headingCount > 0) accessibility += 10
    accessibility -= m.headingLevelSkips * 5
    accessibility -= Math.min(20, m.labelWithoutForCount * 5)
    accessibility -= Math.min(20, m.inputWithoutLabelCount)
    accessibility -= Math.min(15, m.iframeWithoutLoadingCount * 5)

    // Performance: the resource-hygiene defects that are decidable from the DOM.
    let performance = 80
    performance -= Math.min(40, m.iframeWithoutLoadingCount * 10)
    if (m.maxDepth > 30) performance -= 10
    performance -= Math.min(10, (m.templateFragmentCount ?? 0) * 2)

    const architecturalScore = Math.round(
      (clamp(semantic, 0, 100) + clamp(accessibility, 0, 100) + clamp(performance, 0, 100)) / 3,
    )
    return {
      accessibility: clamp(accessibility, 0, 100),
      semantic: clamp(semantic, 0, 100),
      performance: clamp(performance, 0, 100),
      architecturalScore,
    }
  }

  private nodeToRange(node: Node): ASTEngine.UniversalSymbol["range"] {
    return {
      startLine: node.startPosition.row + 1,
      startColumn: node.startPosition.column + 1,
      endLine: node.endPosition.row + 1,
      endColumn: node.endPosition.column + 1,
      startIndex: node.startIndex,
      endIndex: node.endIndex,
    }
  }
}

interface Frame {
  node: Node
  nearestNamed: string
  depth: number
  inBarrier?: boolean
}

interface DeferredReference {
  source: string
  handle: string
  /** `label` / `anchor` for the `uses` classes, or the IDREF rule's `kind`. */
  kind: string
  /** WHICH label the resolved edge carries. `uses` is the lane's ratified label
   *  for a form-control association and a navigation; `references` is the
   *  address-space naming class (css `var()`, scss `$var`, a type reference). */
  rel: "uses" | "references"
  /** The IDREF rule's `list`, carried to the emitted row as `metadata.idrefList`.
   *  Absent for the `label`/`anchor` classes, which name exactly one element. */
  list?: boolean
  line: number
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}
