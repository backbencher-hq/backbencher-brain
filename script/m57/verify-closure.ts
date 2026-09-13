// script/m57/verify-closure.ts — M57.X1 (#794)
//
// Closure gate: refuses milestone close unless every subordinate gate actually
// PASSES right now (re-run live, never trusted from evidence), the real-DB
// receipts carry the corpus identity + classifier epoch of the CURRENT world,
// and the downstream set (gates that consume the surfaces M57 changed) is green.
//
// REAL-DB legs use BB_M57_REAL_DB=1 BB_M57_DATA_DIR=<data dir> (the closure
// command is documented in the PLAN; without them closure fails honestly).

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const GATE_TIMEOUT = 600_000
const REAL_DATA_DIR = process.env.BB_M57_DATA_DIR || path.join(process.env.HOME || "$HOME/.khushal_file", ".bb")

const SUBORDINATE: Array<{ code: string; script: string; env?: Record<string, string> }> = [
  { code: "T1", script: "verify-t1-classifier.ts", env: { BB_M57_REAL_DB: "1", BB_M57_DATA_DIR: REAL_DATA_DIR } },
  { code: "T2", script: "verify-t2-consumers.ts", env: { BB_M57_REAL_DB: "1", BB_M57_DATA_DIR: REAL_DATA_DIR } },
  { code: "T3", script: "verify-t3-scope-all.ts" },
  { code: "T4", script: "verify-t4-corpus-identity.ts", env: { BB_M57_REAL_DB: "1", BB_M57_DATA_DIR: REAL_DATA_DIR } },
  { code: "T5", script: "verify-t5-predicate-unity.ts", env: { BB_M57_REAL_DB: "1", BB_M57_DATA_DIR: REAL_DATA_DIR } },
]

// Downstream set: gates consuming the surfaces M57 edited (re-run, not trusted).
// Every entry was verified GREEN on the current tree before being listed —
// closure demands live proof, never memory.
const DOWNSTREAM: Array<{ code: string; script: string }> = [
  { code: "M50.A2-test-sources", script: "script/m50/verify-a2-test-sources.ts" },
  { code: "M48.P3-agreement", script: "script/m48/verify-p3-agreement.ts" },
  { code: "M13.patterns-orphans", script: "script/m13/verify-patterns-orphans.ts" },
  { code: "M13.test-intel", script: "script/verify-test-intel.ts" },
  { code: "M13.test-quality", script: "script/verify-test-quality.ts" },
]

// DECLARED FOREIGN REDS: gates that fail at HEAD for reasons proven OUTSIDE
// this milestone (revert-my-files attribution during M50; conviction posted on
// #764). They are re-run here and must fail EXACTLY as documented — if one
// suddenly PASSES, the corpus moved and the conviction must be re-examined.
const FOREIGN_REDS: Array<{ code: string; script: string; reason: string }> = [
  { code: "M20.patterns-orphan-semantics", script: "script/m20/verify-patterns-orphan-semantics.ts", reason: "pre-existing at HEAD: dynamic string access indexed with a fabricated static target (analyzer/indexer lane, convicted during M50)" },
]

async function main() {
  let pass = 0
  let failed = 0
  // M57 follow-up: capture each gate's output so a RED is diagnosable. On
  // 2026-09-13 a single closure run reported M13.test-intel exit=1 with no
  // reason recorded (spawnSync had swallowed its output); the next 7 runs were
  // green. Without the tail, a flake and a real regression look identical.
  let LAST_OUT = ""
  const run = (cmd: string, args: string[], env?: Record<string, string>) => {
    const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", timeout: GATE_TIMEOUT, env: { ...process.env, ...env } })
    LAST_OUT = `${r.stdout ?? ""}${r.stderr ?? ""}`
    return r.status ?? 1
  }
  const dumpFail = (label: string) => {
    const lines = LAST_OUT.trimEnd().split("\n")
    console.log(`  ---- ${label} output (last 25 lines) ----`)
    for (const l of lines.slice(-25)) console.log(`  | ${l}`)
  }

  for (const g of SUBORDINATE) {
    const code = run("bun", ["run", path.join(ROOT, "script/m57", g.script)], g.env)
    if (code === 0) { pass++; console.log(`  ok subordinate ${g.code} (${g.script})`) }
    else { failed++; console.log(`FAIL subordinate ${g.code} (${g.script}) exit=${code}`); dumpFail(g.code) }
  }

  for (const g of DOWNSTREAM) {
    const code = run("bun", ["run", g.script])
    if (code === 0) { pass++; console.log(`  ok downstream ${g.code}`) }
    else { failed++; console.log(`FAIL downstream ${g.code} (${g.script}) exit=${code}`); dumpFail(g.code) }
  }

  for (const g of FOREIGN_REDS) {
    const code = run("bun", ["run", g.script])
    if (code !== 0) { pass++; console.log(`  ok foreign-red ${g.code} fails as documented (${g.reason})`) }
    else { failed++; console.log(`FAIL foreign-red ${g.code} now PASSES — the documented conviction no longer reproduces; re-examine before closing`); dumpFail(g.code) }
  }

  // Receipt currency: every M57 gate receipt stamped at the CURRENT commit.
  // (The census JSONs are corpus snapshots, not gate receipts — the T1 GATE
  // receipt below is the commit-stamped artifact for the classifier proof.)
  const commit = spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout?.trim() ?? ""
  for (const name of ["T1-classifier.json", "T2-consumers.json", "T3-scope-all.json", "T4-corpus-identity.json", "T5-predicate-unity.json"]) {
    const p = path.join(ROOT, "validation/m57/results", name)
    try {
      const ev = JSON.parse(readFileSync(p, "utf8"))
      if (ev.commit === commit) { pass++; console.log(`  ok receipt ${name} is current (${commit.slice(0, 8)})`) }
      else { failed++; console.log(`FAIL receipt ${name} stamped at ${String(ev.commit).slice(0, 8)} != HEAD ${commit.slice(0, 8)} — re-run its gate`) }
    } catch (e: any) {
      failed++
      console.log(`FAIL receipt ${name} unreadable: ${e?.message}`)
    }
  }

  mkdirSync(path.join(ROOT, "validation/m57/results"), { recursive: true })
  writeFileSync(path.join(ROOT, "validation/m57/results/X1-closure.json"), JSON.stringify({ probe: "M57.X1-closure", at: new Date().toISOString(), commit, checks: pass + failed, passed: pass, failed }, null, 2) + "\n")

  console.log(`\nX1 closure: ${pass} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error("FAIL", e?.stack || e?.message); process.exit(1) })
