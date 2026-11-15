/**
 * M60 ONTOLOGY CENSUS — yaml.
 *
 * Read-only. Produces the numbers §2b/§2c/§3 of the ontology lane require,
 * and every one of them comes from the PRODUCTION entry point
 * `parseFile` (src/ast/pool-worker.ts), never from `analyze()`.
 *
 * Why `parseFile` and not `analyze()`: `analyze()` is a per-file unit that skips
 * the pool-worker stages — the 5 MB structural limit, the 1 MB fallback, the
 * parse timeout, truncation. A count taken through it would measure the analyzer
 * rather than the thing that ships.
 *
 * WHAT IT MEASURES, per relationship type:
 *   - edges, and the files they came from
 *   - how many endpoints bind to a real symbol in the SAME file's symbol set
 *     (`resolvedBothEnds`), which is the "Resolved" question
 *   - the evidenceClass distribution and the heuristic ratio (< 1.0 confidence),
 *     which is the "Confident" question
 * and per file:
 *   - SymbolKind distribution, and every empty/unknown kind
 *   - symbols with an empty name
 *   - edge endpoints equal to the literal `unknown`
 *
 * SAMPLING. Deterministic: the git-tracked files of every corpus repo whose
 * path/content detects as `yaml`, sorted by `repo/rel`, then a seeded stride so
 * the draw is spread over the whole list rather than a directory-order prefix,
 * then the first `--sample` of that. `--repo=` restricts to named repos. The
 * draw is reproducible from the corpus alone, which is the property a number
 * has to have to be worth quoting.
 */
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { detectLanguageFromPath } from "../../../../../src/ast/language-detection"
import { parseFile } from "../../../../../src/ast/pool-worker"

const CR = process.env.BB_CORPUS_ROOT ?? "/home/ishaq2321/bb_tests/repositories"
const LANG = "yaml"
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"] as const
type Type = (typeof ALL_TYPES)[number]

const sampleArg = process.argv.indexOf("--sample")
const SAMPLE = sampleArg >= 0 ? parseInt(process.argv[sampleArg + 1]) : 500
const repoArg = process.argv.indexOf("--repo")
const ONLY_REPO = repoArg >= 0 ? process.argv[repoArg + 1] : undefined
// `--text=<regex>` narrows the admitted corpus BEFORE the draw, and `--all` removes the
// stride cap. Both exist because a stride sample of 500 out of 16,371 files cannot see a
// construct that occurs in 17 of them: the merge key `<<` and the duplicate-key pair both
// live at that frequency, and a draw that misses them reports 0 for a construct that is
// there. Narrowing by TEXT is a sampling filter, not an attribution rule — the analyzer
// still decides what a `uses:` means, so nothing here can flatter a count.
// Accepts both `--text=<regex>` and `--text <regex>`; the first form is what a shell
// produces from `--text='...'`, so accepting only the second silently ran the WHOLE
// corpus instead of the intended subset and printed `filter: (none)`.
const textEq = process.argv.find((a) => a.startsWith("--text="))
const textArg = process.argv.indexOf("--text")
const textValue = textEq ? textEq.slice("--text=".length) : textArg >= 0 ? process.argv[textArg + 1] : undefined
const TEXT_FILTER = textValue !== undefined ? new RegExp(textValue) : null
const ALL = process.argv.includes("--all")

// ------------------------------------------------------------------ corpus

interface CorpusFile { repo: string; dir: string; rel: string; abs: string }

function corpusFiles(): CorpusFile[] {
  const out: CorpusFile[] = []
  for (const e of readdirSync(CR).sort()) {
    if (ONLY_REPO && e !== ONLY_REPO) continue
    const dir = path.join(CR, e)
    try {
      if (!statSync(dir).isDirectory()) continue
      execFileSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" })
    } catch { continue }
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
        encoding: "utf8",
        maxBuffer: 512 * 1024 * 1024,
      }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try {
        if (statSync(abs).size > 512 * 1024) continue
        text = readFileSync(abs, "utf8")
      } catch { continue }
      if (detectLanguageFromPath(abs, text) !== LANG) continue
      if (TEXT_FILTER && !TEXT_FILTER.test(text)) continue
      out.push({ repo: e, dir, rel, abs })
    }
  }
  return out.sort((a, b) => `${a.repo}/${a.rel}`.localeCompare(`${b.repo}/${b.rel}`))
}

const all = corpusFiles()
console.log(`[census] corpus: ${all.length} admitted ${LANG} files across ${new Set(all.map((f) => f.repo)).size} repos`)
const perRepo = new Map<string, number>()
for (const f of all) perRepo.set(f.repo, (perRepo.get(f.repo) ?? 0) + 1)
console.log(`[census] per repo: ${[...perRepo.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}=${n}`).join(" ")}`)

// Stride draw: `SAMPLE` spread over the sorted list, not a prefix. A prefix of a
// sorted-by-path list is one directory of one repo, which measures a subtree
// rather than the language.
const stride = ALL ? 1 : Math.max(1, Math.floor(all.length / SAMPLE))
const drawn = stride === 1 ? all : all.filter((_, i) => i % stride === 0).slice(0, SAMPLE)
const drawnRepos = new Map<string, number>()
for (const f of drawn) drawnRepos.set(f.repo, (drawnRepos.get(f.repo) ?? 0) + 1)
console.log(`[census] filter: ${TEXT_FILTER ? TEXT_FILTER.source : "(none)"}`)
console.log(`[census] sampling: stride ${stride} over ${all.length} sorted paths -> ${drawn.length} files, ${drawnRepos.size} repos`)
console.log(`[census] draw: ${[...drawnRepos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([r, n]) => `${r}=${n}`).join(" ")}`)
console.log("")

// ------------------------------------------------------------------ tallies

interface TypeRow {
  edges: number
  files: Set<string>
  /** endpoints present in the file's symbol set (id, qualifiedName or name). */
  srcResolved: number
  tgtResolved: number
  bothResolved: number
  confUnder07: number
  confUnder1: number
  evidence: Map<string, number>
  /** distinct `metadata.relationshipType` labels, for the "Labelled" question. */
  labels: Map<string, number>
}

const byType = new Map<Type, TypeRow>()
const row = (t: Type): TypeRow => {
  let r = byType.get(t)
  if (!r) {
    r = {
      edges: 0, files: new Set(), srcResolved: 0, tgtResolved: 0, bothResolved: 0,
      confUnder07: 0, confUnder1: 0, evidence: new Map(), labels: new Map(),
    }
    byType.set(t, r)
  }
  return r
}

const kindTally = new Map<string, number>()
const emptyKindRows: string[] = []
const emptyNameRows: string[] = []
const unknownEndpointRows: string[] = []
let filesOk = 0
let filesFailed = 0
let totalSymbols = 0
let totalEdges = 0
const failReasons = new Map<string, number>()
const overflowSymbols = 0

let idx = 0
async function worker(): Promise<void> {
  while (true) {
    const i = idx++
    if (i >= drawn.length) return
    const f = drawn[i]!
    let r: any
    try {
      r = await parseFile(f.abs, f.dir)
    } catch (err) {
      filesFailed++
      const k = String((err as any)?.message ?? err).slice(0, 80)
      failReasons.set(k, (failReasons.get(k) ?? 0) + 1)
      continue
    }
    if (!r?.success && !r?.symbols) { filesFailed++; continue }
    filesOk++

    // A symbol is resolvable by its id, its qualifiedName, or — the graph's
    // last-resort join — its bare name. All three are counted separately so the
    // honest figure is visible: an endpoint that only binds by BARE name is a
    // weaker resolution than one that binds by id.
    const byId = new Set<string>()
    const byName = new Set<string>()
    for (const s of r.symbols ?? []) {
      totalSymbols++
      const k = String(s.kind ?? "")
      kindTally.set(k, (kindTally.get(k) ?? 0) + 1)
      if (!k || k === "unknown") emptyKindRows.push(`${f.repo}/${f.rel} :: ${String(s.name)}`)
      if (!s.name || String(s.name).trim() === "") emptyNameRows.push(`${f.repo}/${f.rel} :: ${String(s.id)}`)
      for (const v of [s.id, s.qualifiedName]) if (v) byId.add(String(v))
      if (s.name) byName.add(String(s.name))
    }

    for (const e of r.relationships ?? []) {
      const t = String(e.type ?? "").toLowerCase() as Type
      if (!ALL_TYPES.includes(t)) continue
      totalEdges++
      const rr = row(t)
      rr.edges++
      if (rr.files.size < 4000) rr.files.add(`${f.repo}/${f.rel}`)
      const src = String(e.source ?? "")
      const tgt = String(e.target ?? "")
      if (!src || !tgt || src === "unknown" || tgt === "unknown") {
        if (unknownEndpointRows.length < 40) unknownEndpointRows.push(`${f.repo}/${f.rel} ${t} ${src} -> ${tgt}`)
      }
      const sOk = byId.has(src) || byName.has(src)
      const tOk = byId.has(tgt) || byName.has(tgt)
      if (sOk) rr.srcResolved++
      if (tOk) rr.tgtResolved++
      if (sOk && tOk) rr.bothResolved++
      const c = typeof e.confidence === "number" ? e.confidence : 1
      if (c < 1) rr.confUnder1++
      if (c < 0.7) rr.confUnder07++
      const ec = String((e.metadata as any)?.evidenceClass ?? "(none)")
      rr.evidence.set(ec, (rr.evidence.get(ec) ?? 0) + 1)
      const lab = String((e.metadata as any)?.relationshipType ?? "(none)")
      rr.labels.set(lab, (rr.labels.get(lab) ?? 0) + 1)
    }
    void overflowSymbols
  }
}
await Promise.all(Array.from({ length: 6 }, () => worker()))

// ------------------------------------------------------------------ report

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`)
const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)

console.log(`files parsed ok ${filesOk}   failed ${filesFailed}   symbols ${totalSymbols}   edges ${totalEdges}`)
if (failReasons.size > 0) {
  console.log(`fail reasons: ${[...failReasons.entries()].map(([k, v]) => `${v}x ${k}`).join(" | ")}`)
}
console.log("")

console.log("PER TYPE (through production parseFile)")
console.log(`${w("type", 14)}${w("edges", 10)}${w("files", 8)}${w("srcRes", 9)}${w("tgtRes", 9)}${w("bothRes", 10)}${w("conf<1", 9)}${w("conf<.7", 9)}labels`)
console.log("-".repeat(150))
for (const t of ALL_TYPES) {
  const rr = byType.get(t)
  if (!rr) { console.log(`${w(t, 14)}0`); continue }
  const labels = [...rr.labels.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(" ")
  console.log(
    `${w(t, 14)}${w(rr.edges.toLocaleString(), 10)}${w(rr.files.size.toLocaleString(), 8)}` +
    `${w(pct(rr.srcResolved, rr.edges), 9)}${w(pct(rr.tgtResolved, rr.edges), 9)}${w(pct(rr.bothResolved, rr.edges), 10)}` +
    `${w(pct(rr.confUnder1, rr.edges), 9)}${w(pct(rr.confUnder07, rr.edges), 9)}${labels}`,
  )
}
console.log("")

console.log("EVIDENCE CLASS per type")
for (const t of ALL_TYPES) {
  const rr = byType.get(t)
  if (!rr) continue
  console.log(`  ${w(t, 14)} ${[...rr.evidence.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`)
}
console.log("")

console.log("EXAMPLE FILES per type (up to 3)")
for (const t of ALL_TYPES) {
  const rr = byType.get(t)
  if (!rr || rr.edges === 0) continue
  console.log(`  ${w(t, 14)} ${[...rr.files].slice(0, 3).join(", ")}`)
}
console.log("")

console.log(`SYMBOL KIND tally: ${[...kindTally.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k || "(empty)"}=${v}`).join(" ")}`)
console.log(`empty/unknown kind rows: ${emptyKindRows.length}${emptyKindRows.length ? ` e.g. ${emptyKindRows.slice(0, 5).join(" | ")}` : ""}`)
console.log(`empty symbol name rows: ${emptyNameRows.length}${emptyNameRows.length ? ` e.g. ${emptyNameRows.slice(0, 5).join(" | ")}` : ""}`)
console.log(`edge endpoint 'unknown'/empty rows: ${unknownEndpointRows.length}${unknownEndpointRows.length ? ` e.g. ${unknownEndpointRows.slice(0, 5).join(" | ")}` : ""}`)