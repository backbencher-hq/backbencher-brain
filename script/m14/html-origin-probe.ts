// HTML_FIX — JOB 1 Part 1 probe: the six questions, per emitted type.
//
// The six (ONTOLOGY-WORKSTREAM.md Part 1):
//   1 exists      2 fires      3 correct (oracle agrees)
//   4 labelled    5 resolved   6 confident
//
// Source derivation answers only (1). This probe answers (2), (4), (5), (6)
// from production output, and (3) by RUNNING the differential's own oracle
// `deriveHtmlEdges` — which is imported from the shared harness, never
// re-implemented here, because a second derivation written by the same author
// as the probe would agree with the probe by construction.
//
// THE ORIGIN SPLIT, which is the part html uniquely needs. Every edge in an
// html ParseResult is either written by real-html-analyzer.ts or merged in
// from a JS/TS/CSS delegate by mergeEmbeddedBlocks. The merge tags every merged
// row `metadata.htmlEmbedded = true` plus `embeddedLang`, so origin is
// MEASURED, not guessed — and that distinction is the whole question for this
// lane, because the handover asked whether the JS/TS/CSS delegation is honestly
// represented. Three of html's six firing types (calls, references,
// instantiates) exist ONLY on the delegate side, and a graph that cannot say
// which is which is a graph whose edges have two different meanings under one
// label.
//
// NO REGEX. String includes/charCodeAt only.
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const REPO = process.env.BB_REPO || "/tmp/opencode/wt/HTML_FIX"
const CORPUS = process.env.BB_CORPUS || "$HOME/fixtures/repositories"
const NFILES = Number(process.env.NFILES || 100000)

const { ASTEngine } = await import(`${REPO}/src/ast/engine.ts`)
const { RelationshipType } = await import(`${REPO}/src/ast/types.ts`)
const ALL = [...new Set(Object.values(RelationshipType))]

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

const files: string[] = []
let ents: any[] = []
try { ents = readdirSync(CORPUS, { withFileTypes: true }) } catch {}
for (const e of ents) if (e.isDirectory()) findHtml(join(CORPUS, e.name), files)
files.sort()
// STRATIFIED, and this is the brief's own warning turned on my own probe. The
// first version sampled `files.slice(0, NFILES)`. `files` is sorted by absolute
// path, so the first 300 are all alamofire — the one corpus in the whole sweep
// with ZERO inline <script>/<style> (per-corpus calls: 0). The oracle pass then
// reported "emitted edges the oracle does NOT derive: (none)" and 100% apparent
// agreement, because on that sample html emits no `calls`, no `references` and no
// `instantiates` at all. A sample whose CONTENT decides the score is not a
// sample; the ruby 1/10 -> 8/10 swing in firing-check-v2 DEFECT 1 is the same
// defect at a different scale.
//
// So the sample takes a deterministic stride WITHIN each corpus, which
// guarantees every corpus is represented and every delegate-bearing corpus is
// measured on files that actually carry inline code.
function stratified(all: string[], n: number): string[] {
  const byCorpus = new Map<string, string[]>()
  for (const f of all) {
    const rel = f.slice(CORPUS.length + 1)
    const corpus = rel.split("/")[0]
    let arr = byCorpus.get(corpus)
    if (!arr) { arr = []; byCorpus.set(corpus, arr) }
    arr.push(f)
  }
  // ROUND-ROBIN, not a per-corpus stride then a global head. A per-corpus
  // stride still emits the first corpus first, so any PREFIX of the result is
  // again one corpus — which is the defect. Round-robin interleaves the corpora,
  // so every prefix of the sample is itself stratified and the LIMIT can be
  // applied afterwards without re-introducing the bias.
  const out: string[] = []
  const keys = [...byCorpus.keys()].sort()
  const stride = new Map<string, number>()
  for (const k of keys) {
    const arr = byCorpus.get(k)!
    stride.set(k, Math.max(1, Math.floor(arr.length / Math.max(1, Math.ceil((arr.length / all.length) * n)))))
  }
  const cursor = new Map<string, number>()
  for (const k of keys) cursor.set(k, 0)
  let progress = true
  while (progress) {
    progress = false
    for (const k of keys) {
      const arr = byCorpus.get(k)!
      const st = stride.get(k)!
      let i = cursor.get(k)!
      if (i >= arr.length) continue
      out.push(arr[i])
      cursor.set(k, i + st)
      progress = true
      if (out.length >= n) return out
    }
  }
  return out
}
const sample = stratified(files, Math.min(NFILES, files.length))

// The differential's own oracle, imported not copied.
let deriveHtmlEdges: any = null
try {
  const d: any = await import(`${REPO}/script/m14/differential.ts`)
  deriveHtmlEdges = d.deriveHtmlEdges
} catch (e) {
  console.log(`NOTE: could not import deriveHtmlEdges (${String(e).slice(0, 90)}) — question 3 will be reported as UNAVAILABLE rather than guessed.`)
}

for (const l of ["html", "javascript", "typescript", "tsx", "css"]) {
  try { await ASTEngine.getParser(l) } catch {}
}
const htmlParser = await ASTEngine.getParser("html")

interface Cell { n: number; files: Set<string>; srcSym: number; tgtSym: number; tgtPathish: number; empty: number }
interface OriginCell {
  n: number; files: Set<string>
  conf: Map<string, number>; ev: Map<string, number>
  lineMissing: number; lineBad: number
  srcSym: number; tgtSym: number; tgtPathish: number; tgtEmpty: number; srcEmpty: number
  placeholder: number; placeholderSamples: Set<string>
}
function blankOrigin(): OriginCell {
  return {
    n: 0, files: new Set(), conf: new Map(), ev: new Map(), lineMissing: 0, lineBad: 0,
    srcSym: 0, tgtSym: 0, tgtPathish: 0, tgtEmpty: 0, srcEmpty: 0,
    placeholder: 0, placeholderSamples: new Set(),
  }
}

const byType = new Map<string, Map<string, OriginCell>>()
for (const t of ALL) byType.set(t, new Map())
let filesParsed = 0, filesFailed = 0

/** A target is PATHISH when it names a file the index could resolve: a relative
 *  path, a scheme, or a bare filename with an extension. That is the analyzer's
 *  own published resolution contract ("neither symbol, scheme, nor path"), so
 *  this probe applies the analyzer's definition rather than inventing a stricter
 *  one — but it also reports the two classes SEPARATELY, so a reader can apply
 *  a stricter definition without re-running anything. */
function pathish(t: string): boolean {
  if (t.length === 0) return false
  if (t.includes("/") || t.includes("\\")) return true
  if (t.includes(".")) return true
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i)
    if (c === 58 /* : */) return true
  }
  return false
}

for (const f of sample) {
  let content = ""
  try { content = readFileSync(f, "utf8") } catch { filesFailed++; continue }
  let res: any
  try { res = await ASTEngine.parseFile(f, content); filesParsed++ } catch { filesFailed++; continue }
  const names = new Set<string>()
  for (const s of res.symbols || []) if (typeof s.name === "string") names.add(s.name)
  for (const r of res.relationships || []) {
    const t = r.relationshipType ?? r.type
    if (!t) continue
    if (!byType.has(t)) byType.set(t, new Map())
    const md = r.metadata || {}
    const origin = md.htmlEmbedded === true ? `delegate:${md.embeddedLang ?? "?"}` : "html-own"
    const m = byType.get(t)!
    let c = m.get(origin)
    if (!c) { c = blankOrigin(); m.set(origin, c) }
    c.n++
    c.files.add(f)
    const conf = typeof r.confidence === "number" ? String(r.confidence) : "MISSING"
    c.conf.set(conf, (c.conf.get(conf) || 0) + 1)
    const ev = typeof md.evidenceClass === "string" ? md.evidenceClass : "MISSING"
    c.ev.set(ev, (c.ev.get(ev) || 0) + 1)
    if (typeof r.line_number !== "number") c.lineMissing++
    else if (r.line_number <= 0) c.lineBad++
    const src = typeof r.source === "string" ? r.source : ""
    const tgt = typeof r.target === "string" ? r.target : ""
    if (src.length === 0) c.srcEmpty++
    if (tgt.length === 0) c.tgtEmpty++
    if (src.length > 0 && names.has(src)) c.srcSym++
    if (tgt.length > 0 && names.has(tgt)) c.tgtSym++
    else if (tgt.length > 0 && pathish(tgt)) c.tgtPathish++
    // R7 / placeholder-literal endpoints: a target that is the SOURCE TEXT of a
    // construct rather than an identity — a bare fragment, a scheme name, a
    // leading '#', whitespace, or the analyzer's own sentinel.
    const bare = tgt.trim()
    if (bare.length === 0 || bare.charCodeAt(0) === 35 /* # */ || bare === "javascript:" ||
        bare.includes("  ") || bare === "null" || bare === "undefined" || bare === "*") {
      c.placeholder++
      if (c.placeholderSamples.size < 4) c.placeholderSamples.add(`${relative(CORPUS, f)} -> "${tgt}"`)
    }
  }
}

console.log(`html-origin-probe  repo=${REPO}`)
console.log(`files: ${sample.length} sampled, ${filesParsed} parsed, ${filesFailed} failed\n`)
console.log("Q2 FIRES / Q4 ORIGIN / Q5 RESOLVED / Q6 CONFIDENT, per type per origin")
console.log("srcSym/tgtSym = endpoint is a symbol of this file; tgtPath = a path/scheme;")
console.log("NEITHER = an unresolvable identity (the class html's doc holds at 0).\n")

for (const t of ALL) {
  const m = byType.get(t)!
  const total = [...m.values()].reduce((a, c) => a + c.n, 0)
  const origins = [...m.entries()].sort((a, b) => b[1].n - a[1].n)
  if (total === 0) {
    // Report the importers channel separately: `imports` is not a relationship.
    console.log(`${t.padEnd(13)} 0 edges  SILENT`)
    continue
  }
  console.log(`${t.padEnd(13)} ${String(total).padStart(6)} edges`)
  for (const [o, c] of origins) {
    // Endpoint accounting is PER ENDPOINT (2 per edge), never per edge: an
    // earlier version subtracted srcSym and tgtSym from the same edge total and
    // printed NEITHER = -68914, which is a nonsense number that looks like a
    // measurement. Counted over 2*c.n endpoints:
    const endpoints = 2 * c.n
    const resolved = c.srcSym + c.tgtSym + c.tgtPathish
    const neither = endpoints - resolved - c.srcEmpty - c.tgtEmpty
    console.log(`   ${o.padEnd(16)} ${String(c.n).padStart(6)} edges / ${String(c.files.size).padStart(4)} files`)
    console.log(`      confidence   ${[...c.conf.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  ")}`)
    console.log(`      evidenceClass ${[...c.ev.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}:${n}`).join("  ")}`)
    console.log(`      endpoints ${endpoints}: src->symbol ${c.srcSym}  tgt->symbol ${c.tgtSym}  tgt->path/scheme ${c.tgtPathish}  UNRESOLVED ${neither}`)
    console.log(`      line_number missing ${c.lineMissing}  <=0 ${c.lineBad}   empty endpoints src ${c.srcEmpty} tgt ${c.tgtEmpty}   placeholder-literal targets ${c.placeholder}`)
    for (const s of c.placeholderSamples) console.log(`         e.g. ${s}`)
  }
  console.log()
}

// ---- Q3 CORRECT: run the shared oracle over the same files ------------------
//
// THIRD instrument defect in this lane's own tooling, and the same one twice.
//
// The first version drove `deriveHtmlEdges` off `ASTEngine.getParser("html")` —
// the SAME cached Parser that `parseFile` uses — and asked it to parse a second
// tree per file. web-tree-sitter keeps parser state in a fixed wasm heap and the
// second tree is never freed, so by file ~500 the oracle pass died with
// "Out of bounds memory access" / "byteOffset cannot be negative". The oracle
// then reported "derived >=1 edge on 0 of 1065 files" — a 0/0 FABRICATION, and
// the precise failure the differential harness itself guards against
// (`treeEdgesTotal === 0 throws`).
//
// So the oracle gets its OWN parser, rotated every ROTATE files, and the sample
// is stated rather than implied. The sample size is a real limitation: the
// oracle is a separate walker over the SAME grammar, so a grammar bug shared
// with the analyzer is invisible to this check by construction, and a sample is
// not the same claim as an exhaustive pass.
if (deriveHtmlEdges) {
  const ROTATE = Number(process.env.ORACLE_ROTATE || 40)
  const LIMIT = Number(process.env.ORACLE_NFILES || 300)
  const wts: any = await import(`${REPO}/node_modules/web-tree-sitter/tree-sitter.js`)
  await wts.Parser.init?.()
  const Parser = wts.Parser || (wts.default && wts.default.Parser)
  const Language = wts.Language || (wts.default && wts.default.Language)
  const coreLang = await ASTEngine.getParser("html")
  const grammar: any = (coreLang as any).language ?? coreLang
  const agree = new Map<string, number>()
  const agreeSiteAgnostic = new Map<string, number>()
  const agreeByOrigin = new Map<string, number>()
  const unsupported = new Map<string, { n: number; samples: string[] }>()
  const missing = new Map<string, { n: number; samples: string[] }>()
  const truthByLabel = new Map<string, number>()
  const truthTotal = new Map<string, number>()
  const oracleErrors = new Set<string>()
  let filesWithTruth = 0, filesCompared = 0, rotated = 0
  let fresh: any = new Parser()
  ;(fresh as any).setLanguage(grammar)
  let sinceRotate = 0
  for (let idx = 0; idx < sample.length && idx < LIMIT; idx++) {
    const f = sample[idx]
    let content = ""
    try { content = readFileSync(f, "utf8") } catch { continue }
    // Strip only the LAST extension. `split(".")[0]` turns
    // `clojure.core.async.flow.html` into `clojure`, while the analyzer's
    // `path.basename(f, path.extname(f))` and the differential's
    // `relPath.replace(/\.[^.]+$/, "")` both give `clojure.core.async.flow`.
    // The mismatch moved every edge's SOURCE, so every edge looked like a
    // disagreement in both directions — 1 spurious "uses" and 1 spurious
    // "contains" per file with a dot in its name. Same triple for all three.
    const base = f.split("/").pop() ?? "document"
    const dot = base.lastIndexOf(".")
    const stem = (dot > 0 ? base.slice(0, dot) : base) || "document"
    let truth: any[] = []
    let tree: any = null
    try {
      tree = fresh.parse(content)
      truth = deriveHtmlEdges(tree.rootNode, stem)
    } catch (e) {
      if (oracleErrors.size < 5) oracleErrors.add(String(e).slice(0, 140))
      try { tree?.delete?.() } catch {}
      continue
    }
    sinceRotate++
    if (sinceRotate >= ROTATE) {
      // Drop the parser and its trees rather than letting the heap run out. A
      // fresh Parser costs a wasm allocation; 300 files at 40 per parser is 8.
      try { fresh.delete?.() } catch {}
      fresh = new Parser(); (fresh as any).setLanguage(grammar)
      sinceRotate = 0; rotated++
    }
    for (const e of truth) truthTotal.set(e.label, (truthTotal.get(e.label) || 0) + 1)
    if (!truth.length) { try { tree.delete?.() } catch {}; continue }
    filesWithTruth++
    filesCompared++
    let res: any
    try { res = await ASTEngine.parseFile(f, content) } catch { continue }
    const key = new Set<string>()
    for (const e of truth) key.add(`${e.label}|${e.from}|${e.target}`)
    // Mine is keyed (label, source, target) — the STRICT triple. The
    // differential's own comparison is site-agnostic and matches label+target
    // ONLY (differential.ts:1620, 5180, 5727 and others), so a row whose target
    // matches but whose SOURCE differs reads as agreement to the gate and as
    // disagreement here. Both are computed, so neither number has to be taken on
    // trust: `agreeStrict` is this probe's rule, `agreeSiteAgnostic` is the
    // gate's. A gap between them IS a finding about the gate.
    const mineStrict = new Set<string>()
    const mineSiteAgnostic = new Set<string>()
    for (const r of res.relationships || []) {
      const t = r.relationshipType ?? r.type
      if (!t) continue
      mineStrict.add(`${t}|${r.source}|${r.target}`)
      mineSiteAgnostic.add(`${t}|${r.target}`)
    }
    for (const e of truth) {
      const lab = e.label
      truthByLabel.set(lab, (truthByLabel.get(lab) || 0) + 1)
      if (mineStrict.has(`${lab}|${e.from}|${e.target}`)) {
        agree.set(lab, (agree.get(lab) || 0) + 1)
        agreeByOrigin.set(`${lab}|html-own-side`, (agreeByOrigin.get(`${lab}|html-own-side`) || 0) + 1)
      }
      if (mineSiteAgnostic.has(`${lab}|${e.target}`)) agreeSiteAgnostic.set(lab, (agreeSiteAgnostic.get(lab) || 0) + 1)
      else {
        let u = missing.get(lab)
        if (!u) { u = { n: 0, samples: [] }; missing.set(lab, u) }
        u.n++
        if (u.samples.length < 3) u.samples.push(`${relative(CORPUS, f)} ${lab}: ${e.from} -> ${e.target}`)
      }
    }
    for (const r of res.relationships || []) {
      const t = r.relationshipType ?? r.type
      if (!t) continue
      const k = `${t}|${r.source}|${r.target}`
      const origin = (r.metadata && r.metadata.htmlEmbedded === true) ? `delegate:${r.metadata.embeddedLang ?? "?"}` : "html-own"
      const uk = `${t}  [${origin}]`
      if (!key.has(k)) {
        let u = unsupported.get(uk)
        if (!u) { u = { n: 0, samples: [] }; unsupported.set(uk, u) }
        u.n++
        if (u.samples.length < 3) u.samples.push(`${relative(CORPUS, f)} ${t}: ${r.source} -> ${r.target}`)
      }
    }
    try { tree.delete?.() } catch {}
  }
  try { fresh.delete?.() } catch {}
  console.log("=== Q3 CORRECT — the shared oracle deriveHtmlEdges ===")
  console.log(`sampling: first ${Math.min(sample.length, LIMIT)} files of ${sample.length}, parser rotated every ${ROTATE} (${rotated} rotations)`)
  console.log(`files compared (oracle derived >=1 edge): ${filesWithTruth}`)
  console.log(`oracle truth rows by label: ${[...truthTotal.entries()].map(([k, v]) => `${k}:${v}`).join("  ") || "(none)"}`)
  console.log(`agreed STRICT (label+source+target): ${[...agree.entries()].map(([k, v]) => `${k}:${v}`).join("  ") || "(none)"}`)
  console.log(`agreed SITE-AGNOSTIC (label+target, the gate's own rule): ${[...agreeSiteAgnostic.entries()].map(([k, v]) => `${k}:${v}`).join("  ") || "(none)"}`)
  console.log(`\nTRUTH ROWS THE ANALYZER DID NOT EMIT (MISSING direction), by label:`)
  for (const [t, u] of [...missing].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${t.padEnd(13)} ${String(u.n).padStart(6)}`)
    for (const sm of u.samples) console.log(`      ${sm}`)
  }
  if (missing.size === 0) console.log("  (none)")
  console.log(`oracle errors: ${[...oracleErrors].join(" | ") || "none"}`)
  console.log(`\nlabels the oracle derives (a fixed property of deriveHtmlEdges):`)
  console.log("  contains, uses  — nothing else, so any other type is unaudited BY CONSTRUCTION.")
  console.log(`\nemitted edges the oracle does NOT derive, by type AND ORIGIN:`)
  for (const [t, u] of [...unsupported].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${t.padEnd(13)} ${String(u.n).padStart(6)} unsupported`)
    for (const sm of u.samples) console.log(`      ${sm}`)
  }
  if (unsupported.size === 0) console.log("  (none)")
}
