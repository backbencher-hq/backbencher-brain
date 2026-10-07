// ELIXIR_FIX2 — audit the `contains` edges against an INDEPENDENT oracle.
//
// This is the DERIVATION-debt item the lane was handed. `contains` was the one
// type this analyzer emitted that no oracle derived (confirmed by the
// master-owned `script/m60/rel-type-coverage-gate.ts --langs=elixir`, which
// reported `1 un-audited: ["contains"]` on 2026-10-05), so all 9,873 `contains`
// edges over 601 corpus files were stored and compared against nothing.
//
// WHAT THE NUMBERS CAN AND CANNOT SAY. The oracle is a separate walker over the
// SAME grammar (script/m14/oracles/elixir-contains.ts, written from the grammar's
// tree shapes and Elixir's containment rule, sharing no helper with the
// analyzer). So a DISAGREEMENT is a finding; an AGREEMENT is not proof of
// correctness, because a shape both walkers misread is invisible to both. That
// limit is the harness's declared one and it is repeated here so the summary is
// not read as more than it is.
//
// Population is DERIVED (readdir over the corpus), never a hand-written list,
// and it is printed next to every count: the honesty contract's rule is that "0"
// without its denominator is a claim, not a measurement.
//
// Usage: bun run validation/m14/elixir/elixir-contains-audit.ts [fileCount]

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { join, relative } from "node:path"
import { ASTEngine } from "../../../src/ast/engine"
import { deriveElixirContainsTruth, deriveElixirUsesTruth, deriveElixirExportsTruth } from "../../../script/m14/oracles/elixir-contains"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const CORPUS_DIRS = (process.env.ELIXIR_CORPUS_DIRS ?? "elixir,otp").split(",")
const EXTS = [".ex", ".exs"]
const WANT = Number(process.argv[2] || 0)

function collectFiles(): Array<{ path: string; rel: string }> {
  const out: Array<{ path: string; rel: string }> = []
  for (const d of CORPUS_DIRS) {
    const base = join(CORPUS_ROOT, d)
    const walk = (dir: string, depth: number): void => {
      if (depth > 24) return
      let ents: any[]
      try { ents = readdirSync(dir, { withFileTypes: true }) as any[] } catch { return }
      for (const e of ents) {
        const p = join(dir, e.name)
        if (e.isDirectory()) {
          if (e.name !== ".git" && e.name !== "node_modules" && e.name !== "_build" && e.name !== "deps") walk(p, depth + 1)
        } else if (e.isFile()) {
          let want = false
          for (const x of EXTS) if (e.name.endsWith(x)) want = true
          if (!want) continue
          try { if (statSync(p).size < 8) continue } catch { continue }
          out.push({ path: p, rel: relative(base, p) })
        }
      }
    }
    walk(base, 0)
  }
  out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
  return out
}

const ALL = collectFiles()
const files = WANT > 0 && WANT < ALL.length ? Array.from({ length: WANT }, (_, i) => ALL[Math.floor((i * ALL.length) / WANT)]) : ALL
// A FRESH parser for every file, on purpose. Reusing one parser instance while
// ALSO calling ASTEngine.parseFile (which takes the engine's cached parser) drove
// web-tree-sitter into `Out of bounds memory access (evaluating
// 'C._ts_parser_parse_wasm(..., oldTree, ...))` on 101 of 601 files — an
// incremental re-parse against a tree the other caller had left behind. The
// symptom is a parser crash, so an instrument that reports fewer files than the
// population would read as "these files have no contains edges" rather than "my
// instrument corrupted its own parser". Cost is ~20 s over the corpus.
async function freshParser(): Promise<any> { return ASTEngine.getParser("elixir" as any) }

let parsed = 0, crashed = 0
const crashSamples: string[] = []
const LABELS = ["contains", "uses", "exports"] as const
type Label = (typeof LABELS)[number]
const TRUTH: Record<Label, (root: any) => TruthEdge[]> = {
  contains: deriveElixirContainsTruth,
  uses: deriveElixirUsesTruth,
  exports: deriveElixirExportsTruth,
}
interface LabelTally { analyzer: number; oracle: number; matched: number; missing: number; unexplained: number; missingSamples: string[]; unexplainedSamples: string[]; filesWithMissing: number; filesWithUnexplained: number }
const tallies: Record<Label, LabelTally> = {} as any
for (const l of LABELS) tallies[l] = { analyzer: 0, oracle: 0, matched: 0, missing: 0, unexplained: 0, missingSamples: [], unexplainedSamples: [], filesWithMissing: 0, filesWithUnexplained: 0 }
let analyzerEdges = 0, oracleEdges = 0
let matched = 0
const missingSamples: string[] = []
const unexplainedSamples: string[] = []
const missingByShape: Record<string, number> = {}
const unexplainedByShape: Record<string, number> = {}
const filesWithMissing: string[] = []
const filesWithUnexplained: string[] = []
const started = Date.now()

const bump = (b: Record<string, number>, k: string): void => { b[k] = (b[k] || 0) + 1 }

// A disagreement is classified by the SOURCE name it names, so the residual is a
// list of things to look at rather than a single opaque count.
function shapeOf(from: string, to: string): string {
  const parts = to.split(".")
  if (parts.length === 1) return "bare-name"
  if (from.endsWith("." + parts[0])) return "nested-member"
  return "qualified-name"
}

for (const f of files) {
  let content: string
  try { content = readFileSync(f.path, "utf8") } catch { continue }
  let tree: any
  try { const parser = await freshParser(); tree = await parser.parse(content, f.path) } catch (e) { crashed++; if (crashSamples.length < 8) crashSamples.push(`parse ${f.rel}: ${String(e).slice(0, 140)}`); continue }
  parsed++
  let res: any
  try { res = await ASTEngine.parseFile(f.path, content) } catch (e) { crashed++; if (crashSamples.length < 8) crashSamples.push(`parseFile ${f.rel}: ${String(e).slice(0, 140)}`); continue }

  const mine = new Set<string>()
  for (const r of res.relationships ?? []) {
    const t = r.type ?? r.relationshipType
    if (!LABELS.includes(t as Label)) continue
    analyzerEdges++
    mine.add(JSON.stringify([t, r.source, r.target]))
    tallies[t as Label].analyzer++
  }
  const theirs = new Set<string>()
  for (const l of LABELS) {
    for (const e of TRUTH[l](tree.rootNode)) {
      oracleEdges++
      theirs.add(JSON.stringify([l, e.from, e.target]))
      tallies[l].oracle++
    }
  }
  let m = 0, u = 0
  // The pair is JSON-encoded, never joined with "|": an Elixir operator name
  // IS a "|"-bearing string (Bitwise declares `|||` and `&&&`), and the first
  // version of this audit joined with "|" and then split on it to print, which
  // reported `contains Bitwise -> ` for the real edge `Bitwise -> |||`. A
  // reporting bug that invents an empty endpoint in an instrument about empty
  // endpoints is the worst kind.
  const unpack = (k: string): [Label, string, string] => JSON.parse(k) as [Label, string, string]
  for (const k of theirs) if (!mine.has(k)) {
    const [l, a, b] = unpack(k)
    missingSamples.push(`${f.rel}  ${l} ${a} -> ${JSON.stringify(b)}`)
    bump(missingByShape, `${l}/${shapeOf(a, b)}`)
    tallies[l].missing++; tallies[l].missingSamples.push(`${f.rel} ${a} -> ${JSON.stringify(b)}`)
    m++
  }
  for (const k of mine) if (!theirs.has(k)) {
    const [l, a, b] = unpack(k)
    unexplainedSamples.push(`${f.rel}  ${l} ${a} -> ${JSON.stringify(b)}`)
    bump(unexplainedByShape, `${l}/${shapeOf(a, b)}`)
    tallies[l].unexplained++; tallies[l].unexplainedSamples.push(`${f.rel} ${a} -> ${JSON.stringify(b)}`)
    u++
  }
  for (const k of mine) if (theirs.has(k)) { matched++; tallies[unpack(k)[0]].matched++ }
  if (m > 0 && filesWithMissing.length < 60) filesWithMissing.push(f.rel)
  if (u > 0 && filesWithUnexplained.length < 60) filesWithUnexplained.push(f.rel)
}

const L = (s: string) => process.stderr.write(s + "\n")
L(`population: ${files.length} of ${ALL.length} derived ${EXTS.join("/")} files under ${CORPUS_DIRS.join(",")}${WANT > 0 && WANT < ALL.length ? ` (stride of ${WANT})` : " (WHOLE corpus)"}`)
L(`parsed ${parsed}, crashed ${crashed}${crashed > 0 ? ` — ${crashSamples.join(" | ")}` : ""}, ${Date.now() - started} ms`)
L(`analyzer contains edges ${analyzerEdges}, oracle contains edges ${oracleEdges}, matched ${matched}`)
L(`MISSING      ${missingSamples.length}  (the oracle derives it, the analyzer does not emit it)`)
L(`UNEXPLAINED  ${unexplainedSamples.length}  (the analyzer emits it, the oracle does not derive it)`)
L("")
for (const l of LABELS) {
  const t2 = tallies[l]
  L(`  ${l.padEnd(10)} analyzer ${String(t2.analyzer).padStart(6)}  oracle ${String(t2.oracle).padStart(6)}  matched ${String(t2.matched).padStart(6)}  MISSING ${t2.missing}  UNEXPLAINED ${t2.unexplained}`)
  for (const s2 of t2.unexplainedSamples.slice(0, 8)) L(`      UNEX ${s2}`)
  for (const s2 of t2.missingSamples.slice(0, 8)) L(`      MISS ${s2}`)
}
L(`missing by shape: ${JSON.stringify(missingByShape)}`)
L(`unexplained by shape: ${JSON.stringify(unexplainedByShape)}`)
L(`files with MISSING: ${filesWithMissing.length}${filesWithMissing.length ? ` — ${filesWithMissing.slice(0, 8).join(", ")}` : ""}`)
L(`files with UNEXPLAINED: ${filesWithUnexplained.length}${filesWithUnexplained.length ? ` — ${filesWithUnexplained.slice(0, 8).join(", ")}` : ""}`)
for (const s of missingSamples.slice(0, 25)) L(`  MISS ${s}`)
for (const s of unexplainedSamples.slice(0, 25)) L(`  UNEX ${s}`)

const artifact = {
  tool: "validation/m14/elixir/elixir-contains-audit.ts",
  lane: "ELIXIR_FIX2",
  subject: "src/ast/real-elixir-analyzer.ts",
  oracle: "script/m14/oracles/elixir-contains.ts",
  derivationFindingRepaid: {
    finding: "rel-type-coverage-gate --langs=elixir reported `1 un-audited: [\"contains\"]` on 2026-10-05; deriveElixirEdges in script/m14/differential.ts pushes only calls/implements/instantiates/references.",
    whatThisIs: "an INDEPENDENT oracle for contains plus a per-file comparison over the whole derived population.",
    declaredLimit: "the oracle is a separate walker over the SAME grammar, so a disagreement is a finding and an agreement is not proof of correctness. A shape both walkers misread is invisible to both.",
    population: { corpusRoot: CORPUS_ROOT, corpusDirs: CORPUS_DIRS, extensions: EXTS, derived: true, allFilesFound: ALL.length, filesRun: files.length },
  },
  result: {
    filesParsed: parsed, filesCrashed: crashed, crashSamples, wallMs: Date.now() - started,
    analyzerEdges, oracleEdges, matched,
    missing: missingSamples.length, unexplained: unexplainedSamples.length,
    missingByShape, unexplainedByShape,
    perLabel: Object.fromEntries(LABELS.map((l) => [l, { analyzer: tallies[l].analyzer, oracle: tallies[l].oracle, matched: tallies[l].matched, missing: tallies[l].missing, unexplained: tallies[l].unexplained, missingSamples: tallies[l].missingSamples.slice(0, 200), unexplainedSamples: tallies[l].unexplainedSamples.slice(0, 200) }])),
    filesWithMissing: filesWithMissing.length, filesWithUnexplained: filesWithUnexplained.length,
    missingSamples: missingSamples.slice(0, 400),
    unexplainedSamples: unexplainedSamples.slice(0, 400),
  },
}
const out = process.env.ELIXIR_CONTAINS_ARTIFACT || "validation/m14/elixir/elixir-contains-audit.json"
writeFileSync(out, JSON.stringify(artifact, null, 2))
L(`artifact: ${out}`)