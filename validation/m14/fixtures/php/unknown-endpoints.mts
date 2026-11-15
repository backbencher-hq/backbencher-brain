/**
 * LITERAL `unknown` ENDPOINTS — the sentinel check, and the discriminator that says whether a
 * hit is a defect.
 *
 * ## WHY THIS EXISTS
 *
 * `validation/m60/php/ambiguity-split.json` records, over the whole admitted corpus (5,094
 * files / 350,342 edges):
 *
 *     unknownLiteralEndpoints = { "uses:target": 7, "calls:target": 13,
 *                                 "instantiates:source": 2, "contains:target": 2,
 *                                 "references:source": 2 }
 *
 * that key counts ENDPOINTS equal to the string `unknown`. It does not say WHAT they are, and
 * the two possibilities have opposite consequences:
 *
 *   SENTINEL   the analyzer ran out of a name and published the placeholder. §2b of the lane
 *              brief and honesty-contract §4 both forbid this: an endpoint the index cannot
 *              hold is a fabricated node, and `bb_graph` will show a caller nobody wrote.
 *   REAL NAME  a declaration in the corpus is literally spelled `unknown` — `class unknown`,
 *              `function unknown()`, `$obj->unknown`. Then the edge is TRUE, the string is
 *              nobody's sentinel, and "fixing" it by rewriting the name would be the defect.
 *
 * 26 of 350,342 edges is small enough that guessing either way would be cheap and wrong. So this
 * instrument answers it by MEASUREMENT, from two independent signals per hit:
 *
 *   1. is `unknown` PUBLISHED as a symbol by some file in the walk? A symbol table holding it
 *      is positive evidence it is a real name.
 *   2. does the hit's own file declare it? `contains class -> unknown` with a `class unknown`
 *      in that file is the name being declared; a `uses -> unknown` in a file that declares
 *      nothing by that name is the same string used as a target with no declaration anywhere.
 *
 * Neither signal is a regex and neither reads source text. Both are set membership over what
 * production `parseFile` published.
 *
 * ## WHAT IT IS NOT
 *
 * Not an oracle for edge correctness. It says nothing about whether a NON-`unknown` endpoint
 * names the right declaration — `references`, `contains` and `instantiates` resolution is
 * priced in `ambiguity-split.json`, and `uses` in `uses-resolution-shape.mts`.
 *
 * ## METHOD
 *
 * Corpus: git-tracked files under `BB_CORPUS_ROOT` (default
 * /home/ishaq2321/bb_tests/repositories) that `detectLanguageFromPath` admits as `php`, over
 * `git ls-files` so build output is excluded by construction. Deterministic stride over the
 * sorted population with `--files N` (default 600); pass `--files <admitted>` for the whole
 * corpus. Entry point is production `parseFile` from `src/ast/pool-worker.ts`.
 *
 * CONTROLS, printed and enforced — a zero in this instrument is only believable if the walk saw
 * edges at all, so the run exits 3 unless `uses` edges > 0, distinct relationship types >= 3,
 * and published symbols > 0. The vacuous-zero failure mode is what these exist for.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const fail = (m: string): never => {
  console.error(`unknown-endpoints: ${m}`)
  process.exit(2)
}
const argOf = (f: string) => {
  const i = argv.indexOf(f)
  if (i < 0) return undefined
  const v = argv[i + 1]
  if (v == null || v.startsWith("--")) fail(`\`${f}\` has no value`)
  return v
}
const OUT = argOf("--out")
const N = Number(argOf("--files") ?? 600)
if (!Number.isInteger(N) || N < 1) fail(`--files must be a positive integer, got \`${argOf("--files")}\``)
const CORPUS = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const SIZE_CAP = 512 * 1024
const UNKNOWN = "unknown"

// ------------------------------------------------------------------ population

const admitted: { label: string; abs: string }[] = []
let reposScanned = 0
for (const entry of readdirSync(CORPUS)) {
  const dir = path.join(CORPUS, entry)
  let tracked: string[] = []
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    reposScanned++
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
      .split("\0")
      .filter(Boolean)
  } catch {
    continue
  }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text = ""
    try {
      if (statSync(abs).size > SIZE_CAP) continue
      text = readFileSync(abs, "utf8")
    } catch {
      continue
    }
    if (detectLanguageFromPath(abs, text) !== "php") continue
    admitted.push({ label: `${entry}/${rel}`, abs })
  }
}
admitted.sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0))
const population = admitted.length
const picked: typeof admitted = []
if (population <= N) picked.push(...admitted)
else for (let i = 0; i < N; i++) picked.push(admitted[Math.floor((i * population) / N)])

console.log(`literal \`unknown\` endpoints — php — production parseFile`)
console.log(`corpus root         ${CORPUS}`)
console.log(`--files             ${N}${argv.includes("--files") ? "" : "   (DEFAULT — not passed on the command line)"}`)
console.log(`repos scanned       ${reposScanned}`)
console.log(`admitted population ${String(population).padStart(8)}`)
console.log(`sample              ${String(picked.length).padStart(8)}  (deterministic stride over the sorted population)`)

// ------------------------------------------------------------------ walk

/** name -> the symbols published under it, so a hit can be asked "is this a real declaration?" */
const publishedUnder = new Map<string, { kind: string; file: string }[]>()
const pushPub = (name: string, kind: string, file: string) => {
  const a = publishedUnder.get(name)
  if (a) a.push({ kind, file })
  else publishedUnder.set(name, [{ kind, file }])
}

type Hit = {
  side: "source" | "target"
  type: string
  file: string
  line: number
  source: string
  target: string
  filePublishesUnknown: boolean
  walkPublishesUnknown: boolean
  confidence: number
  evidenceClass: string
}
const hits: Hit[] = []

let symbols = 0
let edges = 0
let usesEdges = 0
let degraded = 0
let parseFailures = 0
const typesSeen = new Set<string>()

for (const f of picked) {
  let r: any
  try {
    r = await parseFile(f.abs, "php")
  } catch {
    parseFailures++
    continue
  }
  if (!r) {
    degraded++
    continue
  }
  if (r.degraded) degraded++

  const syms: any[] = Array.isArray(r.symbols) ? r.symbols : []
  let fileHasUnknown = false
  for (const s of syms) {
    const name = String(s?.name ?? "")
    if (!name) continue
    symbols++
    pushPub(name, String(s?.kind ?? ""), f.label)
    if (name === UNKNOWN) fileHasUnknown = true
  }

  const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []
  for (const rel of rels) {
    edges++
    const t = String(rel?.type ?? "")
    typesSeen.add(t)
    if (t === "uses" || t === "use") usesEdges++
    const source = String(rel?.source ?? "")
    const target = String(rel?.target ?? "")
    const md = (rel?.metadata ?? {}) as Record<string, unknown>
    const conf = Number(rel?.confidence ?? 0)
    const ec = String(md.evidenceClass ?? "(absent)")
    if (source === UNKNOWN || target === UNKNOWN) {
      hits.push({
        side: source === UNKNOWN ? "source" : "target",
        type: t,
        file: f.label,
        line: Number(rel?.line_number ?? 0),
        source,
        target,
        filePublishesUnknown: fileHasUnknown,
        confidence: conf,
        evidenceClass: ec,
      })
    }
  }
}

// `walkPublishesUnknown` is resolved HERE, after the walk, and not inside it. Evaluated in
// walk order it is an ORDERING BUG: a hit in a file that sorts before the file declaring
// `unknown` reads false, so a corpus-wide claim drawn from it undercounts by exactly the
// number of hits that precede the declaration. The first full run printed 5 "sentinel-shaped"
// hits for this reason; after the move it prints 0. Order-independent: set membership over
// the completed map.
const publishedUnknown = publishedUnder.get(UNKNOWN) ?? []
const walkHasUnknown = publishedUnknown.length > 0
for (const h of hits) h.walkPublishesUnknown = walkHasUnknown

// ------------------------------------------------------------------ controls

console.log("")
console.log("--- CONTROLS: a zero here would make the table below vacuous ---")
const ctlEdges = edges > 0
const ctlTypes = typesSeen.size >= 3
const ctlSymbols = symbols > 0
console.log(`  relationships seen              ${String(edges).padStart(8)}                        ${ctlEdges ? "OK" : "FAIL"}`)
console.log(`  distinct relationship types      ${String(typesSeen.size).padStart(8)}                        ${ctlTypes ? "OK" : "FAIL"}`)
console.log(`  symbols published                ${String(symbols).padStart(8)}                        ${ctlSymbols ? "OK" : "FAIL"}`)
if (!ctlEdges || !ctlTypes || !ctlSymbols) {
  console.error("CONTROL FAILED: the unknown-endpoint table cannot be believed. Exiting 3.")
  process.exit(3)
}

// ------------------------------------------------------------------ table

const byPair = new Map<string, number>()
for (const h of hits) byPair.set(`${h.type}:${h.side}`, (byPair.get(`${h.type}:${h.side}`) ?? 0) + 1)

console.log("")
console.log(`literal \`unknown\` endpoints: ${hits.length} of ${edges} edges (${((hits.length / edges) * 100).toFixed(4)}%)`)
console.log("")
console.log("--- by type:side (the same key ambiguity-split.json reports) ---")
const PAIRS = [
  "calls:target",
  "uses:target",
  "contains:target",
  "references:source",
  "instantiates:source",
]
const pairSeen = new Set<string>()
for (const [k, v] of [...byPair.entries()].sort((a, b) => b[1] - a[1])) pairSeen.add(k)
for (const p of [...pairSeen].sort()) {
  const n = byPair.get(p) ?? 0
  console.log(`  ${p.padEnd(24)}${String(n).padStart(6)}`)
}
const unlisted = [...pairSeen].filter((p) => !PAIRS.includes(p))
if (unlisted.length > 0) {
  console.log("")
  console.log("  NOT IN THE ambiguity-split KEY LIST — report as a shape that key cannot hold:")
  for (const p of unlisted) console.log(`  ${p.padEnd(24)}${String(byPair.get(p)).padStart(6)}`)
}

console.log("")
console.log("--- DISCRIMINATOR: sentinel, or a declaration in the corpus that is spelled `unknown`? ---")
const publishedHits = hits.filter((h) => h.walkPublishesUnknown)
const fileHits = hits.filter((h) => h.filePublishesUnknown)
console.log(`  hits whose endpoint is \`unknown\`                       ${String(hits.length).padStart(6)}`)
console.log(`  ... and SOME file in the walk publishes a symbol \`unknown\`  ${String(publishedHits.length).padStart(6)}`)
console.log(`  ... and the hit's OWN file publishes \`unknown\`               ${String(fileHits.length).padStart(6)}`)
const sentinelOnly = hits.filter((h) => !h.walkPublishesUnknown)
console.log(`  hits with NO published \`unknown\` anywhere (sentinel-shaped)   ${String(sentinelOnly.length).padStart(6)}`)
console.log("")
console.log("  symbols published under the bare name `unknown`:")
for (const p of publishedUnder.get(UNKNOWN) ?? []) console.log(`    ${p.kind.padEnd(16)}${p.file}`)

console.log("")
console.log("--- every hit, in walk order ---")
for (const h of hits) {
  console.log(
    `  ${h.type.padEnd(13)}${h.side.padEnd(7)}${h.file}:${h.line}  ${h.source} -> ${h.target}  conf=${h.confidence} ec=${h.evidenceClass}${h.filePublishesUnknown ? "  [file declares `unknown`]" : ""}`,
  )
}

const report = {
  instrument: "validation/m14/fixtures/php/unknown-endpoints.mts",
  entryPoint: "parseFile (src/ast/pool-worker.ts)",
  corpusRoot: CORPUS,
  reposScanned,
  admittedPopulation: population,
  requestedFiles: N,
  filesArgumentPresent: argv.includes("--files"),
  sampleFiles: picked.length,
  sampling: "deterministic stride over the admitted files sorted by repo/relative/path",
  symbolsPublished: symbols,
  edgesSeen: edges,
  usesEdges,
  distinctTypes: typesSeen.size,
  degraded,
  parseFailures,
  unknownEndpoints: hits.length,
  byPair: Object.fromEntries([...byPair.entries()].sort()),
  pairsOutsideTheAmbiguitySplitKeyList: unlisted,
  discriminator: {
    hitsWhoseEndpointIsUnknown: hits.length,
    hitsWithSomePublishedUnknown: publishedHits.length,
    hitsWhoseOwnFilePublishesUnknown: fileHits.length,
    hitsWithNoPublishedUnknownAnywhere: sentinelOnly.length,
    symbolsPublishedUnderUnknown: (publishedUnder.get(UNKNOWN) ?? []).length,
  },
  hits,
}
if (OUT) {
  mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true })
  writeFileSync(path.resolve(OUT), JSON.stringify(report, null, 2) + "\n")
  console.log("")
  console.log(`wrote ${OUT}`)
}