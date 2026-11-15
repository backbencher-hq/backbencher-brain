/**
 * THE DERIVATION PAYOFF — adjudicating the two types markdown's differential
 * allowlist excludes.
 *
 * ## The debt this settles
 *
 * markdown emits FOUR relationship types. `script/m14/differential.ts:23392` compares
 * TWO of them:
 *
 *     ...(lang === "markdown" ? ["contains", "uses"] : []),
 *
 * and the comment above that line says "the lane emits no `imports` (markdown has no
 * module system) and no `references` (front-matter keys are a declared boundary, not a
 * graph)". Both halves of that sentence are FALSE, and measurably so: production
 * `parseFile` emits `imports` and `references` on these very corpora. So `imports` and
 * `references` are DERIVATION findings — emitted, and compared against nothing.
 *
 * ## Why the differential cannot simply be read as "the analyzer omits them"
 *
 * The harness documents this exact trap at differential.ts:23408:
 *
 *     This harness filters the ANALYZER side by the allowlist and does NOT filter the
 *     truth side, so a label that truth derives and the allowlist omits is not merely
 *     unmeasured, it is measured as a DEFECT.
 *
 * Measured consequence on markdown: `npx tsx script/m14/differential.ts --lang markdown`
 * reports, on kubernetes, `tree-truth=8499 covered=7729 (90.9%) MISSING=770`, and every
 * printed sample is an edge of the shape `references document -> <heading text>` from a
 * file carrying a `<!-- BEGIN MUNGE: GENERATED_TOC -->` block. `8499 - 7729 = 770`, and
 * 770 is the `references` truth count the allowlist never admits.
 *
 * Those 770 are NOT missing edges. `toc-truth-probe.mts` runs production `parseFile` on
 * `kubernetes/CHANGELOG/CHANGELOG-1.11.md` — the file every sample names — and the
 * analyzer emits, verbatim:
 *
 *     { type: "references", source: "document", target: "v1.11.10",     confidence: 1 }
 *     { type: "references", source: "document", target: "Client Binaries", confidence: 1 }
 *
 * 182 `references` edges in that one file. The oracle derives the same edges; the
 * allowlist drops the analyzer's copy before the comparison, so each one reads as MISSING.
 * The differential's own precedent for this is the csharp C923 asymmetry: exclude a label
 * on BOTH sides, never one.
 *
 * ## What this instrument measures instead
 *
 * Both sides, unfiltered, on the differential's OWN two corpora (scala3 and kubernetes,
 * named at differential.ts:533 and :640), with production `parseFile` for the analyzer and
 * `deriveMarkdownEdges` for the truth. Per type: how many analyzer edges, how many truth
 * edges, how many MATCH on (type, source, target), how many truth rows the analyzer does
 * not produce (MISSING), and how many analyzer rows the oracle does not derive
 * (unexplained).
 *
 * ## The limitation, stated before the number
 *
 * `deriveMarkdownEdges` is a SECOND WALKER OVER THE SAME TWO GRAMMARS, and it sub-parses
 * each `inline` node itself rather than reading the engine's pre-parse (differential.ts:
 * 22201-22204, which is the right call — reusing the analyzer's pre-parse would make the
 * oracle agree by construction). That removes collusion over the PARSE. It does not
 * remove collusion over the GRAMMAR: a node type both walkers misread is invisible here.
 * So a high match rate is evidence the two walkers agree, not evidence the grammar is read
 * correctly. Instrument A in `markdown-ruled.ts` is what covers the grammar, and it reads
 * node types, not edge agreement.
 *
 * Run:  npx tsx validation/m14/fixtures/markdown/references-imports-derivation.ts
 * Env:  MD_DERIV_FILES=<n>  bound the sample (default: the whole admitted population)
 * Out:  validation/m60/markdown/references-imports-derivation.json
 */
import * as path from "path"
import { createRequire } from "module"

// `import * as fs from "fs"` does not expose execFileSync under this tsx/ESM interop —
// the namespace has no such binding and the call throws "fs.execFileSync is not a
// function", which the walk's `catch { return out }` then swallows into an EMPTY
// population. That is the worst shape a measurement can take: it reports 0 edges over
// 0 files and reads as "the language has none of these". createRequire sidesteps the
// interop entirely, and the population count is now printed so an empty run is visible.
const require_ = createRequire(import.meta.url)
const fs = require_("fs") as typeof import("fs")
const { execFileSync } = require_("child_process") as typeof import("child_process")
import { parseFile } from "../../../../src/ast/pool-worker"
import { deriveMarkdownEdges } from "../../../../script/m14/markdown-oracle"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CORPORA = ["scala3", "kubernetes"]
const LIMIT = Number(process.env.MD_DERIV_FILES ?? 0)
const SHARDS = Number(process.env.SHARDS ?? 8)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8)

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
]

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try {
    entries = execFileSync("git", ["-C", dir, "ls-files", "-z", "*.md", "*.markdown"], {
      encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
    }).split("\0").filter(Boolean)
  } catch {
    return out
  }
  for (const rel of entries) {
    const abs = path.join(dir, rel)
    try { if (fs.statSync(abs).size > 512 * 1024) continue } catch { continue }
    out.push(abs)
  }
  return out
}

type Key = string
const key = (type: string, source: string, target: string): Key => `${type}\u0000${source}\u0000${target}`

interface Bucket {
  analyzerEdges: number
  truthEdges: number
  /** DISTINCT (type,source,target) keys, per file. The ratio denominators. */
  analyzerKeys: number
  truthKeys: number
  matched: number
  missingInAnalyzer: number
  unexplained: number
  filesWithAnalyzerEdges: number
  filesWithTruthEdges: number
  missingExamples: string[]
  unexplainedExamples: string[]
  confidenceBelow07: number
}

function emptyBucket(): Bucket {
  return {
    analyzerEdges: 0, truthEdges: 0, analyzerKeys: 0, truthKeys: 0,
    matched: 0, missingInAnalyzer: 0, unexplained: 0,
    filesWithAnalyzerEdges: 0, filesWithTruthEdges: 0,
    missingExamples: [], unexplainedExamples: [], confidenceBelow07: 0,
  }
}

async function main(): Promise<void> {
  const all: string[] = []
  for (const c of CORPORA) all.push(...walk(path.join(CORPUS_ROOT, c)))
  all.sort()
  const population = all.length
  const files = LIMIT > 0 ? all.slice(0, LIMIT) : all
  // Printed before any parsing, so an empty run is visibly empty rather than reading as
  // "the language emits none of these types".
  console.log(`population ${population} admitted files, sampling ${files.length}, corpora ${CORPORA.join(",")}`)

  // The oracle needs a tree over the BLOCK grammar. The differential builds the same one
  // at :22072 (`parser.parse(content)` -> `tree?.rootNode`).
  const wts: any = await import("web-tree-sitter")
  const WSP = wts.Parser ?? wts.default
  const WSL = wts.Language ?? wts.default?.Language
  await WSP.init({ locateFile: () => path.join(process.cwd(), "node_modules", "web-tree-sitter", "tree-sitter.wasm") })
  const parser = new WSP()
  parser.setLanguage(await WSL.load(fs.readFileSync(path.join(process.cwd(), "wasm", "tree-sitter-markdown.wasm"))))

  const perType: Record<string, Bucket> = {}
  for (const t of ALL_TYPES) perType[t] = emptyBucket()
  let parsed = 0, parseFailures = 0, degraded = 0, unparsedTree = 0
  let oracleThrew = 0
  const filesWithAnyAnalyzerEdge = new Set<string>()

  // Sharded so one WASM trap costs one shard's tail, not the run. src/ast/engine.ts:1411
  // kills the process outright, which is why the existing lane tally shards too.
  const shards: string[][] = Array.from({ length: SHARDS }, () => [])
  files.forEach((f, i) => shards[i % SHARDS].push(f))

  for (const shard of shards) {
    if (!shard.length) continue
    let cursor = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const f = shard[cursor++]
        if (f === undefined) return
        let content: string
        try { content = fs.readFileSync(f, "utf8") } catch { continue }

        // --- analyzer side: production entry point
        let aEdges: any[] = []
        try {
          const r: any = await parseFile(f, "markdown")
          parsed++
          if (r?.fallback) degraded++
          aEdges = r?.relationships ?? []
        } catch {
          parseFailures++
          continue
        }
        if (aEdges.length) filesWithAnyAnalyzerEdge.add(f)

        const aKeys = new Set<Key>()
        const aSeen = new Set<string>()
        for (const e of aEdges) {
          const t = String(e.type ?? e.relationshipType ?? "").toLowerCase()
          if (!ALL_TYPES.includes(t)) continue
          const k = key(t, String(e.source ?? ""), String(e.target ?? ""))
          if (!aSeen.has(t)) { aSeen.add(t); perType[t].filesWithAnalyzerEdges++ }
          perType[t].analyzerEdges++
          if (Number(e.confidence ?? 1) < 0.7) perType[t].confidenceBelow07++
          aKeys.add(k)
        }

        // --- truth side: the oracle, on the same content
        let tEdges: any[] = []
        try {
          const tree = parser.parse(content)
          const root = tree?.rootNode
          if (!root) { unparsedTree++; continue }
          tEdges = await deriveMarkdownEdges(root, content)
        } catch {
          oracleThrew++
          continue
        }

        const tKeys = new Set<Key>()
        const tSeen = new Set<string>()
        for (const e of tEdges) {
          const t = String(e.label ?? e.type ?? "").toLowerCase()
          if (!ALL_TYPES.includes(t)) continue
          const k = key(t, String(e.from ?? e.source ?? ""), String(e.target ?? ""))
          if (!tSeen.has(t)) { tSeen.add(t); perType[t].filesWithTruthEdges++ }
          perType[t].truthEdges++
          tKeys.add(k)
        }

        // Distinct-key tallies first: these are the ratio denominators. matched is
        // deduplicated (it counts tKeys), so dividing it by a raw edge count - which
        // counts a triple once per occurrence - is not a rate at all.
        for (const k of tKeys) perType[k.split("\u0000")[0]].truthKeys++
        for (const k of aKeys) perType[k.split("\u0000")[0]].analyzerKeys++
        for (const k of tKeys) if (aKeys.has(k)) perType[k.split("\u0000")[0]].matched++
        for (const k of tKeys) if (!aKeys.has(k)) {
          const b = perType[k.split("\u0000")[0]]
          b.missingInAnalyzer++
          if (b.missingExamples.length < 6) {
            b.missingExamples.push(`${f.replace(`${CORPUS_ROOT}/`, "")} :: ${k.split("\u0000").slice(1).join(" -> ")}`)
          }
        }
        for (const k of aKeys) if (!tKeys.has(k)) {
          const b = perType[k.split("\u0000")[0]]
          b.unexplained++
          if (b.unexplainedExamples.length < 6) {
            b.unexplainedExamples.push(`${f.replace(`${CORPUS_ROOT}/`, "")} :: ${k.split("\u0000").slice(1).join(" -> ")}`)
          }
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))
  }

  const DERIVATION = ["imports", "references"]
  const out = {
    instrument: "markdown references/imports DERIVATION payoff (validation/m14/fixtures/markdown/references-imports-derivation.ts)",
    whatThisIs:
      "the two types markdown's differential allowlist (differential.ts:23392 = [\"contains\",\"uses\"]) excludes from the compared set, compared anyway, on the differential's own two corpora, with both sides unfiltered",
    whatThisIsNot:
      "script/m14/differential.ts's output. Both sides are compared here without the allowlist, so a non-zero missingInAnalyzer on a type the differential excludes is that harness's documented one-sided filter (differential.ts:23408), not a finding against the analyzer",
    question:
      "markdown emits imports and references and the allowlist compares neither: do those two types agree with deriveMarkdownEdges when they ARE compared?",
    analyzerEntryPoint: "parseFile (src/ast/pool-worker.ts)",
    truthEntryPoint: "deriveMarkdownEdges (script/m14/markdown-oracle.ts:280)",
    corpusRoot: CORPUS_ROOT,
    corpora: CORPORA,
    population: {
      admittedFiles: population,
      sampledFiles: files.length,
      method: LIMIT > 0 ? `first ${LIMIT} of the sorted admitted population` : "the whole admitted population",
      admission: "git ls-files '*.md' '*.markdown' under each corpus, size <= 512 KB",
    },
    matchingRule:
      "strict equality on the triple (type, source, target), no normalisation on either side. Counts and ratios are over DISTINCT keys per file, because a file can emit the same triple twice and an edge count divided by a deduplicated numerator is not a rate.",
    limitation:
      "deriveMarkdownEdges is a second walker over the SAME two grammars, so a node type both walkers misread is invisible to this comparison. A high match rate is evidence the two walkers agree, not evidence the grammar is read correctly.",
    parsed, parseFailures, degraded, unparsedTree, oracleThrew,
    filesWithAnyAnalyzerEdge: filesWithAnyAnalyzerEdge.size,
    sharding: { shards: SHARDS, concurrencyInsideShard: CONCURRENCY, why: "src/ast/engine.ts:1411 kills the process on a WASM trap" },
    perType,
    derivationFindings: DERIVATION.map(t => ({
      type: t,
      inAllowlist: false,
      analyzerEdges: perType[t].analyzerEdges,
      truthEdges: perType[t].truthEdges,
      matched: perType[t].matched,
      missingInAnalyzer: perType[t].missingInAnalyzer,
      unexplained: perType[t].unexplained,
      distinctAnalyzerKeys: perType[t].analyzerKeys,
      distinctTruthKeys: perType[t].truthKeys,
      // Ratios are over DISTINCT keys. matched / analyzerEdges is not a precision: a
      // file may emit the same (type,source,target) more than once, so the numerator is
      // deduplicated and the denominator is not, and the quotient reads far too low.
      coverageOfTruth: perType[t].truthKeys === 0 ? null : +(perType[t].matched / perType[t].truthKeys).toFixed(4),
      precisionOfAnalyzer: perType[t].analyzerKeys === 0 ? null : +(perType[t].matched / perType[t].analyzerKeys).toFixed(4),
    })),
  }

  const dest = path.join(process.cwd(), "validation", "m60", "markdown", "references-imports-derivation.json")
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, JSON.stringify(out, null, 2))
  console.log(JSON.stringify({ parsed, parseFailures, degraded, unparsedTree, oracleThrew, derivationFindings: out.derivationFindings }, null, 2))
  console.log(`\nwrote ${dest}`)
}

await main()
