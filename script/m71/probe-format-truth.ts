// script/m71/probe-format-truth.ts — REVIEW PROBE for bb_edit (not a gate).
//
// Measures the formatter step of executeEdit, before and after the D5 fix:
//
//   1. no mapping        — `.rb` has no tryAutoFormat mapping, so `formatted: true`
//                          can only be a claim about the REQUEST.
//   2. what it costs     — a `.ts` file with no local prettier: how long does the
//                          edit take, and does anything format it?
//   3. mapped, fails     — a LOCAL node_modules/.bin/prettier that exits 3. Does
//                          `formatted` reflect the failure?
//   4. mapped, times out — the same, but the fake formatter sleeps 5s against a
//                          1500ms timeout. Does `formatted` reflect the kill?
//   5. filename reach    — `tryAutoFormat` built a SHELL command with the path
//                          interpolated into it (`exec(\`npx prettier --write
//                          "${path}"\`)`). A file whose NAME contains a command
//                          substitution is a legal filename inside the project and
//                          passes resolveSafeEditPath, which validates containment
//                          only. If the marker file appears, the file name executed.
//
//   6. isolated cost     — tryAutoFormat called directly, so the formatter step's
//                          own wall time is separated from indexing.
//
// Run: npx tsx script/m71/probe-format-truth.ts

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/cli/index"
import { BrainDatabase } from "../../src/brain/database"
import { executeEdit } from "../../src/intelligence/edit/edit-engine"
import { BrainSurgicalPatcher } from "../../src/ast/brain-surgical-patcher"

const root = mkdtempSync(path.join(tmpdir(), "bb-probe-format-"))
const projectId = getProjectId(root)

/** Create a fake local formatter that npx/the resolver will find first. */
function fakePrettier(body: string): void {
  const bin = path.join(root, "node_modules", ".bin")
  mkdirSync(bin, { recursive: true })
  const p = path.join(bin, "prettier")
  writeFileSync(p, `#!/bin/sh\n${body}\n`)
  chmodSync(p, 0o755)
}

async function edit(filePath: string, content: string, format?: boolean) {
  const started = Date.now()
  try {
    const result = await executeEdit(root, projectId, { mode: "write", filePath, content, ...(format === undefined ? {} : { format }) })
    return { ms: Date.now() - started, result, error: null as string | null }
  } catch (e) {
    return { ms: Date.now() - started, result: null, error: String(e) }
  }
}

try {
  // ── 0. The formatter step's own wall time, isolated ─────────────────────
  console.log("── 0. isolated tryAutoFormat cost (.ts, no local prettier) ─────")
  {
    const p = path.join(root, "cost.ts")
    writeFileSync(p, "export const cost = 1\n")
    const started = Date.now()
    await BrainSurgicalPatcher.tryAutoFormat(p)
    console.log(`   tryAutoFormat returned after ${Date.now() - started}ms`)
  }

  // ── 1. An extension with no formatter mapping at all ─────────────────────
  console.log("── 1. no mapping (.rb) ─────────────────────────────────────────")
  writeFileSync(path.join(root, "a.rb"), "def   target\n    1\nend\n")
  const noMap = await edit("a.rb", "def   target\n      2\nend\n")
  console.log(`   formatted field = ${noMap.result?.formatted}`)
  console.log(`   file on disk    = ${JSON.stringify(readFileSync(path.join(root, "a.rb"), "utf8"))}`)

  // ── 2. A mapped extension with no formatter installed anywhere ──────────
  console.log("── 2. mapped, not installed (.ts; no prettier on this machine) ──")
  rmSync(path.join(root, "node_modules"), { recursive: true, force: true })
  const notInstalled = await edit("b.ts", "export function b(): number {\n  return 1\n}\n")
  console.log(`   formatted field = ${notInstalled.result?.formatted}`)
  console.log(`   edit took       = ${notInstalled.ms}ms (rate: the formatter step is included)`)
  console.log(`   unchanged bytes = ${readFileSync(path.join(root, "b.ts"), "utf8") === "export function b(): number {\n  return 1\n}\n"}`)
  console.log(`   formatting det. = ${JSON.stringify((notInstalled.result as any)?.formatting ?? null)}`)

  // ── 3. A mapped extension whose formatter FAILS (exit 3) ────────────────
  console.log("── 3. mapped and failing (fake prettier exits 3) ───────────────")
  fakePrettier('echo "boom: refusing" >&2\nexit 3')
  const failed = await edit("c.ts", "export function c(): number {\n  return 3\n}\n")
  console.log(`   formatted field = ${failed.result?.formatted}`)
  console.log(`   warnings        = ${JSON.stringify(failed.result?.warnings ?? [])}`)
  console.log(`   formatting det. = ${JSON.stringify((failed.result as any)?.formatting ?? null)}`)

  // ── 4. A mapped extension whose formatter TIMES OUT (sleep 5s) ──────────
  console.log("── 4. mapped and timing out (fake prettier sleeps 5s) ──────────")
  fakePrettier("sleep 5\nexit 0")
  const timedOut = await edit("d.ts", "export function d(): number {\n  return 4\n}\n")
  console.log(`   formatted field = ${timedOut.result?.formatted}`)
  console.log(`   warnings        = ${JSON.stringify(timedOut.result?.warnings ?? [])}`)
  console.log(`   edit took       = ${timedOut.ms}ms`)
  console.log(`   formatting det. = ${JSON.stringify((timedOut.result as any)?.formatting ?? null)}`)

  // ── 5. A filename that carries a command substitution ───────────────────
  console.log("── 5. filename reachability (command substitution in the NAME) ──")
  // The substitution must expand to a BARE name: a `/` inside it would make the
  // "file name" a path and the write would fail before any formatter ran. The
  // formatter is invoked with cwd = the file's directory, so `touch pwned`
  // lands in the project root.
  const marker = path.join(root, "pwned")
  rmSync(marker, { force: true })
  fakePrettier("exit 0") // a formatter that runs and succeeds, so the only variable is the NAME
  const hostile = "inj$(touch pwned).ts"
  writeFileSync(path.join(root, hostile), "export function inj(): number {\n  return 5\n}\n")
  const injected = await edit(hostile, "export function inj(): number {\n  return 55\n}\n")
  console.log(`   marker <root>/pwned created by the file NAME? ${existsSync(marker) ? "YES — the name executed" : "no"}`)
  console.log(`   edit result     = formatted=${injected.result?.formatted} error=${injected.error ?? "none"}`)
  rmSync(marker, { force: true })
  console.log(`   (marker is <root>/pwned, scrubbed afterwards)`)
} finally {
  rmSync(root, { recursive: true, force: true })
  rmSync(path.dirname(BrainDatabase.getDbPath(projectId)), { recursive: true, force: true })
}
