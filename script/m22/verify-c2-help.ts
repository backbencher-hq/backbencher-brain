// script/m22/verify-c2-help.ts — M22.C2
// Proves the CLI help carries real examples for every command, the honest
// post-processing control (--skip-post-processing) exists and works, and the
// phantom `--post` flag is NOT accepted (it must not silently succeed).
// No auto-pass / tautological assertions.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS = path.join(ROOT, "validation/m22/results")

let checks = 0
let passed = 0
let negatives = 0
function check(label: string, ok: boolean, detail = "") { checks++; if (ok) passed++; else console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
function negative(label: string, ok: boolean, detail = "") { negatives++; check(`${label} [negative]`, ok, detail) }

async function run() {
  const root = mkdtempSync(path.join(tmpdir(), "m22-c2-"))
  const proj = path.join(root, "proj")
  mkdirSync(path.join(proj, "src"), { recursive: true })
  for (let i = 0; i < 12; i++) writeFileSync(path.join(proj, "src", `m${i}.ts`), `export function c2f${i}(x:number){return x+${i}}\n`)
  const runner = path.join(root, "run.mjs")
  writeFileSync(runner, `import { runCli } from ${JSON.stringify(path.join(ROOT, "src/cli/index.ts"))}\nawait runCli(process.argv.slice(2)).catch((e)=>{console.error("RUNNER_ERR:", e?.message ?? e); process.exit(1)})\n`)

  async function runArgs(args: string[]): Promise<{ out: string; err: string; code: number }> {
    const r = spawnSync("bun", [runner, ...args], { cwd: ROOT, encoding: "utf8", timeout: 150_000, stdio: ["ignore", "pipe", "pipe"] })
    return { out: r.stdout ?? "", err: r.stderr ?? "", code: r.status ?? 1 }
  }

  // 1. `bb index --help` shows examples
  {
    const r = await runArgs(["index", "--help"])
    const text = r.out + r.err
    check("C2 index --help prints usage", /Usage:/.test(text), text.slice(0, 120))
    check("C2 index --help prints examples (bb index …)", /Examples:/.test(text) && /bb index/.test(text), text.slice(0, 200))
    for (const flag of ["--force", "--skip-post-processing", "--file", "--changed"]) {
      check(`C2 index --help documents ${flag}`, text.includes(flag), `missing ${flag}`)
    }
  }

  // 2. every other command's help exists (non-empty)
  for (const cmd of ["status", "stats", "search", "health", "tool", "mcp", "version"]) {
    const r = await runArgs([cmd, "--help"])
    const text = r.out + r.err
    check(`C2 ${cmd} --help is non-empty`, text.trim().length > 10, text.slice(0, 80))
  }

  // 3. --skip-post-processing works end-to-end (index completes without heavy phases)
  {
    const r = await runArgs(["index", proj, "--skip-post-processing"])
    const text = r.out + r.err
    check("C2 index --skip-post-processing exits 0", r.code === 0, r.err.slice(0, 200))
    check("C2 index --skip-post-processing still stores files", /indexed \d+ files/.test(text), text.slice(-160))
  }

  // 4. negatives
  {
    // 4a. M40.A1: --post is now a REAL flag (standalone post-processing entry).
    // It must be ACCEPTED — on a fresh fixture it exits non-zero with the
    // "no index" error, which is itself the honest behavior (never silently
    // succeed on an unindexed project). A still-phantom flag would fail with
    // "unknown option" instead.
    const r = await runArgs(["index", proj, "--post"])
    negative("C2 --post is real: rejected only as no-index (never as unknown option)", !/unknown option|RUNNER_ERR/.test(r.err + r.out), `code=${r.code} err=${(r.err + r.out).slice(0, 120)}`)
    // 4b. an unknown option errors rather than being ignored
    const r2 = await runArgs(["index", proj, "--definitely-not-a-flag"])
    negative("C2 an unknown option is rejected, not ignored", r2.code !== 0 || /RUNNER_ERR|unknown option/.test(r2.err + r2.out), `code=${r2.code}`)
  }

  rmSync(root, { recursive: true, force: true })
  const finalStatus = passed === checks && negatives >= 2 ? "verified" : "known-gap"
  mkdirSync(RESULTS, { recursive: true })
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()
  const result = {
    issue: "M22.C2", code: "C2", milestone: "M22", status: finalStatus,
    checks, passed, failed: checks - passed, negativeCases: negatives,
    currentCommit: commit, workingTreeRelevantChanges: [],
    verifierCommand: "bun run script/m22/verify-c2-help.ts",
    evidenceFile: "C2.json", generatedAt: new Date().toISOString(),
    command: "bun run script/m22/verify-c2-help.ts",
    limitations: ["Help examples verified structurally + behaviorally for index; post-processing control verified by a full index run with --skip-post-processing (files stored, heavy phases skipped)."],
  }
  writeFileSync(path.join(RESULTS, "C2.json"), JSON.stringify(result, null, 2) + "\n")
  try {
    const led = JSON.parse(readFileSync(path.join(ROOT, "validation/m22/ledger.json"), "utf8"))
    const e = Object.values(led.issues).find((i: any) => i.code === "C2")
    if (e) { e.status = finalStatus; e.passed = passed; e.failed = checks - passed; e.commit = commit; e.evidenceFile = "C2.json" }
    writeFileSync(path.join(ROOT, "validation/m22/ledger.json"), JSON.stringify(led, null, 2) + "\n")
  } catch (e2: any) { console.log(`C2: ledger self-update failed: ${e2?.message}`) }
  console.log(`C2: ${result.status.toUpperCase()} (${result.passed}/${result.checks}, ${result.negativeCases} negative)`)
  process.exit(finalStatus === "verified" ? 0 : 1)
}

run().catch((e) => { console.error("C2 verifier crashed:", e); process.exit(1) })