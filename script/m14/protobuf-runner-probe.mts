/**
 * PROTOBUF LANE — RUNNER PROBE: which runtime can actually START a shared gate.
 *
 * ## What this corrects
 *
 * Pass 14 of `docs/analyzers/real-protobuf-analyzer.md` reported, under the heading
 * "Nine shared gates cannot start at all", that nine files under `script/m14/` fail
 * to start because they use a top-level `__dirname` and the package is
 * `"type": "module"`. It verified that claim under `npx tsx` and under
 * `node --import tsx`. Both crash. Neither is the runner the gates declare.
 *
 * Every one of the nine names its own invocation in a USAGE block as `bun run`.
 * This probe measures, per file, which runners start it, so the claim can be
 * falsified by running it rather than argued from a crash in one runner.
 *
 * ## Why a program walk and not a text search
 *
 * `__dirname` appears in this repository inside code, inside comments, and inside
 * prose that quotes a crash message. A text search cannot tell those apart and
 * would count the very doc section that quotes the error as a second occurrence.
 * So the population is derived from the TypeScript AST: an `Identifier` node whose
 * text is `__dirname`, reached by a tree walk that skips comments and strings
 * entirely, because neither is an `Identifier` in expression position.
 *
 * There is no regular expression anywhere in this file. String comparison only.
 *
 * ## What it does NOT claim
 *
 * "started" means the ES-module ReferenceError did not appear inside the
 * observation window. It does not mean the gate PASSED: most of these gates exit
 * non-zero precisely because they found something, which is a gate working. The
 * question this probe answers is narrower than "does this gate pass" — it is "can
 * this gate report anything at all", because a gate that cannot start cannot
 * report a defect, and that is the claim under test.
 *
 * ## Two defects this probe's first run had, both recorded because both printed a
 * confident wrong number before anything caught them
 *
 * 1. The tsx column ran `npx <file>`. `tsx` is a LOADER, not an interpreter, so
 *    that asks npx for a binary named after the file. It printed
 *    `CRASH_DUNDER 0` for all 15 files — for a file that crashes under
 *    `npx tsx <file>` in two seconds. A zero that contradicted a crash an operator
 *    could reproduce by hand is what exposed it.
 * 2. Exit code was read as "started or not". That merges a gate that ran and
 *    reported a finding with a gate that never launched, and it merges them in the
 *    direction that makes a working gate look broken. The outcome set now
 *    discriminates on the crash marker and on whether anything was printed, and
 *    keeps the unresolvable case (`STARTED_SILENT`) as its own bucket.
 *
 * USAGE: npx tsx script/m14/protobuf-runner-probe.mts [--dir script] [--window=25]
 */

import { spawn } from "node:child_process"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, "..", "..")
const ROOT = process.argv.includes("--dir")
  ? path.resolve(process.argv[process.argv.indexOf("--dir") + 1])
  : path.join(REPO, "script")
const WINDOW_ARG = process.argv.find((a) => a.startsWith("--window="))
const WINDOW_MS = WINDOW_ARG ? Number(WINDOW_ARG.slice("--window=".length)) : 25_000

const DUNDER = "__dirname"
const UNDER_FILE = "__filename"

/** The exact marker a Node/tsx ES module throws. Substring compare, not a regex. */
function isDunderCrash(text: string): boolean {
  return text.includes(DUNDER) && text.includes("is not defined in ES module scope")
}

// ------------------------------------------------------------------ file walk

function walk(dir: string, out: string[]): string[] {
  for (const entry of readdirSync(dir).sort()) {
    const p = path.join(dir, entry)
    const st = statSync(p)
    if (st.isDirectory()) {
      if (entry === "node_modules" || entry === "tmp") continue
      walk(p, out)
    } else if (entry.endsWith(".ts") || entry.endsWith(".mts")) {
      out.push(p)
    }
  }
  return out
}

// ------------------------------------------------------- AST identifier census

type Use = { line: number }

/**
 * Count `__dirname` / `__filename` IDENTIFIER nodes in the file.
 *
 * Comments and string literals are not Identifier nodes, so they are invisible
 * here by construction rather than by a filter that could be wrong. The visitor
 * descends every node kind, so an occurrence inside a nested closure, a default
 * parameter, or a template literal's expression is still found.
 */
function identifierUses(file: string): { dunder: Use[]; underFile: Use[] } {
  const text = readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  const dunder: Use[] = []
  const underFile: Use[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) {
      if (n.text === DUNDER) dunder.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
      else if (n.text === UNDER_FILE) underFile.push({ line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 })
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { dunder, underFile }
}

/**
 * Does the file's own leading comment block declare `bun run` as an invocation?
 *
 * Read from the file's leading comments, so "which runner does this gate declare"
 * is an attribute of the file rather than an assumption this probe supplies.
 */
function declaresBunRun(file: string): boolean {
  const text = readFileSync(file, "utf8")
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ESNext, true)
  const ranges = ts.getLeadingCommentRanges(text, 0) ?? []
  let head = ""
  for (const r of ranges) {
    if (r.kind !== ts.SyntaxKind.MultiLineCommentTrivia) continue
    head += text.slice(r.pos, r.end)
  }
  return head.includes("bun run")
}

// ------------------------------------------------------------------ the runners

/**
 * What happened to the process. These are kept apart because the claim under test
 * is "can this gate report anything", and a non-zero exit is NOT evidence that it
 * cannot: most of these gates exit 1 precisely because they found something, which
 * is a gate working. Collapsing exit-1 into "failed" is the defect that made this
 * probe's first run report `tsx CRASH_DUNDER 0` for a file that crashes under tsx
 * in 2 seconds.
 *
 *   CRASH_DUNDER      the ES-module ReferenceError appeared: it cannot start.
 *   STARTED_EXITED    no crash marker, it exited, and it printed something: it ran.
 *                     `code` says whether what it reported was a pass or a finding.
 *   STARTED_RUNNING   no crash marker, still alive at the window: it started.
 *   STARTED_SILENT    no crash marker, exited, printed nothing: the one bucket this
 *                     probe cannot resolve, and it is counted separately rather
 *                     than folded into either answer.
 *   SPAWN_FAILED      the runner itself would not launch.
 */
type Outcome = "CRASH_DUNDER" | "STARTED_EXITED" | "STARTED_RUNNING" | "STARTED_SILENT" | "SPAWN_FAILED"

const STARTED: ReadonlySet<Outcome> = new Set<Outcome>(["STARTED_EXITED", "STARTED_RUNNING", "STARTED_SILENT"])

type Run = { outcome: Outcome; code: number | null; head: string }

function runGate(file: string, runner: "bun" | "tsx"): Promise<Run> {
  // tsx is a LOADER, not an interpreter: `npx <file>` asks npx for a binary named
  // after the file, which is a different command from the one a reader runs.
  const cmd = runner === "bun" ? "bun" : "npx"
  const argv = runner === "bun" ? ["run", file] : ["tsx", file]
  return new Promise((resolve) => {
    let out = ""
    let settled = false
    let code: number | null = null
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(cmd, argv, {
        cwd: REPO,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, NO_COLOR: "1" },
      })
    } catch {
      resolve({ outcome: "SPAWN_FAILED", code: null, head: "" })
      return
    }
    const finish = (outcome: Outcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        child.kill("SIGKILL")
      } catch {
        /* already gone */
      }
      resolve({ outcome, code, head: out.slice(0, 400) })
    }
    const timer = setTimeout(() => finish("STARTED_RUNNING"), WINDOW_MS)
    child.stdout?.on("data", (d: Buffer) => {
      out += d.toString()
    })
    child.stderr?.on("data", (d: Buffer) => {
      out += d.toString()
    })
    child.on("error", () => finish("SPAWN_FAILED"))
    child.on("close", (c: number | null) => {
      code = c
      if (isDunderCrash(out)) finish("CRASH_DUNDER")
      else if (out.trim().length === 0) finish("STARTED_SILENT")
      else finish("STARTED_EXITED")
    })
  })
}

// ------------------------------------------------------------------------ main

async function main(): Promise<void> {
  if (!existsSync(ROOT)) {
    console.error(`no such directory: ${ROOT}`)
    process.exit(2)
  }
  const files = walk(ROOT, [])
  const users: { rel: string; lines: number[]; declaresBun: boolean }[] = []
  let identifierTotal = 0
  for (const f of files) {
    const { dunder, underFile } = identifierUses(f)
    if (dunder.length === 0 && underFile.length === 0) continue
    identifierTotal += dunder.length + underFile.length
    users.push({
      rel: path.relative(REPO, f),
      lines: [...dunder, ...underFile].map((u) => u.line).sort((a, b) => a - b),
      declaresBun: declaresBunRun(f),
    })
  }

  const pkg = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")) as { type?: string }
  console.log(`package.json type            ${JSON.stringify(pkg.type)}`)
  console.log(`files walked under ${path.relative(REPO, ROOT) || "."}   ${files.length}`)
  console.log(`files with a __dirname/__filename IDENTIFIER node   ${users.length}`)
  console.log(`such identifier nodes, total  ${identifierTotal}`)
  console.log(`files whose own header declares "bun run"   ${users.filter((u) => u.declaresBun).length}`)
  console.log("")
  console.log("file                                                  bun                     tsx")
  console.log("-" + "-".repeat(96))

  const KINDS: Outcome[] = ["CRASH_DUNDER", "STARTED_EXITED", "STARTED_RUNNING", "STARTED_SILENT", "SPAWN_FAILED"]
  const tally = { bun: blankTally(), tsx: blankTally() }
  const rows: { rel: string; bun: Run; tsx: Run; lines: number[] }[] = []
  for (const u of users) {
    const b = await runGate(path.join(REPO, u.rel), "bun")
    const t = await runGate(path.join(REPO, u.rel), "tsx")
    tally.bun[b.outcome]++
    tally.tsx[t.outcome]++
    rows.push({ rel: u.rel, bun: b, tsx: t, lines: u.lines })
    console.log(`${u.rel.padEnd(52).slice(0, 52)} ${label(b).padEnd(23)} ${label(t)}`)
  }

  console.log("")
  console.log("TALLY over the files that hold a __dirname/__filename identifier")
  for (const r of ["bun", "tsx"] as const) {
    const parts = KINDS.map((k) => `${k} ${tally[r][k]}`).join("   ")
    const started = KINDS.filter((k) => STARTED.has(k)).reduce((a, k) => a + tally[r][k], 0)
    console.log(`  ${r.padEnd(4)} started ${String(started).padStart(2)} of ${users.length}   ${parts}`)
  }
  console.log("")
  const startedOf = (r: (typeof rows)[number], side: "bun" | "tsx"): boolean => STARTED.has(r[side].outcome)
  const both = rows.filter((r) => startedOf(r, "bun") && startedOf(r, "tsx")).length
  const bunOnly = rows.filter((r) => startedOf(r, "bun") && !startedOf(r, "tsx")).length
  const tsxOnly = rows.filter((r) => !startedOf(r, "bun") && startedOf(r, "tsx")).length
  const neither = rows.filter((r) => !startedOf(r, "bun") && !startedOf(r, "tsx")).length
  console.log(`  start under BOTH runners   ${both}`)
  console.log(`  start under bun ONLY      ${bunOnly}   <- a tsx-only check calls these "cannot start"`)
  console.log(`  start under tsx ONLY      ${tsxOnly}`)
  console.log(`  start under NEITHER       ${neither}`)
  console.log("")
  console.log("Per-file detail. `code` is the gate's own exit status: a non-zero code with")
  console.log("STARTED_EXITED means the gate RAN and reported a finding, not that it failed to launch.")
  for (const r of rows) {
    console.log(`  ${r.rel}  __dirname/@${r.lines.join(",")}`)
    for (const side of ["bun", "tsx"] as const) {
      const run = r[side]
      const first = run.head.split("\n").find((l) => l.trim().length > 0) ?? ""
      console.log(`    ${side.padEnd(3)} ${run.outcome.padEnd(15)} code=${String(run.code).padEnd(5)} ${first.slice(0, 130)}`)
    }
  }
}

function blankTally(): Record<Outcome, number> {
  return { CRASH_DUNDER: 0, STARTED_EXITED: 0, STARTED_RUNNING: 0, STARTED_SILENT: 0, SPAWN_FAILED: 0 }
}

function label(r: Run): string {
  return r.outcome === "STARTED_EXITED" ? `STARTED_EXITED(${r.code})` : r.outcome
}

await main()
