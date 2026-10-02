// script/m14/verify-parse-integrity.ts — the parse-integrity gate. Every
// TypeScript source in the tree must be a PROGRAM, and the gate proves it by
// asking the compiler to parse it.
//
// THE BUG CLASS: a syntax error in a gate, harness or verifier file is
// invisible because the gate cannot report on a file it cannot parse. A broken
// gate is silently green — worse than absent, because it is counted.
//
// THE INCIDENT: merge commit d46f92906 ("merge: origin/main into main — 607
// remote commits united with 502 local") spliced orphaned code from one file
// into another, destroying mutant definitions and unbalancing braces. Two
// harnesses were left unparseable:
//
//   script/m14/mutate-analyzer.ts   3512 parse errors, first at 2596:5
//   script/m14/differential.ts        1 parse error  at 24193:1
//
// Both lanes were BROKEN — the mutation lane and the differential lane could
// not run at all — and nothing in CI noticed. `npx tsc --noEmit` does not see
// them (tsconfig.json includes only src/), and the `verify` chain runs the
// harnesses as subprocesses whose own crash is easy to misread. A merge that
// takes out two of the three inputs to the mutation/differential evidence
// still leaves every OTHER gate reporting green, because those gates read
// their verdicts from the artifacts and not from the harnesses' ability to run.
//
// WHAT THIS GATE DOES: parses every .ts/.mts/.cts/.tsx under script/, src/,
// test/, ide/, website/ and wasm/ with the TypeScript compiler's PARSER, and
// exits non-zero if any file has a parse diagnostic. This is the check that
// cannot be satisfied by a file that does not compile as a program at all.
//
// WHY PARSE-ONLY, NOT A TYPECHECK. `ts.createProgram` is `npm run typecheck`.
// This gate must stay fast enough to run on every commit (measured: a single
// process parses the whole tree in ~12 s, against ~20 minutes for the per-file
// `node` spawn sweep this replaced — 3,500 files, one process, no fork per
// file). Type errors in a harness are governed by
// script/m14/verify-harness-typecheck.ts and its pinned baseline; duplicating
// them here would produce two disagreeing opinions and a gate nobody can
// reason about. A syntax error, by contrast, is unambiguous: the file cannot
// run, so it cannot be a gate, so it cannot be trusted.
//
// ROOT-RELATIVE, NOT CWD-RELATIVE. Paths are resolved from this file's own
// location, so a gate run from any directory scans the same tree — a gate whose
// coverage depends on the shell it was invoked from is a gate whose coverage
// is unknown.
//
// ZERO IS DECLARED, NEVER ASSUMED. Every root is reported with whether it
// exists and how many files it contributed; a scan that parses ZERO files
// cannot report PASS (exit 2, the same "could not be compared" code
// verify-parse-success.ts uses). A root that legitimately holds no TypeScript
// — wasm/ today — is disclosed rather than silently swallowed.
//
// NOT AN EVIDENCE WRITER. This gate emits no validation/ artifact. M49's
// verify-evidence-identity discovers a producer by a PLAIN LITERAL issueId
// inside an emit call, so writing an unregistered id here would create an ORPHAN
// artifact and fail that gate. Registering a lane for this check is a
// governance decision, not this file's to make silently.
//
// THE NARROWER PREDECESSOR IS KEPT, NOT REPLACED. script/m14/parse-check.ts
// already parses script/, tests/ and src/ (commit 2efcab289) — but it is wired
// only as `npm run parse:check`, it is in NO chain and NO workflow, it names a
// root (`tests`) that does not exist in this repository, and it misses test/,
// ide/, website/ and wasm/ entirely. This gate supersedes its coverage; the
// defect register in docs/GATE-STRENGTH-AUDIT.md records why it was not
// running.
//
// Usage:
//   bun run script/m14/verify-parse-integrity.ts              # the gate (whole tree)
//   bun run script/m14/verify-parse-integrity.ts --selftest   # prove it can fail
//   bun run script/m14/verify-parse-integrity.ts --root src   # scoped inspection
//   bun run script/m14/verify-parse-integrity.ts --max-diagnostics 50
//
// Exit codes: 0 pass · 1 at least one file does not parse · 2 the scan could
// not be compared (no root resolved, or the whole tree yielded zero files).

import * as ts from "typescript"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..", "..")

/**
 * The roots this gate watches, in report order. Each is reported with whether
 * it exists and how many TypeScript files it contributed, so a root that
 * silently stopped existing is visible in the output rather than inferred from
 * an absent complaint.
 */
const DEFAULT_ROOTS = ["script", "src", "test", "ide", "website", "wasm"]

/**
 * Build output, dependency trees and snapshot copies. `worktree-snapshots` is
 * named explicitly because this repository holds full checkouts of itself
 * inside itself: a recursive parse of a snapshot would double-count every file
 * in the tree and would report another lane's half-finished state as this
 * repository's.
 */
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "worktree-snapshots", "coverage", ".next", ".cache"])

/** `.d.ts` is a declaration file: it is consumed, never executed, and an ambient declaration is legitimately loose. */
const SOURCE_EXT = /\.(ts|mts|cts|tsx)$/

interface ParseFailure {
  /** project-relative, POSIX separators — the spelling a reader can paste into an editor */
  file: string
  line: number
  col: number
  message: string
}

interface RootReport {
  root: string
  exists: boolean
  /** TypeScript files this root contributed to the scan */
  files: number
  /** true when the root was refused because its own path is in the skip list */
  excluded: boolean
}

interface Scan {
  /** every file handed to the parser */
  scanned: number
  /** one entry per diagnostic, grouped by file, in walk order */
  failures: Map<string, ParseFailure[]>
  roots: RootReport[]
}

const hasArg = (f: string) => process.argv.includes(f)
const argValue = (f: string) => {
  const i = process.argv.indexOf(f)
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined
}

/**
 * Diagnostics per broken file actually printed. The CAP IS DECLARED in the
 * output and the true per-file total is always printed beside it — mutate-
 * analyzer.ts carries 3,512 of them, and 3,512 lines of `,` expected is a way
 * of hiding the one line that matters. Every broken FILE is listed regardless
 * of the cap; only the repetition within one file is bounded.
 */
const MAX_DIAGNOSTICS = parseInt(argValue("--max-diagnostics") ?? "8", 10)

/**
 * `parseDiagnostics` is the parser's own output but is absent from the public
 * `typescript.d.ts` (verified on 5.9.3), so it is read through a narrow cast
 * rather than with `as any`. Reading it defensively (`?? []`) matters: a
 * diagnostic array that is somehow absent must read as "no parse diagnostics",
 * not as a crash inside the gate that exists to report crashes.
 */
function parseDiagnosticsOf(sf: ts.SourceFile): readonly ts.Diagnostic[] {
  return (sf as unknown as { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? []
}

/**
 * The extension → ScriptKind mapping, written out rather than inferred.
 * `createSourceFile` will guess a kind from the file name when none is passed,
 * but a guess is a second, invisible policy: `.tsx` mis-parsed as `.ts` changes
 * which files fail, and a parse gate whose subject is decided by an implicit
 * default is a gate whose coverage is hard to state.
 */
function scriptKindOf(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".mts")) return ts.ScriptKind.MJS
  if (file.endsWith(".cts")) return ts.ScriptKind.CJS
  return ts.ScriptKind.TS
}

/**
 * PARSE ONE FILE, and nothing else. This is the whole predicate of the gate,
 * and it is here — once — because `--selftest` drives THIS function. A self-
 * test of a copy of the predicate proves the copy works, which is the failure
 * mode this repository keeps paying for.
 *
 * `ts.ScriptTarget.ESNext` because the tree's own `tsconfig.json` targets the
 * newest language version; parsing an older target would report modern syntax
 * as an error and turn this gate into a second, disagreeing `typecheck`.
 */
function parseOne(absFile: string, displayFile: string): ParseFailure[] {
  const text = readFileSync(absFile, "utf8")
  const sf = ts.createSourceFile(absFile, text, ts.ScriptTarget.ESNext, true, scriptKindOf(absFile))
  const diags = parseDiagnosticsOf(sf)
  if (diags.length === 0) return []
  const out: ParseFailure[] = []
  for (const d of diags) {
    const { line, character } = sf.getLineAndCharacterOfPosition(d.start ?? 0)
    out.push({
      file: displayFile,
      line: line + 1,
      col: character + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, " "),
    })
  }
  // Sorted by offset, so the FIRST line printed for a broken file is the
  // earliest point of damage rather than whichever error the parser happened to
  // emit first. TypeScript does not document parseDiagnostics as being in source
  // order under error recovery, and a reader who starts at the reported line
  // must land on the head of the damage rather than on the tail of a cascade.
  // (Measured 2026-10-02 on both files d46f92906 broke: emission order and
  // offset order happened to coincide — 3505 diagnostics at 5075:7 for
  // mutate-analyzer.ts, 1 at 24193:1 for differential.ts. So this is a
  // guarantee, not a fix for an observed wrong first line.) Ties (same
  // offset) keep parser order, which is stable for a given input.
  out.sort((a, b) => a.line - b.line || a.col - b.col)
  return out
}

/** Recursive collect. An unreadable directory is skipped, never fatal — the root report below says how much was reached. */
function collect(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    const full = path.join(dir, e.name)
    if (e.isDirectory()) collect(full, out)
    else if (e.isFile() && SOURCE_EXT.test(e.name) && !e.name.endsWith(".d.ts")) out.push(full)
  }
}

const toPosix = (p: string) => p.split(path.sep).join("/")

/**
 * The scan, as one function over a list of roots — the same function the gate
 * runs and the self-test drives, over a temporary tree instead of the repo.
 */
function scanRoots(roots: string[], base: string): Scan {
  const failures = new Map<string, ParseFailure[]>()
  const reports: RootReport[] = []
  let scanned = 0
  for (const root of roots) {
    const dir = path.resolve(base, root)
    // The skip list binds ROOTS too, not only their children. Honoring it only
    // for children means `--root node_modules` — or a repository that happens
    // to grow a top-level `dist/` — parses a whole dependency tree, which is
    // both a false alarm and an unbounded runtime. Found by this gate's own
    // self-test: the first draft scanned a deliberately broken file under a
    // `node_modules` root and reported it, i.e. the exclusion was decorative.
    const excluded = SKIP_DIRS.has(root) || root.split("/").some((seg) => SKIP_DIRS.has(seg))
    const exists = !excluded && existsSync(dir)
    const files: string[] = []
    if (exists) collect(dir, files)
    files.sort()
    for (const abs of files) {
      scanned++
      const display = toPosix(path.relative(base, abs))
      let found: ParseFailure[]
      try {
        found = parseOne(abs, display)
      } catch (e) {
        // A file this gate cannot even READ is a gate that cannot report, which
        // is the exact failure class under audit. It is a failure, not a skip.
        found = [{ file: display, line: 1, col: 1, message: `unreadable by the parse gate: ${(e as Error).message}` }]
      }
      if (found.length > 0) failures.set(display, found)
    }
    reports.push({ root, exists, files: files.length, excluded })
  }
  return { scanned, failures, roots: reports }
}

/**
 * The verdict, as a pure function of the scan, so `--selftest` can drive the
 * same mapping over a measurement rather than a copy of it.
 *
 * The zero-file case is NOT a pass. A sweep that parsed nothing has proven
 * nothing, and reporting PASS there is the vacuous assertion this repository is
 * trying to stop paying for.
 */
function verdictFor(scan: Scan): { verdict: "pass" | "fail" | "no-scope"; failed: number; files: number } {
  const failed = scan.failures.size
  if (scan.scanned === 0) return { verdict: "no-scope", failed, files: 0 }
  if (failed > 0) return { verdict: "fail", failed, files: scan.scanned }
  return { verdict: "pass", failed, files: scan.scanned }
}

/** fail → 1, no-scope → 2 (could not be compared, which is not a pass), pass → 0. */
function exitCodeFor(verdict: string): number {
  return verdict === "fail" ? 1 : verdict === "no-scope" ? 2 : 0
}

// ------------------------------------------------------------------- selftest

/**
 * `--selftest`: prove the gate CAN FAIL, by parsing files that are deliberately
 * not programs and asserting each one is detected — plus the directions that
 * keep the gate honest (a clean file must NOT be reported, a `.d.ts` and a
 * `node_modules/` file must NOT be scanned). A gate whose only observed state
 * is "pass" is decoration.
 *
 * Writes nothing outside its own temp directory; touches no repository file.
 */
function selftest(): number {
  const bad: string[] = []
  const want = (label: string, got: unknown, expect: unknown) => {
    if (got !== expect) bad.push(`${label}: expected ${String(expect)}, got ${String(got)}`)
  }

  const work = mkdtempSync(path.join(tmpdir(), "bb-parse-integrity-selftest-"))
  const write = (rel: string, body: string) => {
    const full = path.join(work, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, body, "utf8")
  }

  // The shapes this bug class actually takes, one file each, so the assertions
  // name the damage rather than "a malformed file".
  const BROKEN: Record<string, string> = {
    // unbalance a brace mid-file — the shape d46f92906 left behind
    "src/broken-brace.ts": "export function a(): number {\n  return 1\n}\nexport function b(): number {\n  return 2\n",
    // a stray token where a statement end belongs
    "src/broken-token.ts": "const x = 1\nconst y = 2\n}\n",
    // splice damage: one function's body closing another's declaration
    "src/broken-splice.ts": "function f() {\nfunction g() {\n  return 1\n}\n",
    // .tsx must be parsed AS tsx
    "website/broken.tsx": "export const A = () => <div>\nexport const B = 1\n",
    // .mts must be parsed as an ES module. The damage has to be a token the
    // parser cannot recover from — a missing `;` between two top-level
    // `export const` statements is legal via ASI, so it is NOT a broken file,
    // and an earlier draft of this self-test proved that the hard way.
    "ide/broken.mts": "export const a: number = = 1\nexport function f(: number {\n  return a\n}\n",
    // inside a skipped dir: must never be scanned
    "node_modules/dep/broken-ignored.ts": "export const x = {\n",
    // a declaration file is consumed, never executed
    "src/types.d.ts": "declare module \"x\" {\n  const y: number\n",
    // the clean control: must NOT be reported
    "src/clean.ts": "export const ok = (n: number): number => n + 1\n",
  }
  for (const [rel, body] of Object.entries(BROKEN)) write(rel, body)

  const scan = scanRoots(["src", "website", "ide", "node_modules"], work)
  const files = [...scan.failures.keys()]

  console.log(`parse-integrity selftest — a temporary tree of ${Object.keys(BROKEN).length} file(s), scanned in-process\n`)

  // --- the FAILURE direction: every deliberately broken file is caught -------
  const mustCatch = ["src/broken-brace.ts", "src/broken-token.ts", "src/broken-splice.ts", "website/broken.tsx", "ide/broken.mts"]
  for (const rel of mustCatch) {
    const found = scan.failures.get(rel)
    if (!found || found.length === 0) {
      bad.push(`${rel} is deliberately malformed and was NOT detected — the gate cannot fail`)
    } else {
      console.log(`  ok   detected ${rel}:${found[0].line}:${found[0].col} ${found[0].message}`)
    }
  }

  // --- the FALSE-POSITIVE direction: a clean file is never reported ---------
  want("a well-formed file is not reported as broken", files.includes("src/clean.ts"), false)
  if (!files.includes("src/clean.ts")) console.log(`  ok   src/clean.ts parsed with no diagnostics (no false positive)`)

  // --- the SKIP directions: excluded populations stay excluded --------------
  want("a file under node_modules is never scanned", files.includes("node_modules/dep/broken-ignored.ts"), false)
  want("a .d.ts is never scanned", files.includes("src/types.d.ts"), false)
  if (!files.includes("node_modules/dep/broken-ignored.ts") && !files.includes("src/types.d.ts")) {
    console.log(`  ok   node_modules/ and *.d.ts excluded (both would have failed if scanned)`)
  }

  // --- non-vacuity: the sweep must have reached real files at all -----------
  want("the sweep scanned at least the five malformed files", scan.scanned >= 5, true)
  if (scan.scanned === 0) bad.push("the selftest sweep scanned 0 files — nothing was proven")

  // --- the zero is DECLARED, not silently passed ---------------------------
  const empty = scanRoots(["no-such-root"], work)
  want("a sweep that parsed nothing is not a pass", verdictFor(empty).verdict, "no-scope")
  want("a sweep that parsed nothing exits 2", exitCodeFor(verdictFor(empty).verdict), 2)
  want("a missing root is reported as missing, not omitted", empty.roots[0].exists, false)
  console.log(`  ok   an absent root is reported absent and cannot yield PASS`)

  // --- the verdict/exit mapping, which is what a battery actually reads -----
  want("broken files report fail", verdictFor(scan).verdict, "fail")
  want("broken files exit 1", exitCodeFor(verdictFor(scan).verdict), 1)

  // Repair every malformed file and re-run the SAME predicate: a gate that
  // cannot report green is as broken as one that cannot report red, and a
  // detector that flags anything at all would sail through the direction above.
  for (const rel of mustCatch) write(rel, "export const repaired = 1\n")
  const repaired = scanRoots(["src", "website", "ide", "node_modules"], work)
  want("a repaired tree reports pass", verdictFor(repaired).verdict, "pass")
  want("a repaired tree exits 0", exitCodeFor(verdictFor(repaired).verdict), 0)
  want("the repaired tree still reaches files (the pass is not a 0-file pass)", repaired.scanned, scan.scanned)
  if (repaired.failures.size !== 0) {
    for (const [f, ds] of repaired.failures) bad.push(`${f} still reported after repair: ${ds[0].message}`)
  } else {
    console.log(`  ok   all ${mustCatch.length} malformed files repaired → verdict pass, exit 0 (no false positive)`)
  }

  rmSync(work, { recursive: true, force: true })

  if (bad.length > 0) {
    console.error(`\nSELFTEST FAIL — ${bad.length} check(s) do not hold:`)
    for (const b of bad) console.error(`  - ${b}`)
    console.error("\nA gate that cannot fail is not a gate. Do not wire this into the chain until it can.")
    return 1
  }
  console.log("\nSELFTEST PASS — 5 malformed files detected, clean/skipped populations left alone, zero declared not passed")
  return 0
}

// ----------------------------------------------------------------------- main

function main(): void {
  if (hasArg("--selftest")) {
    process.exit(selftest())
  }

  const scoped = process.argv.filter((a, i) => process.argv[i - 1] === "--root")
  const roots = scoped.length > 0 ? scoped : DEFAULT_ROOTS
  const started = Date.now()

  console.log("parse-integrity gate — every TypeScript source in the tree must be a PROGRAM\n")
  console.log(`roots: ${roots.join(", ")}`)
  console.log("method: ts.createSourceFile + parseDiagnostics (PARSE ONLY — types are verify-harness-typecheck.ts's job)\n")

  const scan = scanRoots(roots, ROOT)

  // --- per-root disclosure ---------------------------------------------------
  console.log(`  ${"root".padEnd(10)} ${"exists".padEnd(7)} ${"ts files".padStart(9)}`)
  for (const r of scan.roots) {
    const note = r.excluded
      ? "  (refused: the root's own path is in the skip list)"
      : !r.exists
        ? "  (root does not exist in this tree)"
        : r.files === 0
          ? "  (no TypeScript source)"
          : ""
    const state = r.excluded ? "skip" : r.exists ? "yes" : "NO"
    console.log(`  ${r.root.padEnd(10)} ${state.padEnd(7)} ${String(r.files).padStart(9)}${note}`)
  }
  const absent = scan.roots.filter((r) => !r.exists && !r.excluded).map((r) => r.root)
  const refused = scan.roots.filter((r) => r.excluded).map((r) => r.root)
  if (absent.length > 0) {
    console.log(`\n  DISCLOSED: ${absent.length} configured root(s) absent — ${absent.join(", ")}`)
  }
  if (refused.length > 0) {
    console.log(`\n  DISCLOSED: ${refused.length} root(s) refused as skip-listed — ${refused.join(", ")}`)
  }
  // `script/m14/tmp/` is scratch and is NOT skipped, so a deliberately-malformed
  // fixture copy dropped there would fail this gate. That is disclosed here
  // rather than discovered later as an unexplained red.
  console.log(`\nfiles scanned: ${scan.scanned}   elapsed: ${Date.now() - started} ms (one process, no fork per file)`)

  const { verdict, failed } = verdictFor(scan)

  if (failed > 0) {
    const totalDiags = [...scan.failures.values()].reduce((n, f) => n + f.length, 0)
    console.error(`\nUNPARSEABLE FILES — ${failed} of ${scan.scanned} (${totalDiags} parse diagnostics)\n`)
    const rows = [...scan.failures.entries()].sort((a, b) => b[1].length - a[1].length)
    for (const [file, diags] of rows) {
      const shown = diags.slice(0, MAX_DIAGNOSTICS)
      for (const d of shown) console.error(`  ${d.file}:${d.line}:${d.col}  ${d.message}`)
      if (diags.length > shown.length) {
        console.error(`  ${file}:  … ${diags.length - shown.length} further diagnostic(s) in this file (${diags.length} total, first ${shown.length} shown; raise with --max-diagnostics)`)
      }
    }
    console.error(
      `\nPARSE INTEGRITY FAIL — a file that does not parse is a gate that cannot run and cannot report on itself.`,
    )
    console.error(
      `Every one of these is a lane that cannot execute: the evidence it would have produced does not exist,`,
    )
    console.error(
      `not "no defects found". A merge that splices code between harnesses produces exactly this shape.`,
    )
    process.exit(1)
  }

  if (verdict === "no-scope") {
    console.error("\nexit 2: 0 files were parsed — the sweep reached no TypeScript source, so nothing was proven.")
    console.error("       A gate that scanned nothing is not a pass. Check the --root arguments.")
    process.exit(2)
  }

  if (scoped.length > 0) {
    console.log(`\nSCOPED run (roots: ${scoped.join(", ")}) — result above is NOT the whole-tree claim; run with no --root for that.`)
  }
  console.log(`\nPARSE INTEGRITY PASS — ${scan.scanned} TypeScript file(s) parsed, 0 with parse diagnostics.`)
  console.log("This says each file is a program. It does not say each gate is correct — see docs/GATE-STRENGTH-AUDIT.md.")
  process.exit(0)
}

if (import.meta.main) main()