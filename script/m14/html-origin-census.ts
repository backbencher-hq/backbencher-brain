// HTML_FIX2 — the six questions per emitted type (ONTOLOGY-WORKSTREAM Part 1),
// plus the falsifiable construct census for the silent ones (Part 2).
//
// WHY A SECOND INSTRUMENT WHEN script/m14/html-ontology-census.ts EXISTS.
// That one answers "does the type fire and how often", over the production path.
// It does NOT answer three of the six questions, and the two it cannot answer
// are the two that decide whether a firing number means anything:
//
//   Q4 LABELLED / Q5 RESOLVED need an ORIGIN. html's own edges and the JS/TS/CSS
//     delegate's edges arrive merged on one array with one label per row.
//     HTML_FIX read origin off `metadata.htmlEmbedded`, and its own next commit
//     records that 8,164 seam-created `contains` rows carry NO `htmlEmbedded`
//     tag while every other merged row does. So that tag is not a usable origin
//     oracle: an auditor using it misattributes 8,164 rows. Deriving origin from
//     a metadata tag the analyzer writes is deriving it from the analyzer's own
//     account of itself, which is the thing under test.
//
//   Q6 CONFIDENT needs per-origin confidence, and the census reports one
//     pooled histogram — so a sub-threshold delegate edge and a deterministic
//     html edge are indistinguishable in it.
//
// THE ORIGIN MEASUREMENT, stated as a method so it can be attacked.
//
//   full = ASTEngine.parseFile(path, content)          -> production
//   own  = analyzer.analyze(root, content, path, {})   -> same three stages,
//          context replaced by {}
//
//   engine.ts builds `context.htmlEmbeddedTrees` under `language === "html"`
//   (engine.ts:1622-1649) and RealHtmlAnalyzer's mergeEmbeddedBlocks is gated on
//   exactly that field (real-html-analyzer.ts:1237). So `own` is the production
//   pipeline with the delegate seam switched off and nothing else changed:
//   same parser, same TypeInference wrapper (type-inference.ts:955 — which
//   itself synthesises `extends` rows from inferred superTypes, so those cancel
//   in the difference rather than polluting it), same FrameworkIntelligence pass
//   (which only READS relationships). The multiset difference of the two
//   relationship arrays, keyed on (type, source, target, line_number), IS the
//   delegate's contribution. It reads no metadata field, so it cannot inherit
//   the htmlEmbedded tagging defect, and it is falsifiable: if a delegate row
//   ever carried a field that made it indistinguishable, the key would collide
//   and the difference would UNDER-count. That direction of error is checked and
//   reported as `collisions`, never silently absorbed.
//
// NO REGEX (programme rule 1). Every construct probe reads node.type and named
// children of the tree-sitter AST; the only string work is charCodeAt /
// includes / startsWith on values the grammar has already isolated as
// `attribute_name` / `attribute_value` nodes. No regex over source text: that
// would match comments and string literals and would keep "working" across a
// grammar bump.
//
// POPULATION. Derived by readdir from $BB_CORPUS, never a hand-written FILE
// list (M14-HONESTY-CONTRACT "an instrument must declare the population it
// covered"). Both the numerator and the denominator are printed.
//
// USAGE (from the repo root):
//   bun script/m14/html-origin-census.ts                       # every corpus
//   bun script/m14/html-origin-census.ts vuejs otp             # named corpora
//   BB_REPO=/path/to/worktree bun script/m14/html-origin-census.ts
//   BB_MAX_FILES=50 bun script/m14/html-origin-census.ts        # cap per corpus
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve as resolvePath } from "node:path"

// ---------------------------------------------------------------------------
// ARIA role vocabulary — a specification constant, exactly like the analyzer's
// own LINK_FETCHABLE_RELS / TEMPLATE_BARRIERS tables. It is here so the
// `implements` probe can ask a falsifiable question of a `role="…"` value
// instead of asserting one: "is this token a member of the closed ARIA
// enumeration?" A non-member is a project-specific role and would change the
// ruling, so the probe reports both counts and every distinct value it saw.
// Source: WAI-ARIA 1.2 role taxonomy (abstract roles included, since an
// abstract role in a document is still an ARIA token and not a project symbol).
// ---------------------------------------------------------------------------
const ARIA_ROLES: readonly string[] = [
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption",
  "cell", "checkbox", "code", "columnheader", "combobox", "command", "complementary", "composite",
  "contentinfo", "definition", "deletion", "dialog", "directory", "document", "emphasis", "feed",
  "figure", "form", "generic", "grid", "gridcell", "group", "heading", "img", "input", "insertion",
  "landmark", "link", "list", "listbox", "listitem", "log", "main", "marquee", "math", "menu",
  "menubar", "menuitem", "menuitemcheckbox", "menuitemradio", "meter", "navigation", "none",
  "note", "option", "paragraph", "presentation", "progressbar", "radio", "radiogroup", "range",
  "region", "roletype", "row", "rowgroup", "rowheader", "scrollbar", "search", "searchbox",
  "section", "sectionhead", "select", "separator", "slider", "spinbutton", "status", "strong",
  "structure", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel",
  "term", "textbox", "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
  "widget", "window",
]

const WORKER = process.argv.includes("--worker")
const SELF = new URL(import.meta.url).pathname
const RAW_ARGS = process.argv.slice(2)
const FIRST_FLAG = RAW_ARGS.findIndex((a) => a.startsWith("--"))
const POSITIONAL = FIRST_FLAG === -1 ? RAW_ARGS : RAW_ARGS.slice(0, FIRST_FLAG)
const WANT = POSITIONAL.filter((a) => !a.startsWith("-") && !a.includes("/"))
const REPO = process.env.BB_REPO || process.cwd()
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const MAX_FILES = Number(process.env.BB_MAX_FILES || 0)

function countHtml(dir: string): number {
  let n = 0
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return 0 }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) n += countHtml(p)
    else if (e.name.endsWith(".html") || e.name.endsWith(".htm")) n++
  }
  return n
}

// ---------------------------------------------------------------------------
// DRIVER. One worker per corpus, for the two reasons measured on the previous
// census: web-tree-sitter allocates Parser/Language into a fixed wasm heap and
// never frees them, so one process over ~680 files turns every later parseFile
// into a throw (six corpora reported `parsed 0` and would have been recorded as
// MEASURED RULINGS); and engine.ts's 120s self-destruct watchdog kills the
// process on haskell/utils/haddock/html-test/ref/mini_Bug1.html, after which
// every corpus later in the walk reads as 0. A file the parser cannot finish is
// NAMED and excluded, never silently dropped from the denominator.
// ---------------------------------------------------------------------------
if (!WORKER) {
  const resultDir = join(tmpdir(), `html-origin-census-${process.pid}`)
  mkdirSync(resultDir, { recursive: true })
  let names: string[] = []
  let entries: any[] = []
  try { entries = readdirSync(CORPUS, { withFileTypes: true }) } catch {}
  for (const e of entries) {
    if (!e.isDirectory()) continue
    let found = 0
    try { found = countHtml(join(CORPUS, e.name)) } catch {}
    if (found > 0) names.push(e.name)
  }
  const list = WANT.length > 0 ? names.filter((n) => WANT.includes(n)) : names
  if (list.length === 0) { console.log(`no html corpus under ${CORPUS}`); process.exit(1) }
  const skip: string[] = []
  let status = 0
  for (const corpus of list) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const args = [SELF, "--worker", "--corpus", corpus, "--results", resultDir]
      for (const s of skip) args.push("--skip", s)
      const r = spawnSync(process.execPath, args, { encoding: "utf8", maxBuffer: 1 << 28, timeout: 3600_000 })
      const out = (r.stdout || "") + (r.stderr || "")
      const hang = out.split("\n").find((l) => l.includes("[BB-HANG] parser stuck"))
      if (!hang) {
        if (r.status !== 0) {
          status = 1
          console.log(`[census] worker for ${corpus} exited ${r.status} without a hang line; corpus NOT measured`)
        }
        break
      }
      const path = (hang.split("parser stuck 120s on ")[1] || "").split(" ")[0]
      if (!path) { console.log(`[census] unparseable BB-HANG line: ${hang}`); status = 1; break }
      skip.push(path)
      console.log(`[census] parser hang on ${path} — ${corpus} retried without it (${skip.length} skipped)`)
    }
  }
  // REPORT ONLY. An earlier version re-measured every corpus that had no cache
  // in this final pass, which put all 28 corpora back into ONE process — the
  // fixed-size wasm heap exhaustion the per-corpus worker exists to avoid — so
  // 1,127 of 1,652 files reported `failed` and the aggregate was a partial
  // population presented as a whole. A corpus with no cache after its own
  // worker has run is now REPORTED AS NOT MEASURED (honesty rule 5.4: silence is
  // guilt, and a swallowed exception is guilt with a number attached).
  const final = spawnSync(process.execPath, [SELF, "--worker", "--report", "--results", resultDir, ...list.flatMap((nm) => ["--corpus-name", nm])], {
    encoding: "utf8", maxBuffer: 1 << 28, timeout: 3600_000,
  })
  process.stdout.write((final.stdout || "") + (final.stderr || ""))
  if (skip.length > 0) console.log(`\nFILES THE PARSER COULD NOT FINISH (excluded from every count):\n  ${skip.join("\n  ")}`)
  process.exit(status)
}

const SKIP = new Set<string>()
for (let i = 0; i < RAW_ARGS.length; i++) if (RAW_ARGS[i] === "--skip") SKIP.add(RAW_ARGS[i + 1])
const RESULTS: string | null = (() => {
  const i = RAW_ARGS.indexOf("--results")
  return i === -1 ? null : RAW_ARGS[i + 1]
})()
const ONLY = RAW_ARGS.includes("--corpus") ? RAW_ARGS[RAW_ARGS.indexOf("--corpus") + 1] : null
const REPORT_ONLY = RAW_ARGS.includes("--report")
const REPORT_NAMES: string[] = []
for (let i = 0; i < RAW_ARGS.length; i++) if (RAW_ARGS[i] === "--corpus-name") REPORT_NAMES.push(RAW_ARGS[i + 1])

function findHtml(dir: string, out: string[]): void {
  let ents: any[]
  try { ents = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    if (e.name === "node_modules" || e.name === ".git") continue
    const p = join(dir, e.name)
    if (e.isDirectory()) findHtml(p, out)
    else if (e.name.endsWith(".html") || e.name.endsWith(".htm")) {
      try { if (statSync(p).size >= 2_000_000) continue } catch { continue }
      out.push(p)
    }
  }
}

const byCorpus = new Map<string, string[]>()
let roots: string[] = []
try { roots = readdirSync(CORPUS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(CORPUS, e.name)) } catch {}
for (const dir of roots) {
  const files: string[] = []
  findHtml(dir, files)
  if (files.length === 0) continue
  byCorpus.set(basename(dir), files.sort())
}
const corpora = ONLY ? [ONLY]
  : REPORT_NAMES.length > 0 ? REPORT_NAMES.filter((c) => byCorpus.has(c)).sort()
  : WANT.length > 0 ? WANT.filter((c) => byCorpus.has(c))
  : [...byCorpus.keys()].sort()
if (corpora.length === 0) { console.log(`no html corpus under ${CORPUS}`); process.exit(1) }

const { ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
// The DENOMINATOR is engine.ts's enum, not src/ast/types.ts's. types.ts's
// `Imports` member reads "brain_import" while every analyzer emits engine.ts's
// "imports" (firing-check-v2 DEFECT 3/D). Grading against types.ts makes the
// tenth production type invisible.
const ENGINE_RT = ASTEngine.RelationshipType
// A census that cannot parse cannot rule (HTML_FIX D3: run from a worktree with
// no node_modules, every Language.load fails and every type reads as silent).
try { await ASTEngine.getParser("html") } catch (e) {
  console.log(`CENSUS REFUSED: getParser("html") failed — ${String(e).slice(0, 160)}`)
  process.exit(2)
}
// `Object.values<string>`: ENGINE_RT comes from a computed dynamic import (`any`),
// and TS 5.9 types `Object.values(any)` as `unknown[]`, so every later use of a
// production type name (gFull.get(t), t.padEnd) was an error while this line was
// not. The engine's RelationshipType members are all string-initialised.
const PRODUCTION_TYPES = [...new Set(Object.values<string>(ENGINE_RT))]
const { RealHtmlAnalyzer } = await import(`${REPO}/src/ast/real-html-analyzer.ts`)
const { TypeInference } = await import(`${REPO}/src/ast/type-inference.ts`)
const { FrameworkIntelligence } = await import(`${REPO}/src/ast/framework-intelligence.ts`)
const htmlParser = await ASTEngine.getParser("html")

// ---------------------------------------------------------------------------
// AST readers. Same node shapes the analyzer reads, so a construct probe and the
// analyzer cannot disagree about what an attribute IS.
// ---------------------------------------------------------------------------
function tagOf(node: any): string {
  for (let i = 0; i < node.childCount; i++) {
    const st = node.child(i)
    if (!st || (st.type !== "start_tag" && st.type !== "self_closing_tag")) continue
    for (let j = 0; j < st.childCount; j++) {
      const g = st.child(j)
      if (g && g.type === "tag_name") return g.text.toLowerCase()
    }
  }
  return ""
}
/** attribute name -> value, grammar nodes only. */
function attrsOf(node: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < node.childCount; i++) {
    const st = node.child(i)
    if (!st || (st.type !== "start_tag" && st.type !== "self_closing_tag")) continue
    for (let j = 0; j < st.childCount; j++) {
      const a = st.child(j)
      if (!a || a.type !== "attribute") continue
      let name = "", val = ""
      for (let k = 0; k < a.childCount; k++) {
        const c = a.child(k)
        if (!c) continue
        if (c.type === "attribute_name") name = c.text
        else if (c.type === "quoted_attribute_value" || c.type === "attribute_value") {
          let inner: any = null
          for (let m = 0; m < c.namedChildCount; m++) {
            const ic = c.namedChild(m)
            if (ic && ic.type === "attribute_value") { inner = ic; break }
          }
          val = inner ? inner.text : c.text
        }
      }
      if (!name) continue
      const key = name.toLowerCase()
      if (out[key] === undefined) out[key] = val
    }
  }
  return out
}

/** Every distinct node type the html grammar actually produces over the corpus.
 *  Instrument A of the workstream: positive evidence of absence, for a ruling
 *  that no probe can falsify because there is no probe. */
const nodeTypeCounts = new Map<string, number>()

// ---------------------------------------------------------------------------
// CONSTRUCT PROBES. Each one counts occurrences of the construct that WOULD
// produce `type`, over the DOCUMENT tree only (never over an embedded
// sub-parse): these questions are about what the MARKUP says, and a JS
// delegate's `class X extends Y` inside an inline script is that delegate's
// edge to emit, already counted by the origin split.
// ---------------------------------------------------------------------------
interface Probe { type: string; note: string; tags: Set<string> }
const PROBES: Probe[] = [
  { type: "extends", note: `is="x" — customized built-in: <button is="fancy-button">; the custom class extends the built-in`, tags: new Set(["is"]) },
  // Polymer's PRE-STANDARD spelling of the same idea, and it must be probed too or
  // the ruling only covers the spelling that happens to occur. Measured separately
  // so a non-zero count on either one is visible.
  { type: "extends", note: `extends="paper-item" — Polymer's pre-standard customized-builtin spelling`, tags: new Set(["extends-attr"]) },
  { type: "implements", note: `role="x" — WAI-ARIA role conformance declaration on any element`, tags: new Set(["role"]) },
  { type: "exports", note: `<slot name="x"> — a component's named light-DOM projection point`, tags: new Set(["slot-name"]) },
  // The whole <slot> vocabulary, named or not. A ruling that counts only the
  // NAMED form states its population as "named slots occur 0 times" when the
  // honest population is "slots occur N times, named 0 of them" — and if N were
  // large the second number would be the interesting one.
  { type: "exports", note: `<slot> ANY form — the whole slot vocabulary in HTML documents`, tags: new Set(["slot-any"]) },
  // Shadow DOM `part=` is the strongest EXPORTS candidate HTML actually has: a
  // `part` names an externally-addressable piece of this element's surface that
  // CSS reaches with ::part(). It is a public OUTLET, not a member. Measured
  // rather than assumed either way.
  { type: "exports", note: `part="x" — a Shadow DOM part: an externally-addressable piece of this element's surface (::part()), i.e. an export`, tags: new Set(["part"]) },
  { type: "overrides", note: `role in {none,presentation} — an element suppressing the implicit semantics it inherits from the host language`, tags: new Set(["role-suppressing"]) },
]
interface ProbeHit { occ: number; files: Set<string>; values: Map<string, number>; samples: string[] }
function newHit(): ProbeHit { return { occ: 0, files: new Set<string>(), values: new Map<string, number>(), samples: [] } }
function bump(h: ProbeHit, value: string, where: string) {
  h.occ++
  h.values.set(value, (h.values.get(value) || 0) + 1)
  if (h.samples.length < 4) h.samples.push(where)
}
function isCustomElementTag(tag: string): boolean {
  return tag.indexOf("-") !== -1 && tag !== "annotation-xml"
}

// ---------------------------------------------------------------------------
// Per-corpus accumulators.
// ---------------------------------------------------------------------------
interface Bucket { n: number; files: number }
interface Row {
  corpus: string; files: number; parsed: number; failed: number
  full: Map<string, Bucket>          // production, all origins
  own: Map<string, Bucket>           // production with the delegate seam off
  delta: Map<string, Bucket>         // full MINUS own, multiset -> the delegate
  collisions: number                 // rows the (type,source,target,line) key cannot separate
  imported: Bucket; importedOwn: Bucket; importedDelta: Bucket
  exportsRel: Bucket; exportsCh: Bucket; exportsChOwn: Bucket
  ownSymbols: number; delegateSymbols: number
  resOwn: { total: number; sym: number; file: number; neither: number }
  resDelta: { total: number; sym: number; file: number; neither: number }
  confOwn: Map<string, number>; confDelta: Map<string, number>; confNoFieldOwn: Map<string, number>
  evClassOwn: Map<string, number>; evClassDelta: Map<string, number>
  noLineOwn: number; badLineOwn: number; noLineDelta: number; badLineDelta: number
  htmlEmbeddedTaggedDelta: number; htmlEmbeddedUntaggedDelta: number
  emptyName: number; whitespaceName: number; unknownKind: number
  placeholderEndpoint: number
  hits: Map<string, ProbeHit>
  nodeTypes: Record<string, number>
  customTags: Map<string, number>; customTagFiles: Set<string>; customTagSamples: string[]
  roleValues: Map<string, number>
}
function blankRow(corpus: string): Row {
  return {
    corpus, files: 0, parsed: 0, failed: 0,
    full: new Map(), own: new Map(), delta: new Map(), collisions: 0,
    imported: { n: 0, files: 0 }, importedOwn: { n: 0, files: 0 }, importedDelta: { n: 0, files: 0 },
    exportsRel: { n: 0, files: 0 }, exportsCh: { n: 0, files: 0 }, exportsChOwn: { n: 0, files: 0 },
    ownSymbols: 0, delegateSymbols: 0,
    resOwn: { total: 0, sym: 0, file: 0, neither: 0 },
    resDelta: { total: 0, sym: 0, file: 0, neither: 0 },
    confOwn: new Map(), confDelta: new Map(), confNoFieldOwn: new Map(),
    evClassOwn: new Map(), evClassDelta: new Map(),
    noLineOwn: 0, badLineOwn: 0, noLineDelta: 0, badLineDelta: 0,
    htmlEmbeddedTaggedDelta: 0, htmlEmbeddedUntaggedDelta: 0,
    emptyName: 0, whitespaceName: 0, unknownKind: 0, placeholderEndpoint: 0,
    hits: new Map(), nodeTypes: {}, customTags: new Map(), customTagFiles: new Set(), customTagSamples: [], roleValues: new Map(),
  }
}
/**
 * `JSON.stringify` renders EVERY Map and Set as `{}`. So a naive round-trip of
 * a cached row keeps the plain counters and drops every tally this instrument
 * exists to produce — and the failure is silent, because `{}` rehydrates into
 * an empty Map with no error.
 *
 * That is measured, not hypothetical: the first full run of this file reported
 * `0 occurrences of 0 distinct tag names in 5 files` while simultaneously
 * listing five `<demo-grid>`/`<tree-item>` samples from the same rows. The five
 * files are in `customTagFiles`, a Set I flattened by hand; the tag NAMES are in
 * `customTags`, a Map I did not, so the numerator was 0 and the denominator was
 * 5. That is the honesty contract's "a correct number about the wrong
 * population", produced by the instrument itself.
 *
 * So every Map and Set is flattened explicitly, and `rehydrate` rebuilds them.
 */
const MAP_FIELDS = ["full", "own", "delta", "confOwn", "confDelta", "evClassOwn", "evClassDelta", "customTags", "roleValues"] as const
function dehydrate(r: Row): any {
  const out: any = JSON.parse(JSON.stringify(r))
  for (const k of MAP_FIELDS) out[k] = Object.fromEntries(r[k])
  out.nodeTypes = { ...r.nodeTypes }
  out.customTagFiles = [...r.customTagFiles]
  out.hits = Object.fromEntries([...r.hits].map(([t, h]) => [t, { occ: h.occ, files: [...h.files], values: Object.fromEntries(h.values), samples: h.samples }]))
  return out
}
/** Sets do not survive JSON, so a cached row is rehydrated field by field.
 *  A wrong rehydration would print a smaller population with total confidence,
 *  which is the failure mode the population rule exists to prevent. */
function rehydrate(c: any): Row {
  const r: any = blankRow(c.corpus)
  Object.assign(r, c)
  for (const k of MAP_FIELDS) r[k] = new Map(Object.entries(c[k] || {}))
  r.hits = new Map()
  for (const [t, h] of Object.entries<any>(c.hits || {})) {
    r.hits.set(t, { occ: h.occ, files: new Set((h.files || []) as string[]), values: new Map(Object.entries(h.values || {})), samples: (h.samples || []) as string[] })
  }
  r.customTagFiles = new Set((c.customTagFiles || []) as string[])
  return r as Row
}
function bucketAdd(m: Map<string, Bucket>, t: string, isNewFile: boolean) {
  let b = m.get(t)
  if (!b) { b = { n: 0, files: 0 }; m.set(t, b) }
  b.n++
  if (isNewFile) b.files++
}

const PLACEHOLDER = "unknown"
function isPlaceholderEndpoint(v: unknown): boolean {
  return typeof v === "string" && (v === PLACEHOLDER || v.length === 0)
}

/** Q5. Does an endpoint name a real thing? Two independent tests, neither of
 *  which reads a field the analyzer wrote:
 *    sym  — the name is a symbol of THIS file (the merged symbol set, so a
 *            delegate row is measured against the graph it actually lands in);
 *    file — the name resolves, relative to the document's directory, to a file
 *           on disk. A relative path dependency that names a missing file is a
 *           real edge about a real (absent) target, which is why this is its own
 *           bucket and not folded into `neither`. */
function classify(name: unknown, dir: string, symbols: Set<string>): "sym" | "file" | "neither" {
  if (typeof name !== "string" || name.length === 0) return "neither"
  if (symbols.has(name)) return "sym"
  if (name.indexOf("/") >= 0 || name.charCodeAt(0) === 46 /* . */) {
    for (const cand of [resolvePath(dir, name), resolvePath(dir, name.slice(1))]) {
      if (existsSync(cand)) return "file"
    }
  }
  return "neither"
}

const rows: Row[] = []
const notMeasured: { corpus: string; files: number }[] = []

for (const corpus of corpora) {
  const cachePath = RESULTS ? join(RESULTS, `${corpus}.json`) : null
  if (cachePath && existsSync(cachePath)) { rows.push(rehydrate(JSON.parse(readFileSync(cachePath, "utf8")))); continue }
  if (REPORT_ONLY) { notMeasured.push({ corpus, files: byCorpus.get(corpus)!.filter((f) => !SKIP.has(f)).length }); continue }
  const all = byCorpus.get(corpus)!.filter((f) => !SKIP.has(f))
  const files = MAX_FILES > 0 ? all.slice(0, MAX_FILES) : all
  const row = blankRow(corpus)
  for (const f of files) {
    row.files++
    let content = ""
    try { content = readFileSync(f, "utf8") } catch { row.failed++; continue }
    let full: any, own: any
    try {
      full = await ASTEngine.parseFile(f, content)
      row.parsed++
    } catch { row.failed++; continue }
    // ONE parse, reused by the `own` stage and the construct walk below. This
    // used to parse three times per file (parseFile's own, `own`'s, the probes'
    //) and the third was a whole extra wasm parse of the same bytes for no
    // additional information; a fresh Parser per call is also the M49 W12 lesson.
    //   `own` — the same three production stages with the delegate seam switched
    //   off. See the header for why this, and not a metadata tag.
    let probeTree: any = null
    try {
      probeTree = (htmlParser as any).parse(content, f)
      const analyzer = new RealHtmlAnalyzer()
      const wrapped: any = TypeInference.enhanceAnalyzerWithTypeInference(analyzer, "html")
      own = wrapped.analyze(probeTree.rootNode, content, f, {})
      own = FrameworkIntelligence.enhanceWithFrameworkIntelligence(own, content, "html")
    } catch { row.failed++; continue }

    // --- construct probes + grammar inventory, over the DOCUMENT tree ---------
    try {
      const tree = probeTree
      const stack: any[] = [tree.rootNode]
      while (stack.length > 0) {
        const n = stack.pop()
        nodeTypeCounts.set(n.type, (nodeTypeCounts.get(n.type) || 0) + 1)
        row.nodeTypes[n.type] = (row.nodeTypes[n.type] || 0) + 1
        if (n.type === "element" || n.type === "script_element" || n.type === "style_element") {
          const tag = tagOf(n)
          if (tag) {
            const a = attrsOf(n)
            const where = `${relative(join(CORPUS, corpus), f)} <${tag}>`
            for (const p of PROBES) {
              let hit = row.hits.get(`${p.type}||${p.note}`)
              if (!hit) { hit = newHit(); row.hits.set(p.type + "||" + p.note, hit) }
              if (p.tags.has("is") && (a["is"] ?? "").trim().length > 0) { bump(hit, a["is"].trim(), where); hit.files.add(f) }
              if (p.tags.has("role")) {
                const rv = (a["role"] ?? "").trim()
                if (rv.length > 0) {
                  row.roleValues.set(rv, (row.roleValues.get(rv) || 0) + 1)
                  if (ARIA_ROLES.includes(rv)) bump(hit, rv, where)
                  else bump(hit, `NON-ARIA: ${rv}`, where)
                  hit.files.add(f)
                }
              }
              if (p.tags.has("role-suppressing")) {
                const rv = asciiLower((a["role"] ?? "").trim())
                if (rv === "none" || rv === "presentation") { bump(hit, rv, where); hit.files.add(f) }
              }
              if (p.tags.has("slot-name")) {
                if (tag === "slot" && (a["name"] ?? "").trim().length > 0) { bump(hit, a["name"].trim(), where); hit.files.add(f) }
              }
              if (p.tags.has("slot-any")) {
                if (tag === "slot") { bump(hit, "slot", where); hit.files.add(f) }
              }
              if (p.tags.has("part")) {
                const pv = (a["part"] ?? "").trim()
                if (pv.length > 0) { bump(hit, pv, where); hit.files.add(f) }
              }
              if (p.tags.has("extends-attr")) {
                const ev = (a["extends"] ?? "").trim()
                if (ev.length > 0) { bump(hit, ev, where); hit.files.add(f) }
              }
            }
            if (isCustomElementTag(tag)) {
              row.customTags.set(tag, (row.customTags.get(tag) || 0) + 1)
              row.customTagFiles.add(f)
              if (row.customTagSamples.length < 6) row.customTagSamples.push(where)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) { const c = n.namedChild(i); if (c) stack.push(c) }
      }
    } catch {}

    // --- Q5: the merged symbol set both origins land in ----------------------
    const symbols = new Set<string>()
    for (const s of full.symbols || []) if (typeof s.name === "string") symbols.add(s.name)
    const ownSyms = new Set<string>()
    for (const s of own.symbols || []) if (typeof s.name === "string") ownSyms.add(s.name)

    // --- R7 / symbol hygiene, per origin --------------------------------------
    const deltaSyms = new Set<string>()
    for (const s of full.symbols || []) if (typeof s.name === "string" && !ownSyms.has(s.name)) deltaSyms.add(s.name)
    row.ownSymbols += ownSyms.size
    row.delegateSymbols += deltaSyms.size
    for (const s of full.symbols || []) {
      const nm = s.name
      if (typeof nm !== "string" || nm.length === 0) { row.emptyName++; continue }
      if (nm.trim().length === 0) { row.whitespaceName++; continue }
      const k = s.kind
      if (k === undefined || k === null || k === "" || k === "unknown") row.unknownKind++
    }

    // --- origin by multiset difference ---------------------------------------
    const dir = dirname(f)
    const seenOwn = new Map<string, number>()
    for (const r of own.relationships || []) {
      const t = r.relationshipType ?? r.type ?? "(none)"
      bucketAdd(row.own, t, true)
      const k = `${t}|${r.source}|${r.target}|${r.line_number}`
      seenOwn.set(k, (seenOwn.get(k) || 0) + 1)
      if (typeof r.line_number !== "number") row.noLineOwn++
      else if (r.line_number <= 0) row.badLineOwn++
      const ck = typeof r.confidence === "number" ? String(r.confidence) : "NO-FIELD"
      row.confOwn.set(ck, (row.confOwn.get(ck) || 0) + 1)
      const ec = typeof r.metadata?.evidenceClass === "string" ? r.metadata.evidenceClass : "NO-FIELD"
      row.evClassOwn.set(ec, (row.evClassOwn.get(ec) || 0) + 1)
      if (r.metadata?.htmlEmbedded === true) row.htmlEmbeddedTagged++
      const b = classify(r.source, dir, symbols)
      row.resOwn.total++; if (b === "sym") row.resOwn.sym++; else if (b === "file") row.resOwn.file++; else row.resOwn.neither++
      const b2 = classify(r.target, dir, symbols)
      row.resOwn.total++; if (b2 === "sym") row.resOwn.sym++; else if (b2 === "file") row.resOwn.file++; else row.resOwn.neither++
      if (isPlaceholderEndpoint(r.source) || isPlaceholderEndpoint(r.target)) row.placeholderEndpoint++
    }
    for (const r of full.relationships || []) {
      const t = r.relationshipType ?? r.type ?? "(none)"
      const k = `${t}|${r.source}|${r.target}|${r.line_number}`
      const remaining = seenOwn.get(k) || 0
      if (remaining > 0) { seenOwn.set(k, remaining - 1); continue }
      // HTML_FIX measured that the seam's OWN `contains` rows carry no
      // `htmlEmbedded` tag while every other merged row does. Counted here so
      // the number is on the record against the origin test rather than
      // against a metadata field.
      if (r.metadata?.htmlEmbedded === true) row.htmlEmbeddedTaggedDelta++
      else row.htmlEmbeddedUntaggedDelta++
      bucketAdd(row.delta, t, true)
      if (typeof r.line_number !== "number") row.noLineDelta++
      else if (r.line_number <= 0) row.badLineDelta++
      const ck = typeof r.confidence === "number" ? String(r.confidence) : "NO-FIELD"
      row.confDelta.set(ck, (row.confDelta.get(ck) || 0) + 1)
      const ec = typeof r.metadata?.evidenceClass === "string" ? r.metadata.evidenceClass : "NO-FIELD"
      row.evClassDelta.set(ec, (row.evClassDelta.get(ec) || 0) + 1)
      const b = classify(r.source, dir, symbols)
      row.resDelta.total++; if (b === "sym") row.resDelta.sym++; else if (b === "file") row.resDelta.file++; else row.resDelta.neither++
      const b2 = classify(r.target, dir, symbols)
      row.resDelta.total++; if (b2 === "sym") row.resDelta.sym++; else if (b2 === "file") row.resDelta.file++; else row.resDelta.neither++
      if (isPlaceholderEndpoint(r.source) || isPlaceholderEndpoint(r.target)) row.placeholderEndpoint++
    }
    // Rows whose key collided: the difference UNDER-counts by this many, which
    // is the only direction in which this method can be wrong.
    for (const [, n] of seenOwn) if (n > 0) row.collisions += n

    for (const r of full.relationships || []) bucketAdd(row.full, r.relationshipType ?? r.type ?? "(none)", true)

    // --- the imports / exports channels, per origin --------------------------
    const fi = full.imports || [], oi = own.imports || []
    const oiKey = new Set(oi.map((x: any) => `${x.module}|${(x.items || []).join("+")}`))
    row.imported.n += fi.length
    if (fi.length) row.imported.files++
    row.importedOwn.n += oi.length
    if (oi.length) row.importedOwn.files++
    let dcount = 0
    const fiKey = new Set<string>()
    for (const x of fi) { const k = `${x.module}|${(x.items || []).join("+")}`; if (!oiKey.has(k)) { dcount++; fiKey.add(k) } }
    row.importedDelta.n += dcount
    if (dcount) row.importedDelta.files++
    row.exportsCh.n += (full.exports || []).length
    if ((full.exports || []).length) row.exportsCh.files++
    row.exportsChOwn.n += (own.exports || []).length
    if ((own.exports || []).length) row.exportsChOwn.files++
    for (const r of full.relationships || []) if ((r.relationshipType ?? r.type) === "exports") { row.exportsRel.n++; }
  }
  rows.push(row)
  if (cachePath) writeFileSync(cachePath, JSON.stringify(dehydrate(row)))
}

function asciiLower(s: string): string {
  let out = ""
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out += c >= 65 && c <= 90 ? String.fromCharCode(c + 32) : s[i]
  }
  return out
}

const gFull = new Map<string, { n: number; files: number }>()
const gOwn = new Map<string, { n: number; files: number }>()
const gDelta = new Map<string, { n: number; files: number }>()
const gConfOwn = new Map<string, number>(), gConfDelta = new Map<string, number>()
const gEvOwn = new Map<string, number>(), gEvDelta = new Map<string, number>()
const gRoleValues = new Map<string, number>(), gCustomTags = new Map<string, number>()
let gFiles = 0, gParsed = 0, gFailed = 0, gCollisions = 0
let gImported = 0, gImportedOwn = 0, gImportedDelta = 0, gImportFiles = 0
let gExportsCh = 0, gExportsChOwn = 0, gExportsChFiles = 0, gExportsRel = 0
let gOwnSyms = 0, gDeltaSyms = 0
let gResOwn = { total: 0, sym: 0, file: 0, neither: 0 }, gResDelta = { total: 0, sym: 0, file: 0, neither: 0 }
let gNoLineOwn = 0, gBadLineOwn = 0, gNoLineDelta = 0, gBadLineDelta = 0
let gTaggedDelta = 0, gUntaggedDelta = 0
let gEmptyName = 0, gWhitespaceName = 0, gUnknownKind = 0, gPlaceholder = 0
let gCustomFiles = 0
const gHits = new Map<string, ProbeHit>()
const gCustomSamples: string[] = []
for (const r of rows) {
  gFiles += r.files; gParsed += r.parsed; gFailed += r.failed; gCollisions += r.collisions
  gImported += r.imported.n; gImportedOwn += r.importedOwn.n; gImportedDelta += r.importedDelta.n
  gImportFiles += r.imported.files
  gExportsCh += r.exportsCh.n; gExportsChOwn += r.exportsChOwn.n; gExportsRel += r.exportsRel.n
  if (r.exportsCh.n) gExportsChFiles++
  gOwnSyms += r.ownSymbols; gDeltaSyms += r.delegateSymbols
  for (const k of ["total", "sym", "file", "neither"] as const) { gResOwn[k] += r.resOwn[k]; gResDelta[k] += r.resDelta[k] }
  gNoLineOwn += r.noLineOwn; gBadLineOwn += r.badLineOwn; gNoLineDelta += r.noLineDelta; gBadLineDelta += r.badLineDelta
  gTaggedDelta += r.htmlEmbeddedTaggedDelta; gUntaggedDelta += r.htmlEmbeddedUntaggedDelta
  gEmptyName += r.emptyName; gWhitespaceName += r.whitespaceName; gUnknownKind += r.unknownKind; gPlaceholder += r.placeholderEndpoint
  gCustomFiles += r.customTagFiles.size
  for (const [a, b] of r.roleValues) gRoleValues.set(a, (gRoleValues.get(a) || 0) + b)
  for (const [a, b] of r.customTags) gCustomTags.set(a, (gCustomTags.get(a) || 0) + b)
  for (const [a, b] of Object.entries(r.nodeTypes || {})) nodeTypeCounts.set(a, (nodeTypeCounts.get(a) || 0) + b)
  for (const s of r.customTagSamples) if (gCustomSamples.length < 8) gCustomSamples.push(s)
  for (const [src, dst] of [[r.full, gFull], [r.own, gOwn], [r.delta, gDelta]] as const) {
    for (const [t, b] of src) { const c = dst.get(t) || { n: 0, files: 0 }; c.n += b.n; c.files += b.files; dst.set(t, c) }
  }
  for (const [src, dst] of [[r.confOwn, gConfOwn], [r.confDelta, gConfDelta], [r.evClassOwn, gEvOwn], [r.evClassDelta, gEvDelta]] as const) {
    for (const [k, n] of src) dst.set(k, (dst.get(k) || 0) + n)
  }
  for (const [t, h] of r.hits) {
    let g = gHits.get(t)
    if (!g) { g = newHit(); gHits.set(t, g) }
    g.occ += h.occ
    for (const f of h.files) g.files.add(f)
    for (const [v, n] of h.values) g.values.set(v, (g.values.get(v) || 0) + n)
    for (const s of h.samples) if (g.samples.length < 6) g.samples.push(s)
  }
}

const pct = (a: number, b: number) => (b === 0 ? "n/a" : `${((a / b) * 100).toFixed(2)}%`)

console.log(`html-origin-census   repo=${REPO}`)
console.log(`corpora (${corpora.length}): ${corpora.join(", ")}`)
console.log(`POPULATION: ${gFiles} html/htm files enumerated by readdir under ${CORPUS}`)
console.log(`           ${gParsed} parsed   ${gFailed} failed   ${MAX_FILES > 0 ? `BB_MAX_FILES=${MAX_FILES} CAP APPLIED` : "no cap"}`)
const notMeasuredFiles = notMeasured.reduce((a, b) => a + b.files, 0)
if (notMeasured.length > 0) {
  console.log(`           NOT MEASURED: ${notMeasured.map((x) => `${x.corpus}(${x.files})`).join(" ")}  = ${notMeasuredFiles} files excluded from EVERY number below`)
} else {
  console.log(`           NOT MEASURED: none`)
}
console.log(`production vocabulary (${PRODUCTION_TYPES.length}): ${PRODUCTION_TYPES.join(" ")}`)
console.log(`origin method: parseFile MINUS analyze-with-empty-context, keyed (type|source|target|line); key collisions=${gCollisions}\n`)

console.log("=== Q2 FIRES — per type, per origin (production path) ===")
console.log("type            all          html-own     delegate    fires?")
for (const t of PRODUCTION_TYPES) {
  const a = gFull.get(t) || { n: 0, files: 0 }
  const o = gOwn.get(t) || { n: 0, files: 0 }
  const d = gDelta.get(t) || { n: 0, files: 0 }
  const special = t === "imports"
    ? `   [importer channel: ${gImported} rows / ${gImportFiles} files  (own ${gImportedOwn}, delegate ${gImportedDelta})]`
    : ""
  const verdict = t === "imports" ? (gImported > 0 ? "EMITTED (imports[])" : "silent")
    : a.n > 0 ? (o.n > 0 ? "EMITTED" : "DELEGATE-ONLY") : "silent"
  console.log(`  ${t.padEnd(13)} ${String(a.n).padStart(6)}/${String(a.files).padStart(4)}f  ${String(o.n).padStart(6)}/${String(o.files).padStart(4)}f  ${String(d.n).padStart(6)}/${String(d.files).padStart(4)}f   ${verdict}${special}`)
}
console.log(`  (relationships channel note: no relationship row carries type "imports" from html's own code;`)
console.log(`   ${gExportsRel} rows carry it from a delegate — see ORIGIN below.)`)

console.log(`\n=== Q5 RESOLVED — per endpoint, classified independently of analyzer fields ===`)
console.log("  html-own   : sym=" + gResOwn.sym + " file=" + gResOwn.file + " neither=" + gResOwn.neither + " of " + gResOwn.total + " endpoints")
console.log(`     sym resolves in-file ${pct(gResOwn.sym, gResOwn.total)} · file resolves on disk ${pct(gResOwn.file, gResOwn.total)} · NEITHER ${pct(gResOwn.neither, gResOwn.total)}`)
console.log("  delegate   : sym=" + gResDelta.sym + " file=" + gResDelta.file + " neither=" + gResDelta.neither + " of " + gResDelta.total + " endpoints")
console.log(`     sym resolves in-file ${pct(gResDelta.sym, gResDelta.total)} · file resolves on disk ${pct(gResDelta.file, gResDelta.total)} · NEITHER ${pct(gResDelta.neither, gResDelta.total)}`)

console.log(`\n=== Q6 CONFIDENT — confidence and evidenceClass per origin ===`)
console.log("  confidence     html-own   delegate")
const confKeys = [...new Set([...gConfOwn.keys(), ...gConfDelta.keys()])].sort((a, b) => (Number(a) || -1) - (Number(b) || -1))
for (const k of confKeys) console.log(`    ${k.padEnd(12)} ${String(gConfOwn.get(k) || 0).padStart(8)}   ${String(gConfDelta.get(k) || 0).padStart(8)}`)
console.log("  evidenceClass  html-own   delegate")
for (const k of [...new Set([...gEvOwn.keys(), ...gEvDelta.keys()])].sort()) {
  console.log(`    ${k.padEnd(12)} ${String(gEvOwn.get(k) || 0).padStart(8)}   ${String(gEvDelta.get(k) || 0).padStart(8)}`)
}

console.log(`\n=== ORIGIN DISCLOSURE (the delegation question, measured not asserted) ===`)
console.log(`  delegate rows carrying metadata.htmlEmbedded === true : ${gTaggedDelta}`)
console.log(`  delegate rows carrying NO htmlEmbedded tag            : ${gUntaggedDelta}`)
console.log(`  -> htmlEmbedded is therefore ${gUntaggedDelta === 0 ? "a usable" : "NOT a usable"} origin oracle: ${gUntaggedDelta} seam-created rows are untagged,`)
console.log(`     so an auditor using htmlEmbedded as the origin test misattributes ${gUntaggedDelta} delegate rows to html's own code.`)

console.log(`\n=== R7 / M59.O2 INVARIANTS ===`)
console.log(`  own: no line_number ${gNoLineOwn} · line_number<=0 ${gBadLineOwn}`)
console.log(`  delegate: no line_number ${gNoLineDelta} · line_number<=0 ${gBadLineDelta}`)
console.log(`  empty symbol names ${gEmptyName} · whitespace-only ${gWhitespaceName} · empty/unknown kind ${gUnknownKind}`)
console.log(`  endpoints equal to the placeholder literal "unknown" (or empty): ${gPlaceholder}`)
console.log(`  symbols: ${gOwnSyms} html-own, ${gDeltaSyms} delegate-contributed`)

console.log(`\n=== exports[] CHANNEL (separate from relationships, same reason as imports[]) ===`)
console.log(`  production ${gExportsCh} rows in ${gExportsChFiles} files · html-own ${gExportsChOwn} · relationship-channel "exports" rows ${gExportsRel}`)

console.log(`\n=== PART 2 CONSTRUCT CENSUS — the falsifiable half ===`)
for (const p of PROBES) {
  // A type with several probes cannot be tallied into one hit bucket, so each
  // PROBE gets its own bucket, keyed type+note. Merging them would report one
  // number for constructs that answer different questions — and the merged
  // number would be the sum of a 0 and a 0, which reads exactly like a 0.
  const h = gHits.get(`${p.type}||${p.note}`)
  console.log(`  ${p.type.padEnd(13)} ${String(h ? h.occ : 0).padStart(5)} occ / ${String(h ? h.files.size : 0).padStart(4)} files   ${p.note}`)
  if (h && h.values.size > 0) {
    const top = [...h.values.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    console.log(`      values: ${top.map(([v, n]) => `${v}:${n}`).join("  ")}${h.values.size > 12 ? `  (+${h.values.size - 12} more)` : ""}`)
    if (h.samples.length) console.log(`      e.g. ${h.samples.slice(0, 3).join("   ")}`)
  }
}
console.log(`\n  instantiates construct: custom-element tags (tag contains "-", not annotation-xml)`)
console.log(`      ${[...gCustomTags.values()].reduce((a, b) => a + b, 0)} occurrences of ${gCustomTags.size} distinct tag names in ${gCustomFiles} files`)
console.log(`      ${gCustomTags.size === 0 ? "(none)" : [...gCustomTags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}:${v}`).join("  ")}`)
if (gCustomSamples.length) console.log(`      e.g. ${gCustomSamples.slice(0, 4).join("   ")}`)

console.log(`\n  implements construct: the role="…" vocabulary, against the WAI-ARIA enumeration`)
const ariaRows = [...gRoleValues.entries()].filter(([v]) => ARIA_ROLES.includes(v))
const nonAriaRows = [...gRoleValues.entries()].filter(([v]) => !ARIA_ROLES.includes(v))
console.log(`      ${[...gRoleValues.values()].reduce((a, b) => a + b, 0)} occurrences, ${gRoleValues.size} distinct values`)
console.log(`      IN the ARIA enumeration: ${ariaRows.length} distinct / ${ariaRows.reduce((a, [, n]) => a + n, 0)} occurrences`)
console.log(`      NOT in it: ${nonAriaRows.length} distinct / ${nonAriaRows.reduce((a, [, n]) => a + n, 0)} occurrences${nonAriaRows.length ? "  " + nonAriaRows.slice(0, 10).map(([v, n]) => `${v}:${n}`).join(" ") : ""}`)

console.log(`\n=== GRAMMAR INVENTORY (instrument A: positive evidence of absence) ===`)
console.log(`  ${nodeTypeCounts.size} distinct node types tree-sitter-html produced over the parsed population:`)
console.log(`  ${[...nodeTypeCounts.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join("  ")}`)
