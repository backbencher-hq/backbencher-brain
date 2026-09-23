// script/m60/target-spelling-census.ts — the "target spelling" family census (R10).
//
// WHY THIS EXISTS
// ---------------
// The differential oracle is the family's strongest instrument and it is
// STRUCTURALLY BLIND to one class: a spelling that BOTH sides fabricate
// IDENTICALLY. The oracle derives its truth from the same rules the analyzer
// runs, so when a rule publishes a member name that is not a name at all —
// php's `$o->{'lit'}` publishing the string literal `'lit'`, `$o->{2}`
// publishing `2` — the two sides agree, every per-edge gate reads clean, and
// the M59 line oracle confirms the token appears on the claimed line because
// the *quotes and digits* are written there. Agreement is not evidence when
// both sides compute the same wrong answer, and nothing in the family asked
// the prior question: is this target a name the language could ever declare?
//
// WHAT IS MEASURED, AND WHY THIS CALIBRATION
// ------------------------------------------
// Per lane, over real corpus files, through the lane's REAL analyzer (ASTEngine,
// the same entry every other instrument uses), this census collects:
//
//     symbols       every symbol NAME the lane itself publishes for those files
//     alphabet      the set of characters occurring in those names, with the
//                   number of distinct symbol names each character occurs in
//     targets       every relationship TARGET the lane publishes
//
// and then asks of each target only the question the lane's own output can
// answer. Two classes, deliberately separated because they carry different
// certainty:
//
//   CONVICTING — a spelling no language in the family can declare:
//
//   literal            the target is ENTIRELY a quoted string (`'lit'`) or a
//                      bare number (`2`). This is the class php's `$o->{'lit'}` /
//                      `$o->{2}` belonged to. No calibration is involved and no
//                      false positive is possible.
//   whitespace         the target contains a space, tab or newline. No identifier
//                      in any of these 19 languages may contain whitespace, so a
//                      target with a space is source text or an expression, never a
//                      name (cpp's `functional  // std::reference_wrapper`, scala's
//                      `Sync with MonadCancel.Uncancelable`, kotlin's
//                      `tester.selectAll().where {...}.single()`).
//   delimiter          the target contains `;`, `(`, `)`, `{`, `}` or `,` —
//                      statement and grouping syntax, never part of a name.
//
//   REPORTED, NEVER CONVICTED — `separator`: the target carries a non-alphanumeric
//   character that occurs in NONE of the lane's own symbol names, but that the
//   languages legitimately use inside a qualified name (`io:format`, `clojure.string/join`,
//   `UIKit/UIKit.h`, `@version`, `:sets.new`, `Class.member`). The first version of
//   this census convicted that class and the measurement refuted it: 21 of 24 lanes
//   carry it, so an allowlist per lane would have laundered every real finding along
//   with the conventions. It is reported with its counts and its (lang, type, char)
//   triples are DECLARED in the register, so a lane that starts emitting a NEW
//   separator drops out of the register and fails — the register is the gate, the
//   conviction classes above are the alarm.
//
//   Two characters were REMOVED from an earlier draft of the convicting set for the
//   same reason, both by measurement rather than by taste: quotes (erlang's
//   `'tpl_prv':init` is a quoted atom and haskell's `structureHash'` is a name) and
//   brackets (ruby's own method `Hash.[]` is spelled with them). Both stay in the
//   reported class, where the lane's own alphabet decides. Convicting them would have
//   invented two defects in two lanes to catch one in php.
//
//   And one RELATIONSHIP TYPE was removed from the alarm for the same reason: an
//   `imports` / `exports` target is a module PATH, not a symbol name, and a path may
//   legitimately contain grouping punctuation and whitespace — svelte's SvelteKit
//   route groups are real directories named `(app)`/`(layout)`. Module paths stay in
//   the reported class, so their vocabulary is still pinned and a new shape still
//   drifts the register.
//
// BOUNDARIES, DISCLOSED
// ---------------------
//   * The alphabet is only as good as the sample: a lane measured on too few
//     files can have an under-populated alphabet, which is why every row
//     carries `symbols` and `distinctSymbols` and why an alphabet built from
//     fewer than MIN_SYMBOLS distinct names cannot adjudicate that lane.
//   * Both classes judge a target by how it is SPELLED, so a lane that publishes
//     the *same* fabricated spelling under a DECLARED (lang, type, char)
//     exemption is a register question, not a census question: the register is
//     where a human ruling is visible, and it may only grow by hand.
//   * This measures SPELLING, not RESOLUTION. A target can be well-spelled and
//     still point at nothing; that is the differential's question, not this
//     one. It is admitted cross-file targets (a name written in another file)
//     that make resolution the wrong question here.
//   * Synthetic names the analyzers are entitled to publish (`?`, `constructor`,
//     `anonymous_*`, `given_N`, `this`/`super` literal targets ruled honest by
//     G2) are DECLARED in the register with a written reason, never silently
//     tolerated by a regex in this file. A synthetic spelling the register does
//     not declare is a finding, which is the point: the register may only grow
//     by hand.
//   * A corpus draw is a sample of the lane's behaviour, not its whole surface.
//     `anomalies === 0` means "no fabricated spelling in this draw", which is
//     the strongest statement the instrument can make, and the draw is pinned
//     in the artifact so a later run's different draw is a resampling, not a
//     regression.
//
// Run: bun script/m60/target-spelling-census.ts [--sample N] [--lane L]
//   → validation/m60/results/target-spelling.json
import fs from "node:fs"
import path from "node:path"
import { LANGS, LANG_REPOS, SECOND_CORPUS } from "../m14/differential.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const OUT = path.join(ROOT, "validation/m60/results/target-spelling.json")
const CORPUS_ROOT = "$HOME/fixtures/repositories"

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
// The ruled separators: the register's `rulings` map per lane, keyed
// `<relationshipType>|<char>`, whose value is a written reason or `null`
// (measured, owed, NOT blessed). Scoping a ruling to the relationship TYPE is
// deliberate — php's `overrides` targets carry `.` as a documented member
// qualifier, and that ruling must not silence a `.` in a `uses` or `calls`
// target. The register is generated by script/m60/target-spelling-register.ts
// from a census run, and only its `rulings` half is hand-written.
type Rulings = Record<string, string | null>
const REGISTER_PATH = path.join(ROOT, "validation/m60/target-spelling-register.json")
const REGISTER: Record<string, { rulings?: Rulings }> = fs.existsSync(REGISTER_PATH)
  ? JSON.parse(fs.readFileSync(REGISTER_PATH, "utf8")).lanes ?? {}
  : {}

const SAMPLE = Number(arg("--sample") ?? 40)
const SECOND_SAMPLE = Math.max(1, Math.floor(SAMPLE * 0.6))
const ONLY_LANE = arg("--lane")

// A lane whose own symbols number fewer than this many DISTINCT names has not
// exercised its alphabet enough to be adjudicated. Reporting that as
// `underdetermined` (not as clean, and not as guilty) is the honest reading:
// the measurement, not the lane, is what fell short.
const MIN_SYMBOLS = 250

/** Every file whose extension routes to the lane, in a bounded recursive walk. */
function filesFor(lang: string, repo: string, cap: number): string[] {
  const cfg = LANGS[lang]
  if (!cfg) return []
  const dir = path.join(CORPUS_ROOT, repo)
  if (!fs.existsSync(dir)) return []
  const exts = cfg.ext.split(",").map((x: string) => "." + x)
  const out: string[] = []
  const scan = (d: string) => {
    if (out.length > 4000) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (!/^(\.|node_modules|build|target|vendor)/.test(e.name)) scan(p)
      } else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
    }
  }
  scan(dir)
  // Deterministic draw: sorted, then spread across the tree (every k-th file)
  // rather than the first N, so one directory cannot decide a lane's verdict.
  out.sort()
  if (out.length <= cap) return out
  const step = out.length / cap
  return Array.from({ length: cap }, (_, i) => out[Math.floor(i * step)])
}

/** The lane's own symbol vocabulary: names, and the character counts behind them. */
function alphabetOf(names: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const n of new Set(names)) {
    for (const ch of new Set(Array.from(n as string))) {
      counts.set(ch, (counts.get(ch) ?? 0) + 1)
    }
  }
  return counts
}

async function main() {
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))

  const lanes = Object.keys(LANGS).filter((l) => LANGS[l].analyzerFile && (!ONLY_LANE || l === ONLY_LANE))
  const rows: any[] = []

  for (const lang of lanes) {
    const primary = LANG_REPOS[lang]
    const second = SECOND_CORPUS[lang]
    const draws: Array<{ repo: string; files: string[] }> = []
    for (const [repo, cap] of [
      [primary, SAMPLE],
      [second, SECOND_SAMPLE],
    ] as Array<[string | undefined, number]>) {
      if (!repo) continue
      const files = filesFor(lang, repo, cap)
      if (files.length > 0) draws.push({ repo, files })
    }
    if (draws.length === 0) {
      rows.push({ lang, verdict: "no-corpus", symbols: 0, relationships: 0 })
      console.log(`${"no-corpus".padEnd(18)} ${lang.padEnd(11)} (no corpus files present under CORPUS_ROOT)`)
      continue
    }

    const symNames: string[] = []
    const targets: Array<{ target: string; type: string; file: string }> = []
    let relationships = 0
    let parseErrors = 0
    for (const draw of draws) {
      for (const file of draw.files) {
        let src: string
        try {
          src = fs.readFileSync(file, "utf8")
        } catch {
          continue
        }
        if (src.length > 400_000) continue // a 400KB source is a generated file, not a sample
        let res: any
        try {
          res = await ASTEngine.parseFile(file, src)
        } catch {
          parseErrors++
          continue
        }
        for (const s of res?.symbols ?? []) if (s?.name) symNames.push(String(s.name))
        for (const r of res?.relationships ?? []) {
          relationships++
          if (r?.target !== undefined && r?.target !== null) {
            targets.push({ target: String(r.target), type: String(r?.type ?? "?"), file: path.relative(CORPUS_ROOT, file) })
          }
        }
      }
    }

    const alphabet = alphabetOf(symNames)
    const distinctSymbols = new Set(symNames).size

    // Class 1: the WHOLE target is a quoted string or a bare number. Written as
    // character tests rather than a regex over the target: the question is what
    // the spelling IS, not what pattern it matches.
    const isQuoted = (c: string) => c === "'" || c === '"'
    const isLiteralTarget = (t: string): boolean => {
      if (t.length >= 2 && isQuoted(t[0]) && t[t.length - 1] === t[0] && !t.slice(1, -1).includes(t[0])) return true
      let dots = 0
      for (const c of t) {
        if (c === ".") dots++
        else if (c < "0" || c > "9") return false
      }
      return t.length > 0 && dots <= 1
    }

    // Provably impossible in any of the 19 languages' identifiers. Brackets are
    // deliberately NOT here: ruby's own method `Hash.[]` is spelled with them.
    const DELIMITERS = ";(){},"
    const anomalies: Array<{ target: string; type: string; chars: string[]; klass: string; file: string }> = []
    // Every (lang, type, char) triple the lane's targets actually exercise, so the
    // register can be adjudicated exactly rather than by eyeballing samples.
    const separatorTriples: Array<{ target: string; type: string; chars: string[]; file: string }> = []
    const emptyTargets: Array<{ type: string; file: string }> = []
    const declared = REGISTER[lang]?.rulings ?? {}
    for (const t of targets) {
      if (t.target.length === 0) {
        emptyTargets.push({ type: t.type, file: t.file })
        continue
      }
      const chars = [...new Set(Array.from(t.target))]
      if (isLiteralTarget(t.target)) {
        anomalies.push({ target: t.target, type: t.type, chars: [], klass: "literal", file: t.file })
        continue
      }
      // The convicting classes are about SYMBOL NAMES. An `imports` / `exports`
      // target is a module PATH, and a path may legitimately contain grouping
      // punctuation and whitespace: svelte's SvelteKit route groups are real
      // directories named `(app)` / `(layout)`, so `import '../../routes/(app)/x.svelte'`
      // is a correctly spelled path. Convicting it would invent three defects to
      // catch none, so module paths are excluded from the ALARM and kept in the
      // reported class, where their vocabulary is still pinned by the register.
      const symbolish = t.type !== "imports" && t.type !== "exports"
      const spaces = symbolish ? chars.filter((c) => c === " " || c === "\t" || c === "\n" || c === "\r") : []
      const delims = symbolish ? chars.filter((c) => DELIMITERS.includes(c)) : []
      if (spaces.length > 0) anomalies.push({ target: t.target, type: t.type, chars: spaces, klass: "whitespace", file: t.file })
      if (delims.length > 0) anomalies.push({ target: t.target, type: t.type, chars: delims, klass: "delimiter", file: t.file })
      if (spaces.length > 0 || delims.length > 0) continue
      // The reported class: a non-alphanumeric character none of the lane's OWN
      // symbol names uses. Legitimate in qualified names, so reported only.
      const missing = chars.filter((c) => !alphabet.has(c) && !/[\p{L}\p{N}]/u.test(c))
      if (missing.length > 0) separatorTriples.push({ target: t.target, type: t.type, chars: missing, file: t.file })
    }

    // The (type, char) pairs the draw exercised, and the ones the register has not
    // ruled — the difference IS the gate: a lane that starts emitting a separator
    // no ruling covers fails until a human writes the ruling.
    const triples = [...new Set(separatorTriples.flatMap((s) => s.chars.map((c) => `${s.type}|${c}`)))].sort()
    // A triple is RULED only when the register carries a written reason for it.
    // `null` is the measured-but-owed state, which must fail exactly as an
    // absent key does.
    const unruledTriples = triples.filter((tr) => !(typeof declared[tr] === "string" && declared[tr]!.length > 0))

    // The CONVICTING classes need no alphabet — `literal`, `whitespace` and
    // `delimiter` are impossible in every language here regardless of what this
    // draw happened to declare. An earlier draft let a thin alphabet mask them,
    // so javascript's 163 convictions read as `underdetermined` — the instrument
    // excusing its own finding. Only the REPORTED separator class needs the
    // lane's symbol alphabet, so a thin draw suppresses adjudication of THAT
    // class alone and is recorded as such.
    const adjudicable = distinctSymbols >= MIN_SYMBOLS
    const verdict =
      anomalies.length > 0
        ? "fabricated-spellings"
        : !adjudicable
          ? "underdetermined"
          : unruledTriples.length > 0
            ? "unruled-separators"
            : "clean"

    rows.push({
      lang,
      verdict,
      draws: draws.map((d) => ({ repo: d.repo, files: d.files.length })),
      symbols: symNames.length,
      distinctSymbols,
      relationships,
      targets: targets.length,
      parseErrors,
      alphabet: [...alphabet.keys()].sort().join(""),
      alphabetEntries: [...alphabet.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`),
      anomalyCount: anomalies.length,
      // Whether the REPORTED (separator) class could be adjudicated for this lane
      // — the convicting classes are always adjudicable.
      separatorAdjudicable: distinctSymbols >= MIN_SYMBOLS,
      byClass: anomalies.reduce((acc: Record<string, number>, a) => {
        acc[a.klass] = (acc[a.klass] ?? 0) + 1
        return acc
      }, {}),
      emptyTargetCount: emptyTargets.length,
      separatorEdges: separatorTriples.length,
      separatorTriples: triples,
      unruledTriples,
      separatorSamples: separatorTriples.slice(0, 12),
      anomalies: anomalies.slice(0, 25),
      emptyTargets: emptyTargets.slice(0, 10),
      // A BOUNDED sample plus the true count. The artifact's job is to make the
      // register's claims auditable and the vocabulary drift checkable, not to
      // carry every target: a bounded sample with the count beside it says the same
      // thing without putting a megabyte of evidence in the tree, and the census
      // re-runs in about a minute when a ruling needs the full list.
      distinctTargets: new Set(targets.map((t) => t.target)).size,
      sampleTargets: [...new Set(targets.map((t) => t.target))].slice(0, 120),
    })

    const byChar = [...new Set(anomalies.flatMap((a) => a.chars))].sort().join("")
    const klassCounts = anomalies.reduce((acc: Record<string, number>, a) => {
      acc[a.klass] = (acc[a.klass] ?? 0) + 1
      return acc
    }, {})
    console.log(
      `${verdict.padEnd(21)} ${lang.padEnd(11)} syms=${String(distinctSymbols).padStart(5)} rels=${String(relationships).padStart(6)} anomalies=${String(anomalies.length).padStart(4)}${Object.keys(klassCounts).length ? ` ${JSON.stringify(klassCounts)}` : ""} sep=${String(separatorTriples.length).padStart(5)} unruled=${unruledTriples.length ? unruledTriples.join(",") : "-"}${byChar ? ` chars=[${byChar}]` : ""} draws=${draws.map((d) => `${d.repo}:${d.files.length}`).join("+")}`,
    )
    for (const a of anomalies.slice(0, 6)) console.log(`    ANOMALY ${a.klass} ${a.type} target=${JSON.stringify(a.target)} chars=${JSON.stringify(a.chars)} @ ${a.file}`)
  }

  const payload = {
    schemaVersion: 1,
    milestone: "M60",
    rule: "R10",
    purpose:
      "A relationship target must be spelled the way the lane spells its own symbols. The differential oracle derives truth from the same rules the analyzer runs, so a spelling BOTH sides fabricate identically (php's `$o->{'lit'}` publishing the string literal `'lit'`) is invisible to every per-edge gate and to the M59 line oracle: agreement is not evidence when both sides compute the same wrong answer. This census asks the prior question per lane, calibrating against the lane's OWN symbol alphabet measured at runtime over real corpora rather than a hardcoded per-language character set.",
    generatedAt: new Date().toISOString().slice(0, 10),
    boundary:
      "Measures SPELLING, not RESOLUTION: a well-spelled target that resolves to nothing is the differential's finding, not this one's. `sampleTargets` is a BOUNDED sample (120 distinct per lane) with `distinctTargets` the true count beside it, so the artifact stays auditable without carrying every target. Two classes: `literal` (the whole target is a quoted string or a bare number — no calibration needed, no false positives possible) and `punctuation` (a non-alphanumeric character occurring in none of the lane's own symbol names; alphanumerics are excluded so a character absent from a 40-file draw cannot convict). The alphabet is a sample of the lane's own symbols, so a lane under MIN_SYMBOLS distinct names reads `underdetermined` and is not adjudicated. Conventions with a separator are DECLARED in validation/m60/target-spelling-register.json scoped to (lang, relationshipType, char) with a written reason; nothing is tolerated by an implicit allowlist in this file.",
    minSymbols: MIN_SYMBOLS,
    samplePerDraw: SAMPLE,
    lanes: rows.length,
    clean: rows.filter((r) => r.verdict === "clean").map((r) => r.lang),
    unruledSeparators: rows.filter((r) => r.verdict === "unruled-separators").map((r) => r.lang),
    underdetermined: rows.filter((r) => r.verdict === "underdetermined").map((r) => r.lang),
    noCorpus: rows.filter((r) => r.verdict === "no-corpus").map((r) => r.lang),
    fabricated: rows.filter((r) => r.verdict === "fabricated-spellings").map((r) => r.lang),
    rows,
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
  console.log(
    `\n${payload.clean.length}/${payload.lanes} clean; fabricated: ${payload.fabricated.join(", ") || "none"}; unruled separators: ${payload.unruledSeparators.join(", ") || "none"}; underdetermined: ${payload.underdetermined.join(", ") || "none"}; no-corpus: ${payload.noCorpus.join(", ") || "none"}`,
  )
  console.log(`wrote ${path.relative(ROOT, OUT)}`)
}

main()
