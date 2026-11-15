// ─────────────────────────────────────────────────────────────────────────────
// M72 gate — run the engine-core unit matrix when it is present.
//
// WHAT THIS FILE IS — the Phase-1 engine gate: it runs engine-core's own unit
//   matrix (`script/m72/engine/run.ts`) and reports its real exit code. It does
//   NOT re-implement the matcher/flow assertions here: a gate that re-states the
//   engine's own tests would pass whenever both copies share a bug, so this gate
//   surfaces the owner's tests and fails on their exit code.
// WHICH TOOL IT SERVES — bb_security (the spec engine behind the lead store).
// WHY IT EXISTS — the engine's contract (self-pair rejection, constant argument
//   exclusion, comment/string masking, sanitizer/parameterized exclusion,
//   reachability) is only as true as its test matrix. The matrix gate and the
//   answer-contract gates cannot prove engine internals; this gate can.
// WHERE ITS EVIDENCE LIVES — validation/m72/results/engine.json.
// EDIT TOGETHER WHEN THIS CHANGES — script/m72/engine/run.ts,
//   src/intelligence/security/rebuild/{matcher,flow,engine}.ts.
// CONTRACTS IT MUST NOT BREAK — absent engine tests are a DECLARED skip with a
//   path and a reason (never a silent pass); a present-but-failing engine matrix
//   is a hard failure; the gate never edits or replaces the owner's assertions.
//
// COMMAND: npx tsx script/m72/verify-security-engine.ts
// ─────────────────────────────────────────────────────────────────────────────
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "..", "..")
const EVIDENCE = join(ROOT, "validation", "m72", "results", "engine.json")
const ENGINE_DIR = "script/m72/engine"
const RUNNER = "script/m72/engine/run.ts"

function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel))
}

interface EngineEvidence {
  status: "ran" | "skipped"
  command: string | null
  exitCode: number | null
  reason?: string
  stdoutTail?: string
  stderrTail?: string
  engineSources: Record<string, boolean>
}

function writeEvidence(evidence: EngineEvidence): void {
  let head = "unknown"
  try {
    head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    head = "unknown"
  }
  mkdirSync(dirname(EVIDENCE), { recursive: true })
  writeFileSync(
    EVIDENCE,
    JSON.stringify(
      {
        probe: "m72-security-engine",
        what: "runs engine-core's own unit matrix (script/m72/engine/run.ts) when present; a declared skip with a path+reason when absent",
        generatedAt: new Date().toISOString(),
        head,
        ...evidence,
      },
      null,
      2,
    ) + "\n",
  )
}

function tail(text: string, lines = 40): string {
  return text.split("\n").slice(-lines).join("\n").trim()
}

function main(): number {
  const engineSources = {
    "src/intelligence/security/rebuild/matcher.ts": exists("src/intelligence/security/rebuild/matcher.ts"),
    "src/intelligence/security/rebuild/flow.ts": exists("src/intelligence/security/rebuild/flow.ts"),
    "src/intelligence/security/rebuild/engine.ts": exists("src/intelligence/security/rebuild/engine.ts"),
  }
  if (!exists(RUNNER)) {
    // Declared skip, never a silent pass: the evidence records exactly what is
    // missing, and the gate says out loud that it did not verify the engine.
    const evidence: EngineEvidence = {
      status: "skipped",
      command: null,
      exitCode: null,
      reason: `${RUNNER} is absent — the engine-core unit matrix has not been merged into this working tree; the engine's own contract is UNVERIFIED by this gate`,
      engineSources,
    }
    writeEvidence(evidence)
    console.log(`SKIP (declared): ${evidence.reason}`)
    console.log(`  engine sources present: ${Object.entries(engineSources).map(([file, present]) => `${file.split("/").pop()}=${present}`).join(" ")}`)
    console.log(`  evidence: validation/m72/results/engine.json — this is a SKIP, not a pass`)
    return 0
  }

  const command = `npx tsx ${RUNNER}`
  console.log(`running engine-core unit matrix: ${command}`)
  try {
    const stdout = execFileSync("npx", ["tsx", RUNNER], { cwd: ROOT, encoding: "utf8", timeout: 900_000, stdio: ["ignore", "pipe", "pipe"] })
    const evidence: EngineEvidence = {
      status: "ran",
      command,
      exitCode: 0,
      stdoutTail: tail(stdout),
      engineSources,
    }
    writeEvidence(evidence)
    console.log(tail(stdout))
    console.log(`\nM72 SECURITY ENGINE: PASS — ${command} exited 0`)
    console.log(`  evidence: validation/m72/results/engine.json`)
    return 0
  } catch (error: any) {
    const stdout = String(error?.stdout ?? "")
    const stderr = String(error?.stderr ?? "")
    const exitCode = typeof error?.status === "number" ? error.status : 1
    const evidence: EngineEvidence = {
      status: "ran",
      command,
      exitCode,
      stdoutTail: tail(stdout),
      stderrTail: tail(stderr),
      engineSources,
    }
    writeEvidence(evidence)
    console.log(tail(stdout))
    console.error(tail(stderr))
    console.log(`\nM72 SECURITY ENGINE: FAIL — ${command} exited ${exitCode}`)
    console.log(`  evidence: validation/m72/results/engine.json`)
    return 1
  }
}

process.exit(main())
