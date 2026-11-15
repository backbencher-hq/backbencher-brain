/**
 * BASH — WHAT THE UNRESOLVED EDGES ACTUALLY POINT AT, and how much of it is walkable.
 *
 * ## Why this file exists
 *
 * The six questions answer "does the edge resolve?" with a rate per type, and this
 * lane's rates are: `contains` 100%, `exports` 100%, `overrides` 100%, `uses` 80.0%,
 * `calls` **18.8%**, `imports` **0.0%**, `references` **0.0%** (400-file hash-order
 * sample, `census-bash-ontology.ts`).
 *
 * A rate is the wrong unit for the last three, because "does not resolve" is two
 * findings that look identical in a count and are opposites:
 *
 *   EXTERNAL          the target is a real thing outside the indexed corpus — an
 *                     external command, a file in `/etc`, a builtin. No analyzer
 *                     can resolve it and no analyzer should try. The edge is
 *                     correct and the graph is honestly bounded.
 *   NEVER INDEXED     the target is a declaration, or a file, INSIDE this corpus
 *                     that this run never published. That is a defect, and the
 *                     defect is either the analyzer's or the router's.
 *
 * The task's requirement C is exactly this separation, and requirement D — every
 * applicable relationship must resolve — is unanswerable until it is made. So this
 * probe makes it, over EVERY admitted file rather than a sample, because the classes
 * are small and a sample would report a rate for a class of size ~10.
 *
 * ## What it measures
 *
 *   A. UNINDEXED SOURCES. Every `imports`/`references` target that names a file
 *      which EXISTS inside a corpus repository but was not admitted by
 *      `detectLanguageFromPath`. For each one, the decisive question is asked with
 *      the production parser rather than by reading the file: **does the pinned bash
 *      grammar find at least one symbol in it?** A file the bash parser reads as
 *      shell, and the router declined, is a routing gap with a count.
 *
 *   B. CROSS-FILE CALL REACHABILITY. `calls` is 18.8% resolved and 82.4% of its
 *      edges carry `isExternalCommand`, so the interesting question is not "does the
 *      command resolve in this file" but "does it name a function DECLARED BY A FILE
 *      THIS SCRIPT SOURCES". bash's dependency model is `source`: the sourced file's
 *      functions are defined in the sourcing shell, so a call to one is a call to a
 *      real declaration this corpus holds. Only literal, resolvable source paths are
 *      used — a path the script computes is not evidence of anything.
 *
 *      This CANNOT be fixed inside the analyzer: `analyze()` is a per-file unit and
 *      never sees another file. So the deliverable here is the SIZE of the walkable
 *      class, which is what a cross-file resolution layer needs to know.
 *
 * ## Instrument, and the NO-REGEX rule
 *
 * Production `parseFile` from `src/ast/pool-worker.ts` — not `analyze()`, which skips
 * the pipeline stages. Path decomposition is character arithmetic (`charCodeAt`), never
 * a pattern, so this file adds zero regex literals to the lane.
 *
 * Two passes for one reason: an index built while the edges are read makes every
 * cross-file bucket order-dependent, which is the defect round 6 spent a whole pass
 * on inside a single file.
 *
 * CLI: npx tsx validation/m14/fixtures/bash/probe-bash-unresolved-targets.mts [--json out.json]
 */
import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const argv = process.argv.slice(2)
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined }
const OUT = flag("json")

// ---------------------------------------------------------------- corpus walk
type Admitted = { repo: string; dir: string; rel: string; abs: string }
const admitted: Admitted[] = []
/** Every TRACKED file inside a corpus repo, whatever its extension or shebang. This is
 * the universe a target can name, and it is deliberately wider than `admitted`: the
 * whole question is what falls between the two. */
const trackedOnDisk = new Set<string>()
const repoOf = new Map<string, string>()

for (const e of readdirSync(CR)) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    trackedOnDisk.add(abs)
    repoOf.set(abs, e)
    if (!existsSync(abs)) continue
    let size: number
    try { size = statSync(abs).size } catch { continue }
    if (size > 512 * 1024) continue
    let text: string
    try { text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "bash") continue
    admitted.push({ repo: e, dir, rel, abs })
  }
}
const totalAdmitted = admitted.length
const repos = new Set(admitted.map((f) => f.repo))
const admittedAbs = new Set(admitted.map((f) => f.abs))

/** Is `c` an ASCII letter or `_`? A char-code test, not a character class. */
const isNameStart = (c: string | undefined): boolean => {
  if (c === undefined) return false
  const k = c.charCodeAt(0)
  return (k >= 97 && k <= 122) || (k >= 65 && k <= 90) || k === 95 /* _ */
}
/** Does this target carry an unexpanded expansion? Character walk: a `$` followed by
 * `{`, `(`, a quote or a name is a value the script computes at run time. */
const hasUnexpandedExpansion = (t: string): boolean => {
  for (let i = 0; i < t.length; i++) {
    if (t.charCodeAt(i) !== 36 /* $ */) continue
    const next = t[i + 1]
    if (next === "{" || next === "(" || next === "'" || next === '"') return true
    if (isNameStart(next)) return true
  }
  return false
}
const startsWithTilde = (t: string): boolean => t.length > 0 && t.charCodeAt(0) === 126 /* ~ */
const isAbsolute = (t: string): boolean => t.length > 0 && t.charCodeAt(0) === 47 /* / */

// ---------------------------------------------------------------- pass one
type FileFacts = {
  /** function-symbol names this file publishes — the universe a `calls` target can
   * legitimately resolve against. `alias` is a function symbol too (`isAlias`). */
  functions: Set<string>
  /** literal, filesystem-resolvable `source`/`.` paths, as absolute paths */
  literalSources: string[]
  /** every `imports`/`references` target string, for section A */
  sourceTargets: { target: string; line: number }[]
  /** `calls` edges: target, and whether the analyzer called it external */
  calls: { target: string; line: number; external: boolean; fnCall: boolean }[]
  parseFailed: boolean
}
const facts = new Map<string, FileFacts>()

let idx = 0
let parseFailures = 0
async function worker() {
  while (true) {
    const i = idx++
    if (i >= admitted.length) return
    const f = admitted[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    if (!r || r.success === false) { parseFailures++; facts.set(f.abs, { functions: new Set(), literalSources: [], sourceTargets: [], calls: [], parseFailed: true }); continue }
    const ff: FileFacts = { functions: new Set(), literalSources: [], sourceTargets: [], calls: [], parseFailed: false }
    for (const s of r.symbols ?? []) {
      if (String(s?.kind ?? "").toLowerCase() !== "function") continue
      const nm = String(s?.name ?? "")
      if (nm) ff.functions.add(nm)
    }
    for (const x of r.relationships ?? []) {
      const t = String(x?.type ?? x?.relationshipType ?? "").toLowerCase()
      const tgt = String(x?.target ?? "")
      const line = Number(x?.line_number ?? 0)
      if (t === "imports" || t === "references") {
        // `imports` and `references` are two labels on ONE fact (measured: the key
        // sets are identical in both directions), so only the `imports` copy is read
        // here or every count in this file would be doubled.
        if (t !== "imports") continue
        ff.sourceTargets.push({ target: tgt, line })
        const resolution = String((x?.metadata as any)?.resolution ?? "")
        const trimmed = tgt.trim()
        if (resolution !== "literal") continue
        if (trimmed.length === 0 || hasUnexpandedExpansion(trimmed) || startsWithTilde(trimmed)) continue
        const candidates = isAbsolute(trimmed) ? [trimmed] : [path.resolve(path.dirname(f.abs), trimmed), path.resolve(f.dir, trimmed)]
        const hit = candidates.find((c) => existsSync(c))
        if (hit) ff.literalSources.push(hit)
        continue
      }
      if (t === "calls") {
        const md = (x?.metadata as any) ?? {}
        ff.calls.push({
          target: tgt,
          line,
          external: md.isExternalCommand === true,
          fnCall: md.isFunctionCall === true,
        })
      }
    }
    facts.set(f.abs, ff)
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ---------------------------------------------------------------- section A
type UnindexedVerdict = "bash-grammar-reads-symbols" | "no-symbols" | "too-large-to-parse" | "unreadable"
const unindexed = new Map<string, { repo: string; rel: string; bytes: number; from: number; verdict: UnindexedVerdict; symbols: number; functions: number; firstLine: string }>()
let unindexedEdges = 0
let unindexedEdgeExamples: string[] = []

const shapeCounts: Record<string, number> = {
  "unexpanded": 0, "tilde": 0, "external-absolute": 0,
  "resolves-to-an-admitted-file": 0, "resolves-to-a-file-the-router-declined": 0,
  "resolves-outside-every-corpus-repo": 0, "does-not-resolve": 0,
}
const shapeExamples: Record<string, string[]> = {}
let sourceEdges = 0

for (const f of admitted) {
  const ff = facts.get(f.abs)
  if (!ff) continue
  for (const st of ff.sourceTargets) {
    sourceEdges++
    const t = st.target.trim()
    let shape: string
    let resolvedAbs = ""
    if (t.length === 0) shape = "does-not-resolve"
    else if (hasUnexpandedExpansion(t)) shape = "unexpanded"
    else if (startsWithTilde(t)) shape = "tilde"
    else {
      const candidates = isAbsolute(t) ? [t] : [path.resolve(path.dirname(f.abs), t), path.resolve(f.dir, t)]
      const hit = candidates.find((c) => existsSync(c))
      if (!hit) shape = "does-not-resolve"
      else {
        resolvedAbs = hit
        if (admittedAbs.has(hit)) shape = "resolves-to-an-admitted-file"
        else if (trackedOnDisk.has(hit)) shape = "resolves-to-a-file-the-router-declined"
        else shape = "resolves-outside-every-corpus-repo"
      }
    }
    shapeCounts[shape]++
    if (!shapeExamples[shape]) shapeExamples[shape] = []
    if (shapeExamples[shape].length < 6) shapeExamples[shape].push(`${f.repo}/${f.rel}:${st.line} -> ${t}${resolvedAbs ? `   [${resolvedAbs}]` : ""}`)
    if (shape !== "resolves-to-a-file-the-router-declined") continue
    unindexedEdges++
    if (unindexed.has(resolvedAbs)) continue
    const repo = repoOf.get(resolvedAbs) ?? "?"
    const rel = resolvedAbs.slice(path.join(CR, repo).length + 1)
    let bytes = 0
    try { bytes = statSync(resolvedAbs).size } catch { /* counted as unreadable below */ }
    const entry = { repo, rel, bytes, from: 0, verdict: "unreadable" as UnindexedVerdict, symbols: 0, functions: 0, firstLine: "" }
    unindexed.set(resolvedAbs, entry)
    if (bytes > 512 * 1024) { entry.verdict = "too-large-to-parse"; continue }
    let text = ""
    try { text = readFileSync(resolvedAbs, "utf8") } catch { continue }
    const nl = text.indexOf("\n")
    entry.firstLine = (nl >= 0 ? text.slice(0, nl) : text).slice(0, 78)
    // THE DECISIVE TEST: run the PRODUCTION parser over a file the router declined.
    // Reading the text and deciding "looks like shell" would be this probe's own
    // judgement; asking the parser is a measurement.
    let r: any
    try { r = await parseFile(resolvedAbs, path.join(CR, repo)) } catch { continue }
    const syms = (r?.symbols ?? []).filter((s: any) => String(s?.name ?? "").length > 0)
    entry.symbols = syms.length
    entry.functions = syms.filter((s: any) => String(s?.kind ?? "").toLowerCase() === "function").length
    entry.verdict = syms.length > 0 ? "bash-grammar-reads-symbols" : "no-symbols"
  }
}

// ---------------------------------------------------------------- section B
type Reach = "resolves-in-own-file" | "declared-by-a-literal-sourced-file" | "declared-by-a-literal-sourced-file-ambiguous" | "external"
const reachCounts: Record<string, number> = {}
const reachExamples: Record<string, string[]> = {}
let callsTotal = 0
let fnCallTotal = 0
let extCallTotal = 0
/** Q4 — the LABELLING quadrant. `isFunctionCall` and `isExternalCommand` are the
 * analyzer's own claims about what a `calls` edge is; reachability is measured
 * independently from the published symbol set. If a claim and a measurement disagree
 * on any cell, one of them is wrong, and which one is decided by reading the
 * disagreement rather than by preferring either column. */
const quad: Record<string, number> = {}
const quadExamples: Record<string, string[]> = {}
const quadKey = (fnCall: boolean, ext: boolean, reach: string) => {
  const claim = fnCall && ext ? "BOTH" : fnCall ? "functionCall" : ext ? "externalCommand" : "**NO FLAG**"
  const k = `${claim} x ${reach}`
  quad[k] = (quad[k] ?? 0) + 1
  if (!quadExamples[k]) quadExamples[k] = []
  return k
}
/** files with at least one literal source that resolved — the population section B is
 * even meaningful over. Reported so B is never read as a rate over all 4,130 files. */
let filesWithLiteralSource = 0
const crossFileEdges: string[] = []

for (const f of admitted) {
  const ff = facts.get(f.abs)
  if (!ff) continue
  if (ff.literalSources.length > 0) filesWithLiteralSource++
  // The declaration universe reachable from THIS file: the functions it publishes,
  // plus the functions published by every file it sources by a literal path.
  const reachable = new Map<string, Set<string>>()
  for (const s of ff.literalSources) {
    const sf = facts.get(s)
    if (!sf || sf.parseFailed) continue
    for (const fn of sf.functions) {
      let set = reachable.get(fn)
      if (!set) { set = new Set(); reachable.set(fn, set) }
      set.add(s)
    }
  }
  for (const c of ff.calls) {
    callsTotal++
    if (c.fnCall) fnCallTotal++
    if (c.external) extCallTotal++
    if (ff.functions.has(c.target)) {
      reachCounts["resolves-in-own-file"] = (reachCounts["resolves-in-own-file"] ?? 0) + 1
      const k = quadKey(c.fnCall, c.external, "resolves-in-own-file")
      if (quadExamples[k].length < 8) quadExamples[k].push(`${f.repo}/${f.rel}:${c.line} -[calls]-> ${c.target}`)
      continue
    }
    const holders = reachable.get(c.target)
    if (holders && holders.size > 0) {
      const key = holders.size > 1 ? "declared-by-a-literal-sourced-file-ambiguous" : "declared-by-a-literal-sourced-file"
      reachCounts[key] = (reachCounts[key] ?? 0) + 1
      const reachWord = key === "declared-by-a-literal-sourced-file" ? "declared-by-a-literal-sourced-file" : "declared-by-a-literal-sourced-file-ambiguous"
      const k = quadKey(c.fnCall, c.external, reachWord)
      const where = Array.from(holders).map((h) => `${repoOf.get(h) ?? "?"}/${h.slice(h.lastIndexOf("/") + 1)}`).join(", ")
      if (quadExamples[k].length < 8) quadExamples[k].push(`${f.repo}/${f.rel}:${c.line} -[calls]-> ${c.target}   declared in ${where}`)
      if (crossFileEdges.length < 400) crossFileEdges.push(`${f.repo}/${f.rel}:${c.line} -> ${c.target} :: ${Array.from(holders)[0]}`)
      if (!reachExamples[key]) reachExamples[key] = []
      if (reachExamples[key].length < 10) reachExamples[key].push(`${f.repo}/${f.rel}:${c.line} -[calls]-> ${c.target}   declared in ${where}`)
      continue
    }
    reachCounts["external"] = (reachCounts["external"] ?? 0) + 1
    const ke = quadKey(c.fnCall, c.external, "external")
    if (quadExamples[ke].length < 8) quadExamples[ke].push(`${f.repo}/${f.rel}:${c.line} -[calls]-> ${c.target}`)
    if (!reachExamples["external"]) reachExamples["external"] = []
    if (reachExamples["external"].length < 8) reachExamples["external"].push(`${f.repo}/${f.rel}:${c.line} -[calls]-> ${c.target}`)
  }
}

// ---------------------------------------------------------------- report
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`)
const rows = (o: Record<string, number>, total: number) => { for (const k of Object.keys(o).sort()) console.log(`  ${k.padEnd(46)} ${String(o[k]).padStart(6)}  ${pct(o[k], total)}`) }

console.log(`bash — what the unresolved edges point at`)
console.log(`instrument : production parseFile + filesystem arithmetic, no regex`)
console.log(`corpus     : ${CR}`)
console.log(`repos      : ${repos.size}`)
console.log(`admitted   : ${totalAdmitted} files (EVERY admitted file)`)
console.log(`tracked    : ${trackedOnDisk.size} files in those repos, any extension`)
console.log(`parse fail : ${parseFailures}`)

console.log(`\nA. imports/references target shape   (${sourceEdges} edges — the imports copy only;`)
console.log(`   references carries an identical key for every one of them, measured)`)
rows(shapeCounts, sourceEdges)
for (const k of Object.keys(shapeExamples)) for (const e of shapeExamples[k]) console.log(`      ${k}: ${e}`)

const unindexedList = Array.from(unindexed.values())
const bashReadable = unindexedList.filter((u) => u.verdict === "bash-grammar-reads-symbols")
console.log(`\nA2. files the ROUTER declined that the bash grammar reads as shell`)
console.log(`  distinct files targeted by a source edge but not admitted : ${unindexedList.length}`)
console.log(`  … of which the pinned bash parser publishes >=1 symbol      : ${bashReadable.length}`)
console.log(`  source edges pointing at them                             : ${unindexedEdges}`)
for (const u of bashReadable.slice(0, 14)) console.log(`      ${u.repo}/${u.rel}  ${u.bytes}B  symbols=${u.symbols} functions=${u.functions}`)
console.log(`      first line of ${bashReadable[0]?.repo}/${bashReadable[0]?.rel}: ${bashReadable[0]?.firstLine ?? ""}`)

console.log(`\nB. calls reachability   (${callsTotal} calls edges over every admitted file)`)
console.log(`  isFunctionCall=true    : ${fnCallTotal}  (${pct(fnCallTotal, callsTotal)})`)
console.log(`  isExternalCommand=true : ${extCallTotal}  (${pct(extCallTotal, callsTotal)})`)
console.log(`  files with >=1 literal source that resolved to a file    : ${filesWithLiteralSource} of ${totalAdmitted}`)
rows(reachCounts, callsTotal)
for (const k of Object.keys(reachExamples)) for (const e of reachExamples[k]) console.log(`      ${k}: ${e}`)

console.log(`\nB2. Q4 labelling quadrant — the analyzer's CLAIM (isFunctionCall / isExternalCommand)`)
console.log(`   against the MEASURED reachability above. A disagreement in any cell is a defect;`)
console.log(`   agreement in the two diagonal cells is the check that the flags are not decorative.`)
rows(quad, callsTotal)
for (const k of Object.keys(quadExamples)) for (const e of quadExamples[k]) console.log(`      ${k}: ${e}`)

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    instrument: "parseFile + filesystem arithmetic, no regex",
    corpusRoot: CR, repos: repos.size, admitted: totalAdmitted, tracked: trackedOnDisk.size, parseFailures,
    sectionA: { sourceEdges, shapes: shapeCounts, unindexedFiles: unindexedList.length, routerDeclinedButBashReadable: bashReadable.length, unindexedEdges, files: bashReadable.map((u) => ({ repo: u.repo, rel: u.rel, bytes: u.bytes, symbols: u.symbols, functions: u.functions, firstLine: u.firstLine })) },
    sectionB: { callsTotal, fnCallTotal, extCallTotal, filesWithLiteralSource, reach: reachCounts, examples: reachExamples, quadrant: quad, quadrantExamples: quadExamples },
  }, null, 2))
  console.log(`\nwrote ${OUT}`)
}