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
  // ManagedOO (the M14.4 wave, plans/M14-issues.json #264–#270): swift and
  // objc were filed under `systems` here, which contradicted the wave that
  // actually owns them AND the family the OO plan assigns its lanes to. The
  // systems family is c/cpp/go/rust/zig (the M37.19 #612 gate). Two artifacts
  // disagreeing about which family a lane belongs to is how a lane gets
  // counted twice or not at all — the seam this milestone exists to kill.
  oo: ["python", "ruby", "php", "dart", "csharp", "swift", "objc"],
  systems: ["c", "cpp", "rust", "go", "zig"],
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
  c: ["c holy", "cpp/c", "c/cpp", "c+cpp"], cpp: ["cpp", "c++"], rust: ["rust"],
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
  // #930 names php because php is where the defect was PROVEN (the only lane whose cell read
  // PASS with a whole-lane gap), but the subject is the m60 `lines` CELL WORDING: the fix
  // re-measures all 41 lanes' cells, so it is family-sweep work by the owner's lane-by-lane
  // standard, not php completion work. php's own half of #930 — the lane whose gap the weak
  // wording let through — is fixed and closed (#929, cb9f846d: 18,303/19,750 unlined -> 0).
  930: "m60 lines-cell wording: the gate asks `is line_number written anywhere` so ONE emit site satisfies it — the fix re-measures every lane's cell, so it is family work, not the named lane's completion gap",
  // #943 names php and cpp for the same reason #930 names php: they are where the defect was
  // PROVEN, not the lanes that owe the repair. The subject is the INSTRUMENT — R8 and R10
  // adjudicate a COMMITTED census artifact (php's framework surface went un-adjudicated at
  // HEAD: 0 sites, 1 binding, while every count still read clean; cpp's committed R10 row was
  // not HEAD-true) — and the remaining deliverable is a freshness device every lane's
  // census/register pair needs, which is family-sweep work. BOTH named instances were repaired
  // this round on the lane side of the line: the census's published-value vocabulary now
  // follows a COLLECTION-LITERAL ARGUMENT, so php's chain-published surface
  // (`ORDER.filter(...).concat([...detectedFrameworks])`) is a surface again — 9 sites, 52
  // bindings, 27/27 self-tests, violations unmoved at 20 — and the register was re-derived
  // from that reading (one deliberate GROWTH: php's #931 base-clause `TestCase` write); cpp's
  // row was re-derived by hand with its evidence. What is left is the staleness class itself.
  943: "M60.R8/R10 adjudicate a COMMITTED artifact: the fix is a freshness pin every lane's census/register pair needs (family sweep), and both named instances — php's un-adjudicated surface, cpp's stale R10 row — are repaired at HEAD this round",
}
// 612 is genuinely their closure gate, so it stays language-scoped.
delete CROSS_CUTTING[612]

export function trackerHits(lang: string, snapshot: any): number[] {
  const c = canon(lang)
  const aliases = TRACKER_ALIASES[c] ?? [lang]
  // A `lang:<language>` label is the STRUCTURED form of the same claim, and it
  // exists because the title-substring rule silently drops issues whose wording
  // does not happen to carry a recognized alias: #916 is a c-only defect (a bare
  // macro between a C type and its declarator costs the REAL symbol) and its title
  // carries no token from `TRACKER_ALIASES.c`, so the c cell read only #743 and
  // would have gone green with #916 still open. The token that WOULD have matched,
  // `cpp/c`, is exactly wrong here — it also matches cpp's `cpp` alias and would
  // have reddened a lane the issue does not touch. The label is additive: every
  // existing issue keeps matching by title, and no `lang:` label existed before
  // this rule, so no other lane's cell moves.
  const labelled = `lang:${c}`
  // M60 (measured 2026-09-22, the #916 close-out): a label is the STRUCTURED claim
  // and is AUTHORITATIVE when present. Additive title matching still mis-files an
  // issue whose title happens to name another lane's corpus: #916 is a c-only
  // defect, and because its title reads "… 7 sites on **sqlite** …" the `sql` cell
  // inherited it (`sql: ["sql"]` matches "sqlite") while the c lane it actually
  // blocks was reading #743 alone. So an issue carrying any `lang:*` label matches
  // by label ONLY; an issue carrying none keeps the legacy title-alias path, which
  // is every one of the pre-existing issues — so no other lane's cell moves.
  const labelLangs = (i: any) =>
    ((i.labels ?? []) as string[]).filter(l => l.startsWith("lang:")).map(l => canon(l.slice(5)))
  return snapshot.issues
    .filter((i: any) => !(i.number in CROSS_CUTTING))
    .filter((i: any) => {
      const langs = labelLangs(i)
      if (langs.length > 0) return langs.includes(c)
      return aliases.some(a => i.title.toLowerCase().includes(a))
    })
    .map((i: any) => i.number)
    .sort((a: number, b: number) => a - b)
}

// The exclusion table's own gate. A hand-written exclusion map with no test is the
// "gate that cannot fail" class this milestone keeps finding: adding issue 804 to it
// would turn a lane's own open work green, and nothing here would notice. So the
// discrimination is asserted, in both directions, on synthetic snapshots.
function trackerSelfTest(): { passed: number; failed: string[] } {
  const snap = (issues: any[]) => ({ snapshotAt: "selftest", count: issues.length, issues })
  const ISSUE = (number: number, title: string, labels: string[] = []) => ({ number, title, labels })
  const failed: string[] = []
  let passed = 0
  const check = (name: string, cond: boolean) => (cond ? passed++ : failed.push(name))
  const hits = (lang: string, issues: any[]) => trackerHits(lang, snap(issues)).join(",")

  // The namesake exclusion, and that it is SCOPED: a milestone-wide issue does not name
  // any lane, while a lane's own issue still does.
  const NAMESAKE = ISSUE(593, "M37: Dual-lens backfill of the 18 gated-done analyzers (read + census, csharp/haskell method)")
  check("namesake: #593 does not name csharp", !hits("csharp", [NAMESAKE]).includes("593"))
  check("namesake: #593 does not name haskell", !hits("haskell", [NAMESAKE]).includes("593"))
  check("namesake: the exclusion is not a blanket silence — a lane's OWN issue still matches",
    hits("csharp", [ISSUE(804, "M49.CS1 C# first review wave")]) === "804")
  check("namesake: an unrelated lane is not caught by a csharp-titled issue",
    hits("php", [ISSUE(804, "M49.CS1 C# first review wave")]) === "")
  // The label is the STRUCTURED claim and is authoritative when present.
  check("label authority: a lang:php label wins over a title that says csharp",
    hits("php", [ISSUE(9001, "M60 csharp: mislabelled", ["lang:php"])]) === "9001")
  check("label authority: that same issue does NOT match csharp",
    hits("csharp", [ISSUE(9001, "M60 csharp: mislabelled", ["lang:php"])]) === "")
  // Every exclusion carries a reason, and the table may not grow silently: an
  // exclusion is the strongest possible edit to this cell.
  const reasons = Object.entries(CROSS_CUTTING)
  check("exclusion hygiene: every exclusion states a reason",
    reasons.every(([, r]) => typeof r === "string" && r.length >= 40))
  // The membership is pinned ID BY ID rather than by size: a size cap only says "not bigger",
  // so a wave could SWAP one exclusion for another and stay green, which is exactly the
  // strongest edit this cell allows (#943 joined the table on 2026-09-25, and this line is the
  // deliberate edit that records it).
  check("exclusion hygiene: the table's membership is pinned id by id (a new exclusion is a deliberate edit here)",
    JSON.stringify(reasons.map(([n]) => Number(n)).sort((a, b) => a - b)) === JSON.stringify([593, 864, 930, 943]))
  check("exclusion hygiene: no exclusion is enumerated for a nonexistent issue id",
    reasons.every(([n]) => Number.isFinite(Number(n))))
  // The systems family's joint closure gate OPENS with c's name, and c's alias list
  // could not reach it: the older phrases need a slash (`cpp/c`) or the word holy, and
  // #612 spells the family "c+cpp+rust+go+zig". So the one systems lane that TICKED did
  // so while its family gate was open — go's alias list carried the exact string and
  // c's did not. Asserted on the real title, in both directions.
  const FAMILY = ISSUE(612, "M37.19 System family closure: c+cpp+rust+go+zig joint gates")
  check("family gate: #612 names c, its own family member", hits("c", [FAMILY]) === "612")
  check("family gate: the other four systems lanes see that same issue",
    ["cpp", "rust", "go", "zig"].every(l => hits(l, [FAMILY]) === "612"))
  check("family gate: it does not leak to a lane outside the family",
    ["python", "php", "java", "csharp"].every(l => hits(l, [FAMILY]) === ""))
  return { passed, failed }
}

const trackerSelf = trackerSelfTest()
if (trackerSelf.failed.length) {
  console.error(`tracker self-test FAILED (${trackerSelf.passed} passed, ${trackerSelf.failed.length} failed):`)
  for (const f of trackerSelf.failed) console.error(`  ${f}`)
  process.exit(1)
}
if (process.argv.includes("--self-test")) {
  console.log(`tracker self-test: ${trackerSelf.passed} passed, 0 failed`)
  process.exit(0)
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
// Depth: the canonical M14.0.F5 draw is 60 files/lane. These are deeper draws on
// the same pinned repos (200), and a lane is clean at depth only if EVERY draw is
// clean — one red draw is a defect that reproduces, not noise.
const DEPTH = exists("validation/m60/results/depth-probes.json") ? readJson("validation/m60/results/depth-probes.json") : null
// Depth residuals whose owner is the TRUTH MACHINERY, not the analyzer (see the
// depth evidence file's `adjudicated` map). Listed here so the distinction is
// explicit and auditable rather than a judgement made in the render loop.
const ORACLE_SIDE_RESIDUALS = new Set<string>(["#905", "#906"])
const depthWorst: Record<string, { maxSample: number; missing: number; unexplained: number; drawsRed: number; issue?: string }> =
  DEPTH?.worstPerLang ?? {}

if (!F5 || !F3 || !F1 || !CLAIMS || !P1 || !TRACKER) {
  console.error("missing an input artifact — refusing to compute a matrix from partial evidence")
  process.exit(5)
}

const diffReport: Record<string, any> = F5.data.report
const fixtureSummary: Record<string, { pass: number; fail: number }> = FIX?.summary ?? F3.data.summary
const untrackedFixtureFails: Record<string, number> = FIX?.untrackedFixtureFailures ?? {}
// Keyed CANONICALLY, because F1 spells a language the way its analyzer file
// does (`objective-c`) while every row here is canonicalised (`objc`). The raw
// lookup made objc's grammar cell read `n/a` while F1 held a PASS for it — a
// false unknown on the one dimension that decides whether a lane is ticked.
const grammarAudit: Record<string, any> = Object.fromEntries(
  Object.entries(F1.data.languages as Record<string, any>).map(([k, v]) => [canon(k), v]),
)
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

  const dp = depthWorst[lang]
  if (dp) {
    const clean = dp.missing === 0 && dp.unexplained === 0
    // A residual edge has an OWNER, and the owner decides the cell. An
    // analyzer-side residual is work this product owes -> fail. An ORACLE-side
    // residual (the truth derivation over-derives, the analyzer's refusal is
    // correct — #905) is truth-machinery debt, disclosed with its issue number
    // and never silently passed, but not scored as an unfinished analyzer: the
    // question this table answers is whether the LANGUAGE is done.
    const oracleSide = !!dp.issue && ORACLE_SIDE_RESIDUALS.has(dp.issue)
    cells.depth = clean ? "pass" : oracleSide ? "disclosed" : "fail"
    notes.push(clean
      ? `depth: clean on ${dp.maxSample}-file draws (canonical draw is 60)`
      : `depth: MISSING=${dp.missing} unexplained=${dp.unexplained} at ${dp.maxSample} files, red in ${dp.drawsRed} draw(s)${dp.issue ? ` — ${dp.issue} (${oracleSide ? "ORACLE-side, analyzer refusal correct" : "ANALYZER-side, work owed"})` : ""}`)
  } else { cells.depth = "n/a"; notes.push("depth: no deeper-than-canonical draw measured for this lane") }

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
const COLS = ["diff", "depth", "fixtures", "corpus", "fresh", "grammar", "lines", "folder", "tracker"]
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

// The emission is guarded: this module EXPORTS `trackerHits` so the audit that checks
// the cell can use the cell's own rule, and an import must not rewrite the artifact it
// is auditing. Measured the hard way — the audit, run from a checkout whose P1 and
// depth-probes were another lane's in-flight edits, clobbered LCM.json with those
// stamps. A reader that writes is not a reader.
if (import.meta.main) writeFileSync(OUT, JSON.stringify({
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
    depth: DEPTH ? `validation/m60/results/depth-probes.json @ ${DEPTH.at} (${DEPTH.draws?.length ?? 0} draws over ${Object.keys(DEPTH.worstPerLang ?? {}).length} lanes)` : "validation/m60/results/depth-probes.json @ absent",
    tracker: `validation/m49/lang-open-issues.json @ ${TRACKER.snapshotAt} (${TRACKER.count} open)`,
  },
  crossCuttingIssues: CROSS_CUTTING,
  // The depth column is computed from THIS map (worstPerLang), so publish it as the verdicts
  // it holds. The field used to read DEPTH?.runs — a key depth-probes.json has never had — so
  // every emission published `[]`: a citation that named the evidence and carried none. The
  // evidence file's own prose stays there; this is only what the column was computed from.
  depthProbes: Object.fromEntries(
    Object.entries(DEPTH?.worstPerLang ?? {}).map(([l, w]: [string, any]) => [
      l,
      w.missing === 0 && w.unexplained === 0
        ? `clean @${w.maxSample} files`
        : `MISSING=${w.missing} unexplained=${w.unexplained} @${w.maxSample} files${w.issue ? ` — ${w.issue}` : ""}`,
    ]),
  ),
  columns: {
    diff: "M14.0.F5 MISSING/unexplained/fabrication all zero",
    depth: "every 200-file draw on the lane's pinned repo is MISSING=0 and unexplained=0 (60 is the canonical draw)",
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
if (import.meta.main) console.log(`\nevidence written: validation/m60/results/LCM.json`)
