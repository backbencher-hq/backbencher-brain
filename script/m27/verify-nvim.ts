// script/m27/verify-nvim.ts — M27.N1 verifier + mutation suite (issue #617).
//
// Proves the Neovim adapter drives the REAL bb_lsp through a REAL headless
// Neovim session (no mock transport), asserting the SAME fixture facts the
// VS Code leg asserts (differential honesty, shared core fixture), and that
// the suite CAN FAIL by planting session-level defects:
//
//   R1 provisioned:   nvim binary present (blocked-with-reason otherwise)
//   R2 real session:  nvim --headless runs the driver, client initializes,
//                     capabilities advertised
//   R3 same answers:  hover/definition/references/symbols/call-hierarchy/
//                     staleness agree with the shared core's fixture facts
//   R4 can-fail:      mutant drivers (wrong hover position, wrong fixture
//                     symbol, dropped capability check) are caught
//
// Run: npx tsx script/m27/verify-nvim.ts
// Evidence: validation/m27/results/N1.json (machine-emitted)

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { realpathSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { writeSealed } from "../lib/evidence.ts"
import { parseSealedRecord } from "../lib/evidence.ts"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const NVIM = path.join(ROOT, ".tools", "nvim-linux-x86_64", "bin", "nvim")

let checks = 0
let passed = 0
let mutantsTotal = 0
let mutantsCaught = 0
const mutantRecords: Array<{ name: string; caught: boolean }> = []

function check(label: string, condition: boolean, detail = ""): void {
  checks++
  if (condition) passed++
  else console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
}

/** The fixture — identical text/positions to script/m25/feature-assertions.ts
 *  (the shared core the VS Code leg runs). Drift between the two copies is
 *  caught by the differential assertion set below. */
const FIXTURE_MAIN = `class Greeter {
  greet(): string {
    return "hello"
  }
}

function main(): void {
  const g = new Greeter()
  g.greet()
}
`

type DriverResult = {
  assertions: Array<{ name: string; ok: boolean; detail: string }>
  session: { launch?: { entry: string; mode: string; runtime: string } }
  raw: Record<string, unknown>
}

function writeFixture(dir: string, text: string): void {
  writeFileSync(path.join(dir, "main.ts"), text)
}

/** Seed the index the same way the shared core does (M25.E5 convention:
 *  real hash + stat metadata so staleness starts fresh). */
async function seedIndex(workspaceDir: string, dataDir: string): Promise<void> {
  const canonical = realpathSync(workspaceDir)
  const projectId = createHash("sha1").update(canonical).digest("hex").substring(0, 40)
  const dbDir = path.join(dataDir, "projects", projectId)
  mkdirSync(dbDir, { recursive: true })
  process.env.BB_DATA_DIR = dataDir

  const { BrainDatabase } = await import(path.join(ROOT, "src", "brain", "database.ts"))
  const raw = await BrainDatabase.getRawInstance(projectId)
  const fpath = path.join(workspaceDir, "main.ts")
  const { hashFileContent } = await import(path.join(ROOT, "src", "brain", "freshness.ts"))
  const fileStat = statSync(fpath)
  const fileId = `${projectId}:main.ts`
  raw.prepare(`INSERT INTO brain_file (id, project_id, path, relative_path, language, file_hash, size_bytes, last_modified) VALUES (?,?,?,?,?,?,?,?)`).run(
    fileId, projectId, fpath, "main.ts", "typescript", hashFileContent(readFileSync(fpath)), fileStat.size, Math.floor(fileStat.mtimeMs),
  )
  const symStmt = raw.prepare(
    `INSERT INTO brain_symbol (id, project_id, file_id, name, qualified_name, symbol_type,
      line_start, line_end, byte_start, byte_end, owner_symbol_id, gravity_score)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  symStmt.run("sym-greeter", projectId, fileId, "Greeter", null, "class", 1, 3, 7, 2, null, 10)
  symStmt.run("sym-greet", projectId, fileId, "greet", "Greeter.greet", "method", 2, 2, 3, 8, "sym-greeter", 7)
  symStmt.run("sym-main", projectId, fileId, "main", null, "function", 7, 10, 10, 2, null, 5)
  // relationship_type is "calls" (the REAL analyzer vocabulary, plural — the
  // graph engine's DEFAULT_REL_TYPES filter on it; the M24-era singular
  // "call" was invisible to expandCalls, which the N1 session exposed live:
  // incomingCalls answered [] while hover/references saw the row).
  raw.prepare(`INSERT INTO brain_relationship (id, project_id, source_symbol_id, target_symbol_id, relationship_type, confidence) VALUES (?,?,?,?,?,?)`).run(
    "rel-1", projectId, "sym-main", "sym-greet", "calls", 1.0,
  )
}

/** Run one headless Neovim session with the given driver file. */
function runNvimSession(driverPath: string, workspaceDir: string, outPath: string): { ok: boolean; result: DriverResult | null; stderr: string } {
  let stderr = ""
  if (existsSync(outPath)) rmSync(outPath)
  try {
    execFileSync(NVIM, ["--headless", "--clean", "-u", "NONE", "-i", "NONE", "-n", "-l", driverPath], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, BB27_OUT: outPath, BB27_WS: workspaceDir, BB_LSP_ROOT: ROOT },
      stdio: ["ignore", "pipe", "pipe"],
    })
  } catch (error) {
    const err = error as { stderr?: string; message?: string }
    stderr = err.stderr ?? err.message ?? ""
    if (!existsSync(outPath)) return { ok: false, result: null, stderr }
    // nvim exits non-zero after qa! sometimes; results still count.
  }
  if (!existsSync(outPath)) return { ok: false, result: null, stderr: "no results written" }
  const result = parseSealedRecord(outPath) as DriverResult
  return { ok: true, result, stderr }
}

function runAssertionSet(result: DriverResult, assert: (name: string, ok: boolean, detail?: string) => void): void {
  for (const a of result.assertions) assert(a.name, a.ok, a.detail)
}

async function main(): Promise<void> {
  let currentCommit = "unknown"
  try {
    currentCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {}

  // --- R1: provisioned toolchain ------------------------------------------
  check("N1: portable Neovim is provisioned (.tools/nvim-linux-x86_64)", existsSync(NVIM), NVIM)
  if (!existsSync(NVIM)) {
    const result = {
      issue: "M27.N1", code: "N1", milestone: "M27",
      status: "blocked", blockedReason: "nvim not provisioned in .tools/ (D-7 portable layout)",
    checks, passed, failed: checks - passed, mutantsCaught, mutantsTotal, mutantRecords,
    currentCommit,
    verifierCommand: "npx tsx script/m27/verify-nvim.ts", evidenceFile: "N1.json",
      generatedAt: new Date().toISOString(),
    }
    mkdirSync(path.join(ROOT, "validation/m27/results"), { recursive: true })
    writeSealed(path.join(ROOT, "validation/m27/results/N1.json"), result)
    console.log("N1: BLOCKED (no nvim)")
    process.exit(1)
  }
  const version = execFileSync(NVIM, ["--version"], { encoding: "utf8" }).split("\n")[0]
  check("N1: nvim version records", /NVIM v\d/.test(version), version)

  // --- Fixture workspace + seeded index (shared-core convention) ----------
  const base = mkdtempSync(path.join(os.tmpdir(), "n1-base-"))
  const workspaceDir = mkdtempSync(path.join(base, "n1-ws-"))
  const dataDir = mkdtempSync(path.join(base, "n1-data-"))
  writeFixture(workspaceDir, FIXTURE_MAIN)
  await seedIndex(workspaceDir, dataDir)

  const tmpOut = path.join(base, "out.json")

  // --- R2: the REAL session ------------------------------------------------
  const driverPath = path.join(ROOT, "script", "m27", "nvim-driver.lua")
  const run = runNvimSession(driverPath, workspaceDir, tmpOut)
  check("N1: headless session completes and writes results", run.ok && run.result !== null, run.stderr.slice(0, 200))
  if (run.result) {
    check("N1: launch order resolves dist server (declared order, no guess)", run.result.session?.launch?.mode === "dist", JSON.stringify(run.result.session?.launch ?? null))
    runAssertionSet(run.result, (name, ok, detail) => check(name, ok, detail ?? ""))
  }

  // --- R3: differential honesty vs the shared core's fixture facts ---------
  if (run.result) {
    const raw = run.result.raw as Record<string, any>
    // The exact strings the VS Code leg (feature-assertions.ts L2–L5) requires.
    const hover = raw.hover as any
    const hoverText = typeof hover?.contents === "string" ? hover.contents : (hover?.contents?.value ?? "")
    check("R3: hover names greet (same as VS Code L2)", hoverText.includes("greet"), hoverText.slice(0, 120))
    check("R3: hover tier present (same as VS Code L2)", hover?.data?.tier !== undefined || hoverText.includes("evidence:"), hoverText.slice(0, 120))
    const def = raw.definition as any
    const defLine = def?.location?.line ?? def?.line ?? (Array.isArray(def) ? def[0]?.range?.start?.line : def?.range?.start?.line)
    check("R3: definition at 0-based line 1 (same as VS Code L3)", defLine === 1, JSON.stringify(def ?? null).slice(0, 160))
    const docSym = raw.documentSymbol as any
    const symList = Array.isArray(docSym) ? docSym : Array.isArray(docSym?.symbols) ? docSym.symbols : []
    check("R3: documentSymbol root Greeter (same as VS Code L4)", symList[0]?.name === "Greeter", JSON.stringify(docSym ?? null).slice(0, 200))
    const staleness = raw.staleness as any
    check("R3: staleness marker boolean (contract §4 via real client)", staleness !== null && typeof staleness?.stale === "boolean", JSON.stringify(staleness ?? null).slice(0, 160))
  }

  // --- R4: the suite CAN FAIL (session-level mutants) ----------------------
  // Each mutant is a copy of the real driver with one honest defect planted;
  // the verifier must catch it via the failing assertion set.
  const mutants: Array<{ name: string; from: string; to: string }> = [
    {
      name: "M1 hover position off by one line",
      from: 'local hover_pos = { line = 1, character = 2 }',
      to: 'local hover_pos = { line = 2, character = 2 }',
    },
    {
      name: "M2 wrong fixture symbol expected",
      from: 'record("N1: documentSymbol root is Greeter", sym_root ~= nil and sym_root.name == "Greeter"',
      to: 'record("N1: documentSymbol root is Greeter", sym_root ~= nil and sym_root.name == "NotGreeter"',
    },
    {
      name: "M3 capability expectation inverted (driver demands the wrong thing)",
      from: 'record("N1: hover capability advertised", caps.hoverProvider == true',
      to: 'record("N1: hover capability advertised", caps.hoverProvider == false',
    },
    {
      name: "M4 staleness payload corrupted (driver reports a non-boolean marker)",
      from: 'results.raw.staleness = staleness',
      to: 'results.raw.staleness = { stale = "fresh-ish" }',
    },
  ]

  const driverSrc = readFileSync(driverPath, "utf8")
  for (const m of mutants) {
    mutantsTotal++
    if (!driverSrc.includes(m.from)) {
      mutantRecords.push({ name: m.name, caught: false })
      console.log(`  WARN: mutant anchor not found: ${m.name}`)
      continue
    }
    const mutantPath = path.join(base, "driver-mutant.lua")
    writeFileSync(mutantPath, driverSrc.replace(m.from, m.to))
    const mutantOut = path.join(base, "out-mutant.json")
    const mrun = runNvimSession(mutantPath, workspaceDir, mutantOut)
    let caught = false
    if (mrun.result) {
      // Two detection layers, both applied to every mutant: (1) the driver's
      // own assertion set, (2) the R3 differential re-derivation over the raw
      // payloads (M4 corrupts raw.staleness, which only layer 2 reads).
      caught = mrun.result.assertions.some((a) => !a.ok)
      if (!caught) {
        const raw = mrun.result.raw as Record<string, any>
        const staleness = raw.staleness as any
        const docSym = raw.documentSymbol as any
        const symList = Array.isArray(docSym) ? docSym : Array.isArray(docSym?.symbols) ? docSym.symbols : []
        const hover = raw.hover as any
        const hoverText = typeof hover?.contents === "string" ? hover.contents : (hover?.contents?.value ?? "")
        const r3 = [
          staleness !== null && typeof staleness?.stale === "boolean",
          symList[0]?.name === "Greeter",
          hoverText.includes("greet"),
        ]
        caught = r3.some((ok) => !ok)
      }
    }
    // A mutant session that fails to complete (crash/timeout) also counts as
    // caught — the defect is surfaced, not silent.
    caught = caught || !mrun.ok
    mutantRecords.push({ name: m.name, caught })
    if (caught) mutantsCaught++
    else console.log(`  SURVIVED: ${m.name}`)
    rmSync(mutantPath, { force: true })
    rmSync(mutantOut, { force: true })
  }
  check("N1: all session mutants are caught", mutantsCaught === mutantsTotal && mutantsTotal > 0, `${mutantsCaught}/${mutantsTotal}`)

  // Cleanup.
  rmSync(base, { recursive: true, force: true })

  // --- Persist evidence ----------------------------------------------------
  const failed = checks - passed
  const result = {
    issue: "M27.N1",
    code: "N1",
    milestone: "M27",
    status: failed === 0 && mutantsCaught === mutantsTotal ? "verified" : "known-gap",
    checks,
    passed,
    failed,
    mutantsCaught,
    mutantsTotal,
    mutantRecords,
    nvim: version,
    currentCommit,
    verifierCommand: "npx tsx script/m27/verify-nvim.ts",
    evidenceFile: "N1.json",
    generatedAt: new Date().toISOString(),
    claimLevel: "I3 — real editor session, machine-driven, real server over stdio",
    limitations: [
      "Fixture seeded with the shared-core convention (real hash + stat) — the same shape M25.E5 uses.",
      "Graph webview out of scope in Neovim (D-6); the capability matrix records the delta.",
    ],
  }
  const evidenceDir = path.join(ROOT, "validation/m27/results")
  mkdirSync(evidenceDir, { recursive: true })
  writeSealed(path.join(evidenceDir, result.evidenceFile), result)
  console.log(`N1: ${result.status.toUpperCase()} (${passed}/${checks} passed, ${mutantsCaught}/${mutantsTotal} mutants)`)
  process.exit(failed === 0 && mutantsCaught === mutantsTotal ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
