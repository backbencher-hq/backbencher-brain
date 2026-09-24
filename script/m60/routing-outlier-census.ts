// script/m60/routing-outlier-census.ts — the "extension routed to a grammar that
// cannot represent the format" family census (M60 OO wave, #913).
//
// WHY THIS EXISTS
// ---------------
// `src/ast/language-detection.ts` routes a file to a grammar BY EXTENSION. That
// is right for a dialect and wrong for a format that merely lives beside the
// language: `.pyx`/`.pxd` are Cython — `cdef`/`cimport`/buffer syntax — not
// Python, so the Python grammar has no productions for them; `.gsp` is a Grails
// Server Page, HTML carrying `${}`/`<g:...>` tags, not Groovy source; `.lhs` is
// literate Haskell, prose with Bird tracks. The parse-success gate (#743/F10)
// measures the RESULT of that routing but reads it as a per-lane number, and a
// per-lane number cannot separate "this grammar is weak on its own language"
// from "this extension is not that language at all". #913 was found only because
// its per-extension split happened to be looked at by hand.
//
// The separating measurement is inside F10's own artifact: each row carries a
// per-extension bucket count. A lane whose canonical extension parses cleanly
// while a second extension routed to the SAME grammar fails almost totally is
// either a routing boundary or a wildly different dialect — and the difference
// between those two is a HUMAN RULING, not arithmetic. So this census keeps the
// measurement and the ruling apart:
//
//   measured   per lane, per extension: files, files with ERROR nodes, the rate,
//              and the multiples against the lane's own canonical pooled rate.
//              Pure arithmetic over the artifact. No judgement, no thresholds
//              hidden in prose.
//   declared   EXTENSION_RELATION below states, for every measured extension,
//              whether the format IS the routed language (`same-language`), is
//              a different format that happens to share the routing
//              (`other-format`), or is genuinely ambiguous and content-sniffed
//              (`ambiguous-sniff`, the `.h` header). It may only grow by hand,
//              exactly like the R10 register: an extension that appears in the
//              artifact and is NOT declared is itself a failure, so a new
//              registry entry cannot quietly acquire a routing claim.
//
// A finding is therefore BOTH: declared `other-format` AND measured as an
// outlier (>= MIN_FILES files, at least GAP_PTS absolute points and RATIO-fold
// below the lane's canonical pooled rate). `same-language` extensions that
// nevertheless diverge (`.gradle` 60 % in geb, `.cc` 34 % in fmt) are REPORTED
// with their multiples and never convicted — that divergence is a grammar gap,
// which #850/#841 own, and convicting it here would invent a routing defect.
//
// BOUNDARIES, DISCLOSED
// ---------------------
//   * Only what F10 measures. An extension routed to a wrong grammar in a lane
//     F10 does not sample is invisible here; the `unmeasured` list records the
//     suspects this census knows about (jsonc/sass/less) so they are named
//     rather than silently absent.
//   * The discriminant is a rate comparison, not a parser. A misroute whose
//     damage is under the thresholds (or under MIN_FILES — `.lhs` at 2 files
//     reads `below-floor`) is reported and cannot convict. That is deliberate:
//     the thresholds exist so a small-denominator bucket cannot manufacture a
//     finding.
//   * The canonical rate is the lane's POOLED `same-language` rate, not its
//     largest bucket. That choice is the whole point: in `cython:python` the
//     largest bucket is `.pyx` (270 files, 85.6 %), so a largest-bucket
//     baseline would have declared the lane's canonical rate to be its own
//     defect and found nothing.
//   * The `.h` bucket is content-sniffed by the harness (`detectLanguageFromPath`
//     with the file head), so its row-level language is trustworthy while this
//     script's contentless router probe is not; `.h` is declared
//     `ambiguous-sniff` and excluded from the router cross-check.
//   * The parse rates are inherited from the artifact's commit stamp, which is
//     recorded in the payload as `sourceCommit`; HEAD may have moved on. The row
//     is evidence at that commit, and the round that ACTS on a finding re-emits
//     the artifact first (the csharp lane's rule).
//
// Run: bun script/m60/routing-outlier-census.ts
//   → validation/m60/results/routing-outliers.json
// Exit: 0 no drift, 1 the finding set moved off the baseline, 2 the artifact is
// absent or unreadable ("a lane that cannot be checked is not a pass").
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const F10 = path.join(ROOT, "validation/m14/results/M14.0.F10.json")
const OUT = path.join(ROOT, "validation/m60/results/routing-outliers.json")

/** Lane-id → the id `detectLanguageFromPath` returns for that language. */
export const LANE_ROUTER_ID: Record<string, string> = { objc: "objective-c" }

export type Relation = "same-language" | "other-format" | "ambiguous-sniff"

/**
 * `retired: true` records a format the ruling DECIDED not to route at all (the #913
 * class-wide ruling, 2026-09-24). A retired extension keeps its `other-format` ruling —
 * the format still is not the language — but the router is now expected to return null
 * for it, and a bucket for it must not appear in the artifact. If one reappears, the
 * conviction rule fires unchanged: the census does not exempt what the registry once
 * refused to route.

/**
 * The declared relation of every extension this census can measure. `lang` is
 * the language the router sends the extension to (`null` for `unmeasured`
 * entries, which are declared to keep the suspect list visible). The `note` is
 * the ruling: it says WHY the format is or is not the routed language, so a
 * reader can disagree with a ruling instead of guessing at an unwritten one.
 */
export const EXTENSION_RELATION: Record<string, { relation: Relation; lang: string; note: string; retired?: boolean }> = {
  // ---- measured by F10 (every bucket must be declared; see main) ----------
  c: { relation: "same-language", lang: "c", note: "the language itself" },
  h: { relation: "ambiguous-sniff", lang: "c", note: "shared header: content decides C/C++/Objective-C (detectLanguageFromPath's .h sniff); the harness passes the head, so the row's language is the sniffed one" },
  cpp: { relation: "same-language", lang: "cpp", note: "the language itself" },
  cc: { relation: "same-language", lang: "cpp", note: "canonical C++ source spelling" },
  hpp: { relation: "same-language", lang: "cpp", note: "C++ header spelling" },
  hxx: { relation: "same-language", lang: "cpp", note: "C++ header spelling" },
  rs: { relation: "same-language", lang: "rust", note: "the language itself" },
  go: { relation: "same-language", lang: "go", note: "the language itself" },
  zig: { relation: "same-language", lang: "zig", note: "the language itself" },
  java: { relation: "same-language", lang: "java", note: "the language itself" },
  kt: { relation: "same-language", lang: "kotlin", note: "the language itself" },
  kts: { relation: "same-language", lang: "kotlin", note: "Kotlin script: same grammar, top-level statements are a Kotlin production" },
  scala: { relation: "same-language", lang: "scala", note: "the language itself" },
  sc: { relation: "same-language", lang: "scala", note: "Scala script spelling; measured 0/1" },
  groovy: { relation: "same-language", lang: "groovy", note: "the language itself" },
  gradle: { relation: "same-language", lang: "groovy", note: "RULED same-language at #850: a Gradle build script IS Groovy source (the DSL is Groovy), so its measured 34.8 %/60 % divergence is the Groovy grammar's residual (#841), not a routing defect. Reported as a rate divergence, never convicted" },
  gsp: { relation: "other-format", lang: "groovy", retired: true, note: "Groovy Server Page: an HTML document with ${}/<g:...> tags and <%--%> comments, not Groovy source. Was routed to the Groovy grammar; measured 39/39 = 100 % ERROR. RETIRED BY THE #913 CLASS-WIDE RULING (2026-09-24): no longer routed, and filed as its own issue — the sibling instance this census is what found" },
  ts: { relation: "same-language", lang: "typescript", note: "the language itself" },
  js: { relation: "same-language", lang: "javascript", note: "the language itself" },
  vue: { relation: "same-language", lang: "vue", note: "the language itself" },
  svelte: { relation: "same-language", lang: "svelte", note: "the language itself" },
  cs: { relation: "same-language", lang: "csharp", note: "the language itself" },
  dart: { relation: "same-language", lang: "dart", note: "the language itself" },
  swift: { relation: "same-language", lang: "swift", note: "the language itself" },
  m: { relation: "same-language", lang: "objective-c", note: "Objective-C implementation spelling" },
  mm: { relation: "same-language", lang: "objective-c", note: "Objective-C++ spelling, routed to the objc grammar" },
  php: { relation: "same-language", lang: "php", note: "the language itself" },
  rb: { relation: "same-language", lang: "ruby", note: "the language itself" },
  py: { relation: "same-language", lang: "python", note: "the language itself; measured 2.3 % on cython, 0 % on requests — the grammar is fine on Python" },
  pyx: { relation: "other-format", lang: "python", retired: true, note: "Cython source (`cdef`/`cpdef`/`cimport`/buffer syntax): NOT Python. Was routed to the Python grammar; measured 231/270 = 85.6 % ERROR. RETIRED BY THE #913 RULING (2026-09-24): no longer routed, so nothing claims to have analyzed it" },
  pxd: { relation: "other-format", lang: "python", retired: true, note: "Cython declaration file: a third grammar again (declarations, `cdef extern from`). Was routed to the Python grammar; measured 42/44 = 95.5 % ERROR. RETIRED BY THE #913 RULING (2026-09-24): no longer routed" },
  hs: { relation: "same-language", lang: "haskell", note: "the language itself" },
  lhs: { relation: "other-format", lang: "haskell", note: "literate Haskell: prose interleaved with Bird-track (>) or \\begin{code} blocks, not Haskell source. Routed to the Haskell grammar; measured 2/2 = 100 % ERROR, below the sample floor — reported, cannot convict" },
  ex: { relation: "same-language", lang: "elixir", note: "the language itself" },
  exs: { relation: "same-language", lang: "elixir", note: "Elixir script spelling" },
  erl: { relation: "same-language", lang: "erlang", note: "the language itself" },
  hrl: { relation: "same-language", lang: "erlang", note: "Erlang header: same syntax" },
  clj: { relation: "same-language", lang: "clojure", note: "the language itself" },
  cljc: { relation: "same-language", lang: "clojure", note: "Clojure reader-conditional source" },
  cljs: { relation: "same-language", lang: "clojure", note: "ClojureScript: the clojure grammar parses it (measured 0/20)" },
  edn: { relation: "same-language", lang: "clojure", note: "EDN is Clojure's data format, a subset of the reader: measured 0/46, so the same grammar represents it. Declared rather than assumed" },

  // ---- declared suspects this census CANNOT measure today ------------------
  // No F10 lane samples these, so no rate exists. They are named (not omitted)
  // so the gap is visible; `unmeasured` rows never convict and never pass.
  jsonc: { relation: "other-format", lang: "json", note: "JSON with comments (tsconfig.json, wrangler.jsonc): tree-sitter-json has no comment production. No json lane exists in F10 — UNMEASURED" },
  sass: { relation: "other-format", lang: "css", note: "indented-syntax Sass (no braces, no semicolons): tree-sitter-css cannot represent it. No css lane exists in F10 — UNMEASURED" },
  less: { relation: "other-format", lang: "css", note: "LESS is a CSS superset with variables/mixins; the css grammar's handling of it is unmeasured. No css lane exists in F10 — UNMEASURED" },
}

/**
 * The declared open findings. The finding set must EQUAL this set: a new finding
 * (a regression or a newly-declared format drifting) and a vanished finding (a
 * fix that did not update the baseline) both fail, so the baseline can only move
 * with a recorded ruling. `issue` is null when the tracker does not yet carry
 * the finding — that is a disclosure, not an exemption.
 */
export const BASELINE: { lang: string; ext: string; issue: number | null; note: string }[] = [
  // EMPTY BY RULING, not by silence. The three findings this census opened with —
  // python .pyx (231/270), python .pxd (42/44) and groovy .gsp (39/39) — were retired
  // on 2026-09-24: EXTENSION_LANGUAGE no longer routes any of them, so a clean
  // re-emission carries no bucket for them and the finding set is empty. The census is
  // two-sided on purpose, so emptying this list is the recorded act: if a bucket for a
  // retired extension EVER reappears at an outlier rate it is a NEW finding and exits 1,
  // and if a retired extension is still measured as a finding the entry must come back
  // with its ruling. Deleting an entry without the registry change that justifies it
  // fails the same way (see selftest cases 8-10 and 12-14).
]

/** Sample floor, absolute gap and multiple below which a bucket cannot convict. */
export const MIN_FILES = 20
export const GAP_PTS = 15
export const RATIO = 5

export type Finding = { lang: string; ext: string; files: number; errorFiles: number; rate: number; canonical: number; gap: number; ratio: number }
export type Bucket = { files: number; errorFiles: number }
export type LaneRow = { lane: string; lang: string; errPct?: number; verdict?: string; files?: number; exts?: Record<string, Bucket> }

export const key = (f: { lang: string; ext: string }) => `${f.lang}.${f.ext}`

/**
 * The lane's canonical pooled rate: every bucket whose format IS the routed
 * language (or is the content-sniffed header). Pooled over the WHOLE lane, not
 * the largest bucket — the cython lane's largest bucket is its own defect.
 * Falls back to the row's own errPct when the lane declares no canonical bucket
 * (and says so via `pooled: false`).
 */
export function canonicalRate(row: LaneRow): { canonical: number; canonicalFiles: number; pooled: boolean } {
  let files = 0
  let errors = 0
  for (const [ext, b] of Object.entries(row.exts ?? {})) {
    const rel = EXTENSION_RELATION[ext]?.relation
    if (rel === "same-language" || rel === "ambiguous-sniff") { files += b.files; errors += b.errorFiles }
  }
  if (!files) return { canonical: +Number(row.errPct ?? 0).toFixed(2), canonicalFiles: 0, pooled: false }
  return { canonical: +((errors / files) * 100).toFixed(2), canonicalFiles: files, pooled: true }
}

/**
 * The discriminant, pure. A bucket is a FINDING only when it is declared
 * `other-format` AND clears all three thresholds; a `same-language` bucket that
 * clears them is a rate divergence (a grammar gap) and a small bucket is
 * below-floor. Nothing here knows which lane it is looking at, so the rule can
 * be exercised on a synthetic row (see the self-test).
 */
export function classifyBucket(lang: string, ext: string, b: Bucket, canonical: number): { kind: "finding" | "divergence" | "below-floor" | "none"; finding?: Finding } {
  const decl = EXTENSION_RELATION[ext]
  if (!decl || decl.relation === "ambiguous-sniff") return { kind: "none" }
  const rate = b.files ? (b.errorFiles / b.files) * 100 : 0
  const gap = rate - canonical
  const ratio = canonical > 0 ? rate / canonical : rate > 0 ? Infinity : 1
  const finding: Finding = {
    lang, ext, files: b.files, errorFiles: b.errorFiles,
    rate: +rate.toFixed(1), canonical, gap: +gap.toFixed(1),
    ratio: Number.isFinite(ratio) ? +ratio.toFixed(1) : -1,
  }
  const clears = b.files >= MIN_FILES && gap >= GAP_PTS && (ratio === Infinity || ratio >= RATIO)
  if (decl.relation === "other-format") return clears ? { kind: "finding", finding } : b.files < MIN_FILES ? { kind: "below-floor", finding } : { kind: "none" }
  return clears ? { kind: "divergence", finding } : { kind: "none" }
}

/**
 * The finding set vs a baseline — the only thing that gates, in both directions.
 *
 * `driftAgainst` takes the baseline as an argument so the Vanish direction stays
 * testable while the live baseline is empty (emptied by the #913 ruling): a gate whose
 * refusals cannot be exercised is a gate that has not been tried.
 */
export function driftAgainst(findings: { lang: string; ext: string }[], baseline: { lang: string; ext: string }[]): { newFindings: string[]; vanishedFindings: string[]; drift: boolean } {
  const found = new Set(findings.map(key))
  const base = new Set(baseline.map(key))
  const newFindings = [...found].filter((k) => !base.has(k)).sort()
  const vanishedFindings = [...base].filter((k) => !found.has(k)).sort()
  return { newFindings, vanishedFindings, drift: newFindings.length > 0 || vanishedFindings.length > 0 }
}

export function computeDrift(findings: { lang: string; ext: string }[]) {
  return driftAgainst(findings, BASELINE)
}

export type RouterDisagreement = { ext: string; lang: string; routed: string | null; expected: string | null }

/**
 * Every routing claim in the relation table, checked against the LIVE registry — over
 * the WHOLE table, not only the extensions the artifact happens to sample.
 *
 * That distinction is the point. A per-bucket check can only see extensions that were
 * measured, so an extension the registry stopped routing simply disappears from the
 * artifact and is never questioned again — which is how `.gsp` stayed routed for a
 * whole wave after #850 touched the same line. A retired extension is expected to route
 * NOWHERE (the ruling's entire content is that the pipeline stops claiming it), and an
 * unmeasured-but-declared one is expected to route where its declaration says.
 */
export function routerDisagreements(router: (p: string) => string | null): RouterDisagreement[] {
  const out: RouterDisagreement[] = []
  for (const [ext, d] of Object.entries(EXTENSION_RELATION)) {
    if (d.relation === "ambiguous-sniff") continue // only the content sniff knows a header's language
    const expected = d.retired ? null : LANE_ROUTER_ID[d.lang] ?? d.lang
    const routed = router(`probe.${ext}`) ?? null
    if (routed !== expected) out.push({ ext, lang: d.lang, routed, expected })
  }
  return out
}

export function classifyLane(row: LaneRow) {
  const lang = String(row.lang)
  const buckets = Object.entries(row.exts ?? {})
  const { canonical, canonicalFiles } = canonicalRate(row)
  const findings: Finding[] = []
  const divergences: Finding[] = []
  const belowFloor: Finding[] = []
  const undeclared: { lane: string; ext: string; files: number }[] = []
  for (const [ext, b] of buckets) {
    const decl = EXTENSION_RELATION[ext]
    if (!decl) { undeclared.push({ lane: row.lane, ext, files: b.files }); continue }
    // A retired extension that reappears in the artifact is convicted by the same rule
    // as any other: retirement is a ruling about routing, not an exemption from evidence.
    const { kind, finding } = classifyBucket(lang, ext, b, canonical)
    if (kind === "finding" && finding) findings.push(finding)
    else if (kind === "divergence" && finding) divergences.push(finding)
    else if (kind === "below-floor" && finding) belowFloor.push(finding)
  }
  return { findings, divergences, belowFloor, undeclared, canonical, canonicalFiles, pooled: canonicalFiles > 0 }
}

async function main() {
  if (!existsSync(F10)) {
    console.error(`routing-outliers: cannot adjudicate — ${path.relative(ROOT, F10)} is absent (run script/m14/verify-parse-success.ts). A lane that cannot be checked is not a pass.`)
    process.exit(2)
  }
  const artifact = JSON.parse(readFileSync(F10, "utf8"))
  const rows: any[] = artifact?.data?.rows ?? []
  if (rows.length === 0) {
    console.error("routing-outliers: cannot adjudicate — the F10 artifact carries no rows.")
    process.exit(2)
  }
  const { detectLanguageFromPath } = await import(path.join(ROOT, "src/ast/language-detection.ts"))

  const findings: Finding[] = []
  const rateDivergences: Finding[] = []
  const belowFloor: Finding[] = []
  const undeclared: { lane: string; ext: string; files: number }[] = []
  const measured: Record<string, { lane: string; lang: string; files: number; errorFiles: number; rate: number; relation: Relation | "(undeclared)" }> = {}
  const lanes: any[] = []

  // The routing claims are checked ONCE, over the whole declared table — a bucket the
  // artifact no longer samples cannot be the thing that keeps the registry honest.
  const routerMismatches = routerDisagreements((p) => detectLanguageFromPath(p) as string | null)

  for (const row of rows as LaneRow[]) {
    const c = classifyLane(row)
    findings.push(...c.findings)
    rateDivergences.push(...c.divergences)
    belowFloor.push(...c.belowFloor)
    undeclared.push(...c.undeclared)
    for (const [ext, b] of Object.entries(row.exts ?? {})) {
      measured[`${row.lang}.${ext}`] = {
        lane: row.lane, lang: String(row.lang), files: b.files, errorFiles: b.errorFiles,
        rate: b.files ? +((b.errorFiles / b.files) * 100).toFixed(1) : 0,
        relation: EXTENSION_RELATION[ext]?.relation ?? "(undeclared)",
      }
    }
    lanes.push({ lane: row.lane, lang: row.lang, canonical: c.canonical, canonicalFiles: c.canonicalFiles, pooled: c.pooled, verdict: row.verdict, files: row.files })
  }

  const { newFindings, vanishedFindings: vanished, drift } = computeDrift(findings)
  // Declared suspects with no F10 sample at all: unknown, not clean. Retired
  // extensions are excluded — their absence is the ruling working, not a gap.
  const unmeasuredRows = Object.entries(EXTENSION_RELATION)
    .filter(([ext, d]) => d.relation === "other-format" && !d.retired && !Object.keys(measured).some((k) => k.endsWith(`.${ext}`)))
    .map(([ext, d]) => ({ ext, lang: d.lang, note: d.note }))
  const retiredRows = Object.entries(EXTENSION_RELATION)
    .filter(([, d]) => d.retired)
    .map(([ext, d]) => ({ ext, lang: d.lang, measured: Object.keys(measured).some((k) => k.endsWith(`.${ext}`)) }))

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    title: "Extension-routing outliers: an extension routed to a grammar that cannot represent the format",
    issueId: 913,
    purpose:
      "language-detection routes BY EXTENSION, which is right for a dialect and wrong for a format that merely lives beside the language. The parse-success artifact measures the result per lane and cannot separate 'weak grammar on its own language' from 'not that language at all'. This census compares each measured extension bucket against the lane's own pooled canonical rate and convicts only extensions DECLARED `other-format` — the ruling is data in EXTENSION_RELATION, the arithmetic is in the artifact.",
    method:
      "Reads validation/m14/results/M14.0.F10.json (per-lane, per-extension file and ERROR-node counts over digest-pinned hash-ordered corpus samples) and the live router (detectLanguageFromPath). canonical = the lane's POOLED `same-language` + `ambiguous-sniff` rate, chosen over largest-bucket so that a lane whose biggest bucket IS its defect cannot launder it. finding = declared other-format AND >= MIN_FILES files AND >= GAP_PTS absolute points AND >= RATIO-fold above canonical.",
    thresholds: { MIN_FILES, GAP_PTS, RATIO },
    sourceArtifact: path.relative(ROOT, F10),
    sourceCommit: artifact?.data?.atCommit ?? artifact?.commit ?? "(unstamped)",
    sourceGeneratedAt: artifact?.regeneratedAt ?? artifact?.committedAt ?? "(unstamped)",
    generatedAt: new Date().toISOString().slice(0, 10),
    lanes: rows.length,
    findingCount: findings.length,
    findings,
    baseline: BASELINE,
    newFindings,
    vanishedFindings: vanished,
    drift,
    undeclaredExtensions: undeclared,
    routerDisagreements: routerMismatches,
    rateDivergences: {
      note: "Declared `same-language` (the format IS the routed language) yet far above the lane's canonical rate: a GRAMMAR gap, not a routing defect. Reported so the number is visible and never convicted here.",
      rows: rateDivergences,
    },
    belowSampleFloor: {
      note: `Declared other-format but under ${MIN_FILES} files: reported, cannot convict (a small denominator cannot manufacture a finding).`,
      rows: belowFloor,
    },
    unmeasured: {
      note: "Declared other-format with no F10 lane sampling the extension: unknown, not clean. No rate exists, so nothing is claimed about it.",
      rows: unmeasuredRows,
    },
    retired: {
      note: "Ruled (2026-09-24): the format is real but no pinned grammar can represent it, so the registry does not route it and nothing claims to have analyzed it. `measured: true` would mean the artifact still carries a bucket for a retired extension — a finding, not a retirement.",
      rows: retiredRows,
    },
    measured,
    laneCanonicals: lanes,
    limitations: [
      "Only what F10 measures: an extension mis-routed in a lane F10 does not sample is invisible (see `unmeasured`).",
      "The discriminant is a rate comparison; damage under the thresholds or under MIN_FILES is reported without conviction.",
      "The relation table is a HAND-GROWN ruling set, like the R10 register — it may only grow by hand. An extension present in the artifact and absent here is a failure, so a new registry entry cannot quietly acquire a routing claim.",
      "Parse rates are inherited from the artifact's commit stamp (`sourceCommit`); HEAD may have moved. The round that ACTS on a finding re-emits the artifact first.",
      "`.h` is content-sniffed by the harness and excluded from the router cross-check: this script's contentless probe cannot know a header's language.",
    ],
  }
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")

  console.log(`extension-routing census — ${rows.length} lanes at ${String(payload.sourceCommit).slice(0, 8)}`)
  for (const f of findings) console.log(`  FINDING        ${f.lang}.${f.ext.padEnd(5)} ${f.errorFiles}/${f.files} = ${f.rate}%  vs canonical ${f.canonical}%  (${f.ratio}x, +${f.gap}pts)`)
  for (const f of rateDivergences) console.log(`  rate-divergence ${f.lang}.${f.ext.padEnd(5)} ${f.errorFiles}/${f.files} = ${f.rate}%  vs canonical ${f.canonical}%  (${f.ratio}x, +${f.gap}pts) — same-language, grammar gap not routing`)
  for (const f of belowFloor) console.log(`  below-floor     ${f.lang}.${f.ext.padEnd(5)} ${f.errorFiles}/${f.files} = ${f.rate}% (< ${MIN_FILES} files, no conviction)`)
  for (const u of unmeasuredRows) console.log(`  unmeasured      ${u.lang}.${u.ext.padEnd(5)} declared other-format, no F10 lane samples it`)
  for (const r of retiredRows) console.log(`  retired         ${r.lang}.${r.ext.padEnd(5)} ruled unroutable${r.measured ? " — STILL MEASURED, it reappeared" : " (not routed, not measured)"}`)
  for (const u of undeclared) console.log(`  UNDECLARED      ${u.lane} .${u.ext} (${u.files} files) — declare it in EXTENSION_RELATION`)
  for (const r of routerMismatches) console.log(`  ROUTER-MISMATCH .${r.ext} routes to ${r.routed}, declaration expects ${r.expected} (${r.lang})`)
  if (drift) {
    for (const k of newFindings) console.log(`  NEW FINDING     ${k} — not on the baseline`)
    for (const k of vanished) console.log(`  VANISHED        ${k} — baseline entry no longer a finding; update BASELINE with the ruling`)
  }
  console.log(`wrote ${path.relative(ROOT, OUT)}`)
  process.exit(drift || undeclared.length > 0 || routerMismatches.length > 0 ? 1 : 0)
}

// Entry guarded (C923 sweep): an unguarded call would make every future IMPORT of
// this instrument rewrite its committed artifact from whatever tree is checked out.
// `import.meta.main` is this repo's entry-point idiom.
if (import.meta.main) main()
