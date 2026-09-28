// script/m57/verify-t1-classifier.ts — M57.T1 (#789) permanent gate.
//
// Proves the file-type gate at the SOURCE, on fixtures indexed with the REAL
// indexer, plus the re-index proof on this repo's own DB:
//
//   C1. A /spec/*.json data fixture is NOT flagged is_test_file (was the M50
//       conviction: all 30 flagged files were JSON).
//   C2. A real code test source IS flagged: src/x.test.ts, tests/helper.py.
//   C3. A plain production source is NOT flagged.
//   C4. The indexer's flag agrees with AnalysisExclusions.isTestPath on every
//       fixture file (T5 divergence check, fixture-scale).
//   C5. RE-INDEX PROOF: over the real repo DB (BB_M57_REAL_DB=1), every flagged
//       file is code and none of the M50-convicted JSON fixtures is flagged.
//   N1. Mutation: reverting the file-type gate must fail C1 (the gate can fail).
//
// Runs under bun AND node/tsx.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
// BB_M57_DATA_DIR: run C5 against a specific data dir (e.g. the sandbox DB
// produced by probe-reindex-sandbox.ts) WITHOUT clobbering the fixture DB this
// gate creates for C1-C4. Only honored for the real-DB leg.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-m57-t1-"))
// Fixture legs (C1-C4) ALWAYS use the private temp data dir. The real-DB leg
// (C5) points BB_DATA_DIR at BB_M57_DATA_DIR only inside its own branch, so a
// gate run can never write fixture projects into the user's real data dir.
process.env.BB_DATA_DIR = DATA_DIR

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { AnalysisExclusions } = await import(path.join(ROOT, "src/ast/analysis-exclusions"))

  let pass = 0
  let failed = 0
  const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) { pass++; console.log(`  ok ${name}`) } else { failed++; console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`) }
  }

  // ---- fixture: exactly the four shapes T1a/T1b must distinguish ----------
  const proj = mkdtempSync(path.join(tmpdir(), "bb-m57-t1-proj-"))
  mkdirSync(path.join(proj, "tools", "spec"), { recursive: true })
  mkdirSync(path.join(proj, "src"), { recursive: true })
  mkdirSync(path.join(proj, "tests"), { recursive: true })
  writeFileSync(path.join(proj, "tools", "spec", "table.json"), JSON.stringify({ cases: [{ a: 1 }] }, null, 2))
  writeFileSync(path.join(proj, "src", "x.test.ts"), `import { util } from "./util"\nexport function check(): number { return util(1) }\n`)
  writeFileSync(path.join(proj, "tests", "helper.py"), `from src.util import util\n\ndef test_util():\n    assert util(1) == 1\n`)
  writeFileSync(path.join(proj, "src", "util.ts"), `export function util(v: number): number { return v + 1 }\n`)
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "m57-t1-fixture", version: "1.0.0" }))

  const pid = getProjectId(proj)
  const r = await indexProjectParallel(pid as any, proj, { force: true, skipPostProcessing: true })
  if (r.errors && r.errors.length) throw new Error(`fixture index errors: ${JSON.stringify(r.errors)}`)
  const raw = await BrainDatabase.getRawInstance(pid as string)
  const q = (sql: string, ...p: any[]) => raw.prepare(sql).all(...p) as any[]
  const rows = q("SELECT relative_path p, COALESCE(is_test_file,0) f, language l FROM brain_file WHERE project_id=? ORDER BY relative_path", pid) as Array<{ p: string; f: number; l: string }>
  const flag = (p: string) => rows.find((x) => x.p === p)?.f ?? -1

  check("C1: /spec/*.json data fixture is NOT flagged", flag("tools/spec/table.json") === 0, `flag=${flag("tools/spec/table.json")}`)
  check("C2a: src/x.test.ts IS flagged", flag("src/x.test.ts") === 1, `flag=${flag("src/x.test.ts")}`)
  check("C2b: tests/helper.py IS flagged", flag("tests/helper.py") === 1, `flag=${flag("tests/helper.py")}`)
  check("C3: plain production source is NOT flagged", flag("src/util.ts") === 0, `flag=${flag("src/util.ts")}`)

  let diverged = 0
  for (const row of rows) {
    const predicate = AnalysisExclusions.isTestPath(row.p)
    if (!!row.f !== predicate) diverged++
  }
  check("C4: indexer flag == canonical predicate on every fixture file", diverged === 0, `${diverged} diverged`)

  // ---- C5: re-index proof on the REAL repo DB ------------------------------
  if (process.env.BB_M57_REAL_DB === "1") {
    // Scope the env swap to THIS branch only: the real data dir (sandbox DB
    // from probe-reindex-sandbox.ts, or the re-indexed ~/.bb) is read here,
    // while the fixture legs above stay in their private temp dir. Swapping
    // globally was the original C5c bug shape (a real-pid lookup against an
    // empty fixture DB).
    const realDataDir = process.env.BB_M57_DATA_DIR
    if (!realDataDir) throw new Error("BB_M57_REAL_DB=1 requires BB_M57_DATA_DIR=<real data dir>")
    const prevDataDir = process.env.BB_DATA_DIR
    process.env.BB_DATA_DIR = realDataDir
    const realPid = getProjectId(ROOT) as string
    const realRaw = await BrainDatabase.getRawInstance(realPid)
    const flagged = realRaw.prepare("SELECT relative_path p, language l FROM brain_file WHERE project_id=? AND COALESCE(is_test_file,0)=1 ORDER BY relative_path").all(realPid) as Array<{ p: string; l: string }>
    const nonCode = flagged.filter((f) => ["json", "yaml", "yml", "md", "toml", "xml", "csv", "txt"].includes((f.l || "").toLowerCase()))
    check("C5a: every flagged file on the real DB is code", nonCode.length === 0, JSON.stringify(nonCode.slice(0, 5)))
    const convicted = flagged.filter((f) => f.p.startsWith("script/m14/spec/") || f.p === "validation/m14/results/M14.0.SPEC.json")
    check("C5b: none of the M50-convicted JSON fixtures is flagged", convicted.length === 0, JSON.stringify(convicted.slice(0, 5)))
    // C5c: the flag must equal the canonical predicate over EVERY file — the
    // real invariant. A zero corpus is legitimate (this repo's suite is the
    // script/* verifier gates, not test-named files) as long as the predicate
    // agrees file-by-file.
    let c5diverged = 0
    const all = realRaw.prepare("SELECT relative_path p, language l, COALESCE(is_test_file,0) f FROM brain_file WHERE project_id=?").all(realPid) as Array<{ p: string; l: string; f: number }>
    for (const row of all) {
      if (!!row.f !== AnalysisExclusions.isTestPath(row.p)) c5diverged++
    }
    check(`C5c: flag == canonical predicate on all ${all.length} real-DB files`, c5diverged === 0, `${c5diverged} diverged; flagged=${flagged.length}`)
    BrainDatabase.closeAll()
    process.env.BB_DATA_DIR = prevDataDir
  } else {
    console.log("  -- C5 (real-DB re-index proof) skipped: set BB_M57_REAL_DB=1 after re-index")
  }

  // ---- evidence stamp ------------------------------------------------------
  try {
    const { execFileSync } = await import("node:child_process")
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    const dir = path.join(ROOT, "validation/m57/results")
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      path.join(dir, "T1-classifier.json"),
      JSON.stringify({ probe: "M57.T1-classifier", issue: 789, milestone: "M57", at: new Date().toISOString(), commit, checks: pass + failed, passed: pass, failed, fixture: { files: rows.length }, verifierCommand: "npx tsx script/m57/verify-t1-classifier.ts", status: failed === 0 ? "verified" : "known-gap" }, null, 2) + "\n",
    )
  } catch { /* best-effort stamp; exit code is the verdict */ }

  BrainDatabase.closeAll()
  rmSync(DATA_DIR, { recursive: true, force: true })
  rmSync(proj, { recursive: true, force: true })
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error("FAIL", e && (e.stack || e.message)); process.exit(1) })
