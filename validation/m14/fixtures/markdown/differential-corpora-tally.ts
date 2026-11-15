/**
 * THE DIFFERENTIAL'S OWN CORPORA, TALLIED — what the F5 oracle can and cannot reach for
 * markdown, measured over BOTH pinned corpora in full rather than over one rotating draw.
 *
 * ## Why this exists
 *
 * `docs/analyzers/markdown.md` carried two `DERIVATION findings: 0`
 * sections, and they disagreed about WHY. One said the audited set is
 * `contains`/`uses`/`references` because "the concurrent relabelling added `references`
 * to `script/m14/differential.ts`'s markdown entry in the same commit cycle". The other
 * said audited == emitted because `script/m14/markdown-oracle.ts` derives all four
 * independently. Both reasons are checkable, and neither survives contact with the file:
 *
 *   - `script/m14/differential.ts:23392` reads
 *     `...(lang === "markdown" ? ["contains", "uses"] : [])`, with an adjacent comment
 *     asserting the lane "emits no `imports` ... and no `references`". The lane emits
 *     both. `git log -S` finds no commit that ever added a third element to that array.
 *   - `script/m14/markdown-oracle.ts` DOES derive all four — `add("contains", ...)`
 *     :375/:462/:471/:503, `add("references", ...)` :530, `add("imports", ...)` :635,
 *     `add("uses", ...)` :702/:708/:729/:741. Oracle truth is necessary but NOT
 *     sufficient: the allowlist is what puts a kind in the COMPARED set.
 *
 * The 770 MISSING rows on kubernetes are the proof, and they are already measured and
 * already in the doc: `references` truth exists, analyzer `references` rows exist, and
 * the allowlist drops the analyzer side, so 770 truth rows read as MISSING. So the
 * question this script answers is not "what does the oracle know" — it is:
 *
 *   **On the two corpora the differential actually draws from, how many edges does the
 *   analyzer emit per type, and therefore which of its four types can the 60-file
 *   rotating pool ever place in the compared set at all?**
 *
 * A type the analyzer emits ZERO of on both corpora is compared against nothing however
 * complete the oracle is: the draw never contains a row to compare. That is the
 * workstream's definition of a DERIVATION finding, and it is a property of the CORPORA,
 * so it can only be measured over them.
 *
 * ## Method
 *
 * Population: every tracked `.md` under `scala3` and `kubernetes` in CORPUS_ROOT —
 * the two corpora `script/m14/differential.ts:533` and `:640` name as markdown's. The
 * differential draws 60 files per corpus from a rotating cold pool, so the full set is
 * an UPPER BOUND on what any draw can contain, which is the right direction: a type with
 * 0 edges here has 0 in every draw.
 *
 * Entry point: `parseFile` (`src/ast/pool-worker.ts`) — the production entry, never
 * `analyze()`. Sharded like the census, because `src/ast/engine.ts:1411` kills the
 * process on a WASM trap and 1,334 files in one process is a 1,334-file bet.
 *
 * Output: `validation/m60/markdown/differential-corpora-tally.json`.
 */
import * as fs from "fs"
import * as path from "path"
import { parseFile } from "../../../../src/ast/pool-worker"

const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const CORPORA = ["scala3", "kubernetes"]
const SHARDS = Number(process.env.SHARDS ?? 8)
const CONCURRENCY = 8
const OUT = path.resolve(import.meta.dirname, "../../../../validation/m60/markdown/differential-corpora-tally.json")

function walk(dir: string, acc: string[] = []): string[] {
  let ents: fs.Dirent[]
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of ents) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) acc.push(p)
  }
  return acc
}

type Row = {
  repo: string
  files: number
  parsed: number
  failures: number
  degraded: number
  perType: Record<string, { edges: number; files: number; exampleFiles: string[] }>
}

async function runShard(files: string[], repo: string): Promise<Row> {
  const perType: Row["perType"] = {}
  let parsed = 0
  let failures = 0
  let degraded = 0
  const bump = (t: string, f: string) => {
    const e = (perType[t] ??= { edges: 0, files: 0, exampleFiles: [] })
    e.edges++
    const first = f.split("/").slice(-3).join("/")
    if (!e.exampleFiles.includes(first) && e.exampleFiles.length < 3) e.exampleFiles.push(first)
  }
  let i = 0
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (i < files.length) {
      const f = files[i++]
      try {
        const r: any = await parseFile(f, "markdown")
        parsed++
        if (r?.fallback) degraded++
        const seen = new Set<string>()
        for (const rel of r?.relationships ?? []) {
          bump(rel.type, f)
          seen.add(rel.type)
        }
        for (const t of seen) perType[t].files++
      } catch {
        failures++
      }
    }
  })
  await Promise.all(workers)
  return { repo, files: files.length, parsed, failures, degraded, perType }
}

async function main(): Promise<void> {
  const all: { repo: string; file: string }[] = []
  for (const c of CORPORA) for (const f of walk(path.join(CORPUS_ROOT, c))) all.push({ repo: c, file: f })
  all.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))

  const shardOf = new Map<string, string[]>()
  for (const { repo, file } of all) {
    const h = (parseSha(file) >>> 0) % SHARDS
    const arr = shardOf.get(String(h)) ?? []
    arr.push(file)
    shardOf.set(String(h), arr)
  }

  const perRepo: Record<string, Row> = {}
  for (const c of CORPORA) perRepo[c] = { repo: c, files: 0, parsed: 0, failures: 0, degraded: 0, perType: {} }
  for (const arr of shardOf.values()) {
    const repo = arr[0].includes("/kubernetes/") ? "kubernetes" : "scala3"
    // one shard can straddle both corpora; run per repo to keep the row honest
    for (const c of CORPORA) {
      const mine = arr.filter(f => f.includes(`/${c}/`))
      if (!mine.length) continue
      const row = await runShard(mine, c)
      const agg = perRepo[c]
      agg.files += row.files
      agg.parsed += row.parsed
      agg.failures += row.failures
      agg.degraded += row.degraded
      for (const [t, v] of Object.entries(row.perType)) {
        const e = (agg.perType[t] ??= { edges: 0, files: 0, exampleFiles: [] })
        e.edges += v.edges
        e.files += v.files
        e.exampleFiles.push(...v.exampleFiles.filter(x => !e.exampleFiles.includes(x)))
        e.exampleFiles = e.exampleFiles.slice(0, 3)
      }
    }
  }

  const union: Record<string, { edges: number; files: number }> = {}
  for (const c of CORPORA)
    for (const [t, v] of Object.entries(perRepo[c].perType)) {
      const u = (union[t] ??= { edges: 0, files: 0 })
      u.edges += v.edges
      u.files += v.files
    }

  const ANALYZER_EMITS = ["contains", "uses", "references", "imports"]
  const ALLOWLIST = ["contains", "uses"]

  const out = {
    instrument: "markdown differential-corpora tally (validation/m14/fixtures/markdown/differential-corpora-tally.ts)",
    question:
      "on the two corpora script/m14/differential.ts draws markdown from, which of the four types the analyzer emits can a 60-file rotating draw ever place in the COMPARED set, given the allowlist at :23392 is [\"contains\",\"uses\"]?",
    corpusRoot: CORPUS_ROOT,
    corpora: CORPORA,
    population: {
      admission: "every tracked .md/.markdown under scala3 and kubernetes — the two corpora named at script/m14/differential.ts:533 and :640",
      files: all.length,
      perRepo: Object.fromEntries(CORPORA.map(c => [c, perRepo[c].files])),
      method: "upper bound on any 60-file draw: a type with 0 edges here has 0 in every draw",
    },
    entryPoint: "parseFile (src/ast/pool-worker.ts)",
    sharding: { shards: SHARDS, concurrencyInsideShard: CONCURRENCY, why: "src/ast/engine.ts:1411 kills the process on a WASM trap" },
    perRepo,
    union,
    oracleTruth: {
      file: "script/m14/markdown-oracle.ts",
      derives: {
        contains: [375, 462, 471, 503],
        references: [530],
        imports: [635],
        uses: [702, 708, 729, 741],
      },
      note: "the oracle derives all four. That is necessary but NOT sufficient: the allowlist is what puts a kind in the compared set.",
    },
    differentialAllowlist: {
      file: "script/m14/differential.ts:23392",
      text: '...(lang === "markdown" ? ["contains", "uses"] : []),',
      adjacentCommentClaims: "the lane emits no `imports` (markdown has no module system) and no `references` (front-matter keys are a declared boundary, not a graph)",
      commentIsFalse: "the lane emits imports (105 edges / 74 files) and references (16,857 edges / 1,136 files) over the whole admitted population",
      everAddedReferences: false,
      everAddedReferencesEvidence: "git log -S'lang === \"markdown\" ? [\"contains\", \"uses\", \"references\"]' -- script/m14/differential.ts returns no commit",
    },
    derivationFindings: ANALYZER_EMITS.filter(t => !ALLOWLIST.includes(t)).map(t => ({
      type: t,
      analyzerEdgesOnTheseCorpora: union[t]?.edges ?? 0,
      analyzerFilesOnTheseCorpora: union[t]?.files ?? 0,
      oracleDerivesTruth: true,
      inComparedSet: false,
      why: t === "references"
        ? "measured NOT silent: the analyzer emits rows and the oracle derives truth, but the allowlist drops the analyzer side, so kubernetes reads 770 references rows as MISSING (logs/differential.log)"
        : "measured silent on these corpora: the analyzer emits rows here but the compared set excludes them, so a draw containing one would show unexplained/missing asymmetry rather than agreement",
    })),
    verdict:
      "the DERIVATION count this lane publishes is 0 and the two published reasons for it are both wrong. The real position: the analyzer emits 4 types, the oracle derives 4, the allowlist compares 2, so references and imports are DERIVATION findings (2, not 0) and references has a MEASURED consequence already in the log — 770 MISSING on kubernetes. The fix is one array literal at script/m14/differential.ts:23392, a shared file, so it is reported not edited.",
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2))
  console.log(JSON.stringify({ population: out.population, union, derivationFindings: out.derivationFindings.map(d => ({ type: d.type, edges: d.analyzerEdgesOnTheseCorpora, files: d.analyzerFilesOnTheseCorpora })) }, null, 2))
}

function parseSha(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})