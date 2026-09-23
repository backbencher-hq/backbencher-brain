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

const DEFAULT_SAMPLE = 40
const SAMPLE = Number(arg("--sample") ?? DEFAULT_SAMPLE)
const SECOND_SAMPLE = Math.max(1, Math.floor(SAMPLE * 0.6))
const ONLY_LANE = arg("--lane")
// Dev-scoped runs may dump their own JSON here; the canonical artifact is only
// ever written by a full run (see the guard at the write site).
const OUT_ARG = arg("--out")

// A lane whose own symbols number fewer than this many DISTINCT names has not
// exercised its alphabet enough to be adjudicated. Reporting that as
// `underdetermined` (not as clean, and not as guilty) is the honest reading:
// the measurement, not the lane, is what fell short.
const MIN_SYMBOLS = 250

// Walk guards by name, not by pattern (R1's "no regex" applied to this
// instrument too): a directory whose name starts with `.`, or is a known build
// output, never holds the lane's source.
const SKIP_DIRS = new Set(["node_modules", "build", "target", "vendor", "dist", "out"])

/**
 * Is this character a letter or a digit (the class the `unseenAlnum` filter uses)?
 *
 * BY CHARACTER CODE, not regex. Everything outside ASCII is treated as
 * ALPHANUMERIC, which is the CONSERVATIVE direction: a non-ASCII identifier
 * character can then never be reported as an unseen separator, so the census can
 * only under-report on a corpus that spells symbols with non-ASCII letters —
 * disclosed rather than hidden, and the safe way round for an instrument whose
 * job is to convict.
 */
function isAlphanumericChar(c: string): boolean {
  const code = c.charCodeAt(0)
  if (code > 127) return true
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95
}

/** Every file whose extension routes to the lane, in a bounded recursive walk. */
// EXPORTED 2026-09-23 (M60, inverse-shape census): ONE draw rule for the family. The
// unscanned-shape census needs the same corpus file set as this census, and a second copy of
// "sorted, then every k-th file" would be free to drift — the drift class this program has
// paid for repeatedly. Consumers import this instead of re-implementing it.
export function filesFor(lang: string, repo: string, cap: number): string[] {
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
        if (!SKIP_DIRS.has(e.name) && !e.name.startsWith(".")) scan(p)
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

// ---------------------------------------------------------------- the whitespace split
//
// The `whitespace` class was convicted on a rationale stated in this file and in the
// register: "no identifier in any of these languages may contain whitespace". The
// artifact refutes it, and the refutation is the same kind the `separator` class already
// went through (that one was convicted by a first draft and the measurement took it back:
// 21 of 24 lanes carried it). Measured per target against the lane's OWN published symbol
// names (`script/m14/tmp/r10-whitespace-split-probe.ts`), a whitespace target is one of:
//
//   operatorMember    the whole target, or its last dotted segment, is `operator` +
//                     whitespace + a token. csharp `operator ==`, dart `operator ?`,
//                     swift `operator <`. This is the C2b question and it is a NAMING
//                     question, not a spelling one: the lane's own symbol is spelled
//                     that way and the containment edge agrees with it.
//   payloadSigil      the target begins with `@`: a decorator/annotation payload or a
//                     sigil-quoted identifier published as if it were a name (swift's
//                     `@available(*, deprecated, …)`, zig's `@"zls env"`). The
//                     payload is not a name in any language here; who owns that
//                     depends on whether the lane publishes it as a SYMBOL or a target.
//   matchesOwnSymbol  the string is one of the names this lane itself publishes. The
//                     lane is SELF-CONSISTENT: whatever the string is, it is the lane's
//                     answer on both sides, so a per-edge gate (and the differential,
//                     whose truth comes from the same rules) cannot adjudicate it. This
//                     is where scala's and groovy's backtick/quoted method names live
//                     (legal: the language declares identifiers containing whitespace),
//                     AND where the lanes whose published NAME carries the quoting syntax
//                     live (kotlin's name is literally `` `test char column read and write` ``, zig's is
//                     `@"zls env"`), AND where a lane that publishes an EXPRESSION as a
//                     name lands (haskell `M1 i c`, scala `A, B`). Those three need
//                     different owners, so this subclass is ROUTED, not excused.
//   sourceText        the string is not a name this lane declares at all — a comment, a
//                     call expression, a type expression. This is the genuine R10
//                     target-spelling conviction, and it is the only subclass R10 owns.
//
// Nothing here is decided by a regex over the target: the operator test is a character
// scan, and the self-consistency test is set membership against the lane's own artifact.
type WhitespaceSubclass = "operatorMember" | "payloadSigil" | "matchesOwnSymbol" | "sourceText"

function classifyWhitespace(target: string, ownSymbolNames: Set<string>): WhitespaceSubclass {
  const lastDot = target.lastIndexOf(".")
  const last = lastDot >= 0 ? target.slice(lastDot + 1) : target
  const KEYWORD = "operator"
  if (
    last.length > KEYWORD.length + 1 &&
    last.slice(0, KEYWORD.length) === KEYWORD &&
    (last.charAt(KEYWORD.length) === " " || last.charAt(KEYWORD.length) === "\t")
  ) {
    return "operatorMember"
  }
  if (target.charAt(0) === "@") return "payloadSigil"
  if (ownSymbolNames.has(target)) return "matchesOwnSymbol"
  return "sourceText"
}

// C2b — the operator-member NAMING RULING (owner decision, 2026-09-23).
//
// A whitespace-bearing operator member name (`operator ==`, `implicit Box<Plain>`,
// `operator ?`, `operator <`) is a NAMING CONVENTION of the lane's contract, not a
// fabricated spelling, so it is RULED rather than convicted. Why the ruling went this
// way, measured rather than argued:
//
//   1. It is exactly what the declaration writes. The grammar spells an operator
//      declaration `operator` + whitespace + the token, so the published name is
//      source-faithful, and the lane's own containment edge agrees with it.
//   2. The lane ALREADY publishes a whitespace-bearing operator name by design.
//      csharp's conversion operators are named `implicit Box<Plain>` — pinned in
//      validation/m14/fixtures/csharp/qualified-type-spelling.expectation.json and
//      `implicit int` in payload-and-complexity — and
//      using-alias-and-operators.expectation.json states the contract in its own
//      rationale: "every ordinary operator keeps its exact pre-R1 spelling
//      (`operator +`, `operator checked +`, `operator ==`, `implicit int`), because the
//      whole lane's expectations name these symbols". Convicting one half of that
//      convention would contradict the other half, which is pinned and mutated.
//   3. "Referenceable" was never the operative test. No source in these languages
//      references an operator member by name — operators are invoked
//      (`a == b`), never named — so the argument this class was first convicted on
//      ("a name containing whitespace can never be referenced by source") does not
//      distinguish a convention from a fabrication here.
//
// What the ruling does NOT do: stop measuring it. A ruled sub-class is still counted
// in `whitespaceSubclasses` and in `whitespaceRuled`, so the surface is pinned exactly
// (a lane that starts emitting a new operator-member shape fails the gate until the
// register is re-written), and every ruled sub-class must carry a WRITTEN REASON in the
// register — an unreasoned ruling fails, exactly like an unruled separator triple.
// The class's other three mechanisms keep their convictions.
const RULED_WHITESPACE_SUBCLASSES = new Set<WhitespaceSubclass>(["operatorMember"])

/** A whitespace target is CONVICTED unless its mechanism has been ruled a convention. */
function isConvictedWhitespace(sub: WhitespaceSubclass): boolean {
  return !RULED_WHITESPACE_SUBCLASSES.has(sub)
}

/** The split's own gate. A pure function nobody tests is a claim, not an instrument. */
function whitespaceSplitSelfTest(): { passed: number; failed: string[] } {
  const own = new Set([
    "operator ==",
    "test entity with trait property",
    "`popAll preserves iteration order`",
    "@\"zls env\"",
    "M1 i c",
  ])
  const cases: Array<[string, WhitespaceSubclass]> = [
    // the operator form, and: only when it is the whole last segment
    ["operator ==", "operatorMember"],
    ["operator !=", "operatorMember"],
    ["HttpHeaders.operator ?", "operatorMember"],
    // negatives: `operatorial x` merely starts with those letters; the bare keyword is
    // not an operator member (there is no token after it)
    ["operatorial x", "sourceText"],
    ["operator", "sourceText"],
    // payloads and sigils
    ['@available(*, deprecated, message: "Cannot be thrown")', "payloadSigil"],
    ['@"zls env"', "payloadSigil"],
    // self-consistency, in all three of its meanings
    ["test entity with trait property", "matchesOwnSymbol"],
    ["`popAll preserves iteration order`", "matchesOwnSymbol"],
    ["M1 i c", "matchesOwnSymbol"],
    // the real conviction: a string the lane never declares
    ["functional  // std::reference_wrapper", "sourceText"],
    ["getMap(f)", "sourceText"],
    ['# 7..13 is the range', "sourceText"],
    // and the control that keeps the class from being laundered: the SAME string is
    // sourceText in a lane that does not declare it, matchesOwnSymbol in one that does
    ["test entity with trait property", "matchesOwnSymbol"],
  ]
  const failed: string[] = []
  let passed = 0
  for (const [target, want] of cases) {
    const got = classifyWhitespace(target, own)
    if (got === want) passed++
    else failed.push(`${JSON.stringify(target)}: wanted ${want}, got ${got}`)
  }
  if (classifyWhitespace("test entity with trait property", new Set()) !== "sourceText") {
    failed.push("control: the same string is not sourceText for a lane that does not declare it")
  } else passed++
  // C2b: the ruling must exempt the CONVENTION and nothing else. A ruling that leaked
  // into another mechanism would launder a real fabrication, so the exemption is
  // asserted in both directions.
  const rulingCases: Array<[WhitespaceSubclass, boolean]> = [
    ["operatorMember", false],
    ["payloadSigil", true],
    ["matchesOwnSymbol", true],
    ["sourceText", true],
  ]
  for (const [sub, convicted] of rulingCases) {
    if (isConvictedWhitespace(sub) === convicted) passed++
    else failed.push(`ruling: ${sub} should be ${convicted ? "convicted" : "ruled (exempt)"}`)
  }
  return { passed, failed }
}

async function main() {
  // The split's gate, run before anything is measured: a classifier that cannot fail is not
  // an instrument, and an artifact emitted by a broken one is worse than no artifact.
  const split = whitespaceSplitSelfTest()
  console.log(`whitespace split self-test: ${split.passed} passed, ${split.failed.length} failed`)
  for (const f of split.failed) console.log(`  FAIL ${f}`)
  if (process.argv.includes("--self-test")) {
    process.exit(split.failed.length ? 1 : 0)
  }
  if (split.failed.length) {
    console.error("whitespace split self-test FAILED — refusing to write an artifact classified by it")
    process.exit(1)
  }

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
    const symNameSet = new Set(symNames)
    const distinctSymbols = symNameSet.size

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
    const anomalies: Array<{ target: string; type: string; chars: string[]; klass: string; file: string; subclass?: string }> = []
    // C2b: whitespace targets whose mechanism is a RULED convention — measured and
    // pinned exactly like the convicted ones, but not counted as a conviction.
    const ruledWhitespace: Array<{ target: string; type: string; chars: string[]; klass: string; file: string; subclass?: string }> = []
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
      if (spaces.length > 0) {
        const sub = classifyWhitespace(t.target, symNameSet)
        const anomaly = { target: t.target, type: t.type, chars: spaces, klass: "whitespace", file: t.file, subclass: sub }
        // C2b: a RULED sub-class is measured and pinned but not convicted (see the
        // ruling block above the classifier). Everything else convicts as before.
        if (isConvictedWhitespace(sub)) anomalies.push(anomaly)
        else ruledWhitespace.push(anomaly)
      }
      if (delims.length > 0) anomalies.push({ target: t.target, type: t.type, chars: delims, klass: "delimiter", file: t.file })
      if (spaces.length > 0 || delims.length > 0) continue
      // The reported class: a non-alphanumeric character none of the lane's OWN
      // symbol names uses. Legitimate in qualified names, so reported only.
      const missing = chars.filter((c) => !alphabet.has(c) && !isAlphanumericChar(c))
      if (missing.length > 0) separatorTriples.push({ target: t.target, type: t.type, chars: missing, file: t.file })
    }

    // DEBUG (temporary): the classifier's own inputs at the moment it ran, so a row that
    // cannot be reproduced in isolation can be explained by state rather than guessed at.
    if (process.argv.includes("--debug-alphabet")) {
      console.log(
        `  DBG ${lang.padEnd(10)} alphabetSize=${alphabet.size} symNames=${symNames.length} hasDot=${alphabet.has(".")} targets=${targets.length} sepPushes=${separatorTriples.length} distinctTargets=${new Set(targets.map((t) => t.target)).size}`,
      )
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
      // The whitespace class SPLIT by the mechanism that decides its owner, so the
      // register can pin the split exactly and a lane cannot move a target from
      // `sourceText` to `matchesOwnSymbol` without the gate noticing.
      // The split covers EVERY whitespace target, convicted or ruled, so the surface
      // stays pinned exactly; `whitespaceRuled` names the ruled half and
      // `byClass.whitespace` (above) counts only the convictions.
      whitespaceSubclasses: [...anomalies, ...ruledWhitespace]
        .filter((a) => a.klass === "whitespace")
        .reduce((acc: Record<string, number>, a) => {
          acc[a.subclass ?? "?"] = (acc[a.subclass ?? "?"] ?? 0) + 1
          return acc
        }, {}),
      whitespaceRuled: ruledWhitespace.reduce((acc: Record<string, number>, a) => {
        acc[a.subclass ?? "?"] = (acc[a.subclass ?? "?"] ?? 0) + 1
        return acc
      }, {}),
      whitespaceSamples: anomalies
        .filter((a) => a.klass === "whitespace")
        .slice(0, 8)
        .map((a) => ({ subclass: a.subclass, type: a.type, target: a.target.slice(0, 80), file: a.file })),
      whitespaceRuledSamples: ruledWhitespace
        .slice(0, 8)
        .map((a) => ({ subclass: a.subclass, type: a.type, target: a.target.slice(0, 80), file: a.file })),
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
    for (const a of anomalies.slice(0, 6)) {
      console.log(
        `    ANOMALY ${a.klass}${a.subclass ? `/${a.subclass}` : ""} ${a.type} target=${JSON.stringify(a.target)} chars=${JSON.stringify(a.chars)} @ ${a.file}`,
      )
    }
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
  // M60 R10 follow-up (measured the hard way): a `--lane`/`--sample` run is
  // DEV-SCOPED and must NEVER overwrite the canonical 24-lane artifact. It did:
  // `--lane groovy` replaced validation/m60/results/target-spelling.json with a
  // one-row file (8,764 deletions), which would have silently shrunk R10's claim
  // to the lane the author happened to be looking at while the gate still read
  // the (now one-lane) artifact as green. This is the same guard the M14
  // differential carries for its own artifact (M61 #886), for the same reason: a
  // scoped run is for inspecting a lane, and writing it here replaces the
  // milestone's claim with a smaller one. The scoped result is PRINTED in full
  // and offered through --out for a temp file; only a full, unfiltered run writes
  // the canonical path.
  const scoped = !!ONLY_LANE || SAMPLE !== DEFAULT_SAMPLE
  if (scoped) {
    console.log(
      `\nDEV-SCOPED run (${ONLY_LANE ? `--lane ${ONLY_LANE}` : ""}${ONLY_LANE && SAMPLE !== DEFAULT_SAMPLE ? " " : ""}${SAMPLE !== DEFAULT_SAMPLE ? `--sample ${SAMPLE}` : ""}) — the canonical ${path.relative(ROOT, OUT)} was NOT touched: it belongs to a full ${DEFAULT_SAMPLE}-file-per-draw, all-lane run, and a scoped run would replace that claim with a smaller one.`,
    )
    if (OUT_ARG) {
      fs.writeFileSync(OUT_ARG, JSON.stringify(payload, null, 2) + "\n")
      console.log(`dev-scoped rows written to ${OUT_ARG} (canonical artifact untouched)`)
    }
    return
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n")
  console.log(
    `\n${payload.clean.length}/${payload.lanes} clean; fabricated: ${payload.fabricated.join(", ") || "none"}; unruled separators: ${payload.unruledSeparators.join(", ") || "none"}; underdetermined: ${payload.underdetermined.join(", ") || "none"}; no-corpus: ${payload.noCorpus.join(", ") || "none"}`,
  )
  console.log(`wrote ${path.relative(ROOT, OUT)}`)
}

// Entry guarded: `filesFor` (the shared draw rule) is imported by the family's other
// instruments (unscanned-shape-census, c923-interface-member-census), and an unguarded call
// made every such import run all 24 lanes and REWRITE this census's committed artifact from
// whatever tree happened to be checked out. Entry points in this repo use `import.meta.main`
// (script/m13/verify-evidence.ts, src/cli/index.ts).
if (import.meta.main) main()
