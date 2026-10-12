#!/usr/bin/env tsx
// script/m62/verify-check-arg-order.ts — no assertion helper may be called with its
// CONDITION in the slot its signature declares as the LABEL.
//
// FOUND 2026-10-12 in script/m26/verify-impact-mode.ts. That file declares
//
//   function check(label: string, condition: boolean, detail = ""): void {
//     checks++
//     if (condition) passed++
//     else console.log(`  FAIL: ${label} …`)
//   }
//
// and nine of its twenty-nine calls passed `check(condition, label, fixture, detail)`.
// That is not a cosmetic mismatch. It INVERTS THE CHECK: `condition` received the label
// STRING, a non-empty string is truthy, so all nine took the `passed++` branch
// unconditionally. Nine of twenty-nine checks in the gate could not fail, and the gate
// reported `W5: VERIFIED (29/29 passed, 19/19 mutants caught)` regardless of the engine.
//
// PROVEN BY CANARY, not by reading. With `false` hard-coded over a condition:
//
//     before the fix:  0 FAIL,  gate reported VERIFIED   (29/29 passed)
//     after  the fix:  1 FAIL,  gate reported KNOWN-GAP  (28/29 passed)
//
// WHY A TYPE ERROR ALONE WAS NOT ENOUGH — and this is the reason the gate exists rather
// than a `tsc` baseline bump.
//
//   - SIX of the nine calls passed FOUR arguments. Arity did not match the three-parameter
//     signature, so tsc reported TS2554 at each one. Visible.
//   - THREE passed EXACTLY THREE arguments — condition, label, fixture — which is
//     arity-correct for `check(label, condition, detail)`. tsc reported NOTHING. Had I only
//     worked the TS2554 list, those three would have stayed quietly green, and the count
//     would have been unchanged while three checks remained unfalsifiable.
//
// So a compiler that flags arity cannot see this class at all: the arity-correct
// instances are the ones that survive. The only thing that catches them is running the
// gate with the condition forced false.
//
// WHAT THIS GATE DETECTS, precisely. For a helper declared with a label-ish FIRST parameter
// and a condition-ish SECOND parameter, any call whose first argument is an expression that
// evaluates to a boolean rather than a message. That covers `===`, `!==`, `==`, `!=`, `<=`,
// `>=`, `&&`, `||`, `.length`, `.includes`, and a literal `true`/`false`.
//
// WHAT IT DOES NOT DETECT, stated so the number is not oversold:
//
//   - A first argument that is a BARE VARIABLE holding a boolean (`check(ok, "…")`) has no
//     operator in it, so the operator test cannot see it. `check(ok, "…")` is still wrong,
//     and this gate will not tell you so.
//   - A helper whose parameter names are not label-ish/condition-ish (e.g. `(a, b)`) is
//     skipped entirely rather than guessed at.
//   - A helper that is imported from elsewhere. This is a same-file, local-declaration
//     check. An inverted call into a shared helper in another module is invisible here.
//
// Those are real limits. They are the reason this gate is not a proof that the class is
// gone; they are what remains after it goes green.
//
// Strings are KEPT while comments are blanked, because a correct call's first argument IS a
// string literal and blanking it would hide the very thing being checked for. The
// self-tests below prove both halves of that: a correct string-first call is not reported,
// and a comment that quotes the pattern is not reported either.

import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()
const { walkSourceFiles, blankCommentsAndStrings } = await import("./path_encoding_scan.ts")

// Helpers whose first parameter is a message. Deliberately a small explicit list: a
// broad heuristic would report calls that are correct, and this session has already paid
// for that twice (verify-indexer-option-contract.ts and verify-esm-only-globals.ts both
// learned it by flagging correct fixtures).
const HELPERS = new Set(["check", "ck", "assert", "expect", "assertTrue", "expectTrue", "requireOk"])

// A parameter name that means "a message to print when this fails".
const LABELISH = /label|msg|message|desc|description|name|title|text|why|what|tag/i
// A parameter name that means "did it hold".
const CONDISH = /cond|ok|pass|truth|holds|hold|result|valid|satisf|actual|should|expected/i

/**
 * Split on top-level commas and return each argument's [start, end) offsets into the
 * given slice. Run this on BLANKED source, where string content is already whitespace: a
 * comma inside a string literal is a space there, so it cannot be mistaken for a separator,
 * and a `${…}` interpolation survives as real code with its commas correctly nested inside
 * braces. The offsets are then used to slice the ORIGINAL text, which is what tells a
 * string literal from a boolean expression.
 */
function splitArgRanges(body: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  let start = 0
  let depth = 0
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!
    if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") depth--
    else if (c === "," && depth === 0) {
      ranges.push({ start, end: i })
      start = i + 1
    }
  }
  // Only a trailing all-whitespace remainder is dropped — that is what a trailing comma
  // leaves behind.
  //
  // Every OTHER comma-delimited piece is kept even when it is blank. This is the second
  // version of the same mistake in this one detector: the first version skipped pieces
  // whose blanked text was whitespace, reasoning that an empty range was not an argument.
  // But a string literal IS an argument, and on BLANKED source a string literal IS
  // whitespace. Skipping those ranges made `args[0]` the SECOND argument of every correct
  // `check("the label", condition)` call, so the gate reported every one of them as
  // inverted — 6148 hits across 479 files, with three of the self-tests inverted alongside.
  if (body.slice(start).trim()) ranges.push({ start, end: body.length })
  return ranges
}

/**
 * From an open paren, return the index just past the matching close paren. Run this on
 * BLANKED source, where every quote and string body is already a space — so this is plain
 * bracket counting with no string case to get wrong.
 */
function matchParen(blanks: string, open: number): number {
  let depth = 0
  for (let i = open; i < blanks.length; i++) {
    const c = blanks[i]!
    if (c === "(" || c === "[" || c === "{") depth++
    else if (c === ")" || c === "]" || c === "}") {
      depth--
      if (depth === 0) return i + 1
    }
  }
  return -1
}

/** Strip a TS parameter's type annotation and default, leaving the binding name. */
function paramName(decl: string): string {
  return decl
    .split(":")[0]!
    .split("=")[0]!
    .trim()
    .replace(/^\.\.\./, "")
    .replace(/^[{[]/, "")
    .trim()
}

/**
 * Does this helper declare (message, condition)? Only then is a non-string first
 * argument a defect rather than a choice. Runs on blanked source so a signature quoted
 * inside a doc string is not mistaken for a real declaration.
 */
function declaresLabelFirst(blanks: string, name: string): boolean {
  const consider = (open: number): boolean => {
    const end = matchParen(blanks, open)
    if (end < 0) return false
    // splitArgRanges returns offsets RELATIVE TO THE SLICE IT WAS GIVEN, so the params
    // must be sliced out of `body`. Slicing them out of `blanks` instead reads from the
    // top of the file: `blanks.slice(params[0].start, params[0].end)` yielded "function
    // check" for a `check(label: string, …)` declaration, so declaresLabelFirst answered
    // false for every helper and the sweep reported ZERO inverted calls across 4601 files
    // — a gate that reads nothing and calls the tree clean, which is the exact failure
    // mode that produced the path-encoding gate in this session.
    const body = blanks.slice(open + 1, end - 1)
    const params = splitArgRanges(body)
    if (params.length < 2) return false
    const first = paramName(body.slice(params[0]!.start, params[0]!.end))
    const second = paramName(body.slice(params[1]!.start, params[1]!.end))
    return LABELISH.test(first) && CONDISH.test(second)
  }

  for (const m of blanks.matchAll(new RegExp(`function\\s+${name}\\s*\\(`, "g"))) {
    if (consider(blanks.indexOf("(", m.index))) return true
  }

  // An arrow helper, allowing a return-type annotation between the parameter list and
  // `=>` — `(name: string, ok: boolean): void =>` is the shape most gates actually use, and
  // a regex that required `) =>` silently matched nothing and made this whole branch look
  // like it had found no arrow helpers rather than like it had failed to look.
  for (const m of blanks.matchAll(new RegExp(`const\\s+${name}\\s*(?::[^=]*?)?=\\s*\\(`,"g"))) {
    const open = blanks.indexOf("(", m.index)
    const end = matchParen(blanks, open)
    if (end < 0) continue
    const after = blanks.slice(end).match(/^\s*(?::[^=]*?)?=>/)
    if (!after) continue
    if (consider(open)) return true
  }
  return false
}

/**
 * An expression that produces a boolean — not a message.
 *
 * The operator list is deliberately narrow. `||` and `&&` are EXCLUDED on purpose, because
 * a string fallback is both common and correct as a first argument: `check(kind || "none",
 * …)` is a message. Requiring a comparison, a length, or a collection predicate keeps this
 * honest at the cost of missing `check(someBoolCall(), …)`, which is listed in the gate's
 * own limits.
 */
function looksBoolean(a: string): boolean {
  const t = a.trim()
  if (t === "") return false
  if (t === "true" || t === "false") return true
  if (/^[!.]/.test(t)) return false
  return /===|!==|==|!=|<=|>=|\.length\b|\.includes\(|\.startsWith\(|\.every\(|\.some\(/.test(t)
}

/**
 * Report calls to a label-first helper whose first argument is a boolean expression.
 *
 * Detection runs on BLANKED source — comments and string bodies replaced by spaces, same
 * length — so a call quoted inside a comment or a doc string cannot be matched at all. The
 * argument TEXT is then sliced from the ORIGINAL source at those offsets, which is what
 * separates a string literal from a boolean expression. Running the arg split on the
 * blanked text rather than the original is also what makes the comma scan unambiguous: a
 * comma inside a string is a space in the blanked text and cannot be read as a separator.
 */
export function invertedCalls(src: string): string[] {
  const blanks = blankCommentsAndStrings(src)
  const found: string[] = []
  for (const name of HELPERS) {
    if (!declaresLabelFirst(blanks, name)) continue
    // The declaration's own parameter list is not a call.
    const declOpens = new Set<number>()
    for (const m of blanks.matchAll(new RegExp(`function\\s+${name}\\s*\\(`, "g"))) {
      declOpens.add(blanks.indexOf("(", m.index))
    }
    const callRe = new RegExp(`(?<![\\w.$])${name}\\s*\\(`, "g")
    for (const m of blanks.matchAll(callRe)) {
      const open = blanks.indexOf("(", m.index)
      if (declOpens.has(open)) continue
      const end = matchParen(blanks, open)
      if (end < 0) continue
      const body = blanks.slice(open + 1, end - 1)
      const args = splitArgRanges(body)
      if (args.length === 0) continue
      const first = src.slice(open + 1 + args[0]!.start, open + 1 + args[0]!.end).trim()
      // A string or template first argument IS the declared order.
      if (first.startsWith('"') || first.startsWith("'") || first.startsWith("`")) continue
      // The boolean test runs on the BLANKED text, not on `first`. Using the original here
      // read a label's own wording as a comparison: script/m17/verify-sec-corpus.ts:60 is
      // `ck(tag + ": persisted findings == live confirmed+mitigated", …)` and the `==` sits
      // INSIDE the string, so the gate called a concatenation a boolean expression. The
      // blanked form of that argument is `tag +`, which is not a comparison — which is the
      // answer the gate should have given all along.
      const firstBlanks = blanks.slice(open + 1 + args[0]!.start, open + 1 + args[0]!.end).trim()
      if (!looksBoolean(firstBlanks)) continue
      const line = blanks.slice(0, m.index).split("\n").length
      found.push(`line ${line}: ${name}(${first.replace(/\s+/g, " ").slice(0, 60)} …)`)
    }
  }
  return found.sort((a, b) => Number(a.match(/line (\d+)/)?.[1]) - Number(b.match(/line (\d+)/)?.[1]))
}

// --- self-tests: the detector must DISCRIMINATE, or it is decoration ---------------

check(
  "the detector SEES a condition in the label slot",
  invertedCalls(`function check(label: string, condition: boolean) { if (condition) passed++ }\ncheck(a === b, "the label", "detail")`).length === 1,
  `${invertedCalls(`function check(label: string, condition: boolean) { if (condition) passed++ }\ncheck(a === b, "the label", "detail")`).length} hit(s) for a condition-first call`,
)

check(
  "the detector does NOT fire on the declared order",
  invertedCalls(`function check(label: string, condition: boolean) { if (condition) passed++ }\ncheck("the label", a === b, "detail")`).length === 0,
  `${invertedCalls(`function check(label: string, condition: boolean) { if (condition) passed++ }\ncheck("the label", a === b, "detail")`).length} hit(s) for a correct call`,
)

check(
  "the detector SEES the ARITY-CORRECT inversion, which tsc cannot",
  invertedCalls(`function check(label: string, condition: boolean, detail = "") { if (condition) passed++ }\ncheck(a === b, "the label", "fixture/x")`).length === 1,
  `${invertedCalls(`function check(label: string, condition: boolean, detail = "") { if (condition) passed++ }\ncheck(a === b, "the label", "fixture/x")`).length} hit(s) for a 3-arg inversion — three arguments is arity-correct for this signature, so tsc is silent`,
)

check(
  "the detector reads a helper DECLARED condition-first as correct when called condition-first",
  invertedCalls(`function check(condition: boolean, label: string) { if (condition) passed++ }\ncheck(a === b, "the label")`).length === 0,
  `${invertedCalls(`function check(condition: boolean, label: string) { if (condition) passed++ }\ncheck(a === b, "the label")`).length} hit(s) when the signature itself puts the condition first`,
)

check(
  "the detector does NOT fire on a mention inside a comment",
  invertedCalls(`function check(label: string, condition: boolean) {}\n// check(a === b, "the label")\ncheck("the label", a === b)`).length === 0,
  `${invertedCalls(`function check(label: string, condition: boolean) {}\n// check(a === b, "the label")\ncheck("the label", a === b)`).length} hit(s) for a comment`,
)

check(
  "the detector does NOT fire on the pattern inside a string literal",
  invertedCalls(`function check(label: string, condition: boolean) {}\nconst doc = 'check(a === b, "the label")'\ncheck("the label", a === b)`).length === 0,
  `${invertedCalls(`function check(label: string, condition: boolean) {}\nconst doc = 'check(a === b, "the label")'\ncheck("the label", a === b)`).length} hit(s) for a doc string`,
)

check(
  "the detector sees an arrow-function helper, not only a declaration",
  invertedCalls(`const ck = (name: string, ok: boolean): void => { if (ok) passed++ }\nck(items.length === 0, "empty", "")`).length === 1,
  `${invertedCalls(`const ck = (name: string, ok: boolean): void => { if (ok) passed++ }\nck(items.length === 0, "empty", "")`).length} hit(s) for an arrow helper`,
)

check(
  "the detector does NOT fire on a helper whose parameters are not identifiable as label/condition",
  invertedCalls(`function check(a: unknown, b: unknown) {}\ncheck(a === b, "the label")`).length === 0,
  `${invertedCalls(`function check(a: unknown, b: unknown) {}\ncheck(a === b, "the label")`).length} hit(s) for an unnameable signature — skipped rather than guessed`,
)

check(
  "the detector does NOT fire on the DECLARATION itself",
  invertedCalls(`function check(label: string, condition: boolean) { if (condition) passed++ }`).length === 0,
  `${invertedCalls(`function check(label: string, condition: boolean) { if (condition) passed++ }`).length} hit(s) for a bare declaration`,
)

// --- the sweep ---------------------------------------------------------------------

const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
  scripts?: Record<string, string>
}
const chain = Object.values(pkg.scripts ?? {}).join("\n")
const suiteSrc = readFileSync(path.join(ROOT, "script/m62/verify-suite.mts"), "utf8")
const runsInChain = (rel: string): boolean => chain.includes(rel) || suiteSrc.includes(rel)

const files = [...walkSourceFiles(path.join(ROOT, "script")), ...walkSourceFiles(path.join(ROOT, "src"))]
  .filter((f) => f.endsWith(".ts") || f.endsWith(".mts"))
  .map((f) => path.relative(ROOT, f))

const offenders: Array<{ file: string; sites: string[]; inChain: boolean }> = []
for (const rel of files) {
  const src = readFileSync(path.join(ROOT, rel), "utf8")
  const sites = invertedCalls(src)
  if (sites.length > 0) offenders.push({ file: rel, sites, inChain: runsInChain(rel) })
}

check(
  "the sweep actually READ files (zero scanned means the walk failed, not that the tree is clean)",
  files.length > 0,
  `${files.length} file(s) scanned`,
)

const sites = offenders.reduce((n, o) => n + o.sites.length, 0)

check(
  "no assertion helper is called with a boolean where its signature declares the label",
  offenders.length === 0,
  offenders.length === 0
    ? `${files.length} file(s) scanned; ${sites} inverted call(s) found`
    : `*** ${sites} call(s) in ${offenders.length} file(s) pass a condition where a label is declared: ` +
      offenders
        .flatMap((o) => o.sites.map((s) => `${o.file}:${s}`))
        .slice(0, 8)
        .join(" | ") +
      `${sites > 8 ? ` (+${sites - 8} more)` : ""} ***`,
)

if (offenders.length > 0) {
  const inChain = offenders.filter((o) => o.inChain)
  console.log(`\n  run by the verify chain or the suite (${inChain.length} file(s), ${inChain.reduce((n, o) => n + o.sites.length, 0)} call(s)):`)
  for (const o of inChain) for (const s of o.sites) console.log(`    ${o.file}  ${s}`)
  if (inChain.length > 0) {
    console.log(
      "\n  A CALL IN THIS SHAPE IS NOT A COSMETIC MISMATCH. `condition` receives the label\n" +
        "  string, a non-empty string is truthy, and the check takes its PASS branch no matter\n" +
        "  what the code under test returned. The gate's own pass count then includes checks\n" +
        "  that could never fail, and a mutant planted in the code under test survives them.\n\n" +
        "  MEASURED in script/m26/verify-impact-mode.ts, which carried nine of these:\n" +
        "    before: 0 FAIL, gate reported VERIFIED  (29/29 passed, 19/19 mutants caught)\n" +
        "    after:  1 FAIL, gate reported KNOWN-GAP (28/29 passed, 19/19 mutants caught)\n" +
        "  The mutants were caught either way — by other checks — so the mutant count did not\n" +
        "  reveal it. Only forcing a condition to `false` did.",
    )
  }
  console.log(`\n  not in a chain (${offenders.length - inChain.length} file(s)).`)
}

console.log(
  "\n  WHAT THIS GATE DOES NOT SEE, restated so the green is not over-read:\n" +
    "    - a first argument that is a bare variable holding a boolean, `check(ok, \"...\")`,\n" +
    "      has no operator in it and is not reported;\n" +
    "    - a helper whose parameter names are not label-ish/condition-ish is skipped;\n" +
    "    - a helper imported from another module — this is a local-declaration check.\n" +
    "  None of those is a reason to trust the number above as proof the class is gone.",
)

const failed = checks.filter((c) => !c.ok).length
console.log(`\nCHECK ARG ORDER: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)