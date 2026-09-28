// script/m57/verify-gate-selftest.ts — M57.G2
//
// Mutation-based self-test (M31/M35/M40/M50 pattern). For every registered
// non-infra M57 gate this proves TWO things:
//   control   the gate PASSES on the clean world
//   mutation  the gate FAILS when the surface it governs is corrupted
//
// Real-DB gates (T2/T4) mutate their RECEIPT (the governed evidence surface),
// not the DB. T1/T3/T5 mutate the governed SOURCE with byte-identical restore.
// The gate's exit code is the only verdict consulted — never its prose.
//
// Run: npx tsx script/m57/verify-gate-selftest.ts

import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs"
import path from "node:path"
import { tmpdir } from "node:os"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const GATE_TIMEOUT = 420_000
// The data dir of the re-indexed real DB (same shell HOME resolution the
// receipts were stamped under).
const REAL_DATA_DIR = process.env.BB_M57_DATA_DIR || path.join(process.env.HOME || "$HOME/.khushal_file", ".bb")

interface Mutation {
  gate: string
  script: string
  env?: Record<string, string>
  file: string
  find: string
  replace: string
}

const MUTATIONS: Mutation[] = [
  {
    gate: "T1",
    script: "verify-t1-classifier.ts",
    file: "src/ast/test-classification.ts",
    find: "  if (isNonCodeLanguage(language) || (!language && hasNonCodeExtension(relativePath))) return false\n  return pathShapeSaysTest(relativePath)",
    replace: "  // MUTANT: file-type gate disabled\n  return pathShapeSaysTest(relativePath)",
  },
  {
    gate: "T2",
    script: "verify-t2-consumers.ts",
    env: { BB_M57_REAL_DB: "1", BB_M57_DATA_DIR: REAL_DATA_DIR },
    // The governed surface of U1b is testQuality's disclosure. Mutating the
    // helper in test-intel changes every consumer at once — the widest true
    // surface. The mutant produces a WRONG disclosure string.
    file: "src/intelligence/testing/test-intel.ts",
    find: "export function noEvidenceUnknown(): string {\n  return NO_EVIDENCE_UNKNOWN\n}",
    replace: "export function noEvidenceUnknown(): string {\n  return \"MUTANT: wrong disclosure\" // MUTANT\n}",
  },
  {
    gate: "T3",
    script: "verify-t3-scope-all.ts",
    file: "src/intelligence/patterns/orphans.ts",
    find: "  const truncated = candidates.length > maxResults\n  const page = candidates\n    .slice(0, maxResults)",
    replace: "  const truncated = candidates.length > maxResults\n  const page = candidates // MUTANT: page ignores maxResults",
  },
  {
    gate: "T4",
    script: "verify-t4-corpus-identity.ts",
    env: { BB_M57_REAL_DB: "1", BB_M57_DATA_DIR: REAL_DATA_DIR },
    // Governed surface: the receipt's classifierEpoch. Tamper it; M3 must fail.
    file: "validation/m57/results/T5-predicate-unity.json",
    find: "\"classifierEpoch\": \"",
    replace: "\"classifierEpoch\": \"0",
  },
  {
    gate: "T5",
    script: "verify-t5-predicate-unity.ts",
    file: "src/ast/analysis-exclusions.ts",
    find: "  return isTestFileCandidate(relativePath)\n}\n\nexport function isAnalysisExcluded",
    replace: "  return relativePath.includes(\"test\") || relativePath.includes(\"spec\") // MUTANT: private detector restored\n}\n\nexport function isAnalysisExcluded",
  },
]

function runGate(script: string, env?: Record<string, string>): { code: number } {
  const r = spawnSync("bun", ["run", path.join(ROOT, "script/m57", script)], {
    cwd: ROOT,
    encoding: "utf8",
    timeout: GATE_TIMEOUT,
    env: { ...process.env, ...env },
  })
  return { code: r.status ?? 1 }
}

function mutate(file: string, find: string, replace: string): () => void {
  const full = path.join(ROOT, file)
  const before = readFileSync(full, "utf8")
  if (!before.includes(find)) throw new Error(`mutation anchor not found in ${file}`)
  writeFileSync(full, before.replace(find, replace))
  let restored: string | null = null
  return () => {
    if (restored === null) {
      writeFileSync(full, before)
      restored = before
    }
    if (readFileSync(full, "utf8") !== before) throw new Error(`restore mismatch: ${file}`)
  }
}

async function main() {
  let pass = 0
  let failed = 0
  const results: Array<{ gate: string; control: string; mutation: string }> = []

  for (const m of MUTATIONS) {
    // CONTROL
    const c = runGate(m.script, m.env)
    const controlOk = c.code === 0
    // MUTATION
    let mutationFailed = false
    let restore: (() => void) | null = null
    try {
      restore = mutate(m.file, m.find, m.replace)
      const x = runGate(m.script, m.env)
      mutationFailed = x.code !== 0
    } catch (e: any) {
      // Anchor missing = the surface moved; that is a governance failure, not a pass.
      mutationFailed = false
      console.log(`  (mutation setup error for ${m.gate}: ${e?.message})`)
    } finally {
      restore?.()
    }
    const ok = controlOk && mutationFailed
    if (ok) { pass++; console.log(`  ok ${m.gate}: control PASS, mutation FAILS, restored byte-identical`) }
    else { failed++; console.log(`FAIL ${m.gate}: control=${controlOk ? "PASS" : "FAIL"} mutation-rejected=${mutationFailed ? "yes" : "NO"}`) }
    results.push({ gate: m.gate, control: controlOk ? "pass" : "fail", mutation: mutationFailed ? "rejected" : "accepted" })
  }

  const dir = path.join(ROOT, "validation/m57/results")
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "G2-selftest.json"), JSON.stringify({ probe: "M57.G2-selftest", at: new Date().toISOString(), checks: pass + failed, passed: pass, failed, results }, null, 2) + "\n")

  console.log(`\nG2 self-test: ${pass} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error("FAIL", e?.stack || e?.message); process.exit(1) })
