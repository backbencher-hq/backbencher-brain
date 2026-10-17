#!/usr/bin/env tsx
// script/m62/verify-indexer-option-contract.ts — options passed to the indexer that
// it does not accept.
//
// FOUND 2026-10-10 while working the TS2353 class: two M11 corpus gates pass
// `conflictMode: "replace"` to indexProjectParallel, and several m14 scratch scripts
// pass it too. The option appears NOWHERE under src/ — not in the options interface,
// not in the implementation, not in a destructuring. It is accepted by nobody and
// does nothing.
//
// Why this is not a type error to silence: TypeScript reports it as TS2353 in the
// two files whose call is type-checked, and stays quiet in the .mts scripts whose
// paths are looser. That asymmetry is why it survived. Deleting the option would
// make the compiler happy and would ALSO delete the evidence that these gates
// believe they are asking for replace-on-conflict semantics that never happen.
//
// WHAT THIS GATE DOES. It names every option these scripts pass that the indexer
// does not declare, and refuses to pass while any remain. It does NOT decide which
// side is wrong — see the two readings below — because that is a decision about
// what those gates are measuring, and it belongs to whoever owns them.
//
// THE TWO READINGS, neither assumed here:
//   (a) the gates want a guarantee the indexer never gave them. Then the option
//       should be DELETED, and any conclusion those gates drew from replace-on-
//       conflict is unsupported and must be re-derived.
//   (b) the option was intended and is simply unimplemented. Then it is a real
//       product gap: `bb index` has no way to say "this file replaces what you had",
//       and re-indexing a changed file may leave stale rows behind.
//
// Until one of those is settled, this gate FAILS. A gate that passes on an
// unresolved question is how a wrong measurement survives for months.

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

const ROOT = process.cwd()

// The indexer's declared option surface, read from its own options type rather
// than from a hand-kept list that could drift from the implementation.
const INDEXER = path.join(ROOT, "src/ast/parallel-indexer.ts")
const indexerSrc = readFileSync(INDEXER, "utf8")

// Options declared on the indexer's options type: `name?: ...` inside the block
// that declares it. Kept deliberately simple — this names what is DECLARED, and a
// declaration is what a caller is allowed to pass.
const declared = new Set<string>()
for (const m of indexerSrc.matchAll(/^\s{2,}([a-zA-Z][\w]*)\??\s*:/gm)) declared.add(m[1])

check(
  "the indexer's option surface could be read (a list of zero means the parse failed, not that there are none)",
  declared.size > 20,
  `${declared.size} declared option/property names read from parallel-indexer.ts`,
)

// SCAN CODE, NOT PROSE. This gate originally ran its regex over the raw file text,
// which meant a COMMENT mentioning an option counted as a call site passing it. When
// the dead `conflictMode: "replace"` was removed from five M11 corpus gates, the
// explanatory comment recording WHY it was safe to remove was immediately reported as
// a fresh violation — 5 false positives out of 9 findings, all of them my own
// explanation.
//
// Comments are not code. Strings can be the evidence (an option NAME is a string), so
// this uses the shared scanner's `keepStrings` mode rather than blanking both, which is
// the same distinction the path-encoding gate already draws.
const { walkSourceFiles, blankCommentsAndStrings } = await import("./path_encoding_scan.ts")
const callers = walkSourceFiles(path.join(ROOT, "script")).map((f) => path.relative(ROOT, f))

// The specific option this gate was written for, plus the rule: any camelCase key
// passed in an options object to the indexer must be declared by it.
const SUSPECT_OPTIONS = ["conflictMode", "replaceOnConflict", "overwrite", "forceReindex"]

// AN OPTION ONLY COUNTS WHEN IT IS INSIDE A CALL TO THE INDEXER.
//
// The first version of this gate regexed the whole file for `<option>:` and called every
// hit an indexer option. Measured 2026-10-16: 65 hits, and NONE of them was one —
// `overwrite` is a `bb_edit` write-mode option, so the 54 occurrences in script/m13 (and
// the ones in script/m71) were the editor's option being attributed to the indexer. The
// gate's claim is about options passed TO THE INDEXER, so the measurement has to be
// scoped to the indexer's call sites; an unscoped text scan is a different claim wearing
// the same headline, and it is unfalsifiable in both directions (it cannot tell the
// option that matters from the one that is fine).
//
// The call span is found by bracket balance, not by "to the end of the line": many of
// the real call sites are multi-line object literals, and a line-based span would both
// miss options placed on later lines and swallow options belonging to a sibling call.
const INDEXER_CALLS = ["indexProjectParallel", "reindexFilesParallel", "indexProject", "persistParseResult"]

/** Spans of every indexer call's argument list, in file order. */
function indexerCallSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  for (const name of INDEXER_CALLS) {
    const re = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, "g")
    for (const m of text.matchAll(re)) {
      const open = text.indexOf("(", m.index)
      let depth = 0
      let i = open
      for (; i < text.length; i++) {
        const c = text[i]
        if (c === "(") depth++
        else if (c === ")") {
          depth--
          if (depth === 0) break
        }
      }
      spans.push({ start: open, end: i })
    }
  }
  return spans.sort((a, b) => a.start - b.start)
}

/** Undeclared suspect options inside indexer call spans of one blanked source text. */
function undeclaredInIndexerCalls(text: string): Array<{ opt: string; line: number }> {
  const out: Array<{ opt: string; line: number }> = []
  for (const { start, end } of indexerCallSpans(text)) {
    const span = text.slice(start, end)
    for (const opt of SUSPECT_OPTIONS) {
      if (declared.has(opt)) continue
      const re = new RegExp(`\\b${opt}\\s*:`, "g")
      for (const m of span.matchAll(re)) {
        out.push({ opt, line: text.slice(0, start + m.index).split("\n").length })
      }
    }
  }
  return out
}

// THE DETECTOR MUST BE SHOWN ABLE TO DO BOTH THINGS: find a real indexer option, and NOT
// blame a different tool's option that shares a name. Both directions were wrong in
// production, so both are pinned here — a scoped scan that finds nothing because it is
// broken looks exactly like one that finds nothing because the tree is clean.
{
  const plantedIndexer = blankCommentsAndStrings(
    `await indexProjectParallel(pid, root, { files: [f], skipDiscovery: true, conflictMode: "replace" })\n`,
    { keepStrings: true },
  )
  const hits = undeclaredInIndexerCalls(plantedIndexer)
  check(
    "SELF-TEST: an undeclared option passed to the indexer is found",
    hits.length === 1 && hits[0]!.opt === "conflictMode",
    `${hits.length} hit(s)${hits[0] ? ` (${hits[0].opt} @ line ${hits[0].line})` : ""} — 0 would mean the scoped scan sees nothing`,
  )
  const nested = blankCommentsAndStrings(
    `await indexProjectParallel(pid, root, { files: [a, b(x)], forceReindex: true })\n`,
    { keepStrings: true },
  )
  check(
    "SELF-TEST: bracket balancing survives a nested call inside the option object",
    undeclaredInIndexerCalls(nested).length === 1,
    `${undeclaredInIndexerCalls(nested).length} hit(s) — the span must close at the CALL's paren, not the inner one`,
  )
  const editCall = blankCommentsAndStrings(
    `await executeEdit(root, pid, { mode: "write", filePath: "src/a.ts", content: "x", overwrite: true })\n`,
    { keepStrings: true },
  )
  check(
    "SELF-TEST: `overwrite` on a bb_edit call is NOT reported as an indexer option",
    undeclaredInIndexerCalls(editCall).length === 0,
    `${undeclaredInIndexerCalls(editCall).length} hit(s) — the 65-hit false-positive class this scoping exists to end`,
  )
}

const offenders: Array<{ file: string; opt: string; line: number }> = []
for (const f of callers) {
  const raw = readFileSync(path.join(ROOT, f), "utf8")
  // Blank comments, KEEP string literals — an option name in code is a string, and a
  // string inside a comment is prose that must not count.
  const text = blankCommentsAndStrings(raw, { keepStrings: true })
  for (const h of undeclaredInIndexerCalls(text)) offenders.push({ file: f, opt: h.opt, line: h.line })
}

check(
  "every indexer option passed by a gate script is DECLARED by the indexer",
  offenders.length === 0,
  offenders.length === 0
    ? `${SUSPECT_OPTIONS.length} option name(s) checked inside the indexer call sites of ${callers.length} script(s)`
    : `*** ${offenders.length} call site(s) pass an option the indexer does not accept, so it is silently ignored: ${offenders
        .slice(0, 6)
        .map((o) => `${o.file}:${o.line} (${o.opt})`)
        .join(", ")} ***`,
)

// The finding, stated whether or not the above passes, so the gate's own output
// carries the decision rather than only a count.
console.log(
  `\n  ${offenders.length} undeclared indexer option(s) inside indexer call sites.` +
    (offenders.length > 0
      ? "\n  Either the gates draw conclusions from a guarantee the indexer never gave them (delete the\n  option and re-derive those conclusions), or the option is a real product gap (bb index has no\n  way to say \"replace what you had\"). This gate stays red until one is chosen. For `conflictMode`\n  that decision was already made and measured: script/m62/verify-reindex-replaces.ts shows the\n  indexer DOES replace a file's rows, so the option was a broken attempt at a guarantee that\n  already holds, and it was removed from the sites that carried it."
      : ""),
)

const failed = checks.filter((c) => !c.ok).length
console.log(`\nINDEXER OPTION CONTRACT: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)