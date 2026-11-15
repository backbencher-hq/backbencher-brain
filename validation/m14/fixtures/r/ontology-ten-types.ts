/**
 * R ONTOLOGY CENSUS — the six questions, measured on the WHOLE R corpus through the
 * PRODUCTION entry point.
 *
 * ## Why this file exists
 *
 * `validation/m14/measurements/firing-sweep-26-lanes.ndjson` records this lane at
 * **8/10** — `overrides` and `instantiates` at 0 edges over a 120-file draw. That is
 * a fact about the DRAW, not about R, and the draw is the 120 files a fixed sampler
 * picks out of 2,184. The R corpus is OO-dense but the sampler drew mostly dplyr /
 * testthat / ggplot2 files, which are functional and carry no in-file class
 * hierarchy.
 *
 * So the first question this file answers is not "how many edges" but "does the type
 * fire at all, on the population" — and the answer is that both do. That is the
 * difference between a type that needs a RULING and a type that needed a bigger
 * sample, and only a measurement over the population tells them apart.
 *
 * ## The instrument
 *
 * `parseFile` from `src/ast/pool-worker.ts`, never `analyze()`. `analyze()` is a
 * per-file unit that skips the pool-worker stages (timeouts, truncation, the
 * enhancement pass), so a count taken through it is not the count production
 * returns. This was called out in the lane brief and it is not a formality: the
 * pipeline stages are where a degraded parse gets substituted, and a degraded parse
 * returns FEWER edges with NO error.
 *
 * Concurrency is deliberately LOW (4 workers, not 8). `firing-check.ts`'s own header
 * records that `parseFile` was nondeterministic under concurrency because
 * `resolveWasm`'s last fallback wrote each grammar to one shared path; it was fixed
 * per-process in `src/ast/engine.ts`, but a count that depends on a fix is a count
 * worth re-deriving at lower concurrency rather than trusting. `degradedFiles` is
 * reported below and must be 0 for any number here to mean anything.
 *
 * ## What each block reports, and which of the six questions it answers
 *
 *   block 1  per-type EDGE COUNT + FILE SET         — Q2 "fires", and Q1 "exists"
 *   block 2  per-type ENDPOINT RESOLUTION           — Q5 "resolved"
 *   block 3  per-type CONFIDENCE + evidenceClass    — Q6 "confident"
 *   block 4  grammar node-type inventory            — the population an instrument-A
 *                                                     ruling would have to be read
 *                                                     against
 *   block 5  the two types the 120-file draw missed, with the files and the edges
 *
 * Q3 ("correct", an independent oracle) and Q4 ("labelled") are NOT answered here and
 * the file says so rather than implying otherwise — see the LIMITATIONS block and
 * `docs/analyzers/r.md`.
 *
 * ## Reproducing
 *
 *   npx tsx validation/m14/fixtures/r/ontology-ten-types.ts            # full corpus
 *   BB_R_LIMIT=200 npx tsx validation/m14/fixtures/r/ontology-ten-types.ts
 *
 * Sampling method when `BB_R_LIMIT` is set: the admitted files in corpus order
 * (`readdirSync` sorted), which is repository-name order and NOT random. A number
 * from a limited run is a statement about THAT PREFIX and the run prints which files
 * it covered so the population can be read off the output.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../src/ast/language-detection"
import { parseFile } from "../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LIMIT = Number(process.env.BB_R_LIMIT ?? 0)
const WORKERS = 4

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

/**
 * Store label -> ontology name. `imports` is the ONTOLOGY's name for the type the
 * STORE spells `brain_import`; `firing-check.ts` carries the same bridge and this is
 * a re-statement rather than an improvement. Conflating the two is how a lane
 * reports an `imports` row it never initialised.
 */
const LABEL_ALIASES: Record<string, Type> = {
  brain_import: "imports",
  brain_call: "calls",
  brain_use: "uses",
  brain_contains: "contains",
  brain_reference: "references",
  brain_export: "exports",
  brain_extends: "extends",
  brain_implements: "implements",
  brain_overrides: "overrides",
  brain_instantiates: "instantiates",
}
function ontologyType(raw: unknown): Type | null {
  const s = String(raw ?? "").toLowerCase()
  if ((ALL_TYPES as readonly string[]).includes(s)) return s as Type
  return LABEL_ALIASES[s] ?? null
}

// ---------------------------------------------------------------- corpus
interface Admitted { repo: string; dir: string; rel: string; abs: string; text: string }
const admitted: Admitted[] = []
const reposWithR: Record<string, number> = {}
for (const e of readdirSync(CR).sort()) {
  const dir = path.join(CR, e)
  try {
    if (!statSync(dir).isDirectory()) continue
    execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
  } catch { continue }
  let tracked: string[]
  try {
    tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
      encoding: "utf8", maxBuffer: 512 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch { continue }
  for (const rel of tracked) {
    const abs = path.join(dir, rel)
    let text: string
    try { if (statSync(abs).size > 512 * 1024) continue; text = readFileSync(abs, "utf8") } catch { continue }
    if (detectLanguageFromPath(abs, text) !== "r") continue
    admitted.push({ repo: e, dir, rel, abs, text })
    reposWithR[e] = (reposWithR[e] ?? 0) + 1
  }
}
const covered = LIMIT > 0 ? admitted.slice(0, LIMIT) : admitted

console.log(`R ontology census — production parseFile over the admitted R corpus`)
console.log(`corpus root: ${CR}`)
console.log(`admitted files: ${admitted.length} across ${Object.keys(reposWithR).length} repositories`)
console.log(`repositories: ${Object.entries(reposWithR).sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" ")}`)
console.log(`files walked: ${covered.length}${LIMIT > 0 ? ` (BB_R_LIMIT prefix of the corpus-ordered list)` : " (whole population, no sampling)"}`)
console.log(`workers: ${WORKERS}\n`)

// ---------------------------------------------------------------- walk
interface Row { n: number; files: Set<string>; srcPublished: number; srcExternal: number; bothResolve: number; below07: number; evMissing: number; examples: string[] }
const observed = new Map<Type, Row>()
const rowFor = (t: Type): Row => {
  let r = observed.get(t)
  if (!r) { r = { n: 0, files: new Set<string>(), srcPublished: 0, srcExternal: 0, bothResolve: 0, below07: 0, evMissing: 0, examples: [] }; observed.set(t, r) }
  return r
}
for (const t of ALL_TYPES) rowFor(t)

const EMPTY_NAME: Row[] = []
const emptyNames: string[] = []
const emptyOrUnknownKind: string[] = []
const unknownEndpoints: string[] = []
const degraded: string[] = []
let parseFailures = 0
let symbols = 0
let relationships = 0

/** The two types the 120-file draw reported at 0, with their edges kept verbatim. */
const DEEP: Type[] = ["overrides", "instantiates"]
const deepEdges: Record<string, { edge: string; file: string; meta: string }[]> = { overrides: [], instantiates: [] }

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= covered.length) return
    const f = covered[i]
    let r: any
    try { r = await parseFile(f.abs, f.dir) } catch { parseFailures++; continue }
    const label = `${f.repo}/${f.rel}`
    if (r?.fallback === true || r?.metadata?.fallback === true) degraded.push(label)

    const syms: any[] = r?.symbols ?? []
    symbols += syms.length
    const published = new Set<string>()
    for (const s of syms) {
      const nm = String(s?.name ?? "")
      if (nm === "") { emptyNames.push(label); continue }
      published.add(nm)
      const k = String(s?.kind ?? "")
      if (k === "" || k === "unknown" || k === "undefined") emptyOrUnknownKind.push(`${label}: ${nm} kind=${k || "<empty>"}`)
    }

    const rels: any[] = r?.relationships ?? []
    relationships += rels.length
    for (const x of rels) {
      const t = ontologyType(x?.type ?? x?.relationshipType)
      if (!t) continue
      const row = rowFor(t)
      row.n++
      row.files.add(label)
      const src = String(x?.source ?? "")
      const tgt = String(x?.target ?? "")
      if (src === "unknown" || tgt === "unknown") unknownEndpoints.push(`${label}: ${t} ${src}->${tgt}`)
      if (src === "" || tgt === "") unknownEndpoints.push(`${label}: ${t} <empty endpoint> ${src}->${tgt}`)
      if (published.has(src)) row.srcPublished++; else row.srcExternal++
      if (published.has(src) && published.has(tgt)) row.bothResolve++
      const conf = Number(x?.confidence ?? NaN)
      if (!(conf >= 0.7)) row.below07++
      if (x?.evidenceClass === undefined || x?.evidenceClass === null || x?.evidenceClass === "") row.evMissing++
      if (row.examples.length < 3) row.examples.push(`${src} -> ${tgt}`)
      if (DEEP.includes(t) && deepEdges[t].length < 400) {
        deepEdges[t].push({ edge: `${src} -${t}-> ${tgt}`, file: label, meta: JSON.stringify(x?.metadata ?? {}).slice(0, 220) })
      }
    }
  }
}
await Promise.all(Array.from({ length: WORKERS }, () => worker()))
void EMPTY_NAME

// ---------------------------------------------------------------- block 1 + 2 + 3
console.log("=".repeat(126))
console.log("BLOCK 1-3 — per type: edges, files, endpoints resolved both ends, confidence < 0.7, evidenceClass absent")
console.log("=".repeat(126))
console.log(
  ["type".padEnd(13), "edges".padStart(8), "files".padStart(6), "srcPub".padStart(8), "srcExt".padStart(8),
    "bothRes".padStart(8), "resRate".padStart(8), "<0.7".padStart(6), "evMiss".padStart(7), "verdict"].join(""),
)
console.log("-".repeat(126))
for (const t of ALL_TYPES) {
  const r = rowFor(t)
  const rate = r.n === 0 ? "n/a" : `${((r.bothResolve / r.n) * 100).toFixed(1)}%`
  console.log(
    [t.padEnd(13), r.n.toLocaleString().padStart(8), String(r.files.size).padStart(6),
      r.srcPublished.toLocaleString().padStart(8), r.srcExternal.toLocaleString().padStart(8),
      r.bothResolve.toLocaleString().padStart(8), rate.padStart(8),
      String(r.below07).padStart(6), String(r.evMissing).padStart(7),
      r.n > 0 ? "FIRES" : "silent"].join(""),
  )
}

// ---------------------------------------------------------------- block 4
// The node-type inventory. It is reported for every run, not only for a ruling, because
// it is the population any instrument-A ruling for this lane has to be read against:
// a claim that R's grammar "cannot express" a construct is a claim about this table.
const wts: any = await import("web-tree-sitter")
const WSP = wts.Parser ?? wts.default
const WSL = wts.Language ?? wts.default?.Language
await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
const parser = new WSP()
parser.setLanguage(await WSL.load(readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-r.wasm"))))

const nodeTypes = new Map<string, number>()
for (const f of covered) {
  const t = parser.parse(f.text)
  if (!t) continue
  const v = (n: any) => { nodeTypes.set(n.type, (nodeTypes.get(n.type) ?? 0) + 1); for (let i = 0; i < n.childCount; i++) v(n.child(i)) }
  v(t.rootNode)
  t.delete?.()
}
console.log("\n" + "=".repeat(126))
console.log(`BLOCK 4 — grammar inventory: ${nodeTypes.size} distinct node types the pinned tree-sitter-r.wasm PRODUCES over the ${covered.length} walked files`)
console.log("=".repeat(126))
console.log([...nodeTypes.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(" "))

// ---------------------------------------------------------------- block 5
console.log("\n" + "=".repeat(126))
console.log("BLOCK 5 — the two types the 120-file draw read as 0, on the population")
console.log("=".repeat(126))
for (const t of DEEP) {
  const r = rowFor(t)
  console.log(`\n${t}: ${r.n} edges across ${r.files.size} files`)
  const byFile = new Map<string, number>()
  for (const e of deepEdges[t]) byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1)
  const ranked = [...byFile.entries()].sort((a, b) => b[1] - a[1])
  console.log(`  files (${ranked.length} shown, capped at 400 edges): ${ranked.slice(0, 25).map(([f, n]) => `${f}(${n})`).join(" ")}`)
  for (const e of deepEdges[t].slice(0, 12)) console.log(`    ${e.edge}   [${e.file}]  ${e.meta}`)
}

// ---------------------------------------------------------------- integrity
console.log("\n" + "=".repeat(126))
console.log("INTEGRITY — a number above means something only if these are 0")
console.log("=".repeat(126))
console.log(`files attempted: ${covered.length}   parse failures: ${parseFailures}   degraded (regex-substituted) parses: ${degraded.length}`)
console.log(`symbols: ${symbols.toLocaleString()}   relationships: ${relationships.toLocaleString()}`)
console.log(`symbols with an EMPTY name: ${emptyNames.length}`)
console.log(`symbols with an empty/unknown kind: ${emptyOrUnknownKind.length}`)
console.log(`relationships with an empty or \`unknown\` endpoint: ${unknownEndpoints.length}`)
for (const s of unknownEndpoints.slice(0, 10)) console.log(`    ${s}`)
for (const s of emptyOrUnknownKind.slice(0, 10)) console.log(`    ${s}`)
if (degraded.length) for (const s of degraded.slice(0, 10)) console.log(`    DEGRADED ${s}`)
console.log(`\nfired: ${ALL_TYPES.filter((t) => rowFor(t).n > 0).length}/10`)

// ---------------------------------------------------------------- LIMITATIONS
// Stated here rather than left to the reader, because a census that prints 10/10 with
// no caveat is indistinguishable from a census that checked nothing.
console.log(`
LIMITATIONS — what this file does NOT establish
  Q3 CORRECT   not measured. No independent oracle was run against these edges. The
               oracle in script/m14/oracles/ and script/m14/differential.ts walks the
               SAME grammar, so a grammar-level bug is invisible to it by
               construction; agreement there is necessary and not sufficient.
  Q4 LABELLED  not measured. A 'uses' edge that should have been 'references'
               counts identically here. The known R confusions are
               uses-vs-references on a bare symbol read, and extends-vs-implements
               across the S3/S4/R5/R6/S7 object systems.
  BLOCK 4 is the tree-sitter-r.wasm PRODUCTION inventory, not the grammar's declared
               table. It is positive evidence about the files walked; a node type
               absent from it is absent from THESE files, which is not the same claim
               as "R cannot express it".`)

process.exitCode = degraded.length === 0 && parseFailures === 0 ? 0 : 1
