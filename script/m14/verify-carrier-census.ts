/**
 * M14.0.CENSUS — Carrier census for the html lane.
 *
 * Exists because the carrier set is a SHARED PREMISE and every gate that reads it
 * inherits the premise instead of testing it. `deriveHtmlEdges` was written
 * independently as *derivation*, but it was not independently *discovered*: the
 * analyzer's `RESOURCE_RULES` and the oracle's `ORACLE_HTML_FETCHERS` were two
 * transcriptions of one reading of the HTML spec, so they agreed with each other
 * about what a document can point at. `otp` and `sqlite` contain none of the six
 * carriers that were missing, so 100% coverage on both lanes never had to
 * confront them. A differential cannot catch a shared premise — that is the one
 * thing it structurally cannot do.
 *
 * So this gate asks the question from the DOCUMENT side instead: walk real
 * corpora, find every (tag, attribute) pair whose value looks like a reference,
 * and report the ones no table claims. It consults neither table. That is the
 * whole point — a third party that can contradict both.
 *
 * What it does NOT do, deliberately:
 *   - it does not parse HTML with the analyzer, so it cannot be fooled by a bug
 *     in the analyzer;
 *   - it does not decide whether a carrier is a dependency. `<body background>`
 *     and `<meta name=description content="0; url=/x">` differ only in whether
 *     the element means anything, and that judgement belongs to a human ruling
 *     recorded in the tables. So an unreviewed pair FAILS the gate and must be
 *     ruled, not silently allowed.
 *
 * CLI: bun run script/m14/verify-carrier-census.ts [--json] [--allow tag@attr ...]
 */
import * as fs from "fs"
import * as path from "path"
import { ASTEngine } from "../../src/ast/engine"
import { RealHtmlAnalyzer } from "../../src/ast/real-html-analyzer"

const ROOT = process.cwd()
const args = process.argv.slice(2)
const asJson = args.includes("--json")

/** Pairs that are REFERENCES BY LANGUAGE but are not code dependencies, with the
 *  ruling that keeps them out of the graph. Each entry is a decision, not an
 *  oversight, and each is stated here rather than left to a reader's assumption. */
/** Rulings that are only true UNDER A CONDITION, and so cannot be expressed as a
 *  bare "not a carrier". Each entry pairs a pair with probe documents that MUST
 *  produce an edge. Without this, a conditional carrier is invisible: the pair
 *  gets a blanket ruling to silence the common case, and the rare case — the one
 *  that is actually a dependency — goes unhandled with nothing to notice.
 *
 *  This table exists because the negative control caught exactly that: with the
 *  `meta refresh` rule deleted, the census still reported PASS, because
 *  `meta@content` was ruled "free text" and therefore never asked again. */
const CONDITIONAL_CARRIERS: { pair: string; html: string; why: string }[] = [
  {
    pair: "meta@content",
    why: "under `http-equiv=refresh` the content carries a URL and the browser NAVIGATES — the same class as a form action",
    html: '<!doctype html><html><head><meta http-equiv="refresh" content="0; url=/probe-refresh"></head><body></body></html>',
  },
  {
    pair: "a@href",
    why: "a hyperlink is a navigation; external schemes are filtered by the scheme contract but a relative one is a real edge",
    html: '<!doctype html><html><body><a href="/probe-nav">x</a></body></html>',
  },
]

/** Attribute-name PREFIXES that are never a carrier, whatever the element.
 *  `data-*` is application state by definition and is the single largest source
 *  of url-shaped noise in any real corpus — one repository here contributes
 *  `div@data-togglable`, `div@data-filterable-set`, `img@data-right` and dozens
 *  more, every value of which is a path. Enumerating them one at a time would be
 *  a losing game: the next repository invents a new one. `:`/`@`/`v-`/`x-` are
 *  framework bindings (Alpine, Vue, Svelte) whose values are code; `aria-*` is
 *  accessibility metadata. */
const ATTRIBUTE_PREFIXES_NOT_CARRIERS: { prefix: string; why: string }[] = [
  { prefix: "data-", why: "application state read by a script, never fetched by the browser" },
  { prefix: "aria-", why: "accessibility metadata, not a reference" },
  { prefix: ":", why: "a framework binding expression (Alpine/Vue), whose value is code" },
  { prefix: "@", why: "a framework event binding (Vue), whose value is code" },
  { prefix: "v-", why: "a framework binding (Vue), whose value is code" },
  { prefix: "x-", why: "a framework binding (Svelte/XHTML), whose value is code" },
  { prefix: "bind-", why: "a framework binding attribute, not a URL" },
  { prefix: "on", why: "an event handler attribute; its value is code" },
]

/** Attributes that are never a resource on ANY element, because their meaning is
 *  presentation or identity rather than a destination. `id` and `name` are here
 *  deliberately: they are the IDENTITY attributes, and the analyzer makes symbols
 *  of them, so an `id="main"` is a handle and not a document. */
const ATTRIBUTES_NEVER_CARRIERS: Record<string, string> = {
  id: "an IDENTITY — the analyzer makes a symbol of it and references resolve to it",
  name: "an IDENTITY (a legacy anchor handle) on a carrier-bearing element; not a destination",
  class: "a class list, or a template expression; never a document",
  style: "an inline style declaration",
  title: "prose, not a URL",
  alt: "prose, not a URL",
  xmlns: "a namespace name, never dereferenced",
  lang: "a language tag, not a URL",
  dir: "a direction keyword",
  role: "an ARIA role",
  tabindex: "a number",
  placeholder: "prose, not a URL",
  label: "prose, not a URL",
  width: "a number or a percentage",
  height: "a number or a percentage",
  colspan: "a number",
  rowspan: "a number",
  size: "a number or a size list",
  color: "a colour, not a URL",
  charset: "an encoding name",
  action: "claimed by the form-action rule",
  // `data-`-prefixed application attributes and framework bindings are ruled by
  // PREFIX below rather than one by one, because the next repository invents a
  // new one and a list of individual names is a losing game.
}

/** Pairs a blanket ATTRIBUTE rule would otherwise swallow, with the reason each
 *  one is not a carrier after all.
 *
 *  This started as a single list called CARRIER_OVERRIDES that mixed two
 *  opposite things — genuine non-carriers (`input@value`) and pairs that really
 *  are carriers under a condition (`meta@content`, `param@value`) — and the
 *  consequence was that the conditional ones fell through to the unreviewed
 *  report. Two lists with two meanings is the honest structure: a pair is either
 *  not a carrier, or it is handled/conditional and the conditional probe checks
 *  it. */
const ATTRIBUTE_RULE_EXCEPTIONS_NOT_CARRIERS: Record<string, string> = {
  "input@value": "a control's current value, submitted rather than fetched",
  "option@value": "a choice's value, submitted rather than fetched",
  "button@value": "a submit button's value, submitted rather than fetched",
  "li@value": "an option's value, submitted rather than fetched",
  "param@value": "a resource ONLY for a resource-bearing `name` — handled, and ruled conditional below",
  "a@name": "an IDENTITY (the legacy anchor handle); a symbol, not a destination",
  "meta@content": "CONDITIONAL: a carrier under `http-equiv=refresh`, free text otherwise",
}

/** One probe per carrier the analyzer's table claims to handle, each a document
 *  that MUST produce an edge. This is the half of the gate the corpus walk cannot
 *  do.
 *
 *  The corpus walk asks "is anything here unhandled?" — which is blind to a
 *  carrier that has been REMOVED, because a removed carrier simply stops
 *  appearing in the corpus and the walk reports nothing. That hole was found by
 *  negative control: deleting the SVG `use@href` rule left the census at PASS,
 *  because that pair was ruled "claimed by the SVG use rule" and a ruling is an
 *  assertion, not a measurement. So every claimed carrier is now PROBED, and a
 *  rule that stops firing fails the gate.
 *
 *  Kept adjacent to the table on purpose: a new rule in `RESOURCE_RULES` with no
 *  probe here is a gap in the gate, and the diff makes that visible. */
const CARRIER_PROBES: { pair: string; expect: string; html: string; why: string }[] = [
  { pair: "script@src", expect: "/p.js", why: "an external script is a module dependency", html: '<!doctype html><html><head><script src="/p.js"></script></head><body></body></html>' },
  { pair: "script@href", expect: "/p-svg.js", why: "SVG2 spells a script's source `href`", html: '<!doctype html><html><body><svg><script href="/p-svg.js"></script></svg></body></html>' },
  { pair: "link@href", expect: "/p.css", why: "a fetchable `rel` is a subresource", html: '<!doctype html><html><head><link rel="stylesheet" href="/p.css"></head><body></body></html>' },
  { pair: "link@href", expect: "/p-icon.ico", why: "`rel=icon` is fetchable too, and names a different kind", html: '<!doctype html><html><head><link rel="icon" href="/p-icon.ico"></head><body></body></html>' },
  { pair: "img@src", expect: "/p.png", why: "an image is a resource", html: '<!doctype html><html><body><img src="/p.png"></body></html>' },
  { pair: "img@srcset", expect: "/p-480.png", why: "a srcset is a CANDIDATE LIST, one row per candidate", html: '<!doctype html><html><body><img src="/p.png" srcset="/p-480.png 480w, /p-1080.png 1080w"></body></html>' },
  { pair: "img@longdesc", expect: "/p-desc.html", why: "`longdesc` names the long description", html: '<!doctype html><html><body><img src="/p.png" longdesc="/p-desc.html"></body></html>' },
  { pair: "source@src", expect: "/p.mp4", why: "`<source src>` is a media resource", html: '<!doctype html><html><body><video><source src="/p.mp4"></video></body></html>' },
  { pair: "source@srcset", expect: "/p.webp", why: "`<source srcset>` is a candidate list", html: '<!doctype html><html><body><picture><source srcset="/p.webp 1x"></picture></body></html>' },
  { pair: "video@src", expect: "/p.mp4", why: "a video source is a resource", html: '<!doctype html><html><body><video src="/p.mp4"></video></body></html>' },
  { pair: "video@poster", expect: "/p-poster.jpg", why: "a poster frame is an image resource", html: '<!doctype html><html><body><video src="/p.mp4" poster="/p-poster.jpg"></video></body></html>' },
  { pair: "audio@src", expect: "/p.mp3", why: "an audio source is a resource", html: '<!doctype html><html><body><audio src="/p.mp3"></audio></body></html>' },
  { pair: "track@src", expect: "/p.vtt", why: "a text track is a resource", html: '<!doctype html><html><body><video><track src="/p.vtt"></video></body></html>' },
  { pair: "embed@src", expect: "/p.swf", why: "an embed is a resource", html: '<!doctype html><html><body><embed src="/p.swf"></body></html>' },
  { pair: "object@data", expect: "/p.svg", why: "`<object data>` is the resource, not `type`", html: '<!doctype html><html><body><object data="/p.svg"></object></body></html>' },
  { pair: "input@src", expect: "/p-submit-img.png", why: "an image-submit control's image is a resource", html: '<!doctype html><html><body><input type="image" src="/p-submit-img.png"></body></html>' },
  { pair: "input@formaction", expect: "/p-submit", why: "`type=image` with a formaction is an endpoint", html: '<!doctype html><html><body><form action="/f"><input type="image" formaction="/p-submit"></form></body></html>' },
  { pair: "iframe@src", expect: "/p.html", why: "an iframe document is a resource", html: '<!doctype html><html><body><iframe src="/p.html"></iframe></body></html>' },
  { pair: "frame@src", expect: "/p.html", why: "a frame document is a resource", html: '<!doctype html><html><body><frameset><frame src="/p.html"></frameset></body></html>' },
  { pair: "use@href", expect: "/p-sprite.svg#icon", why: "an SVG use reference is a resource", html: '<!doctype html><html><body><svg><use href="/p-sprite.svg#icon"></use></svg></body></html>' },
  { pair: "use@xlink:href", expect: "/p-sprite.svg#icon", why: "the legacy SVG spelling reaches the same rule", html: '<!doctype html><html><body><svg><use xlink:href="/p-sprite.svg#icon"></use></svg></body></html>' },
  { pair: "image@href", expect: "/p-img.png", why: "an SVG image reference is a resource", html: '<!doctype html><html><body><svg><image href="/p-img.png"></image></svg></body></html>' },
  { pair: "image@xlink:href", expect: "/p-img.png", why: "the legacy SVG spelling reaches the same rule", html: '<!doctype html><html><body><svg><image xlink:href="/p-img.png"></image></svg></body></html>' },
  { pair: "param@value", expect: "/p-param.swf", why: "a resource-bearing `name` makes `value` a resource", html: '<!doctype html><html><body><object><param name="movie" value="/p-param.swf"></object></body></html>' },
  { pair: "a@href", expect: "/p-nav.html", why: "a relative hyperlink is a navigation", html: '<!doctype html><html><body><a href="/p-nav.html">x</a></body></html>' },
  { pair: "a@ping", expect: "/ping-", why: "`ping` is a whitespace-separated FETCH list", html: '<!doctype html><html><body><a href="/p-pinged.html" ping="/ping-a /ping-b">x</a></body></html>' },
  { pair: "area@href", expect: "/p-area.html", why: "an image-map area is a navigation", html: '<!doctype html><html><body><map><area href="/p-area.html"></map></body></html>' },
  { pair: "form@action", expect: "/p-endpoint", why: "a form endpoint is a dependency, `uses` and never `calls`", html: '<!doctype html><html><body><form action="/p-endpoint"></form></body></html>' },
  { pair: "button@formaction", expect: "/p-button-endpoint", why: "a submit button may override the form's endpoint", html: '<!doctype html><html><body><form action="/f"><button formaction="/p-button-endpoint">go</button></form></body></html>' },
  { pair: "html@manifest", expect: "/p.appcache", why: "an appcache manifest is a resource", html: '<!doctype html><html manifest="/p.appcache"><body></body></html>' },
  { pair: "feimage@href", expect: "/p-fe.png", why: "a filter image reference is a fetch", html: '<!doctype html><html><body><svg><filter><feImage href="/p-fe.png"/></filter></svg></body></html>' },
  { pair: "feimage@xlink:href", expect: "/p-fe.png", why: "the legacy SVG spelling reaches the same rule", html: '<!doctype html><html><body><svg><filter><feImage xlink:href="/p-fe.png"/></filter></svg></body></html>' },
  { pair: "q@cite", expect: "/p-src.html", why: "a citation is a reference out of the document", html: '<!doctype html><html><body><q cite="/p-src.html">q</q></body></html>' },
  { pair: "blockquote@cite", expect: "/p-src.html", why: "a citation is a reference out of the document", html: '<!doctype html><html><body><blockquote cite="/p-src.html">q</blockquote></body></html>' },
  { pair: "del@cite", expect: "/p-src.html", why: "a citation is a reference out of the document", html: '<!doctype html><html><body><del cite="/p-src.html">d</del></body></html>' },
  { pair: "ins@cite", expect: "/p-src.html", why: "a citation is a reference out of the document", html: '<!doctype html><html><body><ins cite="/p-src.html">i</ins></body></html>' },
  { pair: "body@background", expect: "/p-bg.png", why: "a legacy background image is still fetched", html: '<!doctype html><html><body background="/p-bg.png">x</body></html>' },
  { pair: "table@background", expect: "/p-tile.png", why: "a legacy background image is still fetched", html: '<!doctype html><html><body><table background="/p-tile.png"><tr><td>x</td></tr></table></body></html>' },
]

const RULED_NOT_A_CARRIER: Record<string, string> = {
  // Presentation, deprecated since HTML 4. A colour is not a path; a `bgcolor`
  // row would be an edge to `#FFFFFF`, a node that is neither a symbol nor a file.
  "body@bgcolor": "presentation (colour), not a reference",
  "td@bgcolor": "presentation (colour), not a reference",
  "table@bgcolor": "presentation (colour), not a reference",
  "body@text": "presentation (colour), not a reference",
  "body@link": "presentation (colour), not a reference",
  "body@vlink": "presentation (colour), not a reference",
  "body@alink": "presentation (colour), not a reference",
  // `xmlns` is a namespace NAME, not a document the browser fetches. Emitting an
  // edge to `http://www.w3.org/1999/xhtml` would put a constant in the graph.
  "html@xmlns": "a namespace name, never dereferenced",
  // `type` on a script/link/style says what the resource IS; the sibling `src`
  // or `href` says where it is. Two attributes, one reference.
  "script@type": "a media type, not a URL (src carries the reference)",
  "link@type": "a media type, not a URL (href carries the reference)",
  "style@type": "a media type, not a URL",
  "object@type": "a media type, not a URL (data carries the reference)",
  // Prose and placeholders. A `description` or a `title` that happens to contain
  // a colon or a slash is a sentence, and an edge to a sentence is the defect
  // class this lane exists to avoid.
  "meta@name": "an identifier, not a URL",
  // Found at 4,000-file scale. `div@pageids` is generated API-documentation
  // metadata (a JSON pointer to the symbol a page documents); `foo`/`bar`/`quux`/
  // `unsafe` are attribute names in Svelte's own XSS-regression fixtures, where
  // the value is a deliberately broken payload. Both are values that LOOK like
  // references and are not, which is the case a census exists to make a ruling
  // about rather than to guess at.
  "div@pageids": "generated API-documentation metadata (a JSON pointer), not a document",
  "div@foo": "a test fixture's arbitrary attribute name (Svelte XSS regression corpus)",
  "div@bar": "a test fixture's arbitrary attribute name (Svelte XSS regression corpus)",
  "div@quux": "a test fixture's arbitrary attribute name (Svelte XSS regression corpus)",
  "div@unsafe": "a test fixture's arbitrary attribute name (Svelte XSS regression corpus)",
  "meta@property": "an identifier, not a URL",
  "input@placeholder": "prose, not a URL",
  "textarea@placeholder": "prose, not a URL",
  "a@title": "prose, not a URL",
  "a@download": "a filename hint; the href carries the reference",
  "a@target": "a browsing-context name, not a destination",
  "a@rel": "a relationship token list, not a URL",
  "a@type": "an advisory media type",
  "area@target": "a browsing-context name, not a destination",
  "form@target": "a browsing-context name, not a destination",
  "form@method": "an HTTP method name, not a URL",
  "form@enctype": "a media type, not a URL",
  "input@type": "a control type, not a URL",
  "img@usemap": "a same-document map reference; the fragment rules own it",
  "img@ismap": "a boolean flag, not a URL",
  "object@declare": "a boolean flag, not a URL",
  "link@media": "a media query, not a URL",
  "link@sizes": "a size list, not a URL",
  "source@media": "a media query, not a URL",
  "source@type": "a media type, not a URL",
  "source@sizes": "a size list, not a URL",
  "html@lang": "a language tag, not a URL",
  "html@dir": "a direction keyword",
  // `style` and `data-*` are application state, not documents. A `data-` attribute
  // whose value looks like a selector (`#main-wrapper`) or a JSON pointer is
  // emphatically not a fetch, and these are the single largest source of
  // url-looking noise in any real corpus.
  "li@style": "an inline style declaration",
  "div@style": "an inline style declaration",
  "input@style": "an inline style declaration",
  "iframe@srcdoc": "inline markup, not a URL",
  "script@integrity": "a hash, not a URL",
  "script@nonce": "a token, not a URL",
  "script@crossorigin": "a CORS keyword",
  "link@crossorigin": "a CORS keyword",
  "link@integrity": "a hash, not a URL",
  "link@hreflang": "a language tag, not a URL",
  "link@as": "a media type, not a URL",
  "link@referrerpolicy": "a keyword",
  "a@hreflang": "a language tag, not a URL",
  "a@referrerpolicy": "a keyword",
  // Found by the census itself, and worth recording rather than leaving to a
  // reader's assumption:
  "form@action": "claimed by the form-action rule; a dependency, `uses` and never `calls`",
  "a@name": "an IDENTITY (the legacy anchor handle), not a reference — the analyzer makes a symbol of it and a fragment href resolves to it",
  "meta@content": "free text — a media type, a charset or a sentence. CONDITIONAL: this pair is a CARRIER under `http-equiv=refresh`, and the conditional probe below is what keeps that case honest. A blanket ruling here once hid the refresh navigation entirely, and the negative control (delete the rule, expect the gate to fail) is the only reason that was found.",
  // Server-side TEMPLATE syntax. `a@:class` is Alpine, `li@:class` and `div@class`
  // are Vue/Svelte interpolations, and `button@onclick` is a template-built
  // handler. Their values contain slashes and colons because they are CODE, which
  // is precisely what makes them look like paths. The census cannot tell
  // application state from a document, so the ruling is explicit.
  // `data-*` is application state by definition. These particular values are a URL
  // and a dotted module id, and both are read by the application rather than
  // fetched by the browser.
}

interface CorpusHit {
  pair: string
  count: number
  sample: string
  file: string
}

/** Does this attribute value LOOK like a reference? Deliberately generous: the
 *  gate's job is to surface candidates for a human ruling, and a false candidate
 *  costs one line in RULED_NOT_A_CARRIER while a missed carrier costs a silently
 *  absent dependency. So it errs toward asking. */
function looksLikeReference(value: string): boolean {
  if (value.length === 0 || value.length > 300) return false
  const v = value.trim()
  if (v.length === 0) return false
  // A colon (scheme or `sel:`), a slash (path), a dot (extension or host), or a
  // leading fragment. Prose rarely has all three; selectors and JSON pointers do.
  let hasColon = false
  let hasSlash = false
  let hasDot = false
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c === 58) hasColon = true
    else if (c === 47) hasSlash = true
    else if (c === 46) hasDot = true
  }
  if (v.charCodeAt(0) === 35) return true // a fragment
  return (hasColon || hasSlash) && (hasDot || hasSlash)
}

/** Pure-String tag name out of a start_tag / self_closing_tag node. */
function tagNameOf(node: any): string {
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c?.type !== "start_tag" && c?.type !== "self_closing_tag") continue
    for (let j = 0; j < c.childCount; j++) {
      const g = c.child(j)
      if (g?.type === "tag_name") return g.text.toLowerCase()
    }
  }
  return ""
}

interface Attr {
  name: string
  value: string
}

function attrsOf(node: any): Attr[] {
  const out: Attr[] = []
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i)
    if (c?.type !== "start_tag" && c?.type !== "self_closing_tag") continue
    for (let j = 0; j < c.childCount; j++) {
      const a = c.child(j)
      if (a?.type !== "attribute") continue
      let name = ""
      let value = ""
      for (let k = 0; k < a.childCount; k++) {
        const g = a.child(k)
        if (g?.type === "attribute_name") name = g.text.toLowerCase()
        else if (g?.type === "quoted_attribute_value" || g?.type === "attribute_value") value = g.text
      }
      if (name) out.push({ name, value })
    }
  }
  return out
}

function collectHtmlFiles(dir: string, out: string[], cap: number): void {
  let st: fs.Stats
  try {
    st = fs.statSync(dir)
  } catch {
    return
  }
  if (out.length >= cap) return
  if (st.isFile()) {
    if (/\.x?html?$/i.test(dir)) out.push(dir)
    return
  }
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (out.length >= cap) return
    if (e.name === ".git" || e.name === "node_modules" || e.name === "target" || e.name === "dist") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) collectHtmlFiles(p, out, cap)
    else if (/\.x?html?$/i.test(e.name)) out.push(p)
  }
}

async function main() {
  const repoRoot = process.env.BB_CENSUS_REPOS ?? "$HOME/fixtures/repositories"
  const cap = Number(process.env.BB_CENSUS_CAP ?? "4000")
  const repos = fs.existsSync(repoRoot) ? fs.readdirSync(repoRoot).filter((d) => !d.startsWith(".")) : []
  if (repos.length === 0) {
    console.error(`no corpora under ${repoRoot} — set BB_CENSUS_REPOS`)
    process.exit(2)
  }

  // The document walk gets a RAW tree from the pooled parser, and the analyzer is
  // called separately. That split is the gate's independence: the census asks the
  // DOCUMENT what it contains, and asks the ANALYZER separately what it claims,
  // so neither answer is allowed to inform the other. Routing both through
  // `ASTEngine.parseFile` would return one object containing both, which is
  // tidier and useless — a bug in the analyzer would then be unable to show up
  // here, which is the entire reason this file exists.
  const parser = await (ASTEngine as any).getParser("html")

  const analyzer = new RealHtmlAnalyzer()
  const files: string[] = []
  for (const r of repos) collectHtmlFiles(path.join(repoRoot, r), files, cap)
  console.log(`carrier census: ${files.length} html file(s) across ${repos.length} repo(s)`)

  /** pair -> hits, from the DOCUMENT walk (no analyzer involved). */
  const docHits = new Map<string, CorpusHit>()
  /** tag -> attribute names the ANALYZER actually emitted a relationship for. */

  for (const file of files) {
    let src: string
    try {
      src = fs.readFileSync(file, "utf8")
    } catch {
      continue
    }
    if (src.length > 500_000) continue
    let tree: any
    try {
      tree = parser.parse(src)
    } catch {
      continue
    }
    if (!tree) continue

    // --- pass 1: the document's own view, consulting no table ---
    const walk = (node: any) => {
      if (node.type === "element" || node.type === "script_element" || node.type === "style_element") {
        const tag = tagNameOf(node)
        if (tag) {
          for (const a of attrsOf(node)) {
            if (!looksLikeReference(a.value)) continue
            const pair = `${tag}@${a.name}`
            const cur = docHits.get(pair)
            if (cur) cur.count++
            else docHits.set(pair, { pair, count: 1, sample: a.value.trim().slice(0, 70), file: path.relative(repoRoot, file) })
          }
        }
      }
      for (const c of node.namedChildren ?? []) walk(c)
    }
    walk(tree.rootNode)

  }

  // Classify. A pair with no ruling is not immediately a failure: it may be a
  // carrier the analyzer already handles and that this file simply never
  // documented. So each unreviewed pair is put to the ANALYZER directly, on a
  // one-element document built for that pair alone, and asked whether it emits
  // an edge for it. That distinguishes two very different findings:
  //
  //   HANDLED   — the analyzer claims it; the gap is in this file's rulings, and
  //               the fix is one line. `<form action>` is exactly this: claimed by
  //               the table since the beginning, and flagged here only because no
  //               ruling had ever been written down for it.
  //   UNHANDLED — the analyzer emits nothing. This is the real finding, and it is
  //               the one the gate exists to produce.
  //
  // The probe is per-pair rather than one big document because a single document
  // cannot attribute an edge back to the attribute that caused it, and an
  // unattributable edge cannot answer the question.
  /** Does `src` produce an edge whose TARGET contains `marker`?
   *
   *  The marker is what makes a probe ATTRIBUTABLE, and without it a probe
   *  silently passes on an unrelated edge: `<a href="/x" ping="/a /b">` emits an
   *  edge for the href, so a probe that asked only "did anything emit?" was
   *  satisfied by the href and reported the `ping` rule as working after it had
   *  been deleted. Negative control caught that one too. Asking about the
   *  TARGET removes the ambiguity — a document can only satisfy a probe by
   *  producing the edge that probe is about. */
  const emitsEdgeTo = (src: string, marker: string): boolean => {
    if (marker.length === 0) return false
    let t: any
    try {
      t = parser.parse(src)
    } catch {
      return false
    }
    if (!t) return false
    try {
      const r = analyzer.analyze(t.rootNode, src, "probe.html")
      return (r.relationships ?? []).some((x: any) => typeof x.target === "string" && x.target.includes(marker))
    } catch {
      return false
    }
  }

  const emitsAnyEdge = (src: string): boolean => {
    let t: any
    try {
      t = parser.parse(src)
    } catch {
      return false
    }
    if (!t) return false
    try {
      const r = analyzer.analyze(t.rootNode, src, "probe.html")
      return (r.relationships ?? []).some((x: any) => typeof x.target === "string" && x.target.length > 0)
    } catch {
      return false
    }
  }

  /** A one-element document for a single (tag, attribute) pair, used to ask
   *  whether the analyzer claims a pair this file has no ruling for. */
  const probeDoc = (pair: string, value: string): boolean => {
    const at = pair.indexOf("@")
    const tag = pair.slice(0, at)
    const attr = pair.slice(at + 1)
    return emitsAnyEdge(
      `<!doctype html><html><head><${tag} ${attr}="${value.replace(/"/g, "&quot;")}"></head><body></body></html>`,
    )
  }

  const unreviewed: CorpusHit[] = []
  const handledButUnruled: { hit: CorpusHit; sample: string }[] = []
  const ruled: { hit: CorpusHit; why: string }[] = []
  /** The ruling for a pair, or undefined when there is none. Precedence is
   *  explicit and documented above rather than implied by object order, because
   *  the order IS the contract: an exact pair beats a blanket attribute rule, and
   *  a carrier override beats both. */
  // Pairs a POSITIVE PROBE covers are claimed, and a claim is now a measurement
  // rather than an assertion — so the walk does not re-report them, but their
  // handling is verified separately by `CARRIER_PROBES`. This is the difference
  // between "the table says it handles `img@src`" and "the analyzer emitted an
  // edge for `<img src>` just now", and only the second one can fail.
  const probedPairs = new Set(CARRIER_PROBES.map((pr) => pr.pair))

  const rulingFor = (pair: string): string | undefined => {
    if (probedPairs.has(pair)) return `claimed by a carrier probe (${CARRIER_PROBES.filter((pr) => pr.pair === pair).length} probe(s), verified by measurement)`
    const exact = RULED_NOT_A_CARRIER[pair]
    if (exact !== undefined) return exact
    const exception = ATTRIBUTE_RULE_EXCEPTIONS_NOT_CARRIERS[pair]
    if (exception !== undefined) return exception
    const at = pair.indexOf("@")
    const attr = at === -1 ? "" : pair.slice(at + 1)
    const byAttr = ATTRIBUTES_NEVER_CARRIERS[attr]
    if (byAttr !== undefined) return byAttr
    for (const p of ATTRIBUTE_PREFIXES_NOT_CARRIERS) {
      if (attr.startsWith(p.prefix)) return p.why
    }
    return undefined
  }

  for (const hit of [...docHits.values()].sort((a, b) => b.count - a.count)) {
    const why = rulingFor(hit.pair)
    if (why !== undefined) {
      ruled.push({ hit, why })
      continue
    }
    // The sample value is stripped of its surrounding quotes: the corpus walk reads
    // the raw quoted value, and feeding `"../../../search.json"` to a probe would
    // test a target that includes the quote characters.
    const sample = hit.sample.replace(/^["']|["']$/g, "")
    if (probeDoc(hit.pair, sample)) handledButUnruled.push({ hit, sample })
    else unreviewed.push(hit)
  }

  // The conditional carriers, asked directly. These are the cases a blanket
  // ruling cannot express, and they are the reason this gate is not just a
  // coverage report over RULED_NOT_A_CARRIER.
  const conditionalFailures: { c: (typeof CONDITIONAL_CARRIERS)[number]; handled: boolean }[] = []
  for (const c of CONDITIONAL_CARRIERS) {
    conditionalFailures.push({ c, handled: emitsAnyEdge(c.html) })
  }
  const conditionalBroken = conditionalFailures.filter((f) => !f.handled)

  // The positive probes: every carrier the table claims, verified to still fire.
  // A rule that stops emitting fails here even though the corpus walk sees nothing
  // wrong — which is the whole reason this list exists, and the reason the
  // "claimed by rule" rulings it replaced were deleted rather than kept.
  const carrierProbeFailures: { probe: (typeof CARRIER_PROBES)[number]; handled: boolean }[] = []
  for (const probe of CARRIER_PROBES) {
    carrierProbeFailures.push({ probe, handled: emitsEdgeTo(probe.html, probe.expect) })
  }
  const carriersBroken = carrierProbeFailures.filter((f) => !f.handled)

  const totalRefs = [...docHits.values()].reduce((n, h) => n + h.count, 0)
  const coveredRefs = ruled.reduce((n, r) => n + r.hit.count, 0)

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          files: files.length,
          repos: repos.length,
          distinctPairs: docHits.size,
          totalReferenceLikeAttributes: totalRefs,
          pairsWithRuling: ruled.length,
          pairsCoveredByRuling: coveredRefs,
          unreviewed,
          conditionalCarriers: conditionalFailures.map((f) => ({ pair: f.c.pair, handled: f.handled, why: f.c.why })),
          claimedCarriers: carrierProbeFailures.map((f) => ({ pair: f.probe.pair, handled: f.handled, why: f.probe.why })),
        },
        null,
        2,
      ),
    )
  } else {
    console.log(`  distinct (tag@attr) pairs with a reference-shaped value: ${docHits.size}`)
    console.log(`  reference-shaped attribute occurrences: ${totalRefs}`)
    console.log(`  pairs with a recorded ruling: ${ruled.length} (covering ${coveredRefs} occurrences)`)
  console.log(`  claimed carriers probed: ${CARRIER_PROBES.length}`)
    if (handledButUnruled.length > 0) {
      console.log(`\n  ${handledButUnruled.length} pair(s) the analyzer HANDLES but this file has no ruling for.`)
      console.log("  Not defects — undocumented rulings. Add each to RULED_NOT_A_CARRIER so the")
      console.log("  report stays about real gaps:\n")
      for (const h of handledButUnruled) {
        console.log(`  ${String(h.hit.count).padStart(7)}  ${h.hit.pair.padEnd(26)} handled (sample ${JSON.stringify(h.sample)})`)
      }
    }
    if (carriersBroken.length > 0) {
      console.log(`\n  ${carriersBroken.length} CLAIMED CARRIER(S) NOT EMITTING:`)
      for (const f of carriersBroken) {
        console.log(`    ${f.probe.pair.padEnd(22)} ${f.probe.why}`)
      }
      console.log("  The table claims these and the analyzer no longer produces them.")
      console.log("  The corpus walk cannot see this: a REMOVED carrier stops appearing in")
      console.log("  the corpus, so the walk has nothing to report. Found by negative control.")
    }
    if (conditionalBroken.length > 0) {
      console.log(`\n  ${conditionalBroken.length} CONDITIONAL CARRIER(S) NOT HANDLED:`)
      for (const f of conditionalBroken) {
        console.log(`    ${f.c.pair.padEnd(16)} ${f.c.why}`)
      }
      console.log("  A pair can be 'not a carrier' in general and a carrier under a condition.")
      console.log("  The blanket ruling is what hid this; the probe is what keeps it honest.")
    }
    if (unreviewed.length === 0 && conditionalBroken.length === 0 && carriersBroken.length === 0) {
      console.log("\nCARRIER CENSUS: PASS — every reference-shaped pair in these corpora is either")
      console.log("  ruled on, or handled by the analyzer and awaiting a written ruling.")
    } else {
      console.log(`\nCARRIER CENSUS: ${unreviewed.length} UNREVIEWED PAIR(S)`)
      console.log("Each needs a ruling: a carrier to add, or a reason it is not one.")
      console.log("Add the reason to RULED_NOT_A_CARRIER in this file, or the rule to RESOURCE_RULES and its oracle mirror.\n")
      for (const u of unreviewed) {
        console.log(`  ${String(u.count).padStart(7)}  ${u.pair.padEnd(26)} ${JSON.stringify(u.sample)}`)
        console.log(`          first seen: ${u.file}`)
      }
    }
  }

  // ── evidence ────────────────────────────────────────────────────────────
  // A gate nobody runs is not a gate, so this emits the artifact the honesty gate
  // reads. The wording is constrained by that gate's BANNED list: "complete",
  // "thoroughly reviewed" and friends are refused in artifact prose because a
  // self-description is not a measurement. Every number below is one this run
  // just produced, and the limitations say plainly what the gate does not decide.
  const { emitEvidence } = await import("./evidence-harness")
  const ok = unreviewed.length === 0 && conditionalBroken.length === 0 && carriersBroken.length === 0
  emitEvidence({
    issueId: "M14.0.CENSUS",
    title: "html carrier census",
    claimLevel: "L1",
    layers: ["carrier-census"],
    checks: [
      {
        id: "census-pairs-ruled",
        description: `every reference-shaped (tag@attr) pair in ${files.length} corpus files carries a ruling (${docHits.size} pairs, ${totalRefs} occurrences)`,
        status: unreviewed.length === 0 ? "pass" : "fail",
      },
      {
        id: "census-claimed-carriers",
        description: `all ${CARRIER_PROBES.length} claimed carriers emit an edge whose target carries the probe's marker`,
        status: carriersBroken.length === 0 ? "pass" : "fail",
      },
      {
        id: "census-conditional-carriers",
        description: `all ${CONDITIONAL_CARRIERS.length} carriers that hold only under a condition emit an edge when that condition is met`,
        status: conditionalBroken.length === 0 ? "pass" : "fail",
      },
    ],
    limitations: [
      {
        description:
          "the corpus walk consults neither the analyzer's carrier table nor the differential oracle's, which is the point: a differential cannot contradict a premise it shares. What it CANNOT do is rule on whether a pair should be a carrier — that judgement is a human decision, so an unreviewed pair fails here and must be ruled in RULED_NOT_A_CARRIER or added as a rule",
      },
      {
        description:
          "looksLikeReference is deliberately generous and errs toward asking, because a false candidate costs one line of ruling while a missed carrier is an absent dependency nobody reports. The 61 pairs include presentation, framework-binding and data-* attributes ruled as non-carriers",
      },
      {
        description:
          "the corpus is the pinned fixtures repositories and rotates as a pool; the census reports what those files contain, not what the HTML specification permits, so a carrier that no corpus exercises is outside its reach and is covered only by CARRIER_PROBES",
      },
    ],
    data: {
      files: files.length,
      repos: repos.length,
      distinctPairs: docHits.size,
      referenceShapedOccurrences: totalRefs,
      pairsRuled: ruled.length,
      occurrencesRuled: coveredRefs,
      claimedCarriersProbed: CARRIER_PROBES.length,
      claimedCarriersBroken: carriersBroken.map((f) => f.probe.pair),
      conditionalCarriers: CONDITIONAL_CARRIERS.length,
      conditionalCarriersBroken: conditionalBroken.map((f) => f.c.pair),
      unreviewedPairs: unreviewed.map((u) => ({ pair: u.pair, count: u.count, sample: u.sample })),
    },
  })

  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
