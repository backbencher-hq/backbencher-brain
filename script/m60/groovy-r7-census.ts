// script/m60/groovy-r7-census.ts — the R7 question, counted.
//
//   npx tsx script/m60/groovy-r7-census.ts [--out <path>] [--max N] [--from N]
//
// ## Why this exists
//
// `docs/analyzers/ONTOLOGY-WORKSTREAM.md`'s definition of done ends with three
// prohibitions: "No unknown symbols, no empty names, no placeholder-literal edge
// endpoints." `groovy-ontology-census.ts` reports the three counts, but a count
// without the SITES cannot be acted on, and two of them turned out to be
// different populations wearing one name:
//
//   unknownTarget   the literal string `"unknown"` as an edge endpoint. One site
//                   corpus-wide — and it is not a Groovy class, so where it
//                   comes from matters more than how many there are.
//   placeholderEnd  an endpoint equal to one of the SENTINELS: "", "(script)",
//                   "root", "global", "unknown", "self", "this", "super",
//                   "<global>". `calls` reports 8,510 of them over the corpus
//                   and the obvious reading — "8,510 fabricated edges" — is
//                   wrong: `(script)` is the lane's DELIBERATE owner for a
//                   statement with no enclosing class or method (a Jenkins
//                   pipeline step, a Gradle build script), and GAD2 unified three
//                   older spellings onto it. So the honest breakdown is by
//                   sentinel, and only the non-`(script)` ones are candidates
//                   for being defects.
//
// ## What it measures, per type
//
//   sentinelCounts   every sentinel endpoint, split by WHICH sentinel, with
//                    samples. This is the number that separates "documented
//                    design" from "unreadable endpoint".
//   unknownSites     every edge whose target is the literal `unknown`, with its
//                    file and line — one site is a finding, a thousand is a
//                    number.
//   selfEdgeSites    `source === target`. For `calls` this is RECURSION and is
//                    correct; for `contains` it is a member that shadows its
//                    owner's name; for `instantiates` it is a type constructing
//                    itself. Counted apart from the other two because "self
//                    edge" is only a defect for some labels.
//   emptySymbolSites every symbol whose name is empty or whitespace, with site.
//
// A zero that was never measured is the defect this repo keeps re-discovering,
// so the artifact reports these even when they are zero, and it records the
// slice it covered for the same reason.
import { execFileSync } from "node:child_process"
import { readFileSync, statSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const ROOT = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const argv = process.argv.slice(2)
const OUT = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : undefined
const MAX = Number((argv.includes("--max") ? argv[argv.indexOf("--max") + 1] : "0")) || 0
const FROM = Number((argv.includes("--from") ? argv[argv.indexOf("--from") + 1] : "0")) || 0
const REPOS = (process.env.BB_GROOVY_REPOS ?? "groovy").split(",").map((s) => s.trim()).filter(Boolean)
const ALL_TYPES = ["calls", "uses", "contains", "imports", "references", "exports", "extends", "implements", "overrides", "instantiates"]

const SENTINELS = ["", "(script)", "root", "global", "unknown", "self", "this", "super", "<global>"]

/**
 * What an endpoint's TEXT is, in five classes rather than two.
 *
 * The first version of this census asked one question — "does the endpoint match a
 * dotted-identifier shape?" — and answered it with a single number that was wrong
 * in three different directions at once. It reported 2,362 "malformed" endpoints
 * over the corpus, and reading that as a defect count would have been a
 * fabrication: the population contained (a) genuine text fragments, (b) Spock
 * feature-method names, which legitimately contain spaces because the language
 * writes them as strings (`def "test method with generic return type"()`), and
 * (c) `Owner<T>.member` override labels, where the lane's own `localEdgeLabel`
 * contract keeps the type arguments. So the classes are counted separately and the
 * report names each one. A number that mixes a bug with a language feature is not
 * a measurement, it is an average of incomparable things.
 *
 *   identifier   ^[A-Za-z_$][A-Za-z0-9_$]*$            — a plain name
 *   dotted       the same, separated by dots            — `java.util.List`, `GroovySystem`
 *   spaced       contains a space                       — Spock feature-method names
 *   generic      contains < or >                        — `Publisher<Object>.subscribe`
 *   punctuated   contains any of  ' " ( ) [ ] = , + @ ! ? * & | % # \ ;
 *
 * `punctuated` is the R7 class: an endpoint carrying a character that appears in no
 * name this lane or the language writes. Everything else is a name.
 */
const IDENT_ONLY = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const DOTTED_ONLY = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/
const PUNCTUATED = /['"()[\]=,+@!?*&|%#\\;]/
function classifyEndpoint(v: string): string {
  if (PUNCTUATED.test(v)) return "punctuated"
  if (v.includes(" ")) return "spaced"
  if (v.includes("<") || v.includes(">")) return "generic"
  if (DOTTED_ONLY.test(v)) return "dotted"
  if (IDENT_ONLY.test(v)) return "identifier"
  return "other"
}
const NAME_EXEMPT = new Set(["constructor", "(script)", "super", "this"])

type Row = { sentinels: Record<string, number>; samples: Record<string, string[]>; endpointClasses: Record<string, number>; punctuatedSamples: string[] }
const newRow = (): Row => ({ sentinels: {}, samples: {}, endpointClasses: {}, punctuatedSamples: [] })

async function main(): Promise<void> {
  const files: Array<{ repo: string; abs: string }> = []
  for (const repo of REPOS) {
    const dir = join(ROOT, repo)
    let tracked: string[]
    try {
      tracked = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 }).split("\0").filter(Boolean)
    } catch { continue }
    for (const rel of tracked) {
      if (!rel.endsWith(".groovy") && !rel.endsWith(".gradle")) continue
      const abs = join(dir, rel)
      try { if (statSync(abs).size > 512 * 1024) continue } catch { continue }
      files.push({ repo, abs })
    }
  }
  files.sort((a, b) => (a.abs < b.abs ? -1 : a.abs > b.abs ? 1 : 0))
  const selected = MAX > 0 ? files.slice(FROM, FROM + MAX) : (FROM > 0 ? files.slice(FROM) : files)

  const rows: Record<string, Row> = {}
  for (const t of ALL_TYPES) rows[t] = newRow()
  const unknownSites: string[] = []
  const selfSites: Record<string, string[]> = {}
  const emptySymbolSites: string[] = []
  let filesParsed = 0
  let emptyNameRefusals = 0

  const label = (abs: string): string => `${abs.replace(`${ROOT}/`, "")}`
  const addSentinel = (t: string, which: string, site: string): void => {
    const r = rows[t]
    if (!r) return
    r.sentinels[which] = (r.sentinels[which] ?? 0) + 1
    const arr = r.samples[which] ?? (r.samples[which] = [])
    if (arr.length < 4) arr.push(site)
  }

  let idx = 0
  const WORKERS = Number(process.env.BB_GROOVY_R7_WORKERS ?? "2")
  async function worker(): Promise<void> {
    for (;;) {
      const k = idx++
      if (k >= selected.length) return
      const f = selected[k]
      let r: any
      try { r = await parseFile(f.abs) } catch { continue }
      filesParsed++
      const md = r.metadata ?? {}
      if (typeof md.emptyNameRefusals === "number") emptyNameRefusals += md.emptyNameRefusals
      for (const s of r.symbols ?? []) {
        const n = String(s?.name ?? "")
        if (n.trim() === "") emptySymbolSites.push(`${label(f.abs)} kind=${s?.kind} @${s?.range?.startLine}`)
      }
      for (const rel of r.relationships ?? []) {
        const t = String(rel.type ?? rel.relationshipType ?? "")
        if (!rows[t]) continue
        const src = String(rel.source ?? "")
        const tgt = String(rel.target ?? "")
        const site = `${label(f.abs)}:${rel.line_number ?? "?"} ${src} -> ${tgt}`
        for (const which of SENTINELS) {
          if (src === which) addSentinel(t, `source:${which === "" ? "<empty>" : which}`, site)
          if (tgt === which) addSentinel(t, `target:${which === "" ? "<empty>" : which}`, site)
        }
        if (tgt === "unknown") { if (unknownSites.length < 40) unknownSites.push(site) }
        const row = rows[t]
        for (const which of ["source", "target"]) {
          const v = which === "source" ? src : tgt
          if (v === "" || NAME_EXEMPT.has(v)) continue
          const cls = classifyEndpoint(v)
          const bucket = row.endpointClasses[cls] ?? (row.endpointClasses[cls] = 0)
          row.endpointClasses[cls]++
          if (cls === "punctuated" && row.punctuatedSamples.length < 8) row.punctuatedSamples.push(`${which}=${JSON.stringify(v)} ${site}`)
        }
        if (src === tgt && src !== "") {
          const arr = selfSites[t] ?? (selfSites[t] = [])
          if (arr.length < 6) arr.push(site)
        }
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, () => worker()))

  const artifact = {
    instrument: "groovy-r7-census",
    lane: "analyzer/GROOVY",
    entryPoint: "src/ast/pool-worker.ts parseFile",
    corpora: REPOS.map((r) => `${ROOT}/${r}`),
    slice: { from: FROM, max: MAX, universe: files.length },
    filesAdmitted: selected.length,
    filesParsed,
    sentinelVocabulary: SENTINELS,
    endpointClasses: `identifier ^[A-Za-z_$][A-Za-z0-9_$]*$ | dotted (dot-separated) | spaced (Spock feature-method names) | generic (Owner<T>.member) | punctuated (quote, bracket, paren, = , + @ ! ? * & | % # backslash ;) — the R7 class`,
    endpointExempt: "empty, constructor, (script), super, this",
    byType: Object.fromEntries(ALL_TYPES.map((t) => [t, {
      sentinelEndpoints: rows[t].sentinels,
      samples: rows[t].samples,
      endpointTextClasses: rows[t].endpointClasses,
      punctuatedSamples: rows[t].punctuatedSamples,
    }])),
    unknownTargetSites: unknownSites,
    selfEdgeSamplesByType: selfSites,
    emptySymbolNameSites: emptySymbolSites,
    emptyNameRefusalsReportedByAnalyzer: emptyNameRefusals,
  }
  const out = JSON.stringify(artifact, null, 2)
  if (OUT) { writeFileSync(OUT, out + "\n"); process.stderr.write(`wrote ${OUT}\n`) }
  console.log(out)
}
main().catch((e) => { console.error(e); process.exit(1) })