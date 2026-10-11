#!/usr/bin/env tsx
// script/m62/verify-mutant-crash-honesty.ts — a mutant that could not RUN must not
// be reported as CAUGHT.
//
// FOUND 2026-10-11, twice in one session, independently:
//
//   script/m42/verify-hub-navigation.ts
//     } catch (e) {
//       mutant(`${d.name} (mutant errored — counts as detected)`, true, ...)
//     }
//   Canary: every mutant's import pointed at a non-existent path, so none could
//   load. Result: `H6: VERIFIED (38/38 passed, 5/5 mutants caught)`  exit 0.
//
//   script/m44/verify-legend.ts
//     mutant(`${d.name} (mutant failed to load — counts as detected)`, true, ...)
//   Canary: same break. Result: `U4: VERIFIED (25/25 passed, 4/4 mutants caught)`
//   exit 0.
//
// BOTH gates reported a full catch ratio while executing nothing. The m42 file
// contradicted itself four lines earlier: "a mutant that fails to load is hollow
// evidence (it must be exercised)".
//
// WHY THIS IS A CLASS AND NOT A BUG. script/m60/objc-mutant-check.ts:29 states the
// rule outright —
//
//   "A mutant that no expectation catches is a survivor, and a survivor reported as
//    caught is the worst outcome available here, because it retires a defect class
//    that is still live."
//
// m60 follows it (survivors -> exit 1). The gates below do not. So this is not house
// style; it is a set of gates declining a rule the suite already declares, and the
// consequence is the specific failure the rule exists to prevent: a mutation suite
// whose headline number ("5/5 mutants caught") is produced by broken harnesses rather
// than by detection.
//
// A crash during EXECUTION is a different question and can be defensible — a mutant
// whose whole point is to throw will throw. What can never be evidence is a harness
// that never ran. This gate flags only the sites where the catch fires around LOADING
// or EXERCISING a mutant module, and leaves runtime-crash semantics alone.
//
// THIS GATE FAILS while any such site remains. It names them; it does not decide
// whether each individual site should be fixed the same way, because some may have a
// reason the file records and this scan cannot read intent.

import { readFileSync } from "node:fs"
import path from "node:path"

type Check = { name: string; ok: boolean; detail: string }
const checks: Check[] = []
const check = (name: string, ok: boolean, detail: string): void => {
  checks.push({ name, ok, detail })
  console.log(`  ${ok ? "ok  " : "FAIL"}: ${name} — ${detail}`)
}

// This gate stays red, and it is not in verify-suite.mts, until all 14 sites are
// fixed or individually justified. That is the declaration
// script/m62/verify-suite-coverage.ts looks for.

const ROOT = process.cwd()
const { walkSourceFiles } = await import("./path_encoding_scan.ts")

// A verdict function whose second argument decides pass/fail, and a detail string
// that admits the mutant did not run.
const VERDICT_FN = /\b(mutant|check|ck|nk|negative|assertThat)\s*\(/
const ADMITS_NOT_RUN = /failed to load|could not be judged|crashed|errored|could not be (?:exercised|run)|did not load|threw at import/i

type Site = { file: string; line: number; text: string; kind: string }

const files = walkSourceFiles(path.join(ROOT, "script"))
  .filter((f) => f.endsWith(".ts") || f.endsWith(".mts"))
  .map((f) => path.relative(ROOT, f))
  // This gate quotes the pattern it detects; scanning itself would make it永久 red.
  .filter((f) => f !== "script/m62/verify-mutant-crash-honesty.ts")

const sites: Site[] = []

for (const rel of files) {
  const lines = readFileSync(path.join(ROOT, rel), "utf8").split("\n")
  lines.forEach((line, i) => {
    const t = line.trim()
    // A catch arm (or a plain else-branch after a load failure) that records a pass.
    const isCatchArm = /^\}\s*catch\b/.test(t) || /^(else\s+)?if\s*\([^)]*err(or)?\b[^)]*\)/.test(t)
    if (!isCatchArm) return
    // Scan the arm's body.
    const arm = lines.slice(i, i + 5).join("\n")
    if (!VERDICT_FN.test(arm)) return
    if (!ADMITS_NOT_RUN.test(arm)) return
    // The verdict must be a literal true, not a computed boolean.
    const asPass = /[,(\s]true\s*[,)]/.test(arm)
    if (!asPass) return
    // Skip comment lines — a comment quoting the old code is documentation.
    const codeArm = lines
      .slice(i, i + 5)
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
      .join("\n")
    if (!VERDICT_FN.test(codeArm) || !ADMITS_NOT_RUN.test(codeArm)) return
    sites.push({ file: rel, line: i + 1, text: t.slice(0, 90), kind: "crash recorded as pass" })
  })
}

check(
  "the scan was readable (zero files scanned means the walk failed, not that the codebase is clean)",
  files.length > 500,
  `${files.length} script(s) scanned for a catch arm that records an unrun mutant as caught`,
)

check(
  "no gate records a mutant that could not RUN as CAUGHT",
  sites.length === 0,
  sites.length === 0
    ? `no site found in ${files.length} scripts`
    : `*** ${sites.length} site(s) turn a mutant that failed to load / crashed into a PASS verdict: ${sites
        .slice(0, 12)
        .map((s) => `${s.file}:${s.line}`)
        .join(", ")}${sites.length > 12 ? ` (+${sites.length - 12} more)` : ""} ***`,
)

if (sites.length > 0) {
  console.log("\n  the sites, in full:")
  for (const s of sites) console.log(`    ${s.file}:${s.line}  ${s.text}`)
  console.log(
    "\n  Each of these makes a mutation suite's headline ratio unfalsifiable: break the harness and the\n" +
      "  ratio stays perfect. m60/objc-mutant-check.ts:29 already states the rule these gates break.\n" +
      "  The m42 fix is the reference shape — record the mutant as NOT caught, and add a separate\n" +
      "  assertion that zero mutants went unexercised, since `caught >= total` is on its own\n" +
      "  satisfiable by broken harnesses alone.",
  )
}

const failed = checks.filter((c) => !c.ok).length
console.log(`\nMUTANT CRASH HONESTY: ${failed === 0 ? "PASS" : `FAILED (${failed}) — see above`}`)
process.exit(failed === 0 ? 0 : 1)