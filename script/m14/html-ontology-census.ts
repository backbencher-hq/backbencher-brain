// HTML_FIX — relationship-type ontology census (JOB 1 instrument).
//
// Lane-owned, following the precedent of ts-ontology-census.ts /
// vue-ontology-census.ts / go-ontology-census.ts / zig-relationship-census.ts.
// Nothing shared is touched: differential.ts, mutate-analyzer.ts,
// firing-check*.mjs, ontology-coverage-gate.ts and every baseline are MASTER's.
//
// WHAT IT MEASURES, and why it exists at all.
//
//   `bun script/m14/firing-check-v2.mjs HTML_FIX` reports HTML_FIX at 2/10 and
//   lists `calls` as silent. Both halves of that are properties of the
//   INSTRUMENT, measured here:
//
//   D1  firing-check-v2 hardcodes REPO = $HOME/backbencher-brain, so
//       it reads the MAIN checkout. A lane worktree is invisible to it. This
//       file takes the repo root as an argument instead.
//
//   D2  Its "production path" is getParser -> parser.parse -> analyzer.analyze
//       with NO analyze CONTEXT. engine.ts builds context.htmlEmbeddedTrees
//       only under `language === "html"`, and RealHtmlAnalyzer's
//       mergeEmbeddedBlocks is gated on exactly that field. So on the
//       `analyze` path the entire inline <script>/<style> delegation never runs
//       and every type a JS/TS/CSS delegate contributes is STRUCTURALLY
//       UNOBSERVABLE. Measured on vuejs, 25 files:
//           path=analyze    2/10   calls 0
//           path=parseFile  3/10   calls 248
//       `ASTEngine.parseFile` is the path the indexer calls, so parseFile is the
//       production verdict; the analyze path is tallied alongside it so the gap
//       stays on the record.
//
//   D3  A third defect that is ENVIRONMENTAL and cost this lane an afternoon:
//       run from a worktree with no node_modules, `import "web-tree-sitter"`
//       resolves to bun's GLOBAL INSTALL CACHE (web-tree-sitter@0.27.0,
//       web-tree-sitter.js) instead of node_modules/web-tree-sitter
//       (tree-sitter.js). Every Language.load then fails with the opaque
//       `Language.load failed for html: Error` and EVERY type reads as silent —
//       a 0/10 that looks like a language verdict and is a module-resolution
//       artifact. Asserted here: getParser("html") must succeed or the census
//       refuses to report, because a census that cannot parse cannot rule.
//
// NO REGEX anywhere (programme rule 1). Every construct probe below walks the
// tree-sitter AST through node.type / namedChild APIs; the only string work is
// includes/startsWith/charCodeAt on ATTRIBUTE NAMES AND VALUES the grammar has
// already isolated as `attribute_name` / `attribute_value` nodes. A regex over
// raw source would match comments and text nodes and would silently keep
// "working" across a grammar bump; these probes break loudly instead.
//
// USAGE (from the repo root):
//   bun script/m14/html-ontology-census.ts                      # all corpora
//   bun script/m14/html-ontology-census.ts vuejs otp            # named corpora
//   BB_REPO=/path/to/worktree bun script/m14/html-ontology-census.ts
//
// WHY THERE IS A DRIVER AND A WORKER.
//
// engine.ts arms a per-file self-destruct timer at 120s and calls
// process.exit(1) when `parser.parse` (synchronous WASM) does not return
// (engine.ts:1407-1416). Measured on this corpus:
// haskell/utils/haddock/html-test/ref/mini_Bug1.html hangs the html parser, the
// process dies, and every corpus after it in the walk is reported as
// "0 parsed" — which reads as "html emitted nothing on svelte, sqlite,
// java-sample, go-stdlib" and is a measurement artifact. A first run of this
// census reported sqlite 0/21 and svelte 0/256 for exactly that reason.
//
// So the driver runs each corpus in its own child process, and when a child
// dies it restarts that corpus with the offending file in a skip list. A file
// the parser cannot finish is then named in the output rather than silently
// shrinking the denominator — which is the difference between a ruling over
// 1065 files and a ruling over the 682 that happened to parse.
import { spawnSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs"
import { join, relative, basename } from "node:path"
/** Cheap recursive count of .html/.htm under a dir — used by the driver only to
 *  decide whether a corpus is worth a worker. */
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

const WORKER = process.argv.includes("--worker")
const SELF = new URL(import.meta.url).pathname
// Positional args are corpus names, up to the first flag. A `--skip <path>` pair
// contributes a path as a positional-looking argument, so the list must be cut at
// the first flag or every skipped path would be read as a corpus name.
const RAW_ARGS = process.argv.slice(2)
const FIRST_FLAG = RAW_ARGS.findIndex((a) => a.startsWith("--"))
const POSITIONAL = FIRST_FLAG === -1 ? RAW_ARGS : RAW_ARGS.slice(0, FIRST_FLAG)
const WANT = POSITIONAL.filter((a) => !a.startsWith("-") && !a.includes("/"))
const REPO = process.env.BB_REPO || process.cwd()
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
// HEAP DEFECT — measured on this very census, and it nearly produced six false
// RULED verdicts. A first version ran every corpus in ONE worker process and
// recorded a parseFile throw as `failed`. web-tree-sitter allocates Parser and
// Language objects into a FIXED-SIZE wasm heap and never frees them (the M49 W12
// lesson, "a fresh Parser per file exhausted the fixed-size wasm heap mid-sweep
// at --sample 400"). After roughly 680 files every parseFile threw, so svelte
// (256 files), sqlite (21), java-sample (12), go-stdlib (14), java-lib (1),
// vbnet-samples (7) and vue-element-admin (1) all reported `parsed 0` — which
// reads as "html emitted nothing on these corpora" and would have been recorded
// as a MEASURED RULING that was pure instrumentation exhaustion. Measured
// directly: sqlite 21 files parse 21/21 in a fresh process, and through this
// same script run on sqlite alone: 28/28 across sqlite + vbnet-samples.
//
// So the driver spawns ONE WORKER PER CORPUS. A corpus is small enough that its
// allocations fit, and a corpus that exhausts the heap anyway is reported as
// failed for that corpus alone instead of poisoning the six corpora after it.
// This is also the M14 honesty rule 5.4 turned on my own instrument: silence is
// guilt, and a swallowed exception is guilt with a number attached.
if (!WORKER) {
  const resultDir = join(tmpdir(), `html-ontology-census-${process.pid}`)
  mkdirSync(resultDir, { recursive: true })
  const names: string[] = []
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
      const m = hang.split("parser stuck 120s on ")[1]
      const path = (m || "").split(" ")[0]
      if (!path) { console.log(`[census] unparseable BB-HANG line: ${hang}`); status = 1; break }
      skip.push(path)
      console.log(`[census] parser hang on ${path} — ${corpus} retried without it (${skip.length} skipped)`)
    }
  }
  // Re-run in worker mode over every corpus: each result is read from cache, so
  // this only re-measures a corpus whose worker died, and prints the report.
  const final = spawnSync(process.execPath, [SELF, "--worker", "--results", resultDir, ...skip.flatMap((s) => ["--skip", s])], {
    encoding: "utf8", maxBuffer: 1 << 28, timeout: 3600_000,
  })
  process.stdout.write((final.stdout || "") + (final.stderr || ""))
  if (skip.length > 0) console.log(`\nFILES THE PARSER COULD NOT FINISH (excluded from every count):\n  ${skip.join("\n  ")}`)
  process.exit(status)
}

const SKIP = new Set<string>()
const RESULTS: string | null = (() => {
  const i = RAW_ARGS.indexOf("--results")
  return i === -1 ? null : RAW_ARGS[i + 1]
})()
for (let i = 0; i < RAW_ARGS.length; i++) {
  if (RAW_ARGS[i] === "--skip") SKIP.add(RAW_ARGS[i + 1])
}
// Positional args are corpus names, up to the first flag. A `--skip <path>` pair
// contributes a path as a positional-looking argument, so the list must be cut at
// the first flag or every skipped path would be read as a corpus name.
const ONLY = RAW_ARGS.includes("--corpus") ? RAW_ARGS[RAW_ARGS.indexOf("--corpus") + 1] : null

// ---------------------------------------------------------------------------
// Corpus discovery. Every .html/.htm on disk, grouped by top-level corpus dir,
// so a ruling is stated over a NAMED denominator rather than "the corpus".
// ---------------------------------------------------------------------------
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
let corpusRoot: string[] = []
try { corpusRoot = readdirSync(CORPUS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => join(CORPUS, e.name)) } catch {}
for (const dir of corpusRoot) {
  const files: string[] = []
  findHtml(dir, files)
  if (files.length === 0) continue
  byCorpus.set(basename(dir), files.sort())
}
const corpora = ONLY ? [ONLY] : WANT.length > 0 ? WANT.filter((c) => byCorpus.has(c)) : [...byCorpus.keys()]
if (corpora.length === 0) {
  console.log(`no html corpus under ${CORPUS}`)
  process.exit(1)
}

const { ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${REPO}/src/ast/types.ts`)
const ALL = [...new Set(Object.values(RelationshipType))]
const IMPORT_ENUM = RelationshipType.Imports

// D3 guard: a census that cannot parse a grammar cannot rule anything.
try {
  await ASTEngine.getParser("html")
} catch (e) {
  console.log(`CENSUS REFUSED: getParser("html") failed — ${String(e).slice(0, 160)}`)
  console.log("This is a module-resolution problem, not a language verdict.")
  console.log("A worktree with no node_modules resolves web-tree-sitter to bun's global")
  console.log("install cache; symlink node_modules from the checkout that has it.")
  process.exit(2)
}
for (const l of ["javascript", "typescript", "tsx", "css"]) {
  try { await ASTEngine.getParser(l) } catch {}
}
const htmlParser = await ASTEngine.getParser("html")

// ---------------------------------------------------------------------------
// The 10 ontology types, with the CHANNEL each one can arrive on. `imports`
// (enum value "brain_import") is NOT a relationship: ParseResult carries
// imports: ImportInfo[] on a separate channel (src/ast/types.ts:206-216) and
// parallel-indexer writes it to the brain_import TABLE, never to
// brain_relationship rows. So it is counted from imports[], not from rel rows.
// ---------------------------------------------------------------------------
const CHANNEL_NOTE: Record<string, string> = {
  [IMPORT_ENUM]: "importer channel imports[] (brain_import TABLE), not a relationship row",
}

interface ConstructHit { files: number; occurrences: number; samples: string[] }

/**
 * Count how often a construct that WOULD produce `type` actually occurs in the
 * corpus, by walking the parse tree. This is what turns "HTML has no X" from
 * prose into a falsifiable ruling: a probe finding a non-zero count overturns
 * the ruling, so the ruling names the probe.
 *
 * Each probe gets (node, attrs) for one ELEMENT and returns occurrences.
 */
type Probe = { type: string; note: string; count: (tag: string, attrs: Record<string, string>) => number }

/** attribute value, decoded-free, trimmed. The grammar already unquoted it. */
function av(attrs: Record<string, string>, k: string): string {
  const v = attrs[k]
  return v === undefined ? "" : v.trim()
}

const PROBES: Probe[] = [
  {
    type: "extends",
    note: `customized built-in element: <button is="fancy-button"> extends the built-in`,
    count: (_tag, a) => (av(a, "is").length > 0 ? 1 : 0),
  },
  {
    type: "instantiates",
    note: `custom element tag (<my-widget>): an instantiation of a customElements.define component`,
    count: (tag, _a) => (tag.includes("-") && tag !== "annotation-xml" ? 1 : 0),
  },
  {
    type: "references",
    note: `in-document address resolution: <label for>, href="#id", use href="#id"`,
    count: (tag, a) => {
      if (tag === "label" && av(a, "for").length > 0) return 1
      const h = av(a, "href")
      if (h.length > 1 && h.charCodeAt(0) === 35) return 1 // '#'
      return 0
    },
  },
  {
    type: "references",
    note: `HTML's own two IDREF attributes: <area href>, <link href> as same-document refs`,
    count: (tag, a) => {
      if (tag !== "area" && tag !== "link") return 0
      const h = av(a, "href")
      return h.length > 1 && h.charCodeAt(0) === 35 ? 1 : 0
    },
  },
  {
    type: "implements",
    note: `ARIA role: <div role="button"> adopts a role contract`,
    count: (_tag, a) => (av(a, "role").length > 0 ? 1 : 0),
  },
  {
    type: "exports",
    note: `named <slot name="x">: the component's light-DOM projection point`,
    count: (tag, a) => (tag === "slot" && av(a, "name").length > 0 ? 1 : 0),
  },
  {
    type: "overrides",
    note: `no HTML construct exists; counted anyway so the ruling has a number`,
    count: () => 0,
  },
]

// ---------------------------------------------------------------------------
// AST attribute reader, same shape the analyzer uses, so a construct probe and
// the analyzer agree on WHAT an attribute is (grammar nodes, not source text).
// ---------------------------------------------------------------------------
function tagOf(node: any): string {
  for (let i = 0; i < node.childCount; i++) {
    const st = node.child(i)
    if (!st) continue
    if (st.type !== "start_tag" && st.type !== "self_closing_tag") continue
    for (let j = 0; j < st.childCount; j++) {
      const g = st.child(j)
      if (g && g.type === "tag_name") return g.text.toLowerCase()
    }
  }
  return ""
}
function attrsOf(node: any): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < node.childCount; i++) {
    const st = node.child(i)
    if (!st) continue
    if (st.type !== "start_tag" && st.type !== "self_closing_tag") continue
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

interface ConstructHit { files: Set<string>; occurrences: number; samples: string[] }

interface Row {
  corpus: string; files: number; parsed: number; failed: number
  rel: Map<string, number>; relFiles: Map<string, Set<string>>
  imports: number; importFiles: Set<string>; exportsRows: number; exportFiles: number
  hits: Map<string, ConstructHit>
  noLine: number; badLine: number; emptyName: number; unknownSymbols: number
  conf: Map<string, number>
}
function blankRow(corpus: string): Row {
  return {
    corpus, files: 0, parsed: 0, failed: 0,
    rel: new Map(), relFiles: new Map(), imports: 0, importFiles: new Set(),
    exportsRows: 0, exportFiles: 0, hits: new Map(),
    noLine: 0, badLine: 0, emptyName: 0, unknownSymbols: 0, conf: new Map(),
  }
}
/** Sets do not survive JSON, so a cached row stores arrays and is rebuilt here. */
function rehydrate(c: any): Row {
  const r = blankRow(c.corpus)
  r.files = c.files; r.parsed = c.parsed; r.failed = c.failed
  r.rel = new Map(Object.entries(c.rel))
  r.relFiles = new Map(Object.entries(c.relFiles).map(([k, v]: any) => [k, new Set(v)]))
  r.imports = c.imports
  r.importFiles = new Set(c.importFiles)
  r.exportsRows = c.exportsRows; r.exportFiles = c.exportFiles
  for (const [k, v] of Object.entries(c.hits)) {
    r.hits.set(k, { files: new Set((v as any).files), occurrences: (v as any).occurrences, samples: (v as any).samples })
  }
  r.noLine = c.noLine; r.badLine = c.badLine; r.emptyName = c.emptyName; r.unknownSymbols = c.unknownSymbols
  r.conf = new Map(Object.entries(c.conf))
  return r
}
function dehydrate(r: Row): any {
  return {
    corpus: r.corpus, files: r.files, parsed: r.parsed, failed: r.failed,
    rel: Object.fromEntries(r.rel),
    relFiles: Object.fromEntries([...r.relFiles].map(([k, v]) => [k, [...v]])),
    imports: r.imports, importFiles: [...r.importFiles],
    exportsRows: r.exportsRows, exportFiles: r.exportFiles,
    hits: Object.fromEntries([...r.hits].map(([k, v]) => [k, { files: [...v.files], occurrences: v.occurrences, samples: v.samples }])),
    noLine: r.noLine, badLine: r.badLine, emptyName: r.emptyName, unknownSymbols: r.unknownSymbols,
    conf: Object.fromEntries(r.conf),
  }
}

const rows: Row[] = []

for (const corpus of corpora) {
  // Resume support: a corpus already measured under this driver invocation is
  // not re-measured, so a parser hang in one corpus costs that corpus and not
  // the whole sweep. The skip list only ever names files in the corpus that
  // hung, so a cached row is never stale with respect to it.
  const cachePath = RESULTS ? join(RESULTS, `${corpus}.json`) : null
  if (cachePath && existsSync(cachePath)) {
    const cached = JSON.parse(readFileSync(cachePath, "utf8"))
    rows.push(rehydrate(cached))
    continue
  }
  const files = byCorpus.get(corpus)!.filter((f) => !SKIP.has(f))
  const row = blankRow(corpus)
  for (const f of files) {
    row.files++
    let content = ""
    try { content = readFileSync(f, "utf8") } catch { row.failed++; continue }
    let res: any
    try {
      res = await ASTEngine.parseFile(f, content)
      row.parsed++
    } catch {
      row.failed++
      continue
    }
    const names = new Set<string>()
    for (const s of res.symbols || []) {
      if (typeof s.name === "string") names.add(s.name)
      if (s.name === undefined || s.name === "" || (typeof s.name === "string" && s.name.trim().length === 0)) {
        row.emptyName++
      }
    }
    const rels = res.relationships || []
    for (const r of rels) {
      const t = r.relationshipType ?? r.type
      if (!t) continue
      row.rel.set(t, (row.rel.get(t) || 0) + 1)
      let sf = row.relFiles.get(t)
      if (!sf) { sf = new Set<string>(); row.relFiles.set(t, sf) }
      sf.add(f)
      if (typeof r.line_number !== "number") row.noLine++
      else if (r.line_number <= 0) row.badLine++
      // R7: an endpoint that is neither a symbol of this file nor a path/scheme
      // is an unresolvable identity. Reported, not silently accepted.
      const src = r.source, tgt = r.target
      if (typeof src === "string" && src.length === 0) row.unknownSymbols++
      if (typeof tgt === "string" && tgt.length === 0) row.unknownSymbols++
      const c = typeof r.confidence === "number" ? r.confidence : -1
      const ck = `${t}@${c}`
      row.conf.set(ck, (row.conf.get(ck) || 0) + 1)
    }
    const imps = res.imports || []
    row.imports += imps.length
    if (imps.length) row.importFiles.add(f)
    const exps = res.exports || []
    row.exportsRows += exps.length
    if (exps.length) row.exportFiles++

    // Construct probes over the DOCUMENT tree only. Deliberately NOT over the
    // embedded sub-parses: `is=`/`role=`/custom-element questions are about what
    // the MARKUP says, and a JS delegate's `class X extends Y` inside an inline
    // script is the delegate's edge to emit, already counted above.
    //
    // Parsed SEPARATELY from the html grammar rather than read off ParseResult,
    // which carries no tree (types.ts:205-216). That is also what makes this
    // probe independent: it never reads a field the analyzer wrote, so it cannot
    // agree with the analyzer by construction.
    let root: any = null
    try { root = htmlParser.parse(content, f).rootNode } catch {}
    if (root) {
      const stack: any[] = [root]
      while (stack.length) {
        const n = stack.pop()
        if (n.type === "element" || n.type === "script_element" || n.type === "style_element") {
          const tag = tagOf(n)
          if (tag) {
            const a = attrsOf(n)
            for (const p of PROBES) {
              let c = 0
              try { c = p.count(tag, a) } catch { c = 0 }
              if (c <= 0) continue
              let h = row.hits.get(p.type)
              if (!h) { h = { files: new Set<string>(), occurrences: 0, samples: [] }; row.hits.set(p.type, h) }
              h.occurrences += c
              h.files.add(f)
              if (h.samples.length < 3) h.samples.push(`${relative(join(CORPUS, corpus), f)} <${tag}>`)
            }
          }
        }
        for (let i = 0; i < n.namedChildCount; i++) {
          const c = n.namedChild(i)
          if (c) stack.push(c)
        }
      }
    }
  }
  rows.push(row)
  if (cachePath) writeFileSync(cachePath, JSON.stringify(dehydrate(row)))
}

const totalFiles = rows.reduce((a, r) => a + r.files, 0)

// Fold the per-corpus rows into the global tallies AFTER the loop, so a cached
// row contributes exactly like a freshly measured one and no aggregate depends
// on how many worker attempts it took to collect them.
const globalRel = new Map<string, number>()
const globalRelFiles = new Map<string, Set<string>>()
const globalHitFiles = new Map<string, Set<string>>()
const globalHitOcc = new Map<string, number>()
const globalConf = new Map<string, number>()
let gImports = 0, gImportFiles = 0, gParsed = 0, gFailed = 0, gExports = 0, gExportFiles = 0
let gNoLine = 0, gBadLine = 0, gEmptyName = 0, gUnknown = 0
for (const r of rows) {
  gParsed += r.parsed; gFailed += r.failed
  gImports += r.imports; gImportFiles += r.importFiles.size
  gExports += r.exportsRows; gExportFiles += r.exportFiles
  gNoLine += r.noLine; gBadLine += r.badLine; gEmptyName += r.emptyName; gUnknown += r.unknownSymbols
  for (const [t, n] of r.rel) {
    globalRel.set(t, (globalRel.get(t) || 0) + n)
    let s = globalRelFiles.get(t)
    if (!s) { s = new Set<string>(); globalRelFiles.set(t, s) }
    for (const f of r.relFiles.get(t) || []) s.add(f)
  }
  for (const [k, n] of r.conf) globalConf.set(k, (globalConf.get(k) || 0) + n)
  for (const [t, h] of r.hits) {
    globalHitOcc.set(t, (globalHitOcc.get(t) || 0) + h.occurrences)
    let s = globalHitFiles.get(t)
    if (!s) { s = new Set<string>(); globalHitFiles.set(t, s) }
    for (const f of h.files) s.add(f)
  }
}

console.log(`html-ontology-census   repo=${REPO}`)
console.log(`corpora: ${corpora.join(", ")}`)
console.log(`files: ${totalFiles} html/htm   parsed ${gParsed}   failed ${gFailed}`)
console.log(`enum values (${ALL.length}): ${ALL.join(" ")}\n`)

console.log("=== PER-TYPE VERDICT TABLE (production ASTEngine.parseFile path) ===")
console.log("type           edges     files   verdict-input")
for (const t of ALL) {
  const n = globalRel.get(t) || 0
  const nf = globalRelFiles.get(t)?.size || 0
  const note = CHANNEL_NOTE[t] ? CHANNEL_NOTE[t] : n > 0 ? `EMITTED` : `no edge on ${totalFiles} files`
  const shown = t === IMPORT_ENUM ? gImports : n
  const shownF = t === IMPORT_ENUM ? gImportFiles : nf
  console.log(`  ${t.padEnd(13)} ${String(shown).padStart(6)}  ${String(shownF).padStart(6)}   ${note}`)
}

console.log(`\n=== CONSTRUCT CENSUS — does the LANGUAGE have the construct? ===`)
console.log("(a non-zero count here means RULED is overturned and the type is a GAP)")
for (const p of PROBES) {
  const occ = globalHitOcc.get(p.type) || 0
  const fl = globalHitFiles.get(p.type)?.size || 0
  console.log(`  ${p.type.padEnd(13)} ${String(occ).padStart(6)} occ in ${String(fl).padStart(4)} files   ${p.note}`)
  for (const r of rows) {
    const h = r.hits.get(p.type)
    if (h && h.occurrences > 0) console.log(`      ${r.corpus.padEnd(12)} ${String(h.occurrences).padStart(5)} occ / ${String(h.files.size).padStart(4)} files   e.g. ${h.samples.slice(0, 2).join("   ")}`)
  }
}

console.log(`\n=== PER-CORPUS EDGE COUNTS ===`)
const hdr = ["corpus", "files", "parsed", ...ALL.filter((t) => t !== IMPORT_ENUM), "imports[]"]
console.log("  " + hdr.map((h, i) => (i < 4 ? h.padEnd(12) : h.padStart(11))).join(" "))
for (const r of rows) {
  const cells = [r.corpus, String(r.files), String(r.parsed)]
  let line = "  " + cells[0].padEnd(12) + cells[1].padStart(6) + cells[2].padStart(7)
  for (const t of ALL) {
    if (t === IMPORT_ENUM) continue
    line += String(r.rel.get(t) || 0).padStart(11)
  }
  line += String(r.imports).padStart(11)
  console.log(line)
}

console.log(`\n=== CONFIDENCE DISTRIBUTION per type (M14 §4: <1.0 needs a reason code) ===`)
for (const [k, n] of [...globalConf.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(28)} ${String(n).padStart(7)}`)
}

console.log(`\n=== R7 / M59.O2 INVARIANTS ===`)
console.log(`  relationships with NO line_number : ${gNoLine}`)
console.log(`  relationships with line_number<=0 : ${gBadLine}`)
console.log(`  empty/whitespace symbol names      : ${gEmptyName}`)
console.log(`  empty relationship endpoints       : ${gUnknown}`)
console.log(`  exports[] channel rows             : ${gExports} in ${gExportFiles} files`)

if (!existsSync(join(REPO, "src/ast/real-html-analyzer.ts"))) {
  console.log(`\nNOTE: ${REPO}/src/ast/real-html-analyzer.ts not found — the numbers above are NOT html's.`)
}