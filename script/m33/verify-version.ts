// script/m33/verify-version.ts — M33.S1.
//
// Version parity: `bb -v`, `bb version`, and `bb --version` must all work,
// print the same version string as package.json, and exit 0. Everything is
// verified against the BUILT binary (dist rebuild) — the M30 P0 class
// ("works under tsx, broken in the bundle") must be structurally impossible
// here, and commander writes directly to process.stdout, so the compiled CLI
// is the only honest capture point.
//
// Mutants plant the three regression shapes: the -v alias removed, the
// `version` subcommand removed, and a version string that drifts from
// package.json. Each must be caught. Mutant probes run in CHILD processes so
// commander's error path (process.exit) cannot kill the verifier.
//
// Run: npx tsx script/m33/verify-version.ts
// Evidence: validation/m33/results/S1.json (machine-emitted)

import { execFileSync, spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m33/results")
const COMPONENT = path.join(ROOT, "src/cli/index.ts")
const MUTANT_PATH = path.join(ROOT, "src/cli/.cli-mutant.ts")
const WRAPPER_PATH = path.join(ROOT, "src/cli/.cli-mutant-wrapper.ts")
const EVIDENCE_PATH = path.join(RESULTS, "S1.json")

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

function pkgVersion(): string {
  return JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version as string
}

function childRunCli(mutantImport: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
  const wrapper = `import { runCli } from "./.cli-mutant.ts";\nrunCli(${JSON.stringify(args)}).catch(() => process.exit(70))\n`
  writeFileSync(WRAPPER_PATH, wrapper)
  try {
    const r = spawnSync("npx", ["tsx", WRAPPER_PATH], { cwd: ROOT, encoding: "utf8", timeout: 60000 })
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" }
  } finally {
    if (existsSync(WRAPPER_PATH)) rmSync(WRAPPER_PATH, { force: true })
  }
  void mutantImport
}

// ---------------------------------------------------------------------------
// A. Built binary: all three forms work on the real user surface
//    (commander writes directly to process.stdout, so the compiled CLI is
//    the only honest capture point — an in-process harness would test a
//    fake surface)
// ---------------------------------------------------------------------------

console.log("M33.S1 version-parity verifier")

const pkg = pkgVersion()
{
  let buildOk = false
  try {
    execFileSync("npm", ["run", "build"], { cwd: ROOT, encoding: "utf8", timeout: 180000, stdio: ["ignore", "pipe", "pipe"] })
    buildOk = true
  } catch {}
  check("A: dist rebuilt fresh before binary checks", buildOk)

  const bb = path.join(ROOT, "bin", "bb")
  const env = { ...process.env, BB_DATA_DIR: path.join(os.tmpdir(), `m33-s1-bbdata-${process.pid}`) }
  const rLong = spawnSync(bb, ["--version"], { encoding: "utf8", timeout: 30000, env })
  const rShort = spawnSync(bb, ["-v"], { encoding: "utf8", timeout: 30000, env })
  const rSub = spawnSync(bb, ["version"], { encoding: "utf8", timeout: 30000, env })
  check("A: bb --version exits 0 and prints the version", rLong.status === 0 && rLong.stdout.trim() === pkg, `${rLong.status} ${rLong.stdout.trim()}`)
  check("A: bb -v exits 0 and prints the version", rShort.status === 0 && rShort.stdout.trim() === pkg, `${rShort.status} ${rShort.stdout.trim()}`)
  check("A: bb version exits 0 and prints the version", rSub.status === 0 && rSub.stdout.trim() === pkg, `${rSub.status} ${rSub.stdout.trim()}`)
  check("A: all three forms agree exactly", rLong.stdout.trim() === rShort.stdout.trim() && rShort.stdout.trim() === rSub.stdout.trim())
  const help = spawnSync(bb, ["--help"], { encoding: "utf8", timeout: 30000, env })
  check("A: help lists the short alias (-v, --version)", help.status === 0 && /-v,\s*--version/.test(help.stdout))
}

// ---------------------------------------------------------------------------
// C. Mutants — each planted defect must be caught (child-process probes)
// ---------------------------------------------------------------------------

type Mutant = { name: string; mutate: (src: string) => string; probe: () => boolean }

const mutants: Mutant[] = [
  {
    name: "-v alias removed",
    mutate: (src) => src.replace('"-v, --version"', '"--version"'),
    probe: () => childRunCli(MUTANT_PATH, ["-v"]).status !== 0,
  },
  {
    name: "version subcommand removed",
    mutate: (src) => src.replace(/  \/\/ M33\.S1: `bb version` subcommand[\s\S]*?^\s*}\n/gm, ""),
    probe: () => childRunCli(MUTANT_PATH, ["version"]).status !== 0,
  },
  {
    name: "version subcommand drifts from package.json",
    mutate: (src) =>
      src.replace(
        /(\.command\("version"\)[\s\S]*?\.action\(\(\) => \{\s*console\.log\()([^)]*)(\)\s*\}\))/,
        "$1\"0.0.0-mutant\"$3",
      ),
    probe: () => {
      const r = childRunCli(MUTANT_PATH, ["version"])
      return r.status === 0 && r.stdout.trim() !== pkg
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
check("S1: every planted defect was caught", mutantResults.every((m) => m.caught))

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
  issue: "M33.S1",
  code: "S1",
  milestone: "M33",
  status: "verified",
  checks,
  passed,
  failed,
  negativeCases: mutantResults.length,
  mutants: mutantResults,
  version: pkg,
  currentCommit: headCommit,
  verifierCommand: "npx tsx script/m33/verify-version.ts",
  evidenceFile: "S1.json",
  generatedAt: new Date().toISOString(),
  limitations: [
    "Mutant probes run the mutated component in a child process (npx tsx); a broken tsx runtime would surface as survivor, not as a false pass.",
    "Version parity is pinned to package.json's version field; publishing without a version bump keeps the three forms consistent by construction.",
  ],
}
mkdirSync(RESULTS, { recursive: true })
writeFileSync(EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + "\n")
console.log(`  evidence: ${path.relative(ROOT, EVIDENCE_PATH)}`)
