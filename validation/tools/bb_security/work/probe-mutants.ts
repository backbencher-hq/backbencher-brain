// Falsifiability proof for the bb_security suite: every gate below is shown RED
// on a planted mutant of the code it is supposed to police, then GREEN on the
// restored tree. A gate that cannot go red is not evidence.
//
// Safety: each mutant is applied to a file in this tool's own scope, the gate is
// run, and the original bytes are restored in a finally block; the restore is
// verified by sha256 before the next mutant starts. No git operation is used.
import { createHash } from "node:crypto"
import { copyFileSync, readFileSync, writeFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { LANE, ROOT, writeEvidence, gitHead } from "./lib"

const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
const tsxBin = path.join(ROOT, "node_modules", ".bin", "tsx")

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex")
}

function runGate(script: string): { exit: number; output: string; durationMs: number } {
  const started = Date.now()
  const result = isBun
    ? spawnSync("bun", ["run", script], { cwd: ROOT, encoding: "utf8", timeout: 1_500_000, env: { ...process.env, BB_NO_AUTO_REFRESH: "1" } })
    : spawnSync(tsxBin, [script], { cwd: ROOT, encoding: "utf8", timeout: 1_500_000, env: { ...process.env, BB_NO_AUTO_REFRESH: "1" } })
  return { exit: result.status ?? -1, output: `${result.stdout ?? ""}${result.stderr ?? ""}`.slice(-4000), durationMs: Date.now() - started }
}

interface Mutant {
  id: string
  file: string
  find: string
  replace: string
  gate: string
  expects: string
}

const MUTANTS: Mutant[] = [
  {
    id: "handler-read-not-readonly",
    file: "src/mcp/tools/bb_security/handler.ts",
    find: "raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })",
    replace: "raw = await BrainDatabase.getRawInstance(projectId)",
    gate: "script/m13/verify-security-contract.ts",
    expects: "the handler's read-only open assertion",
  },
  {
    id: "engine-read-not-readonly",
    file: "src/intelligence/security/taint.ts",
    find: "const raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })",
    replace: "const raw = await BrainDatabase.getRawInstance(projectId)",
    gate: "script/m13/verify-security-contract.ts",
    expects: "the engine's read-only open assertion",
  },
  {
    id: "engine-resolve-project-filter",
    file: "src/intelligence/security/taint.ts",
    find: 'f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.id IN (" +\n      chunk.map(() => "?").join(",") +\n      ")"\n    for (const s of raw.prepare(stmt).all(...chunk)',
    replace: 'f.relative_path AS file FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id WHERE s.project_id = ? AND s.id IN (" +\n      chunk.map(() => "?").join(",") +\n      ")"\n    for (const s of raw.prepare(stmt).all(projectId, ...chunk)',
    gate: "script/verify-security.ts",
    expects: "the keyed symbol-resolution assertion",
  },
  {
    id: "live-cap-note-dropped",
    file: "src/mcp/tools/bb_security/handler.ts",
    find: '`${suspicious.length ? ` and ${Math.min(suspicious.length, SECURITY_SUSPICIOUS_WINDOW)} of ${suspicious.length} unvalidated observation(s)` : ""}]` +\n    capNote',
    replace: '`${suspicious.length ? ` and ${Math.min(suspicious.length, SECURITY_SUSPICIOUS_WINDOW)} of ${suspicious.length} unvalidated observation(s)` : ""}]`',
    gate: "script/m13/verify-security-handler.ts",
    expects: "the live CAPPED sentence",
  },
  {
    id: "history-page-cap-removed",
    file: "src/mcp/tools/bb_security/handler.ts",
    find: "const findings = history.findings.slice(0, SECURITY_HISTORY_FINDINGS_CAP)",
    replace: "const findings = history.findings",
    gate: "script/m13/verify-security-handler.ts",
    expects: "the declared history page cap",
  },
  {
    id: "history-fingerprint-drops-state",
    file: "src/mcp/tools/bb_security/handler.ts",
    find: "taint:${finding.type}:${finding.sinkType ?? \"?\"}:${finding.state ?? \"confirmed\"}:${finding.file ?? \"?\"}:${finding.line ?? \"?\"}",
    replace: "taint:${finding.type}:${finding.sinkType ?? \"?\"}:${finding.file ?? \"?\"}:${finding.line ?? \"?\"}",
    gate: "script/m20/verify-security-history.ts",
    expects: "the distinct-identity assertion for two findings at one sink",
  },
  {
    id: "library-door-creates-index",
    file: "src/mcp/tools/bb_security/handler.ts",
    find: "raw = await BrainDatabase.getRawInstance(projectId, { readonly: true })",
    replace: "raw = await BrainDatabase.getRawInstance(projectId)",
    gate: "script/m13/verify-security-handler.ts",
    expects: "the library-door unindexed-project refusal",
  },
  {
    id: "descriptor-advertises-planned-mode",
    file: "src/mcp/tools/bb_security/descriptor.ts",
    find: 'modes: ["findings"],',
    replace: 'modes: ["findings", "flow"],',
    gate: "script/m13/verify-security-contract.ts",
    expects: "the executable-modes contract",
  },
  {
    id: "docs-description-drift",
    file: "docs/tools/bb_security.md",
    find: "Taint-flow security scan over the indexed source-to-sink flows:",
    replace: "Security scan over the indexed source-to-sink flows:",
    gate: "script/m13/verify-security-docs.ts",
    expects: "the page-description-vs-registry check",
  },
]

async function main() {
  const out: any = {
    schemaVersion: 1,
    tool: "bb_security",
    generatedAt: new Date().toISOString(),
    currentCommit: gitHead(),
    command: "npx tsx validation/tools/bb_security/work/probe-mutants.ts",
    method: "apply one mutation to the owned source, run the gate (expect non-zero), restore, run the same gate (expect zero)",
    mutants: [],
  }

  for (const mutant of MUTANTS) {
    const file = path.join(ROOT, mutant.file)
    const original = readFileSync(file, "utf8")
    const originalHash = sha256(original)
    const targetHash = sha256(original.replace(mutant.find, mutant.replace))
    const applied = targetHash !== originalHash
    let red: { exit: number; output: string; durationMs: number } | null = null
    let green: { exit: number; output: string; durationMs: number } | null = null
    let restored = false
    try {
      if (!applied) throw new Error("mutation anchor did not match the current file; refusing to report a mutant that never landed")
      writeFileSync(file, original.replace(mutant.find, mutant.replace))
      red = runGate(mutant.gate)
    } finally {
      writeFileSync(file, original)
      restored = sha256(readFileSync(file, "utf8")) === originalHash
      green = runGate(mutant.gate)
    }
    const drivenRed = red !== null && red.exit !== 0
    const drivenGreen = green !== null && green.exit === 0
    const record = {
      id: mutant.id,
      file: mutant.file,
      gate: mutant.gate,
      expects: mutant.expects,
      mutantApplied: applied,
      restored,
      red: { exit: red?.exit ?? null, durationMs: red?.durationMs ?? null, evidence: red?.output.split("\n").filter((line) => /FAIL/.test(line)).slice(0, 3) },
      green: { exit: green?.exit ?? null, durationMs: green?.durationMs ?? null },
      falsifiable: applied && restored && drivenRed && drivenGreen,
    }
    out.mutants.push(record)
    console.log(`${record.falsifiable ? "RED→GREEN" : "NOT-FALSIFIABLE"} ${mutant.id} [${mutant.gate}] red=${red?.exit} green=${green?.exit} restored=${restored}`)
  }

  out.summary = {
    total: out.mutants.length,
    falsifiable: out.mutants.filter((m: any) => m.falsifiable).length,
    allRestored: out.mutants.every((m: any) => m.restored),
  }
  const file = writeEvidence("mutants.json", out)
  console.log(file)
  console.log(JSON.stringify(out.summary))
  if (out.summary.falsifiable !== out.summary.total) process.exit(1)
}
await main()
