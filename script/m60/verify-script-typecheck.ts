// script/m60/verify-script-typecheck.ts — typecheck the grammar-governance instruments,
// because `tsc --noEmit` does NOT do it.
//
// WHY THIS FILE EXISTS. Every commit in this work has ended with a line reading "tsc 0
// errors", and that line has been TRUE AND WORTHLESS for the m60 instruments. The
// repository's tsconfig includes only `src/**/*.ts`:
//
//     "include": ["src/**/*.ts"]
//
// so the typechecker sees 179 files under src/ and ZERO under script/. The survey builder,
// the consistency gate, the provenance census, the straggler measurement, the migration
// pre-flight — none of them have ever been typechecked by the command this repo runs to
// prove it typechecks. They ran only because Bun transpiles without checking.
//
// It cost two live bugs, and both are the kind that survive casual testing because the code
// path is rarely walked:
//
//   1. `find-grammar-provenance.ts` referenced `lane` where the loop variable is `row`. It
//      sits in a ternary fallback that only evaluates for a chain asset with no hyphen or
//      underscore in it — `dart.wasm` -> `dart`. Every hyphenated lane sailed past and the
//      census reported results; any bare-word asset would have died with a ReferenceError.
//   2. `measure-runtime-stragglers.ts` asserted `if (unparsed.length)` where `unparsed` is
//      a NUMBER. `undefined` is falsy, so assertion A5 COULD NEVER FIRE. It reads as a
//      check in the file, it is counted as one by anyone skimming, and it is dead code.
//
// The second one is the more serious, and it is the exact defect class this whole effort
// exists to eliminate: an assertion that looks present and cannot fail. The instrument's
// sabotage CONTROL had been verified repeatedly; the A5 assertion next to it had not been,
// because nothing had ever compiled it.
//
// SO THE FIX IS A GATE THAT NAMES ITS OWN SCOPE. This does not add script/ to tsconfig —
// that would sweep in 50-odd scripts owned by several agents, and turning a red typecheck
// into everyone's problem is not a call this file gets to make unilaterally. It checks the
// grammar-governance instruments explicitly, and it prints the scope it checked, because a
// typecheck gate that silently covers less than a reader assumes is the same defect wearing
// a different hat.

import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? path.dirname(process.argv[1] ?? "."), "..", "..")
const OUT = path.join(ROOT, "validation", "m60", "results", "M60.0.script-typecheck.json")

// The instruments this milestone owns, and the ONLY ones. Each was written or changed here,
// so each is a claim this milestone makes about the repo compiling — and a claim nobody
// checked until the two bugs above.
const INSTRUMENTS = [
  "script/m60/grammar-lanes-source.ts",
  "script/m60/build-grammar-survey.ts",
  "script/m60/verify-grammar-consistency.ts",
  "script/m60/selftest-grammar-consistency.ts",
  "script/m60/find-grammar-provenance.ts",
  "script/m60/measure-runtime-stragglers.ts",
  "script/m60/verify-runtime-migration-preflight.ts",
  "script/m60/verify-local-rebuilds.ts",
  "script/m60/compare-grammar-surface.ts",
]

// Flags chosen to match how Bun actually loads these: no emit, no lib checks (the tree has
// no single consistent lib set across the script/ directory), and the module/target settings
// tsconfig uses for src/.
const TSC_FLAGS = ["--noEmit", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler"]

// What `tsc --noEmit` actually covers, computed rather than asserted. If someone widens
// tsconfig to include script/, this gate should notice that its reason for existing has gone
// away, rather than quietly becoming a second, narrower copy of the main check.
function mainTypecheckScope(): { files: number; scriptFiles: number } {
  try {
    const out = execFileSync(process.execPath, [TSC_BIN!, "--listFiles", ...TSC_FLAGS.filter((f) => f !== "--noEmit")], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 600_000,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const files = out.split("\n").filter((l) => l.startsWith("/"))
    return { files: files.length, scriptFiles: files.filter((f) => f.includes("/script/")).length }
  } catch {
    // tsc exits non-zero when it finds errors, and --listFiles still printed to stdout.
    try {
      const out = execFileSync(process.execPath, [TSC_BIN!, "--listFiles", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler"], {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
        timeout: 600_000,
        stdio: ["ignore", "pipe", "ignore"],
      })
      const files = out.split("\n").filter((l) => l.startsWith("/"))
      return { files: files.length, scriptFiles: files.filter((f) => f.includes("/script/")).length }
    } catch {
      return { files: -1, scriptFiles: -1 }
    }
  }
}

const present = INSTRUMENTS.filter((f) => existsSync(path.join(ROOT, f)))
const absent = INSTRUMENTS.filter((f) => !existsSync(path.join(ROOT, f)))

let errors: Array<{ file: string; line: string; message: string }> = []
let ran = false

// Resolve the compiler by its real path, never via `npx`. Two ways this went wrong in one
// session, both of which produced a CLEAN reading from a compiler that never ran:
//
//   1. `npx tsc` resolved to the unrelated `tsc` npm package, which prints
//      "This is not the tsc command you are looking for" and exits 0 — so a grep for
//      "error TS" found nothing and the gate reported zero errors.
//   2. `node_modules` was absent from a worktree, so the same invocation failed to launch
//      and produced no output at all — again zero errors, again a false clean.
//
// A typecheck gate that cannot distinguish "no errors" from "no compiler" is worse than
// none, because it is trusted. So the compiler's existence is a precondition, checked
// before it is invoked, and its absence is a hard failure.
const TSC_BIN = [path.join(ROOT, "node_modules", "typescript", "bin", "tsc"), path.join(ROOT, "node_modules", ".bin", "tsc")].find((p) => existsSync(p)) ?? null

if (!TSC_BIN) {
  console.error(
    'script typecheck: REFUSING to report \u2014 no TypeScript compiler found.\n' +
      '  looked in: node_modules/typescript/bin/tsc and node_modules/.bin/tsc\n' +
      '  (run `bun install` in the tree you are checking).',
  )
  process.exit(2)
}

if (present.length) {
  ran = true
  try {
    execFileSync(process.execPath, [TSC_BIN, ...TSC_FLAGS, ...present], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900_000, stdio: ["ignore", "pipe", "pipe"] })
  } catch (e: any) {
    const text = String(e?.stdout ?? "") + String(e?.stderr ?? "")
    for (const line of text.split("\n")) {
      const m = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line.trim())
      if (m) errors.push({ file: path.relative(ROOT, m[1]), line: m[2], message: `${m[4]}: ${m[5]}` })
    }
    if (!errors.length && text.trim()) {
      errors.push({ file: "(tsc)", line: "?", message: text.trim().split("\n").slice(0, 4).join(" | ") })
    }
  }
}

const scope = mainTypecheckScope()
const byFile = new Map<string, number>()
for (const e of errors) byFile.set(e.file, (byFile.get(e.file) ?? 0) + 1)

const hard: string[] = []
if (absent.length) hard.push(`instruments named by this gate do not exist: ${absent.join(", ")} — either they were renamed or this gate is stale, and a gate that checks files which are gone is not a gate`)
if (errors.length) hard.push(`${errors.length} type error(s) in the grammar-governance instruments: ${[...byFile.entries()].map(([f, n]) => `${f} (${n})`).join(", ")}`)

const result = {
  schemaVersion: 1,
  gate: "m60-script-typecheck",
  checkedAt: new Date().toISOString(),
  why: "tsconfig includes only src/**/*.ts, so `tsc --noEmit` has never typechecked a single file under script/. Two live bugs lived in that gap: a ReferenceError on a rarely-taken branch, and an assertion that could never fire.",
  scope: {
    checked: present,
    notChecked: absent,
    note: "this gate deliberately covers the grammar-governance instruments ONLY. Adding script/ to tsconfig would sweep in ~50 scripts owned by several agents, and that is not this gate's call to make.",
    mainTypecheckCovers: { files: scope.files, scriptFiles: scope.scriptFiles },
    mainTypecheckGap: scope.scriptFiles === 0 ? "CONFIRMED: `tsc --noEmit` covers 0 files under script/. Every 'tsc 0 errors' in this milestone's history has been true and has not covered these instruments." : `tsc --noEmit now covers ${scope.scriptFiles} script file(s) — re-check whether this gate is still needed.`,
  },
  ran,
  compiler: TSC_BIN ? path.relative(ROOT, TSC_BIN) : null,
  compilerRule:
    "resolved by absolute path, never via npx: `npx tsc` can resolve the unrelated `tsc` package, which prints 'This is not the tsc command you are looking for' and exits 0, and a missing node_modules fails to launch at all. Both produce a grep for 'error TS' that finds nothing, and both read as a clean typecheck.",
  errors,
  errorsByFile: Object.fromEntries(byFile),
  hardFailures: hard,
  passed: hard.length === 0,
}

mkdirSync(path.dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(result, null, 2) + "\n")

console.log(`script typecheck — ${present.length} grammar-governance instrument(s)`)
console.log(`  tsc --noEmit covers ${scope.scriptFiles} file(s) under script/  <- the gap this gate exists for`)
for (const e of errors.slice(0, 12)) console.log(`  ERROR ${e.file}:${e.line}  ${e.message.slice(0, 110)}`)
if (hard.length) {
  console.error(`\n${hard.map((h) => `  ${h}`).join("\n")}\n`)
  process.exit(1)
}
console.log(`  no type errors in the instruments`)
console.log(`  written to ${path.relative(ROOT, OUT)}`)
