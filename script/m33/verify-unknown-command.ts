// script/m33/verify-unknown-command.ts — M33.S2.
//
// Unknown-command UX: a mistyped command must suggest the closest real
// command (did-you-mean) AND point at `bb --help` — never a bare dead end.
// Far-miss commands still exit 1 with the help pointer. Unknown OPTIONS get
// the same treatment. Everything is verified against the BUILT binary after
// a fresh dist rebuild; mutant probes run in child processes.
//
// Run: npx tsx script/m33/verify-unknown-command.ts
// Evidence: validation/m33/results/S2.json (machine-emitted)

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m33/results")
const COMPONENT = path.join(ROOT, "src/cli/index.ts")
const MUTANT_PATH = path.join(ROOT, "src/cli/.cli-mutant.ts")
const WRAPPER_PATH = path.join(ROOT, "src/cli/.cli-mutant-wrapper.ts")
const EVIDENCE_PATH = path.join(RESULTS, "S2.json")

const POINTER = "(run 'bb --help' for a list of commands)"

let checks = 0
let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else {
    failed++
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

function childRunCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const wrapper = `import { runCli } from "./.cli-mutant.ts";\nrunCli(${JSON.stringify(args)}).catch(() => process.exit(70))\n`
  writeFileSync(WRAPPER_PATH, wrapper)
  try {
    const r = spawnSync("npx", ["tsx", WRAPPER_PATH], { cwd: ROOT, encoding: "utf8", timeout: 60000 })
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  } finally {
    if (existsSync(WRAPPER_PATH)) rmSync(WRAPPER_PATH, { force: true })
  }
}

// ---------------------------------------------------------------------------
// A. Built binary: suggestions + pointer, exit codes, no hangs
// ---------------------------------------------------------------------------

console.log("M33.S2 unknown-command verifier")

{
  let buildOk = false
  try {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] })
    buildOk = true
  } catch {}
  check("A: dist rebuilt fresh before binary checks", buildOk)

  const bb = path.join(ROOT, "bin", "bb")
  const env = { ...process.env, BB_DATA_DIR: path.join(os.tmpdir(), `m33-s2-bbdata-${process.pid}`) }
  const run = (args: string[]) => spawnSync(bb, args, { encoding: "utf8", timeout: 30000, env })

  const near = run(["docter"])
  check("A: near-miss exits 1", near.status === 1, String(near.status))
  check("A: near-miss suggests doctor", /Did you mean doctor\?/.test(near.stderr))
  check("A: near-miss carries the help pointer", near.stderr.includes(POINTER))
  check("A: near-miss does not hang (spawn completed)", near.error === undefined || near.error === null)

  const far = run(["frobnicate"])
  check("A: far-miss exits 1", far.status === 1, String(far.status))
  check("A: far-miss carries NO false suggestion", !/Did you mean/.test(far.stderr))
  check("A: far-miss carries the help pointer", far.stderr.includes(POINTER))

  const badOpt = run(["index", "--deep"])
  check("A: unknown option exits 1", badOpt.status === 1, String(badOpt.status))
  check("A: unknown option names the flag", badOpt.stderr.includes("--deep"))
  check("A: unknown option carries the help pointer", badOpt.stderr.includes(POINTER))

  const nearOpt = run(["index", "--hepl"])
  check("A: near-miss option suggests --help", /Did you mean --help\?/.test(nearOpt.stderr))

  const help = run(["--help"])
  check("A: legit surface unaffected (bb --help exits 0)", help.status === 0)
}

// ---------------------------------------------------------------------------
// B. Mutants — each planted defect must be caught (child-process probes)
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: () => boolean }

const mutants: Mutant[] = [
  {
    name: "help pointer removed",
    mutate: (src) => src.replace(/program\.showHelpAfterError\([^)]*\)/, "program.showHelpAfterError(false)"),
    probe: () => {
      const r = childRunCli(["docter"])
      return !(r.stderr + r.stdout).includes(POINTER)
    },
  },
  {
    name: "did-you-mean suggestions disabled",
    mutate: (src) => src.replace("program.showSuggestionAfterError(true)", "program.showSuggestionAfterError(false)"),
    probe: () => {
      const r = childRunCli(["docter"])
      return !/Did you mean/.test(r.stderr + r.stdout)
    },
  },
  {
    name: "help pointer paraphrased",
    mutate: (src) => src.replace("for a list of commands", "for more information"),
    probe: () => {
      const r = childRunCli(["frobnicate"])
      return !(r.stderr + r.stdout).includes(POINTER)
    },
  },
]

const mutantResults: { name: string; caught: boolean }[] = []
for (const mut of mutants) {
  const src = readFileSync(COMPONENT, "utf8")
  const mutated = mut.mutate(src)
  if (mutated === src) {
    mutantResults.push({ name: mut.name, caught: false })
    check(`mutant [${mut.name}] applied`, false, "mutation produced no change — fix mutant definition")
    continue
  }
  writeFileSync(MUTANT_PATH, mutated)
  let caught = false
  try {
    caught = mut.probe()
  } catch {
    caught = false
  } finally {
    for (const p of [MUTANT_PATH, WRAPPER_PATH]) {
      if (existsSync(p)) rmSync(p, { force: true })
    }
  }
  mutantResults.push({ name: mut.name, caught })
  check(`mutant [${mut.name}] caught by suite`, caught, caught ? "" : "survived")
}
check("S2: every planted defect was caught", mutantResults.every((m) => m.caught))

// ---------------------------------------------------------------------------
// Verdict + evidence
// ---------------------------------------------------------------------------

const ok = failed === 0
console.log("")
console.log(`  checks: ${passed}/${checks} passed, ${mutantResults.length} mutants`)
if (!ok) {
  console.log("VERDICT: FAIL")
  process.exit(1)
}
console.log("VERDICT: PASS")

let headCommit = "unknown"
try {
  headCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
} catch {}

const evidence = {
  issue: "M33.S2",
  code: "S2",
  milestone: "M33",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutantResults.length,
  mutants: mutantResults,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m33/verify-unknown-command.ts",
  evidenceFile: "S2.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Suggestion quality is commander's Levenshtein implementation (v12.1.0); the gate pins that near-misses suggest and far-misses do not, not the exact algorithm.",
    "Mutant probes run the mutated component via npx tsx in a child process; the shipped pointer behavior itself is asserted against the rebuilt dist binary.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
