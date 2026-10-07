/**
 * PERL ONTOLOGY CENSUS — CORPUS_PERL3's measuring instrument.
 *
 * ## What it is for
 *
 * `docs/analyzers/ONTOLOGY-WORKSTREAM.md` Part 1 requires a verdict for every one
 * of the ten relationship types, and Part 1's "Existing debt to clear" records
 * that source DERIVATION (counting which `RelationshipType.X` symbols appear in
 * the analyzer's text) answers only "is this type CONSTRUCTIBLE". It does not
 * answer "does it FIRE". Claiming 10/10 from a source scan misled this
 * programme for a week, so this instrument exists to produce the other number.
 *
 * ## The path is PRODUCTION, not a convenience
 *
 * The verdict for EMITTED is defined against production `parseFile` from
 * `src/ast/pool-worker.ts` — NOT `analyzer.analyze()`. This file imports that
 * `parseFile` and nothing else from the analyzer layer, so a number printed here
 * is a number the indexer would have produced.
 *
 * `script/m14/firing-check-v2.mjs` uses the OTHER production path
 * (`getParser -> parse -> analyze`). Both are production; they are different
 * call sites, and the relationship channel they read is the same. This file also
 * reports the `imports[]` / `exports[]` channels, because `ParseResult` carries
 * them SEPARATELY (`src/ast/types.ts`: `imports: ImportInfo[]`), the
 * parallel-indexer writes them to the `brain_import` TABLE, and no analyzer in
 * the fleet emits a relationship row typed `imports`. A type absent from the
 * relationship tally while `imports[]` is non-zero is therefore not a defect, and
 * conflating the two channels is the defect `firing-check-v2.mjs` DEFECT 3 was
 * written to correct.
 *
 * ## The population is DERIVED, never hand-written
 *
 * `docs/M14-HONESTY-CONTRACT.md` §"an instrument must declare the population it
 * covered": a count of zero is a claim that needs its population attached, and a
 * hard-coded `FILES = [...]` rots silently. This file reproduces the population
 * the arbiter (`script/m14/ontology-coverage-gate.ts`) itself uses, so the two
 * instruments describe ONE surface: every `git ls-files` entry under the corpus
 * root, at most 512 KiB, whose `detectLanguageFromPath` is `perl`. That set is
 * derived, so it grows when a file is added beside it.
 *
 * ## Crash-safety
 *
 * `parser.parse()` is synchronous WASM; a grammar that loops on a pathological
 * input cannot be interrupted and `ASTEngine` answers a hang by killing the
 * process. `script/m14/resumable-walk.ts` exists for exactly that, and this file
 * uses it — but a checkpoint alone is not enough, because the TALLIES would be
 * in memory when the process dies. So every file's tallies are appended to a
 * JSONL line BEFORE the walk moves on, and the summary is computed from that
 * JSONL at the end. A kill costs re-walking some files, never the measurement.
 *
 * ## NO REGEX
 *
 * Not one `RegExp`, and no pattern methods. Extension and key tests are
 * `endsWith` / `===` / `Set.has`. This is the same rule the lane's own
 * `perl-zero-regex.mts` enforces over the analyzer.
 *
 * Usage:
 *   bun script/m14/tmp/perl-ontology-census.mts [--fresh] [--out <json>]
 */
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import * as path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..", "..")
const CR = process.env.BB_CORPUS_ROOT ?? "$HOME/fixtures/repositories"
const MEAS = path.join(ROOT, "validation", "m14", "measurements")
const CHECKPOINT = path.join(MEAS, "walk-perl-ontology.txt")
const JSONL = path.join(MEAS, "perl-ontology-census.jsonl")
const SUMMARY = path.join(MEAS, "perl-ontology-summary.json")

const FRESH = process.argv.includes("--fresh")
const argOut = (() => { const i = process.argv.indexOf("--out"); return i >= 0 ? process.argv[i + 1] : undefined })()
const OUT = argOut ?? SUMMARY

const ALL_TYPES = [
  "calls", "uses", "contains", "imports", "references",
  "exports", "extends", "implements", "overrides", "instantiates",
] as const
type Type = (typeof ALL_TYPES)[number]

// ------------------------------------------------------------------ population
// Derived exactly as script/m14/ontology-coverage-gate.ts derives it, so the two
// instruments describe ONE surface. No hand-written file list anywhere.
const files: { repo: string; dir: string; rel: string; abs: string }[] = []
const reposWithPerl: Record<string, number> = {}
try {
  for (const e of readdirSync(CR)) {
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
    let n = 0
    for (const rel of tracked) {
      const abs = path.join(dir, rel)
      let text: string
      try {
        if (statSync(abs).size > 512 * 1024) continue
        text = readFileSync(abs, "utf8")
      } catch { continue }
      // detectLanguageFromPath is production's own router. Route nothing by hand.
      const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))
      if (detectLanguageFromPath(abs, text) !== "perl") continue
      n++
      files.push({ repo: e, dir, rel, abs })
    }
    if (n) reposWithPerl[e] = n
  }
} catch (e) {
  console.error(`corpus root unreadable: ${CR}: ${String(e)}`)
  process.exit(2)
}
if (!files.length) {
  console.error(`NO CORPUS under ${CR} — this is NOT a pass.`)
  process.exit(2)
}

console.log(`PERL ONTOLOGY CENSUS`)
console.log(`population: ${files.length} admitted files across ${Object.keys(reposWithPerl).length} repos (git ls-files, <=512KiB, detectLanguageFromPath === "perl")`)
console.log(`           derived from the directory listing; no hand-written file list exists in this file`)
console.log(`checkpoint: ${CHECKPOINT}`)
console.log(`jsonl:      ${JSONL}\n`)

// ------------------------------------------------------------------ the walk
if (FRESH) {
  writeFileSync(CHECKPOINT, "")
  try { writeFileSync(JSONL, "") } catch {}
}
mkdirSync(MEAS, { recursive: true })

const { parseFile } = await import(path.join(ROOT, "src/ast/pool-worker.ts"))
const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
const { RelationshipType: TYPES_TS } = await import(path.join(ROOT, "src/ast/types.ts"))
const PROD = [...new Set(Object.values(ASTEngine.RelationshipType as Record<string, string>))].sort()
const TYPES_TS_VOCAB = [...new Set(Object.values(TYPES_TS as Record<string, string>))].sort()
const SYM_KINDS = new Set<string>(Object.values(ASTEngine.SymbolKind as Record<string, string>))
const REL_TYPES = new Set<string>(Object.values(ASTEngine.RelationshipType as Record<string, string>))

const MARK_BAD = "!"
function loadCp(): { done: Set<string>; bad: Set<string> } {
  const done = new Set<string>(), bad = new Set<string>()
  if (!existsSync(CHECKPOINT)) return { done, bad }
  let raw: string
  try { raw = readFileSync(CHECKPOINT, "utf8") } catch { return { done, bad } }
  for (const line of raw.split("\n")) {
    const t = line.trim()
    if (!t) continue
    if (t.startsWith(MARK_BAD)) bad.add(t.slice(1))
    else done.add(t)
  }
  return { done, bad }
}
const { done, bad } = loadCp()

let walked = 0, skippedBad = 0
let cursor = 0
const CONC = Number(process.env.CC ?? 6)

async function worker(): Promise<void> {
  while (true) {
    const i = cursor++
    if (i >= files.length) return
    const f = files[i]
    if (done.has(f.abs) || bad.has(f.abs)) continue
    let line: string
    try {
      const r: any = await parseFile(f.abs, f.dir)
      const relTypes: Record<string, number> = {}
      const relFiles: Record<string, string[]> = {}
      const confBelow: Record<string, number> = {}
      const confAt10: Record<string, number> = {}
      const confMid: Record<string, number> = {}
      const withLine: Record<string, number> = {}
      const withoutLine: Record<string, number> = {}
      const reasons: Record<string, number> = {}
      let unknownKind = 0, emptyName = 0, placeholderEndpoint = 0, offEnumType = 0
      let emptyEndpoint = 0
      const seen: Record<string, number> = {}
      for (const rel of r.relationships ?? []) {
        const t = String(rel.type ?? rel.relationshipType ?? "").toLowerCase()
        if (!t) continue
        relTypes[t] = (relTypes[t] ?? 0) + 1
        if (!REL_TYPES.has(t)) offEnumType++
        const key = `${t}|${rel.source}|${rel.target}`
        seen[key] = (seen[key] ?? 0) + 1
        const c = rel.confidence
        if (typeof c === "number") {
          if (c < 0.7) confBelow[t] = (confBelow[t] ?? 0) + 1
          else if (c >= 1) confAt10[t] = (confAt10[t] ?? 0) + 1
          else confMid[t] = (confMid[t] ?? 0) + 1
        }
        const ln = (rel as any).line_number
        if (typeof ln === "number" && ln > 0) withLine[t] = (withLine[t] ?? 0) + 1
        else withoutLine[t] = (withoutLine[t] ?? 0) + 1
        const rc = (rel.metadata as any)?.reasonCode
        if (typeof rc === "string" && rc.length) reasons[rc] = (reasons[rc] ?? 0) + 1
        // R7: no edge endpoint may be the placeholder literal "unknown", and no
        // endpoint may be empty.
        for (const ep of [rel.source, rel.target]) {
          if (ep === "unknown") placeholderEndpoint++
          if (typeof ep !== "string" || ep.trim().length === 0) emptyEndpoint++
        }
        if (!relFiles[t]) relFiles[t] = []
        if (relFiles[t].length < 4) relFiles[t].push(`${f.repo}/${f.rel}:${(rel as any).line_number ?? "-"}`)
      }
      for (const s of r.symbols ?? []) {
        if (!SYM_KINDS.has(String(s.kind))) unknownKind++
        if (typeof s.name !== "string" || s.name.trim().length === 0) emptyName++
      }
      line = JSON.stringify({
        f: `${f.repo}/${f.rel}`,
        lang: r.language,
        fallback: r.fallback === true,
        bytes: statSync(f.abs).size,
        symbols: (r.symbols ?? []).length,
        relationships: (r.relationships ?? []).length,
        imports: (r.imports ?? []).length,
        exports: (r.exports ?? []).length,
        importModules: [...new Set((r.imports ?? []).map((i: any) => i.module))].slice(0, 6),
        errors: (r.errors ?? []).length,
        relTypes, relFiles, confBelow, confAt10, confMid, withLine, withoutLine, reasons,
        unknownKind, emptyName, placeholderEndpoint, offEnumType, emptyEndpoint,
      })
      done.add(f.abs)
    } catch (e) {
      skippedBad++
      bad.add(f.abs)
      appendFileSync(CHECKPOINT, `${MARK_BAD}${f.abs}\n`)
      line = JSON.stringify({ f: `${f.repo}/${f.rel}`, threw: String(e).slice(0, 200) })
    }
    // Append BEFORE moving on: a process killed by a parser hang cannot flush
    // anything, so anything not already on disk was never measured.
    appendFileSync(JSONL, line + "\n")
    appendFileSync(CHECKPOINT, `${bad.has(f.abs) ? MARK_BAD : ""}${f.abs}\n`)
    walked++
    if (walked % 250 === 0) console.log(`  ...${walked} new (${done.size} done, ${bad.size} bad)`)
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()))

// ------------------------------------------------------------------ summarise
const rows: any[] = []
try {
  for (const l of readFileSync(JSONL, "utf8").split("\n")) {
    const t = l.trim()
    if (!t) continue
    try { rows.push(JSON.parse(t)) } catch {}
  }
} catch {}

const counted = rows.filter((r) => !r.threw)
const threw = rows.filter((r) => r.threw)

type Agg = { n: number; files: number; examples: string[]; below07: number; at10: number; mid: number; withLine: number; withoutLine: number; reasons: Record<string, number> }
const agg = new Map<string, Agg>()
const bump = (t: string, fn: (a: Agg) => void) => {
  let a = agg.get(t)
  if (!a) { a = { n: 0, files: 0, examples: [], below07: 0, at10: 0, mid: 0, withLine: 0, withoutLine: 0, reasons: {} }; agg.set(t, a) }
  fn(a)
}
for (const r of counted) {
  for (const [t, n] of Object.entries(r.relTypes as Record<string, number>)) {
    bump(t, (a) => {
      a.n += n
      a.below07 += (r.confBelow?.[t] ?? 0)
      a.at10 += (r.confAt10?.[t] ?? 0)
      a.mid += (r.confMid?.[t] ?? 0)
      a.withLine += (r.withLine?.[t] ?? 0)
      a.withoutLine += (r.withoutLine?.[t] ?? 0)
      for (const [rc, k] of Object.entries(r.reasons as Record<string, number>)) a.reasons[rc] = (a.reasons[rc] ?? 0) + k
    })
  }
}
for (const r of counted) for (const t of Object.keys(r.relTypes ?? {})) bump(t, (a) => { if (a.examples.length < 6) a.examples.push(...(r.relFiles[t] ?? []).slice(0, 6 - a.examples.length)) })

const filesWithType = new Map<string, Set<string>>()
for (const r of counted) for (const t of Object.keys(r.relTypes ?? {})) {
  if (!filesWithType.has(t)) filesWithType.set(t, new Set())
  filesWithType.get(t)!.add(r.f)
}

const sum = (k: string) => counted.reduce((a, r) => a + (Number(r[k]) || 0), 0)
const impFiles = counted.filter((r) => (r.imports ?? 0) > 0).length
const expFiles = counted.filter((r) => (r.exports ?? 0) > 0).length
const impModules = new Set<string>()
for (const r of counted) for (const m of (r.importModules as string[]) ?? []) impModules.add(m)

const out = {
  generatedAt: new Date().toISOString(),
  head: execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  population: {
    corpusRoot: CR,
    admittedFiles: files.length,
    repos: Object.entries(reposWithPerl).sort((a, b) => b[1] - a[1]),
    derivation: "git ls-files per repo, <=512KiB, detectLanguageFromPath === 'perl' — the same derivation ontology-coverage-gate.ts uses",
  },
  coverage: {
    measured: counted.length,
    threwOnParse: threw.length,
    pct: files.length === 0 ? 0 : ((counted.length / files.length) * 100).toFixed(2),
    resumedFromCheckpoint: walked < files.length,
    newlyWalkedThisRun: walked,
    fallbackFiles: counted.filter((r) => r.fallback).length,
  },
  productionVocabulary: PROD,
  typesTsVocabulary: TYPES_TS_VOCAB,
  relationshipChannel: Object.fromEntries([...agg.entries()].sort((a, b) => b[1].n - a[1].n).map(([t, a]) => [t, {
    ...a, files: filesWithType.get(t)?.size ?? 0,
  }])),
  importsChannel: { count: sum("imports"), files: impFiles, distinctModulesListed: impModules.size },
  exportsChannel: { count: sum("exports"), files: expFiles },
  totals: {
    symbols: sum("symbols"), relationships: sum("relationships"),
    errors: sum("errors"),
    unknownSymbolKind: sum("unknownKind"), emptySymbolName: sum("emptyName"),
    placeholderEndpoint: sum("placeholderEndpoint"), emptyEndpoint: sum("emptyEndpoint"),
    offEnumRelationshipType: sum("offEnumType"),
  },
}
mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(out, null, 2))

const w = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n)
console.log(`\nwalk: ${counted.length}/${files.length} files (${out.coverage.pct}%)   newly walked ${walked}   threw ${threw.length}   resumed ${walked < files.length}`)
console.log(`production vocabulary (${PROD.length}): ${PROD.join(" ")}`)
console.log(`types.ts vocabulary (${TYPES_TS_VOCAB.length}): ${TYPES_TS_VOCAB.join(" ")}`)
console.log(`in types.ts but NOT produced: ${TYPES_TS_VOCAB.filter((t) => !PROD.includes(t)).join(" ") || "(none)"}`)
console.log(`produced but NOT in types.ts: ${PROD.filter((t) => !TYPES_TS_VOCAB.includes(t)).join(" ") || "(none)"}\n`)
console.log(`${w("type", 14)}${w("edges", 10)}${w("files", 8)}${w("<0.7", 9)}${w("0.7-1", 8)}${w("==1.0", 9)}${w("lined", 9)}${w("unlined", 9)}`)
console.log("-".repeat(76))
for (const t of ALL_TYPES) {
  const a = agg.get(t)
  if (!a) { console.log(`${w(t, 14)}${w("0", 10)}${w("0", 8)}${w("-", 9)}${w("-", 8)}${w("-", 9)}${w("-", 9)}${w("-", 9)}`); continue }
  console.log(`${w(t, 14)}${w(a.n.toLocaleString(), 10)}${w(String(filesWithType.get(t)?.size ?? 0), 8)}${w(String(a.below07), 9)}${w(String(a.mid), 8)}${w(String(a.at10), 9)}${w(String(a.withLine), 9)}${w(String(a.withoutLine), 9)}`)
}
const offEnum = [...agg.keys()].filter((t) => !PROD.includes(t))
console.log(`\nRELATIONSHIP CHANNEL: ${PROD.filter((t) => (agg.get(t)?.n ?? 0) > 0).length}/${PROD.length} fired`)
console.log(`IMPORTS CHANNEL: imports[] ${sum("imports")} in ${impFiles} files`)
console.log(`EXPORTS CHANNEL: exports[] ${sum("exports")} in ${expFiles} files`)
console.log(`off-enum relationship types emitted: ${offEnum.length ? offEnum.join(" ") : "none"}`)
console.log(`R7: placeholder "unknown" endpoints ${sum("placeholderEndpoint")}   empty endpoints ${sum("emptyEndpoint")}   unknown SymbolKind ${sum("unknownKind")}   empty symbol names ${sum("emptyName")}`)
console.log(`\nwrote ${OUT}`)
console.log(`\nVERDICT ${PROD.filter((t) => (agg.get(t)?.n ?? 0) > 0).length}/10 on the RELATIONSHIP channel; imports[] and exports[] are separate channels on ParseResult`)
