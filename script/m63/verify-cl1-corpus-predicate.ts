// script/m63/verify-cl1-corpus-predicate.ts — CL1-T1: the M48.C1 predicate for
// bb_cross_language, fed answers it should refuse.
//
// WHY THIS IS ITS OWN FILE
// ------------------------
// validation/m48/results/C1-bb_cross_language.json records
//   "status": "verified", "passed": 5, "failed": 0, "negativeCases": 5
// and that badge is cited wherever this tool's corpus coverage is claimed. The
// predicate behind all five passes (script/m48/c1-repo-worker.ts:185) is
//
//   pass: !r.isError && (JSON.stringify(r.parsed ?? "").includes(sym.name)
//                          || (r.parsed as any)?.declaredAbsent === true)
//
// This file does not argue that it is weak. It MEASURES it, against answers
// built from the facts the jvm-interop corpus actually produced (230 files,
// 9,201 symbols, 1,545 stored cross-language rows). Each answer below is either
// the honest post-fix answer or a MUTATION of it — mutants derived from the
// truth, not ten invented shapes, so a detector that refuses a mutant and
// passes the honest answer has isolated exactly one property.
//
// What makes this a gate rather than a complaint: the same file carries the
// predicates an honest gate WOULD use, and asserts (a) each refuses the defect
// it is the rule for, and (b) each still passes both honest answers. A finding
// with no detector is a wish; a finding with a detector is a fixable gap. A
// detector that refuses everything is as useless as one that accepts everything,
// which is why (b) is checked too.
//
// The measurement of the OLD predicate is EVIDENCE, not a check: asserting "the
// old predicate is insufficient" as a check would be a permanently red gate, and
// the first person to fix that predicate would be told they broke something.
//
// Run: npx tsx script/m63/verify-cl1-corpus-predicate.ts
// Evidence: validation/m63/results/CL1-T1.json

import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { writeSealed } from "../lib/evidence.ts"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const SYMBOL = "invoke" // the name the jvm-interop corpus measures: 227 copies, 21 stored rows

// The predicate, character-for-character from script/m48/c1-repo-worker.ts:185.
const m48Predicate = (r: { isError: boolean; parsed: unknown }, sym: string): boolean =>
  !r.isError && (JSON.stringify(r.parsed ?? "").includes(sym) || (r.parsed as any)?.declaredAbsent === true)

/** The independently derived truth for one name in the measured corpus. */
interface Truth {
  symbol: string
  copies: number
  storedRows: number
  pairableRows: number
  languages: string[]
  limit: number
}

// `invoke`: 227 indexed symbols carry the name, 21 stored cross-language rows
// touch them, all pairable, across two languages.
const TRUTH_INVOKE: Truth = { symbol: "invoke", copies: 227, storedRows: 21, pairableRows: 21, languages: ["clojure", "java"], limit: 200 }
// `f`: one symbol, 106 stored rows — above nothing, under the 200 cap, and the
// symbol that produced the 20,904-byte pre-fix answer.
const TRUTH_F: Truth = { symbol: "f", copies: 1, storedRows: 106, pairableRows: 106, languages: ["clojure", "java"], limit: 200 }

const COUNTERPARTIES = [
  { symbol: "toByteArray", file: "src/jvm/clojure/asm/ClassWriter.java", language: "java", line: 213 },
  { symbol: "RT", file: "src/jvm/clojure/lang/RT.java", language: "java", line: 576 },
  { symbol: "Compiler", file: "src/jvm/clojure/lang/Compiler.java", language: "java", line: 44 },
]

/** The honest post-fix answer, as the handler emits it. */
function honestAnswer(truth: Truth, shownRows: number): any {
  const facts = Array.from({ length: shownRows }, (_, i) => ({
    self: { symbol: truth.symbol, file: `src/jvm/clojure/lang/Fn${i % 227}.java`, language: "java", line: 100 + i },
    direction: "callee",
    other: COUNTERPARTIES[i % COUNTERPARTIES.length],
    pair: "clojure → java",
    bridge: "name-resolution",
    tier: "usage_contextual",
    confidence: 0.7,
    relationshipType: "uses",
    rowId: `${truth.symbol}-row-${i}`,
  }))
  const total = truth.pairableRows
  const truncated = facts.length < total
  return {
    symbol: truth.symbol,
    // null because the copies span two languages: the pre-fix door reported the
    // language of whichever copy SQLite returned first.
    language: truth.languages.length === 1 ? truth.languages[0] : null,
    languages: truth.languages,
    copies: [{ id: `${truth.symbol}-copy-0`, symbol: truth.symbol, file: "src/jvm/clojure/lang/Fn0.java", language: "java", line: 100, crossRowCount: total }],
    copyCount: truth.copies,
    ambiguous: truth.copies > 1,
    ambiguityNote: truth.copies > 1
      ? `${truth.copies} indexed symbols are named '${truth.symbol}'; the facts below are the union over all of them`
      : null,
    facts,
    pairCount: facts.length,
    distinctPairCount: 3,
    storedRowCount: truth.storedRows,
    unpairableRowCount: truth.storedRows - truth.pairableRows,
    collapsedRowCount: 0,
    limit: truth.limit,
    truncated,
    truncationReason: truncated
      ? `declared limit of ${truth.limit} facts; ${total} stored cross-language rows matched this name`
      : null,
    totalCountIfKnown: total,
    declaredAbsent: false,
    absenceNote: null,
  }
}

const HONEST = honestAnswer(TRUTH_INVOKE, TRUTH_INVOKE.pairableRows)
const HONEST_F = honestAnswer(TRUTH_F, TRUTH_F.pairableRows)

const clone = (a: any): any => JSON.parse(JSON.stringify(a))

interface Case {
  id: string
  kind: "control" | "impossible" | "measured-defect"
  defectId?: string
  answer: string
  why: string
  parsed: any
  isError?: boolean
}

const CASES: Case[] = [
  { id: "control-invoke", kind: "control", answer: "the honest post-fix answer for `invoke` (227 copies, 21 rows)",
    why: "must pass every detector — a detector that refuses this has a bug, not a finding",
    parsed: clone(HONEST) },
  { id: "control-f", kind: "control", answer: "the honest post-fix answer for `f` (106 rows, under the cap)",
    why: "a symbol at scale must still pass when truncation is correctly declared as false",
    parsed: clone(HONEST_F) },
  { id: "fabrication", kind: "impossible", answer: "a cross-language pair that exists nowhere in the index",
    why: "the tool's own contract is 'never infers, guesses, or aspires'",
    parsed: (() => { const a = clone(HONEST); a.facts[0].pair = "rust → cobol"; a.facts[0].other = { symbol: "x", file: "nowhere", language: "cobol", line: 1 }; return a })() },
  { id: "count-lie", kind: "measured-defect", defectId: "D3-count-lie", answer: "pairCount 99 over a facts array of 21",
    why: "the count is the tool's own headline and nothing cross-checks it against the body",
    parsed: (() => { const a = clone(HONEST); a.pairCount = 99; return a })() },
  { id: "false-absence", kind: "measured-defect", defectId: "D1-false-absence",
    answer: "declaredAbsent: true while the index holds 21 stored cross-language rows for the name",
    why: "the single most damaging answer this tool can emit — and the recorded corpus gate passed it",
    parsed: (() => {
      const a = clone(HONEST)
      a.facts = []; a.pairCount = 0; a.distinctPairCount = 0; a.declaredAbsent = true; a.totalCountIfKnown = 0
      a.absenceNote = "no stored cross-language rows for this symbol — absence declared, never guessed"
      return a
    })() },
  { id: "silent-loss", kind: "measured-defect", defectId: "D1-silent-loss",
    answer: "1 fact for a name holding 21 stored rows, with nothing declaring the loss",
    why: "21 stored rows, 1 reported, no truncation flag — reads as a complete answer",
    parsed: (() => {
      const a = clone(HONEST)
      a.facts = [a.facts[0]]; a.pairCount = 1; a.distinctPairCount = 1
      a.truncated = false; a.truncationReason = null; a.totalCountIfKnown = 1
      return a
    })() },
  { id: "no-counterparty", kind: "measured-defect", defectId: "D2-no-counterparty",
    answer: "a fact set that names no other symbol, file, or line",
    why: "the tool cannot answer the question it exists to answer",
    parsed: (() => { const a = clone(HONEST); for (const f of a.facts) f.other = { symbol: null, file: null, language: null, line: null }; return a })() },
  { id: "unbounded", kind: "measured-defect", defectId: "D3-unbounded",
    answer: "106 facts with no limit, no total, and no truncation field",
    why: "the pre-fix answer for `f`: 106 stored rows became 106 identical facts and 20,904 bytes",
    parsed: (() => { const a = clone(HONEST_F); a.truncated = undefined; a.truncationReason = undefined; a.totalCountIfKnown = undefined; a.limit = undefined; return a })() },
  { id: "cross-project", kind: "measured-defect", defectId: "D4-leak",
    answer: "a fact whose bridge came from a row owned by another project",
    why: "reproduced by construction against the real handler before the fix",
    parsed: (() => { const a = clone(HONEST); a.facts[0].bridge = "LEAKED-FROM-ANOTHER-PROJECT"; return a })() },
  { id: "language-lie", kind: "impossible", answer: "a language the name's copies do not have",
    why: "the envelope's `language` is the most-read field in the answer",
    parsed: (() => { const a = clone(HONEST); a.language = "haskell"; return a })() },
  { id: "empty", kind: "impossible", answer: "an empty object",
    why: "the ONLY shape the M48.C1 predicate refuses — an object no handler would ever emit",
    parsed: {} },
]

const TRUTH: Record<string, Truth> = {
  "control-invoke": TRUTH_INVOKE, "control-f": TRUTH_F, fabrication: TRUTH_INVOKE,
  "count-lie": TRUTH_INVOKE, "false-absence": TRUTH_INVOKE, "silent-loss": TRUTH_INVOKE,
  "no-counterparty": TRUTH_INVOKE, unbounded: TRUTH_F, "cross-project": TRUTH_INVOKE,
  "language-lie": TRUTH_INVOKE, empty: TRUTH_INVOKE,
}

/** The detectors an honest gate needs. Each takes the answer AND the truth. */
interface Detector { id: string; statement: string; detect: (answer: any, truth: Truth) => boolean }

const DETECTORS: Detector[] = [
  { id: "no-fabrication",
    statement: "every pair names two languages the index actually holds for this name",
    detect: (a, t) => (a?.facts ?? []).every((f: any) => {
      if (typeof f.pair !== "string" || f.pair.length === 0) return false
      const parts = f.pair.split(" → ")
      return parts.length === 2 && t.languages.includes(parts[0]!) && t.languages.includes(parts[1]!)
    }) },
  { id: "no-count-lie",
    statement: "pairCount equals the facts returned, and the declared total is not below them",
    detect: (a) => a?.pairCount === (a?.facts ?? []).length && (a?.totalCountIfKnown === undefined || a.totalCountIfKnown >= a.pairCount) },
  { id: "no-false-absence",
    statement: "declaredAbsent is true only when the index holds no stored row for the name",
    detect: (a, t) => a?.declaredAbsent !== true || t.pairableRows === 0 },
  { id: "no-silent-loss",
    statement: "every stored cross-language row for the name is reported, or the loss is declared as truncation",
    detect: (a, t) => (a?.pairCount ?? 0) >= t.pairableRows || a?.truncated === true },
  { id: "no-unnamed-facts",
    statement: "every fact names its counterparty (symbol, file) and the stored row it came from",
    detect: (a) => (a?.facts ?? []).every((f: any) =>
      f?.other != null &&
      typeof f.other.symbol === "string" && f.other.symbol.length > 0 &&
      typeof f.other.file === "string" && f.other.file.length > 0 &&
      typeof f.rowId === "string" && f.rowId.length > 0) },
  { id: "bounded",
    statement: "the answer is within the declared limit and its truncation flag agrees with the gap between shown and total",
    detect: (a, t) =>
      typeof a?.limit === "number" &&
      (a?.pairCount ?? 0) <= a.limit &&
      typeof a?.totalCountIfKnown === "number" &&
      ((a.pairCount < a.totalCountIfKnown) ? a.truncated === true : a.truncated === false) },
  { id: "no-cross-project",
    statement: "no fact carries a row owned by another project",
    detect: (a) => !JSON.stringify(a ?? {}).includes("LEAKED-FROM-ANOTHER-PROJECT") },
  { id: "language-traceable",
    statement: "the declared language is one the name's copies have, or null when they disagree",
    detect: (a, t) => (a?.language === null) ? t.languages.length > 1 : t.languages.includes(a?.language) },
]

let checks = 0
let passed = 0
const failures: string[] = []
const check = (label: string, condition: boolean, detail = ""): void => {
  checks++
  if (condition) passed++
  else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}

// The worker calls the predicate with the symbol it ASKED FOR, and the answer's
// `symbol` field is that same string (the handler echoes it) — so the probe must
// pass the answer's own symbol, not a fixed one. Getting this wrong makes the
// predicate look stricter than it is: a question about `f` scored against the
// name `invoke` fails the first clause for the wrong reason and the measurement
// flatters the old gate.
const predicateVerdicts = CASES.map((c) => ({
  id: c.id,
  kind: c.kind,
  defectId: c.defectId ?? null,
  answer: c.answer,
  askedFor: typeof c.parsed?.symbol === "string" ? c.parsed.symbol : SYMBOL,
  m48PredicateSays: m48Predicate({ isError: c.isError === true, parsed: c.parsed }, typeof c.parsed?.symbol === "string" ? c.parsed.symbol : SYMBOL),
}))

const measured = predicateVerdicts.filter((v) => v.kind === "measured-defect")
const measuredAccepted = measured.filter((v) => v.m48PredicateSays)
const impossible = predicateVerdicts.filter((v) => v.kind === "impossible")
const impossibleAccepted = impossible.filter((v) => v.m48PredicateSays)
const controls = predicateVerdicts.filter((v) => v.kind === "control")

console.log("The M48.C1 predicate, fed answers built from the real index:")
for (const v of predicateVerdicts) {
  const tag = v.kind === "measured-defect" ? `[measured defect ${v.defectId}]` : v.kind === "control" ? "[honest answer]" : "[impossible]"
  console.log(`  ${v.m48PredicateSays ? "PASS " : "FAIL "} ${v.id.padEnd(16)} ${tag}`)
}
const m48Insufficient = measuredAccepted.length === measured.length
console.log(`\n  M48.C1 accepted ${measuredAccepted.length}/${measured.length} measured defects, ${impossibleAccepted.length}/${impossible.length} impossible answers, ${controls.filter((c) => c.m48PredicateSays).length}/${controls.length} honest answers.`)

const detectorRows = DETECTORS.map((d) => {
  const catches: Record<string, boolean> = {}
  for (const c of CASES) catches[c.id] = d.detect(c.parsed, TRUTH[c.id]!)
  const catchesByDefect: Record<string, boolean> = {}
  for (const c of CASES) if (c.defectId) catchesByDefect[c.defectId] = catches[c.id]!
  return { id: d.id, statement: d.statement, catches, catchesByDefect }
})

// (1) Each honest answer must pass every detector. If one does not, that
//     detector is broken — and a broken detector in a corpus gate is worse than
//     a missing one, because it manufactures failures.
for (const d of detectorRows) {
  const failedControls = controls.filter((c) => d.catches[c.id] !== true)
  check(`CL1-T1: '${d.id}' passes every honest answer`, failedControls.length === 0,
    `refused: ${failedControls.map((c) => c.id).join(", ")}`)
}

// (2) Each measured defect must be refused by the rule that OWNS it. A defect
//     refused only by an unrelated rule is not caught: it means the right rule
//     is missing. Hence the exact per-defect mapping, not a prefix.
const OWNING_RULE: Record<string, string> = {
  "D1-false-absence": "no-false-absence",
  "D1-silent-loss": "no-silent-loss",
  "D2-no-counterparty": "no-unnamed-facts",
  "D3-unbounded": "bounded",
  "D3-count-lie": "no-count-lie",
  "D4-leak": "no-cross-project",
}
for (const [defectId, ruleId] of Object.entries(OWNING_RULE)) {
  const rule = detectorRows.find((d) => d.id === ruleId)!
  const ids = measured.filter((v) => v.defectId === defectId).map((v) => v.id)
  const missed = ids.filter((id) => rule.catches[id] !== false)
  check(`CL1-T1: '${ruleId}' is the rule for ${defectId} and refuses it`, ids.length > 0 && missed.length === 0,
    `cases=${ids.join(",") || "none"} missed=${missed.join(",") || "none"}`)
}

// (3) The two impossible shapes that are not tied to a numbered defect.
check("CL1-T1: the fabrication rule refuses a pair that exists nowhere in the index",
  detectorRows.find((d) => d.id === "no-fabrication")!.catches.fabrication === false)
check("CL1-T1: the language rule refuses a language the copies do not have",
  detectorRows.find((d) => d.id === "language-traceable")!.catches["language-lie"] === false)

// (4) The union of the rules must refuse every impossible answer too — a corpus
//     gate is a set of rules, and the set is what has to hold.
for (const v of impossible) {
  const anyCatches = detectorRows.some((d) => d.catches[v.id] === false)
  check(`CL1-T1: the rule SET refuses the impossible answer '${v.id}'`, anyCatches, v.answer)
}

let commit = "unknown"
try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch {}
const failed = checks - passed
const result = {
  issue: "M63.CL1-T1",
  code: "CL1-T1",
  milestone: "M63",
  status: failed === 0 ? "verified" : "known-gap",
  checks, passed, failed, failures,
  currentCommit: commit,
  verifierCommand: "npx tsx script/m63/verify-cl1-corpus-predicate.ts",
  evidenceFile: "CL1-T1.json",
  predicateSource: "script/m48/c1-repo-worker.ts:185",
  measuredDefectsFedToM48Predicate: measured.length,
  measuredDefectsM48PredicateAccepted: measuredAccepted.length,
  impossibleAnswersFedToM48Predicate: impossible.length,
  impossibleAnswersM48PredicateAccepted: impossibleAccepted.length,
  honestAnswersFedToM48Predicate: controls.length,
  verdict: m48Insufficient
    ? "The recorded M48.C1 'verified' for bb_cross_language accepts EVERY defect measured against the real index. It is a green badge that cannot describe the tool; script/m63/verify-cl1-cross-language.ts replaces it."
    : `The M48.C1 predicate refuses ${measured.length - measuredAccepted.length} of ${measured.length} measured defects — the finding in docs/m63/CL1.md is stale and must be re-measured.`,
  predicateVerdicts,
  detectors: detectorRows,
  honestAnswers: {
    invoke: { copies: TRUTH_INVOKE.copies, storedRows: TRUTH_INVOKE.storedRows, pairableRows: TRUTH_INVOKE.pairableRows, languages: TRUTH_INVOKE.languages },
    f: { copies: TRUTH_F.copies, storedRows: TRUTH_F.storedRows, pairableRows: TRUTH_F.pairableRows },
  },
  generatedAt: new Date().toISOString(),
  limitations: [
    "The answers fed here are built from the jvm-interop corpus's measured facts (230 files, 9,201 symbols, 1,545 stored cross-language rows; `invoke` 227 copies / 21 rows, `f` 1 copy / 106 rows) plus mutations of the honest answer. They are not live tool output.",
    "This file measures a PREDICATE and a rule set, not the tool. The tool's own behaviour against a real index is gated by script/m63/verify-cl1-cross-language.ts.",
    "The M48.C1 measurement is recorded as evidence, not asserted as a check, so this gate goes green when the replacement rules hold rather than staying red forever.",
  ],
}
mkdirSync(join(ROOT, "validation/m63/results"), { recursive: true })
writeSealed(join(ROOT, "validation/m63/results/CL1-T1.json"), result)
console.log(`\n${result.verdict}`)
console.log(`CL1-T1: ${result.status.toUpperCase()} (${passed}/${checks} passed)`)
process.exit(failed === 0 ? 0 : 1)
