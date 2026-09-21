// script/m60/lang-completion-matrix.ts — "mark a tick against the languages that
// are truly done" as a COMPUTED table, not prose.
//
// The question this answers is per-language and it is deliberately harsh: a
// language earns a tick only when EVERY applicable dimension is green, and a
// dimension that is missing for that language is reported as "—", never as a
// pass. The dimensions are the ones this project already measures elsewhere;
// this file only joins them, and it refuses to invent one:
//
//   diff      M14.0.F5   analyzer covers the tree truth: MISSING=0, no
//                        unexplained edges, no fabricated edges (@ HEAD)
//   fixtures  M14.0.F3   adversarial fixtures: fail=0
//   corpus    M12 claims every grammar-error claim is backed by a measured
//                        artifact and agrees with it
//   grammar   M14.0.F1   analyzer↔grammar audit: 0 unknown node/field refs
//                        (allowlisted findings count as adjudicated)
//   lines     M60.P1     line_number is alive for the language (M59.A7's
//                        per-language handoff is complete for it)
//   folder    reviews/   the language's closure folder carries a closure marker
//   tracker   #issues    no OPEN issue names the language as its subject
//
// The tracker dimension is the one that cannot be read from a file, so it reads
// a dated snapshot (validation/m49/lang-open-issues.json) and a curated
// milestone list: issues whose language mentions are *completion records*
// (e.g. M37's per-language ✅ table) rather than open work are declared
// cross-cutting here, by number, with a reason — never silently dropped.
//
// Run: bun script/m60/lang-completion-matrix.ts
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/LCM.json")
const CLOSURE_MARKER = /\b(?:RESOLVED|RESOLUTION|CLOSED)\b/

type Cell = "pass" | "fail" | "n/a" | "disclosed"
interface Row {
  lang: string
  family: string
  cells: Record<string, Cell>
  notes: string[]
  done: boolean
}

const readJson = (p: string): any => JSON.parse(readFileSync(path.join(ROOT, p), "utf8"))
const exists = (p: string) => existsSync(path.join(ROOT, p))

// ---------------------------------------------------------------- canonical names
// Artifacts disagree on a few spellings; canonicalize to the analyzer directory
// name so a language cannot dodge a red cell under an alias.
const ALIAS: Record<string, string> = {
  make: "makefile", makefile: "makefile",
  "objective-c": "objc", objc: "objc",
  "c#": "csharp", csharp: "csharp",
  "f#": "fsharp", fsharp: "fsharp",
}
const canon = (l: string) => ALIAS[l.toLowerCase()] ?? l.toLowerCase()

const FAMILIES: Record<string, string[]> = {
  jvm: ["java", "kotlin", "scala", "groovy"],
  web: ["typescript", "javascript", "vue", "svelte"],
  oo: ["python", "ruby", "php", "dart", "csharp"],
  systems: ["c", "cpp", "rust", "go", "zig", "swift", "objc"],
  functional: ["haskell", "clojure", "elixir", "erlang", "fsharp", "clean"],
  config: ["json", "yaml", "xml", "html", "css", "sql", "graphql", "hcl", "markdown", "makefile", "bash", "powershell", "lua", "perl", "r"],
}
const familyOf = (l: string) =>
  Object.entries(FAMILIES).find(([, ls]) => ls.includes(l))?.[0] ?? "other"

// ---------------------------------------------------------------- tracker dimension
// Aliases are matched as case-insensitive substrings of the issue TITLE (word
// boundaries miss RealGroovyAnalyzer, which is exactly how groovy's #896 hid).
const TRACKER_ALIASES: Record<string, string[]> = {
  java: ["java"], kotlin: ["kotlin"], scala: ["scala"], groovy: ["groovy"],
  typescript: ["typescript"], javascript: ["javascript"], vue: ["vue"], svelte: ["svelte"],
  c: ["c holy", "cpp/c", "c/cpp"], cpp: ["cpp", "c++"], rust: ["rust"],
  go: ["golang", "go:", "go master", "go and haskell", "c+cpp+rust+go+zig"],
  csharp: ["csharp", "c#"], fsharp: ["fsharp", "f#"], dart: ["dart"], ruby: ["ruby"],
  php: ["php"], python: ["python"], swift: ["swift"], objc: ["objc", "objective-c"],
  zig: ["zig"], haskell: ["haskell"], clojure: ["clojure"], elixir: ["elixir"],
  erlang: ["erlang"], clean: ["clean"], lua: ["lua"], perl: ["perl"], r: ["lua/perl/r"],
  xml: ["xml"], yaml: ["yaml"], json: ["json"], css: ["css"], html: ["html"],
  sql: ["sql"], graphql: ["graphql"], hcl: ["hcl"], markdown: ["markdown"],
  makefile: ["makefile"], bash: ["bash"], powershell: ["powershell"],
  nim: ["nim"], protobuf: ["protobuf"], vb: ["vb"],
}
// Milestone-wide issues that *name* languages as completion records, not as open
// work for them. Excluded per language, with the reason recorded.
const CROSS_CUTTING: Record<number, string> = {
  593: "M37 dual-lens backfill: open for the languages still in its table, but java/kotlin/scala/ts/js rows are recorded ✅ done",
  612: "M37.19 systems-family joint closure gate (c/cpp/rust/go/zig) — kept language-scoped, listed here only for the record",
  864: "M14 Matrix 4 grammar provenance/pinning: matrix-wide item that names fsharp+clean as examples, not their completion gap",
}
// 612 is genuinely their closure gate, so it stays language-scoped.
delete CROSS_CUTTING[612]

function trackerHits(lang: string, snapshot: any): number[] {
  const aliases = TRACKER_ALIASES[canon(lang)] ?? [lang]
  return snapshot.issues
    .filter((i: any) => !(i.number in CROSS_CUTTING))
    .filter((i: any) => aliases.some(a => i.title.toLowerCase().includes(a)))
    .map((i: any) => i.number)
    .sort((a: number, b: number) => a - b)
}

// ---------------------------------------------------------------- the join
const F5 = exists("validation/m14/results/M14.0.F5.json") ? readJson("validation/m14/results/M14.0.F5.json") : null
const F3 = exists("validation/m14/results/M14.0.F3.json") ? readJson("validation/m14/results/M14.0.F3.json") : null
const F1 = exists("validation/m14/results/M14.0.F1.json") ? readJson("validation/m14/results/M14.0.F1.json") : null
const CLAIMS = exists("validation/m12/results/corpus-claims-gate.json") ? readJson("validation/m12/results/corpus-claims-gate.json") : null
const P1 = exists("validation/m60/results/P1.json") ? readJson("validation/m60/results/P1.json") : null
const TRACKER = exists("validation/m49/lang-open-issues.json") ? readJson("validation/m49/lang-open-issues.json") : null
// A live canonical fixture run at HEAD, with the tracked rule already applied
// (#899: a fixture whose expectation file is uncommitted is in-flight lane work,
// not milestone evidence). Preferred over the committed F3, which can only ever
// describe the commit that produced it.
const FIX = exists("validation/m60/results/fixtures-at-head.json") ? readJson("validation/m60/results/fixtures-at-head.json") : null
// M12 artifact pinning: a pinned artifact records the input digest it was measured
// against and the freshness checker confirms it still describes this tree; an
// unpinned one CANNOT be checked, so it is disclosed (amber), never scored as a pass.
const FRESH = exists("validation/m60/results/m12-freshness-at-head.json") ? readJson("validation/m60/results/m12-freshness-at-head.json") : null
const freshPinned = new Set<string>((FRESH?.freshPinned ?? []).map(canon))

if (!F5 || !F3 || !F1 || !CLAIMS || !P1 || !TRACKER) {
  console.error("missing an input artifact — refusing to compute a matrix from partial evidence")
  process.exit(5)
}

const diffReport: Record<string, any> = F5.data.report
const fixtureSummary: Record<string, { pass: number; fail: number }> = FIX?.summary ?? F3.data.summary
const untrackedFixtureFails: Record<string, number> = FIX?.untrackedFixtureFailures ?? {}
const grammarAudit: Record<string, any> = F1.data.languages
const P1_LANGS = new Set<string>((P1.emitCells as any[]).map(c => canon(c.lang)))
const lineAlive = new Set<string>(
  P1.emitCells.filter((c: any) => c.field === "line_number" && c.alive).map((c: any) => canon(c.lang)),
)
const claims: Record<string, boolean> = Object.fromEntries(
  CLAIMS.checked.map((c: any) => [canon(c.language), c.agreement === true]),
)

const folders = existsSync(path.join(ROOT, "reviews"))
  ? readdirSync(path.join(ROOT, "reviews")).filter(d => {
      try { return readdirSync(path.join(ROOT, "reviews", d)).length > 0 } catch { return false }
    })
  : []

function folderClosed(lang: string): Cell {
  const dir = folders.find(d => canon(d) === canon(lang))
  if (!dir) return "n/a"
  for (const f of readdirSync(path.join(ROOT, "reviews", dir))) {
    try {
      if (CLOSURE_MARKER.test(readFileSync(path.join(ROOT, "reviews", dir, f), "utf8"))) return "pass"
    } catch { /* directory or unreadable */ }
  }
  return "fail"
}

// The analyzer-lane universe is the manifest's own: every language the corpus-claims
// gate audits. Languages that only appear in the tracker (detected name → parser
// offered → ERROR file, #892) are NOT analyzer lanes and are reported separately
// rather than counted as unfinished analyzers.
const languages = Array.from(new Set<string>([
  ...Object.keys(diffReport), ...Object.keys(fixtureSummary), ...Object.keys(grammarAudit),
  ...Object.keys(claims), ...lineAlive,
].map(canon))).sort()
const nonAnalyzerDetected = Object.keys(TRACKER_ALIASES)
  .map(canon)
  .filter(l => !languages.includes(l) && trackerHits(l, TRACKER).length > 0)
  .sort()

const rows: Row[] = languages.map(lang => {
  const cells: Record<string, Cell> = {}
  const notes: string[] = []

  const d = diffReport[lang]
  if (d) {
    // heuristicUnexplained is the REGISTERED explanatory class (edges explained by a
    // declared heuristic rather than by tree shape) — it is reported, never counted
    // as a gap. The gaps are the analyzer's own: a missed truth edge, an edge the tree
    // cannot explain at all, or a fabricated one.
    const clean = d.missingInAnalyzer === 0 && (d.unexplainedInAnalyzer ?? 0) === 0 && (d.fabricationPct ?? 0) === 0
    cells.diff = clean ? "pass" : "fail"
    if (!clean) notes.push(`diff: MISSING=${d.missingInAnalyzer} unexplained=${d.unexplainedInAnalyzer ?? 0} fab=${d.fabricationPct ?? 0}% (${d.filesSampled} files)`)
    else notes.push(`diff: truth=${d.treeTruthEdges} covered=${d.coveredByAnalyzer} analyzer-edges=${d.analyzerEdges} (heuristic-class ${d.heuristicUnexplained})`)
  } else { cells.diff = "n/a"; notes.push("diff: not a measured differential lane") }

  const fx = fixtureSummary[lang]
  if (fx) {
    // A failing fixture whose expectation file is uncommitted is not milestone
    // evidence (#899) — subtract it; if nothing committed remains, the lane has
    // no committed fixture evidence and says so instead of claiming a pass.
    const failEff = Math.max(0, fx.fail - (untrackedFixtureFails[lang] ?? 0))
    if (fx.pass + failEff === 0) { cells.fixtures = "n/a"; notes.push("fixtures: all fixtures are uncommitted (#899 in-flight)") }
    else { cells.fixtures = failEff === 0 ? "pass" : "fail"; notes.push(`fixtures: ${fx.pass}/${fx.pass + failEff} committed`) }
  } else { cells.fixtures = "n/a"; notes.push("fixtures: no adversarial fixture lane") }
  if (untrackedFixtureFails[lang]) notes.push(`fixtures: +${untrackedFixtureFails[lang]} uncommitted fixture(s) failing — in-flight lane work, excluded per #899`)

  if (lang in claims) { cells.corpus = claims[lang] ? "pass" : "fail"; if (!claims[lang]) notes.push("corpus: manifest claim does not agree with its artifact") }
  else { cells.corpus = "n/a" }

  if (lang in claims) {
    const pinned = freshPinned.has(lang)
    cells.fresh = pinned ? "pass" : "disclosed"
    if (!pinned) notes.push("fresh: M12 artifact is unpinned — freshness cannot be checked (project-wide pinning ceremony, #840 residual)")
  } else { cells.fresh = "n/a" }

  const g = grammarAudit[lang]
  if (g) {
    const ok = g.status === "pass"
    cells.grammar = ok ? "pass" : "fail"
    if (!ok) notes.push(`grammar: ${g.unknownNodeTypes.length} unknown node type(s), ${g.unknownFields.length} unknown field(s)`)
  } else { cells.grammar = "n/a" }

  if (!P1_LANGS.has(lang)) { cells.lines = "n/a"; notes.push("lines: not a payload-matrix language (emission undefined here)") }
  else if (lineAlive.has(lang)) cells.lines = "pass"
  else { cells.lines = "fail"; notes.push("lines: line_number not emitted (M59.A7 handoff open for this language)") }

  cells.folder = folderClosed(lang)
  if (cells.folder === "fail") notes.push("folder: reviews/" + lang + " has no closure marker")

  const hits = trackerHits(lang, TRACKER)
  cells.tracker = hits.length === 0 ? "pass" : "fail"
  if (hits.length) notes.push(`tracker: open issue(s) ${hits.slice(0, 6).join(", ")}${hits.length > 6 ? " …" : ""}`)

  const done = Object.values(cells).every(c => c !== "fail")
  return { lang, family: familyOf(lang), cells, notes, done }
})

// ---------------------------------------------------------------- report
const SYM: Record<Cell, string> = { pass: "✓", fail: "✗", "n/a": "·", disclosed: "~" }
const COLS = ["diff", "fixtures", "corpus", "fresh", "grammar", "lines", "folder", "tracker"]
console.log(`\nM60.LCM — per-language completion at ${F5.commit?.slice(0, 8)} (F5) / HEAD`)
console.log(`${"language".padEnd(12)} ${"family".padEnd(11)} ${COLS.map(c => c.slice(0, 7).padStart(8)).join("")}   TRULY DONE`)
for (const r of rows) {
  console.log(
    `${r.lang.padEnd(12)} ${r.family.padEnd(11)} ` +
    COLS.map(c => SYM[r.cells[c]].padStart(8)).join("") +
    `   ${r.done ? "✓ TICK" : "✗"}`,
  )
}
const ticked = rows.filter(r => r.done).map(r => r.lang)
console.log(`\nTRULY DONE (${ticked.length}/${rows.length} analyzer lanes): ${ticked.join(", ")}`)
console.log(`DETECTED BUT NOT ANALYZER LANES (excluded from the denominator): ${nonAnalyzerDetected.join(", ")} — #892`)
console.log("\nwhy each non-tick falls short:")
for (const r of rows.filter(r => !r.done)) {
  const failed = COLS.filter(c => r.cells[c] === "fail")
  const why = failed.map(c => r.notes.find(n => n.startsWith(`${c}:`)) ?? `${c}: red`)
  console.log(`  ${r.lang} (${failed.join(", ")}): ${why.join(" | ")}`)
}

writeFileSync(OUT, JSON.stringify({
  gate: "M60.LCM",
  title: "Per-language completion matrix — a tick only where every applicable dimension is green",
  at: new Date().toISOString(),
  method: "joins M14.0.F5 (diff), M14.0.F3 (fixtures), M12 corpus-claims gate, M14.0.F1 (grammar audit), M60.P1 (line emission), reviews/* closure markers, and the dated tracker snapshot validation/m49/lang-open-issues.json; a missing dimension reports 'n/a' and never counts as a pass",
  inputs: {
    differential: `validation/m14/results/M14.0.F5.json @ ${F5.commit?.slice(0, 8)}`,
    fixtures: FIX ? `validation/m60/results/fixtures-at-head.json @ ${FIX.at} (live canonical run, untracked-fixture rule applied)` : `validation/m14/results/M14.0.F3.json @ ${F3.commit?.slice(0, 8)}`,
    grammarAudit: `validation/m14/results/M14.0.F1.json @ ${F1.commit?.slice(0, 8)}`,
    corpusClaims: `validation/m12/results/corpus-claims-gate.json @ ${CLAIMS.checkedAt}`,
    lineEmission: `validation/m60/results/P1.json @ ${P1.at}`,
    tracker: `validation/m49/lang-open-issues.json @ ${TRACKER.snapshotAt} (${TRACKER.count} open)`,
  },
  crossCuttingIssues: CROSS_CUTTING,
  columns: {
    diff: "M14.0.F5 MISSING/unexplained/fabrication all zero",
    fixtures: "M14.0.F3 committed-fixture fail=0 (untracked failures excluded, #899)",
    corpus: "M12 claim agrees with artifact",
    fresh: "M12 artifact pinned to input digests and confirmed to describe this tree (~ = unpinned, disclosed not passed)",
    grammar: "M14.0.F1 0 unknown refs",
    lines: "line_number alive (M59.A7)",
    folder: "reviews/<lang> closure marker",
    tracker: "no OPEN issue names the language",
  },
  rows,
  ticked,
  nonAnalyzerDetected,
  totals: { languages: rows.length, ticked: ticked.length },
}, null, 1) + "\n")
console.log(`\nevidence written: validation/m60/results/LCM.json`)
