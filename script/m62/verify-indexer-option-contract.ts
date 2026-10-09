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

const { walkSourceFiles } = await import("./path_encoding_scan.ts")
const callers = walkSourceFiles(path.join(ROOT, "script")).map((f) => path.relative(ROOT, f))

// The specific option this gate was written for, plus the rule: any camelCase key
// passed in an options object to the indexer must be declared by it.
const SUSPECT_OPTIONS = ["conflictMode", "replaceOnConflict", "overwrite", "forceReindex"]

const offenders: Array<{ file: string; opt: string; line: number }> = []
for (const f of callers) {
  const text = readFileSync(path.join(ROOT, f), "utf8")
  for (const opt of SUSPECT_OPTIONS) {
    const re = new RegExp(`\\b${opt}\\s*:`, "g")
    for (const m of text.matchAll(re)) {
      // Skip the file that DECLARES it, if any.
      if (declared.has(opt)) continue
      offenders.push({ file: f, opt, line: text.slice(0, m.index).split("\n").length })
    }
  }
}

check(
  "every indexer option passed by a gate script is DECLARED by the indexer",
  offenders.length === 0,
  offenders.length === 0
    ? `${SUSPECT_OPTIONS.length} option name(s) checked across ${callers.length} script(s)`
    : `*** ${offenders.length} call site(s) pass an option the indexer does not accept, so it is silently ignored: ${offenders
        .slice(0, 6)
        .map((o) => `${o.file}:${o.line} (${o.opt})`)
        .join(", ")} ***`,
)

// The finding, stated whether or not the above passes, so the gate's own output
// carries the decision rather than only a count.
console.log(
  `\n  ${offenders.length} undeclared indexer option(s) in gate scripts.` +
    (offenders.length > 0
      ? "\n  Either the gates draw conclusions from a guarantee the indexer never gave them (delete the\n  option and re-derive those conclusions), or `conflictMode` is a real product gap (bb index has\n  no way to say \"replace what you had\"). This gate stays red until one is chosen."
      : ""),
)

const failed = checks.filter((c) => !c.ok).length
console.log(`\nINDEXER OPTION CONTRACT: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)