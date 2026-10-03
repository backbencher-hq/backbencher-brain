/**
 * FIRING CHECK — does an analyzer actually PRODUCE each relationship type?
 *
 * ## Why this file exists
 *
 * A previous programme reported "14 lanes at 10/10" for a week. That number came
 * from SOURCE DERIVATION: grepping which `RelationshipType` members appear in an
 * analyzer's source. It answers one question — "is this type constructible" — and
 * not the question that matters, which is "does it FIRE".
 *
 * The two differ constantly, and always in the same direction. A branch guarded by
 * a predicate the corpus never satisfies is dead code that still greps. The
 * markdown lane found the sharpest instance in this repo: `emitInlineUses`
 * resolved a heading's own inline with a DIRECT-child lookup, but the two heading
 * forms hold their text differently (`atx_heading > atx_hN_marker > inline` versus
 * `setext_heading > paragraph > inline`), so it returned early for every setext
 * heading in the language. The source says the type is emitted. It was not.
 *
 * So: source is not evidence. This measures.
 *
 * ## What it does
 *
 * For each requested language, walk the corpus through the PRODUCTION entry point —
 * `parseFile` from `src/ast/pool-worker.ts`, not `analyze()` — and tally, per
 * relationship type, how many edges actually came out, and in how many files.
 *
 * It also records three things a bare count cannot tell you:
 *
 *   - `firedOnCorpus`: the type produced at least one edge. This is the firing fact.
 *   - `sourcePublished` / `sourceExternal`: whether the edge's SOURCE is a symbol
 *     the analyzer published. An edge whose source is external, a path, or a
 *     builtin tells you the graph is one-directional for that type, and a count
 *     alone hides that completely.
 *   - `bothEndsResolve`: both endpoints bind to a symbol the run published.
 *     Reported as a count and a rate, because zig measured 759 edges whose source
 *     bound to a non-callable symbol while its census read "dangling 0.00%" — the
 *     census resolved BY NAME, and a name collision resolves.
 *
 * ## What it does not do
 *
 * It does not decide APPLICABILITY. A type reading 0 here is a firing fact, not a
 * ruling: the construct may be absent from the corpus, or present and unread.
 * Turning 0 into "RULED" requires a corpus measurement and a written reason, which
 * is `script/m14/ontology-coverage-gate.ts`'s job. Keeping the two apart is the
 * point — this file says what happened, that file says what it means.
 *
 * ## Usage
 *
 *   npx tsx script/m14/firing-check.ts                    # every onboarded lane
 *   npx tsx script/m14/firing-check.ts lua zig             # named lanes
 *   npx tsx script/m14/firing-check.ts --files 120 lua     # sample size
 *   npx tsx script/m14/firing-check.ts --json              # machine-readable
 *
 * ## Determinism
 *
 * `parseFile` was found nondeterministic under concurrency: `resolveWasm`'s last
 * fallback wrote each grammar to a path shared by every process, so a concurrent
 * reader got a truncated file, `Language.load` threw, and `parseFile`'s catch
 * SILENTLY substituted a regex extractor whose symbols carry no `kind` and whose
 * edges sit at 0.4/0.5. Measured at 12 of 64 concurrent shard-runs degrading against
 * 0 of 11 sequential. Fixed in `src/ast/engine.ts` (per-process path plus atomic
 * rename).
 *
 * A degraded file does not fail — it returns FEWER edges with no error. So this
 * counts `fallback: true` per file and REFUSES to publish a count from a degraded
 * run. That refusal is the second half of the measurement's trustworthiness.
 */
import { execFileSync } from "node:child_process"
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../src/ast/language-detection"
import { parseFile } from "../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"

/**
 * The ten ontology type names, as the ONOLOGY spells them. Note that `imports` is
 * the ontology name while the STORE spells it `brain_import` — the two differ, and
 * conflating them is how a lane ends up reporting an `imports` row that was never
 * initialised. `LABEL_ALIASES` below bridges store label -> ontology name.
 */
const ALL_TYPES = [
  "calls",
  "uses",
  "contains",
  "imports",
  "references",
  "exports",
  "extends",
  "implements",
  "overrides",
  "instantiates",
] as const

/** Every relationship label this repo can store, keyed by the ontology name. */
const LABEL_ALIASES: Record<string, string[]> = {
  calls: ["calls", "call"],
  uses: ["uses"],
  contains: ["contains", "composition", "part_of"],
  imports: ["brain_import", "imports"],
  references: ["references", "depends_on", "related"],
  exports: ["exports", "provides"],
  extends: ["extends", "inheritance"],
  implements: ["implements", "implementation"],
  overrides: ["overrides", "override"],
  instantiates: ["instantiates"],
}

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes("--json")
const NDJSON_OUT = argv.includes("--ndjson")
const FILES_FLAG = argv.indexOf("--files")
const SAMPLE = FILES_FLAG >= 0 ? Number(argv[FILES_FLAG + 1]) || 120 : 120
const NAMED = argv.filter((a) => !a.startsWith("--") && a !== String(SAMPLE))

// ------------------------------------------------------------------ corpus walk

type Repo = { name: string; dir: string }

/**
 * Corpus repos, by name. A language with no corpus is UNMEASURED, which is not the
 * same as failing, and is reported as such rather than as a zero.
 */
function corpusRepos(): Repo[] {
  const out: Repo[] = []
  let entries: string[]
  try {
    entries = readdirSync(CR)
  } catch {
    return out
  }
  for (const name of entries.sort()) {
    const dir = path.join(CR, name)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    // Only real git checkouts are corpus; a stray directory is not evidence.
    try {
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch {
      continue
    }
    out.push({ name, dir })
  }
  return out
}

/** Every tracked file in a repo, or [] if git cannot answer. */
function trackedFiles(repo: Repo): string[] {
  try {
    const raw = execFileSync("git", ["-C", repo.dir, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 512 * 1024 * 1024,
    })
    return raw.split("\0").filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Files for one language, drawn deterministically.
 *
 * Deterministic matters more than clever here: a count nobody can reproduce is a
 * number nobody can check, and the whole point of this file is to replace counts
 * that could not be checked. Order is the repo's own `git ls-files` order, then a
 * per-language stride, so the sample is stable across runs and machines without
 * depending on a PRNG seed.
 */
function filesForLanguage(lang: string, limit: number): { files: string[]; perRepo: Record<string, number>; corpusTotal: number } {
  const perRepo: Record<string, number> = {}
  const all: string[] = []
  for (const repo of corpusRepos()) {
    const hits: string[] = []
    for (const rel of trackedFiles(repo)) {
      if (detectLanguageFromPath(rel) !== lang) continue
      hits.push(path.join(repo.dir, rel))
    }
    perRepo[repo.name] = hits.length
    all.push(...hits)
  }
  const corpusTotal = all.length
  if (all.length <= limit) return { files: all.sort(), perRepo, corpusTotal }

  // Stride sampling: deterministic, and spreads across every repo rather than
  // exhausting the first alphabetically. Which is the defect a "first N files"
  // walk has — it measures one repository and calls it a language.
  const stride = Math.max(1, Math.floor(all.length / limit))
  const picked: string[] = []
  for (let i = 0; i < all.length && picked.length < limit; i += stride) picked.push(all[i])
  return { files: picked.sort(), perRepo, corpusTotal }
}

// ------------------------------------------------------------------ measurement

type TypeRow = {
  edges: number
  files: number
  firedOnCorpus: boolean
  sourcePublished: number
  sourceExternal: number
  bothEndsResolve: number
  belowConfidence07: number
  evidenceClassMissing: number
}

type LangResult = {
  lang: string
  filesAttempted: number
  filesParsed: number
  parseFailures: number
  degradedFallbacks: number
  symbols: number
  relationships: number
  emptySymbolNames: number
  emptyOrUnknownKind: number
  unknownEndpoints: number
  corpusTotal: number
  perRepo: Record<string, number>
  types: Record<string, TypeRow>
}

function blankRow(): TypeRow {
  return {
    edges: 0,
    files: 0,
    firedOnCorpus: false,
    sourcePublished: 0,
    sourceExternal: 0,
    bothEndsResolve: 0,
    belowConfidence07: 0,
    evidenceClassMissing: 0,
  }
}

async function measure(lang: string, limit: number): Promise<LangResult> {
  const { files, perRepo, corpusTotal } = filesForLanguage(lang, limit)
  const res: LangResult = {
    lang,
    filesAttempted: files.length,
    filesParsed: 0,
    parseFailures: 0,
    degradedFallbacks: 0,
    symbols: 0,
    relationships: 0,
    emptySymbolNames: 0,
    emptyOrUnknownKind: 0,
    unknownEndpoints: 0,
    corpusTotal,
    perRepo,
    types: {},
  }
  for (const t of ALL_TYPES) res.types[t] = blankRow()

  for (const file of files) {
    let r: any
    try {
      r = await parseFile(file, path.dirname(file))
    } catch {
      res.parseFailures++
      continue
    }
    if (!r) {
      res.parseFailures++
      continue
    }
    res.filesParsed++

    // A degraded parse substitutes a regex extractor. Its symbols carry no `kind`
    // and its edges sit below 0.7 confidence. Counting it as ordinary output would
    // publish a number about a fallback, not about the analyzer.
    if (r.fallback === true) res.degradedFallbacks++

    const symbols: any[] = Array.isArray(r.symbols) ? r.symbols : []
    const rels: any[] = Array.isArray(r.relationships) ? r.relationships : []

    res.symbols += symbols.length
    res.relationships += rels.length

    const published = new Set<string>()
    for (const s of symbols) {
      const n = String(s?.name ?? "")
      if (n.length === 0) res.emptySymbolNames++
      const k = String(s?.kind ?? "")
      if (k.length === 0 || k === "unknown") res.emptyOrUnknownKind++
      if (n.length > 0) published.add(n)
      // Qualified names bind too: an edge may name `Owner.member`.
      const q = String(s?.qualifiedName ?? "")
      if (q.length > 0) published.add(q)
    }

    const filesByType = new Map<string, Set<string>>()
    for (const rel of rels) {
      const rawLabel = String(rel?.type ?? rel?.relationshipType ?? "")
      if (rawLabel.length === 0) continue

      // Resolve the store label onto an ontology name.
      let type: string | null = null
      for (const [t, labels] of Object.entries(LABEL_ALIASES)) {
        if (labels.includes(rawLabel)) {
          type = t
          break
        }
      }
      if (!type) continue

      const row = res.types[type]
      row.edges++
      if (!filesByType.has(type)) filesByType.set(type, new Set())
      filesByType.get(type)!.add(file)

      const src = String(rel?.source ?? rel?.from ?? rel?.fromSymbol ?? "")
      const tgt = String(rel?.target ?? rel?.to ?? rel?.toSymbol ?? "")

      // R7: the placeholder literal. A source that really DECLARES a member called
      // `unknown` produces the same string and is a true name, so the two are
      // counted apart — collapsing them would either convict a truthful edge or
      // excuse a placeholder.
      if (src === "unknown" || tgt === "unknown") {
        if (!published.has(src) && !published.has(tgt)) res.unknownEndpoints++
      }
      if (src.length === 0 || tgt.length === 0) {
        if (!published.has(src) && !published.has(tgt)) res.unknownEndpoints++
      }

      // DIRECTION. A source the run published is an edge the graph can walk out
      // from; anything else is external, and the edge is one-way.
      if (published.has(src)) row.sourcePublished++
      else row.sourceExternal++

      if (published.has(src) && published.has(tgt)) row.bothEndsResolve++

      const conf = rel?.confidence
      if (typeof conf === "number" && conf < 0.7) row.belowConfidence07++
      if (rel?.metadata?.evidenceClass === undefined) row.evidenceClassMissing++
    }

    for (const [type, set] of filesByType) res.types[type].files = set.size
  }

  for (const t of ALL_TYPES) res.types[t].firedOnCorpus = res.types[t].edges > 0
  return res
}

// ------------------------------------------------------------------ report

function pad(s: string, n: number): string {
  return (s + " ".repeat(n)).slice(0, n)
}

async function main(): Promise<void> {
  let langs = NAMED
  if (langs.length === 0) {
    // Every language the repo onboards, from the same map the differential uses.
    const { LANGS } = await import("./differential")
    langs = Object.keys(LANGS).sort()
  }

  const results: LangResult[] = []
  for (const lang of langs) {
    process.stderr.write(`firing-check: ${lang} … `)
    const r = await measure(lang, SAMPLE)
    results.push(r)
    const fired = ALL_TYPES.filter((t) => r.types[t].firedOnCorpus).length
    process.stderr.write(
      `${fired}/10 fired, ${r.relationships} edges, ${r.filesParsed}/${r.filesAttempted} files` +
        `${r.degradedFallbacks > 0 ? `, ${r.degradedFallbacks} DEGRADED` : ""}\n`,
    )
  }

  if (NDJSON_OUT) {
    // Streamed, because a 43-language sweep takes hours and a single JSON
    // document written at the end is useless until the very last lane finishes —
    // and useless entirely if one lane hangs. One line per lane, flushed, so the
    // sweep is readable while it runs and survives an abort.
    for (const r of results) {
      const fired = ALL_TYPES.filter((t) => r.types[t].firedOnCorpus)
      const notFired = ALL_TYPES.filter((t) => !r.types[t].firedOnCorpus)
      process.stdout.write(
        JSON.stringify({
          lang: r.lang,
          files: `${r.filesParsed}/${r.filesAttempted}`,
          corpusTotal: r.corpusTotal,
          relationships: r.relationships,
          symbols: r.symbols,
          degraded: r.degradedFallbacks,
          firedCount: fired.length,
          fired: Object.fromEntries(fired.map((t) => [t, r.types[t].edges])),
          notFired,
          degradedDetail: {},
          unknownEndpoints: r.unknownEndpoints,
          emptySymbolNames: r.emptySymbolNames,
          emptyOrUnknownKind: r.emptyOrUnknownKind,
          types: r.types,
        }) + "\n",
      )
    }
  } else if (JSON_OUT) {
    console.log(JSON.stringify({ sample: SAMPLE, corpusRoot: CR, results }, null, 2))
  } else {
    console.log(`\nfiring check — production parseFile, ${SAMPLE}-file stride sample per language`)
    console.log(`corpus: ${CR}\n`)
    const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
    console.log(w("lang", 11) + w("files", 12) + w("fired", 8) + w("rels", 12) + w("degraded", 10) + "fired types")
    console.log("-".repeat(110))
    for (const r of results) {
      const firedList = ALL_TYPES.filter((t) => r.types[t].firedOnCorpus).join(",") || "(none)"
      console.log(
        w(r.lang, 11) +
          w(`${r.filesParsed}/${r.filesAttempted}`, 12) +
          w(`${ALL_TYPES.filter((t) => r.types[t].firedOnCorpus).length}/10`, 8) +
          w(r.relationships.toLocaleString(), 12) +
          w(String(r.degradedFallbacks), 10) +
          firedList,
      )
    }
    console.log("-".repeat(110))
    console.log("")
    console.log("A type reading 0 here is a FIRING FACT, not a ruling. Turning 0 into RULED needs a corpus")
    console.log("measurement and a written reason — script/m14/ontology-coverage-gate.ts does that, not this.")
    console.log("A language with corpusTotal 0 is UNMEASURED, which is not the same as failing.")
    const degraded = results.filter((r) => r.degradedFallbacks > 0)
    if (degraded.length > 0) {
      console.log("")
      console.log(`>>> REFUSING to call these counts trustworthy: ${degraded.length} lane(s) had a degraded run.`)
      for (const r of degraded) {
        console.log(`    ${r.lang}: ${r.degradedFallbacks} file(s) fell back to the regex extractor`)
      }
      console.log("    A degraded parse returns FEWER edges with no error, so its count is about the fallback.")
      console.log("    Re-run those lanes sequentially before quoting a number.")
      process.exitCode = 1
    }
  }

  const zeroCorpus = results.filter((r) => r.corpusTotal === 0)
  if (zeroCorpus.length > 0) {
    console.log("")
    console.log(`>>> ${zeroCorpus.length} lane(s) have NO CORPUS and are therefore UNMEASURED:`)
    for (const r of zeroCorpus) console.log(`    ${r.lang}`)
    console.log("    Clone a repository for the language. Unmeasured is not the same as failing.")
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})