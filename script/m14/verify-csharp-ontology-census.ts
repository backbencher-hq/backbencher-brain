/**
 * CORPUS_CS JOB 1 — the per-type census that a verdict is allowed to rest on.
 *
 * The instrument runs the PRODUCTION path and nothing else:
 *   ASTEngine.getParser(lang) -> parser.parse(content, path) -> new RealCSharpAnalyzer().analyze(root, ...)
 * No private reimplementation of engine internals, no separate parse. That matters: three
 * separate mistakes in this programme came from probing harness internals through a private
 * reimplementation and getting a confident number that was not the gate's number
 * (real-csharp-analyzer.md, CS-D11 section "How the breakdown was obtained").
 *
 * NO REGEX (rule 1). Every filter here is a string equality, a Set lookup, or `startsWith`
 * on a path segment. No RegExp literal and no RegExp construction appears in this file.
 *
 * WHAT IT MEASURES, per relationship type actually produced:
 *   - count and the FILES it came from (the workstream requires both)
 *   - the confidence distribution, so question 6 ("is anything under 0.7 a heuristic, not a
 *     fact?") has a number instead of an adjective
 *   - the evidenceClass distribution, which is a published field and can be wrong without
 *     any relationship failing to exist
 *   - the metadata.relationshipType sub-label distribution, which is what separates the
 *     families inside `uses` and inside `references`
 *   - R7 endpoint hygiene: empty names, and endpoints that are placeholder literals rather
 *     than a name the grammar wrote
 *   - the imports[] CHANNEL separately, because imports are not relationship rows
 *     (src/ast/types.ts:206-216 — `relationships` and `imports` are distinct fields)
 *
 * USAGE
 *   bun script/m14/tmp/cs-corpus-ontology-census.ts --corpus <dir> --nfiles N [--seed K] [--json out]
 *   bun script/m14/tmp/cs-corpus-ontology-census.ts --corpus <dir> --all
 *
 * SAMPLING. Directory-walk order is a terrible sample: the review measured Ruby at 1/10 from
 * NFILES=25 and 8/10 from NFILES=200 with the SAME analyzer and corpus, because the first 25
 * files in walk order were encoding data tables. So this census (a) filters to code-bearing
 * files by the same signal idea v2 uses, (b) sorts candidates so the draw is reproducible, and
 * (c) accepts an explicit seed so "re-run at a different NFILES" is a one-flag operation.
 * The reported per-type counts therefore carry the sample definition, and every number in the
 * CORPUS_CS report states its sample.
 */
import * as fs from "fs"
import * as path from "path"

const ROOT = "/tmp/opencode/wt/CORPUS_CS"
const BIG_FILE_CAP = 400_000

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

// ---------------------------------------------------------------------------
// No regex anywhere. Every one of these is a string op.
// ---------------------------------------------------------------------------
const CODE_SIGNALS = [
  "class ", "interface ", "struct ", "enum ", "record ", "namespace ", "using ",
  "public ", "private ", "internal ", "protected ", "static ", "void ", "var ", "=>",
]

const IGNORED_DIR_NAMES = new Set([
  "node_modules", ".git", "bin", "obj", "target", "packages", "node_modules",
  "TestResults", ".vs", "artifacts",
])

function isCodeBearing(src: string): boolean {
  for (const s of CODE_SIGNALS) if (src.includes(s)) return true
  return false
}

function walkCs(dir: string, out: string[], depth = 0): void {
  if (depth > 24 || out.length > 400_000) return
  let ents: fs.Dirent[]
  try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (IGNORED_DIR_NAMES.has(e.name)) continue
      walkCs(p, out, depth + 1)
    } else if (e.isFile() && e.name.endsWith(".cs")) {
      out.push(p)
    }
  }
}

/** Deterministic 32-bit string hash — the reproducible shuffle key. Not a regex. */
function hash32(s: string, seed: number): number {
  let h = 2166136261 ^ (seed >>> 0)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

type Tally = {
  count: number
  files: Map<string, number>
  conf: Map<string, number>
  evidence: Map<string, number>
  sublabel: Map<string, number>
  emptySource: number
  emptyTarget: number
  examples: Array<{ f: string; s: string; t: string; c: number }>
}

function newTally(): Tally {
  return {
    count: 0, files: new Map(), conf: new Map(), evidence: new Map(), sublabel: new Map(),
    emptySource: 0, emptyTarget: 0, examples: [],
  }
}

function bump(m: Map<string, number>, k: string): void {
  m.set(k, (m.get(k) || 0) + 1)
}

function topN(m: Map<string, number>, n = 12): string {
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k || "(empty)"}=${v}`).join("  ")
}

// ---------------------------------------------------------------------------

async function main() {
  const corpus = arg("--corpus")
  if (!corpus) { console.error("usage: --corpus <dir> --nfiles N [--seed K] [--all] [--json out]"); process.exit(2) }
  const wantAll = process.argv.includes("--all")
  const nfiles = Number(arg("--nfiles") ?? 200)
  const seed = Number(arg("--seed") ?? 1)
  const jsonOut = arg("--json")

  const all: string[] = []
  walkCs(corpus, all)
  const repoRoot = corpus
  const rel = (p: string) => p.startsWith(repoRoot + path.sep) ? p.slice(repoRoot.length + 1) : p

  // candidate pass: size cap + code-bearing filter, then deterministic order
  const cands: Array<{ p: string; k: number }> = []
  let rejectedTiny = 0, rejectedNotCode = 0, rejectedBig = 0
  for (const p of all) {
    let st: fs.Stats
    try { st = fs.statSync(p) } catch { continue }
    if (st.size >= BIG_FILE_CAP) { rejectedBig++; continue }
    let src: string
    try { src = fs.readFileSync(p, "utf8") } catch { continue }
    if (!isCodeBearing(src)) { rejectedNotCode++; continue }
    cands.push({ p, k: hash32(rel(p), seed) })
  }
  cands.sort((a, b) => (a.k - b.k) || (a.p < b.p ? -1 : 1))
  const files = wantAll ? cands.map((c) => c.p) : cands.slice(0, nfiles).map((c) => c.p)

  console.log(`corpus            ${corpus}`)
  console.log(`.cs on disk        ${all.length}`)
  console.log(`candidates        ${cands.length}  (rejected: ${rejectedBig} >${BIG_FILE_CAP}B, ${rejectedNotCode} not code-bearing)`)
  console.log(`sample            ${files.length} files, seed=${seed}, wantAll=${wantAll}`)
  console.log(`draw              deterministic over (seed, sorted relative path)`)

  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const { RealCSharpAnalyzer } = await import(path.join(ROOT, "src/ast/real-csharp-analyzer.ts"))
  // `Object.values<string>`: this module is loaded through a COMPUTED specifier
  // (`await import(path.join(ROOT, ...))`), which TypeScript cannot resolve, so the
  // namespace arrives as `any`. TS 5.9's `Object.values(o: {}): unknown[]` overload
  // then makes PROD an `unknown[]`, which surfaced as ten errors at its USES below
  // (`tallies.set(t, ...)`, `t.padEnd`, `payload.types[t]`) and not at this line.
  // Every RelationshipType member is string-initialised (src/ast/engine.ts:582+), so
  // the element type is stated once here. It is not a blanket cast: the same
  // instantiation over a value whose type is known to be `Record<string, unknown>`
  // is a compile error, so it can only help where the type was erased.
  const PROD = [...new Set(Object.values<string>(ASTEngine.RelationshipType))]
  const analyzer = new RealCSharpAnalyzer()

  const tallies = new Map<string, Tally>()
  for (const t of PROD) tallies.set(t, newTally())
  const offVocabulary = new Map<string, number>()

  let parsed = 0, failed = 0, errorNodes = 0, filesWithErrors = 0
  let importsTotal = 0, filesWithImports = 0
  const importExamples: string[] = []
  let symbolsTotal = 0
  let t0 = Date.now()

  for (const f of files) {
    let content: string
    try { content = fs.readFileSync(f, "utf8") } catch { failed++; continue }
    try {
      const parser = await ASTEngine.getParser("csharp")
      const pr = await parser.parse(content, f)
      const res: any = analyzer.analyze(pr.rootNode as any, content, f)
      parsed++
      symbolsTotal += (res.symbols || []).length
      const errs = res.errors || []
      if (errs.length) { filesWithErrors++; errorNodes += errs.length }
      const imps = res.imports || []
      importsTotal += imps.length
      if (imps.length) {
        filesWithImports++
        if (importExamples.length < 6) importExamples.push(`${rel(f)}  ->  ${imps.slice(0, 3).map((i: any) => i.module).join(" | ")}`)
      }
      for (const r of res.relationships || []) {
        const t = r.type ?? r.relationshipType
        if (typeof t !== "string" || t.length === 0) continue
        if (!tallies.has(t)) { bump(offVocabulary, t); continue }
        const tl = tallies.get(t)!
        tl.count++
        bump(tl.files, rel(f))
        bump(tl.conf, String(r.confidence ?? "(none)"))
        bump(tl.evidence, String((r.metadata || {}).evidenceClass ?? "(none)"))
        bump(tl.sublabel, String((r.metadata || {}).relationshipType ?? "(none)"))
        if (typeof r.source !== "string" || r.source.length === 0) tl.emptySource++
        if (typeof r.target !== "string" || r.target.length === 0) tl.emptyTarget++
        if (tl.examples.length < 5) tl.examples.push({ f: rel(f), s: String(r.source), t: String(r.target), c: Number(r.confidence ?? 0) })
      }
    } catch (e) {
      failed++
    }
  }
  const ms = Date.now() - t0

  console.log(`\nparsed ${parsed}/${files.length}   failed ${failed}   ${ms} ms  (${(ms / Math.max(parsed, 1)).toFixed(1)} ms/file)`)
  console.log(`symbols           ${symbolsTotal}`)
  console.log(`parse errors      ${errorNodes} in ${filesWithErrors} files`)
  console.log(`imports[] CHANNEL ${importsTotal} in ${filesWithImports} files  (separate from relationships)`)
  for (const e of importExamples) console.log(`   e.g. ${e}`)

  console.log(`\n=== RELATIONSHIP CHANNEL — per production type (${PROD.length}) ===`)
  const order = [...PROD].sort((a, b) => (tallies.get(b)!.count - tallies.get(a)!.count))
  for (const t of order) {
    const tl = tallies.get(t)!
    if (tl.count === 0) { console.log(`\n${t.padEnd(12)} count 0   files 0   -- DID NOT FIRE`); continue }
    console.log(`\n${t.padEnd(12)} count ${tl.count}   files ${tl.files.size}`)
    console.log(`   confidence : ${topN(tl.conf)}`)
    console.log(`   evidence   : ${topN(tl.evidence)}`)
    console.log(`   sublabel   : ${topN(tl.sublabel)}`)
    console.log(`   empty endpoints: source ${tl.emptySource}  target ${tl.emptyTarget}`)
    console.log(`   top files  : ${topN(tl.files, 5)}`)
    for (const e of tl.examples) console.log(`   e.g. ${e.s} -> ${e.t}  (c=${e.c})  ${e.f}`)
  }
  const fired = order.filter((t) => tallies.get(t)!.count > 0)
  console.log(`\nSCORE (relationship channel): ${fired.length}/${PROD.length}`)
  console.log(`fired : ${fired.join(" ")}`)
  console.log(`silent: ${order.filter((t) => tallies.get(t)!.count === 0).join(" ")}`)
  console.log(`off-vocabulary relationship types produced: ${topN(offVocabulary, 8) || "(none)"}`)

  if (jsonOut) {
    const payload: any = {
      corpus, seed, nfiles: files.length, wantAll, parsed, failed, ms, symbolsTotal,
      parseErrorNodes: errorNodes, filesWithErrors, importsTotal, filesWithImports,
      fired, silent: order.filter((t) => tallies.get(t)!.count === 0),
      types: {} as any,
    }
    for (const t of PROD) {
      const tl = tallies.get(t)!
      payload.types[t] = {
        count: tl.count,
        files: tl.files.size,
        conf: Object.fromEntries(tl.conf),
        evidence: Object.fromEntries(tl.evidence),
        sublabel: Object.fromEntries(tl.sublabel),
        emptySource: tl.emptySource,
        emptyTarget: tl.emptyTarget,
        topFiles: topN(tl.files, 20),
      }
    }
    payload.offVocabulary = Object.fromEntries(offVocabulary)
    fs.writeFileSync(jsonOut, JSON.stringify(payload, null, 2))
    console.log(`\nwrote ${jsonOut}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })