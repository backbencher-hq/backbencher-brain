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
import { ASTEngine } from "./engine"

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
// ELEMENT VOCABULARIES
// ============================================================================

const SEMANTIC_ELEMENTS: Record<string, boolean> = {
  "header": true, "nav": true, "main": true, "section": true, "article": true,
  "aside": true, "footer": true, "h1": true, "h2": true, "h3": true, "h4": true,
  "h5": true, "h6": true, "figure": true, "figcaption": true, "time": true,
  "data": true, "mark": true, "details": true, "summary": true, "dialog": true,
  "meter": true, "progress": true, "search": true, "address": true, "hgroup": true,
}

const INTERACTIVE_ELEMENTS: Record<string, boolean> = {
  "button": true, "input": true, "select": true, "textarea": true, "a": true,
  "details": true, "summary": true, "dialog": true, "menu": true, "option": true,
  "optgroup": true, "label": true, "fieldset": true, "output": true, "area": true,
}

const FORM_ELEMENTS: Record<string, boolean> = {
  "form": true, "input": true, "select": true, "textarea": true, "button": true,
  "fieldset": true, "legend": true, "label": true, "datalist": true,
  "optgroup": true, "option": true, "output": true, "meter": true, "progress": true,
}

/** Elements whose content is NOT rendered where it is written (scope barriers). */
const TEMPLATE_BARRIERS: Record<string, boolean> = { "template": true, "slot": true }

/** `<link rel>` values that fetch a real subresource. `preconnect` and
 *  `dns-prefetch` name a HOST for a connection warm-up, not a document — the
 *  pre-fix analyzer mirrored both into `imports`, so `bb` claimed a dependency on
 *  `/f.ico`-style hints that nothing serves. */
const LINK_FETCHABLE_RELS: Record<string, boolean> = {
  "stylesheet": true, "icon": true, "shortcut icon": true, "apple-touch-icon": true,
  "apple-touch-icon-precomposed": true, "mask-icon": true, "manifest": true,
  "preload": true, "prefetch": true, "preload-stylesheet": true, "modulepreload": true,
  "import": true, "subresource": true, "alternate": true, "canonical": true,
}

/** The `resourceType` a fetchable `<link rel>` is recorded under, so an edge
 *  says WHAT it loads rather than only that a link exists. */
const LINK_RESOURCE_TYPES: Record<string, string> = {
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
}

/** `<param name>` values that make the param's `value` a real resource. */
const PARAM_RESOURCE_NAMES: Record<string, boolean> = {
  "movie": true, "src": true, "url": true, "codebase": true, "archive": true,
}

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

const RESOURCE_RULES: Record<string, ResourceRule[]> = {
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
  object: [{ attr: "data", resourceType: "object", import: true }],
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
}

/** `<input type=submit|image formaction=…>` is a form endpoint, and `type` decides
 *  which of the four `formaction` owners this is — so the rule is keyed on it. */
const FORM_ACTION_INPUT_TYPES: Record<string, boolean> = { submit: true, image: true }

/** The `formaction` rule for a submit/image `<input>`, as a table row so the
 *  emission path is identical to every other carrier (one code path, not two). */
const INPUT_FORMACTION_RULE: ResourceRule = { attr: "formaction", resourceType: "form-action", link: true }

/** What `emitResource` decided, so the caller can keep its document metrics exact
 *  without the emitter reaching back into the walk. */
type ResourceOutcome = "fetch" | "fragment" | "navigation" | "external" | "script-url" | "none"

/** Tag names whose own `class`/`id`-less presence still carries meaning for the
 *  metrics. Kept as data so the census can read the analyzer's own vocabulary. */
const HEADING_ELEMENTS: Record<string, boolean> = { h1: true, h2: true, h3: true, h4: true, h5: true, h6: true }

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
  analyze(rootNode: Node, content: string, filePath: string, context?: ASTEngine.AnalyzeContext): ASTEngine.ParseResult {
    const symbols: ASTEngine.UniversalSymbol[] = []
    const relationships: ASTEngine.UniversalRelationship[] = []
    const imports: ASTEngine.ImportInfo[] = []
    const exports: ASTEngine.ExportInfo[] = []
    const errors: ASTEngine.ParseError[] = []

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
    const usedNames: Record<string, number> = { [moduleName]: 1 }
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
    const handleToSymbol: Record<string, string> = {}
    const ambiguousHandles: Record<string, boolean> = {}

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
    const frameworks: Record<string, boolean> = { HTML5: true }
    const insights: Record<string, boolean> = {}

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
            // A custom element's tag name is its COMPONENT NAME — the one thing in
            // a plain-HTML document that a graph can join against a JS class
            // definition of the same name. That is an `instantiates`-shaped fact
            // about a tag, not a styling hint.
            frameworks["Web Components"] = true
            insights["Custom elements declared as web components"] = true
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
          // `<label for>` and a fragment href are REAL references in the
          // document's address space, which is exactly why `id`/`name` are the
          // identity attributes. They are DEFERRED so a forward reference (a
          // link to an id declared further down) resolves as well as a backward
          // one — HTML allows both, and the pre-fix analyzer resolved labels
          // through an `idMap` it had already finished building, so a label
          // pointing at a LATER input silently emitted nothing.
          if (tagName === "label") {
            const forAttr = attrs["for"]
            if (forAttr && forAttr.length > 0) {
              deferred.push({
                source: frame.nearestNamed,
                handle: forAttr,
                kind: "label",
                line: lineOf("for"),
              })
            } else {
              counters.labelWithoutFor++
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
      // does not exist, or an anchor to a missing id, is not a reference. This is
      // the same honesty rule the pre-fix analyzer had and kept.
      if (target === undefined) continue
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
    if (customElementCount > 0) insights["Custom elements utilized"] = true
    if (templateFragmentCount > 0) insights["Deferred template fragments present"] = true
    if (baseHrefCount > 0) insights["Base URL rewrites relative resource resolution"] = true
    if (counters.externalLinkCount > 0) insights["Outbound cross-origin navigation (recorded, not graphed)"] = true

    const patterns: string[] = []
    if (hasForm) patterns.push("Form Controls Usage")
    if (semanticCount > 0) patterns.push("Semantic HTML5 Structure")
    if (ariaCount > 0) patterns.push("ARIA Accessibility Enhancements")
    if (addressableCount > 0) patterns.push("Addressable DOM Identity")
    if (customElementCount > 0) patterns.push("Web Component Usage")

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
        deferred.push({ source, handle: fragment, kind: "anchor", line })
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
        metadata: {
          htmlSpecific: true,
          resourceType: rule.resourceType,
          isNavigation: rule.navigation === true,
          // A form endpoint is a dependency on a backend route, which is a
          // materially different fact from "the user can click away".
          isFormEndpoint: rule.navigation !== true,
          evidenceClass: "usage_contextual",
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
    const delegates: Record<string, any> = {}
    const delegateFor = (lang: string): any | null => {
      if (delegates[lang] !== undefined) return delegates[lang]
      let instance: any = null
      try {
        // `require` rather than `await import`: `mergeEmbeddedBlocks` is called
        // from the synchronous analyzer body, and a dynamic import would make the
        // whole analyzer async for a benefit the engine already provides (it
        // resolves every analyzer through its own loader). The indirection is
        // deliberate — it is what makes the failure local instead of fatal.
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
        instance = null
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
              embeddedLang: lang,
              evidenceClass: "structural",
            },
          })
        }
      }

      for (const r of (sub.relationships ?? []) as any[]) {
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
        exports.push(e)
      }

      // A delegate's errors are BLOCK-relative; shifting them keeps a consumer's
      // error list in one coordinate system (the M49 H4 lesson on the svelte seam).
      for (const er of (sub.errors ?? []) as any[]) {
        if (er.range) er.range = { ...er.range, startLine: er.range.startLine + lineOffset, endLine: er.range.endLine + lineOffset }
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
    const attrs: Record<string, string> = {}
    const lines: Record<string, number> = {}
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
    const totals: Record<string, number> = {}
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
  kind: "label" | "anchor"
  line: number
}

function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value
}
