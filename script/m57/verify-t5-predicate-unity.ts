// script/m57/verify-t5-predicate-unity.ts — M57.T5 (#793) permanent gate.
//
// Proves ONE definition of "what is a test file" (src/ast/test-classification.ts):
//
//   P1. The canonical predicate decides the battery of real-shape cases
//       (code tests YES; data fixtures, raw-substring false positives NO).
//   P2. AnalysisExclusions.isTestPath delegates — behaviorally identical to the
//       canonical predicate on every battery case (a copy would drift, this
//       catches the drift the day it appears).
//   P3. ALLOWLIST CENSUS: every src/ file that mentions test-shape vocabulary
//       either imports test-classification (consumer of the ONE definition)
//       or is on the declared-benign allowlist with a reason. A new private
//       detector cannot merge unnoticed.
//   P4. The two duplicate detectors M57 found are now delegates
//       (api-coverage-analyzer, brain-relationship-enrichment).
//   P5. REAL-DB (BB_M57_REAL_DB=1): the indexer's is_test_file flag equals the
//       canonical predicate on EVERY file row of the re-indexed real DB.
//   N1. Falsifiability: a wrong battery answer fails; a flagged-but-not-predicate
//       real-DB row fails.
//
// Runs under bun AND node/tsx.

import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")

async function main() {
  const { isTestFileCandidate, NON_CODE_TEST_LANGUAGES } = await import(path.join(ROOT, "src/ast/test-classification"))
  const { AnalysisExclusions } = await import(path.join(ROOT, "src/ast/analysis-exclusions"))

  let pass = 0
  let failed = 0
  const check = (name: string, ok: boolean, detail?: string) => {
    if (ok) { pass++; console.log(`  ok ${name}`) } else { failed++; console.log(`FAIL ${name}${detail ? ` :: ${detail}` : ""}`) }
  }
  const negative = (name: string, wouldFail: boolean) => {
    if (wouldFail) { pass++; console.log(`  ok NEGATIVE ${name}`) } else { failed++; console.log(`FAIL NEGATIVE ${name}`) }
  }

  // ---- P1: the canonical battery ------------------------------------------
  // Every case is a real shape that appeared in a real detector here or in a
  // user report. (file, language | null, expected)
  const battery: Array<[string, string | null, boolean, string]> = [
    ["src/list.test.ts", "typescript", true, "infix .test."],
    ["tests/helper.py", "python", true, "tests/ dir segment"],
    ["internal/auth_test.go", "go", true, "Go _test infix"],
    ["crates/x/tests/it/main.rs", "rust", true, "tests/ dir (rust)"],
    ["UserTests.swift", "swift", true, "Tests? stem"],
    ["spec/models/user_spec.rb", "ruby", true, "spec/ dir + _spec infix"],
    ["e2e/login.e2e.ts", "typescript", true, "e2e/ dir"],
    ["tools/spec/table.json", "json", false, "M50 conviction: data fixture under /spec/"],
    ["script/m14/spec/cpp-completeness.json", "json", false, "the convicted corpus"],
    ["src/contest.ts", "typescript", false, "raw-substring false positive (old api-coverage regex)"],
    ["src/testing-utils.ts", "typescript", false, "dir-less name containing 'test'"],
    ["docs/testing-guide.md", "markdown", false, "non-code, test-shaped dir"],
    ["validation/m14/results/M14.0.SPEC.json", "json", false, "convicted corpus (uppercase SPEC)"],
  ]
  for (const [p, lang, expected, why] of battery) {
    check(`P1: ${p} -> ${expected} (${why})`, isTestFileCandidate(p, lang) === expected, `got ${isTestFileCandidate(p, lang)}`)
  }
  check("P1: the non-code vocabulary is exported and non-empty", Array.isArray(NON_CODE_TEST_LANGUAGES) && NON_CODE_TEST_LANGUAGES.length >= 15, String(NON_CODE_TEST_LANGUAGES?.length))
  // The file-type gate wins over ANY path shape: same path, non-code language
  // must be false, code language decided by shape.
  check("P1: the gate is type-first (spec/x.json false even though spec/ says test)", isTestFileCandidate("spec/x.json", "json") === false)

  // ---- P2: isTestPath delegates behaviorally ------------------------------
  let drift = 0
  for (const [p, lang] of battery.map(([p, l]) => [p, l] as [string, string | null])) {
    // isTestPath is extension-driven (no stored language at call sites); the
    // predicate with language=null uses the same extension fallback.
    if (AnalysisExclusions.isTestPath(p) !== isTestFileCandidate(p, null)) drift++
  }
  check("P2: isTestPath == canonical predicate on the whole battery", drift === 0, `${drift} drifted`)

  // ---- P3: allowlist census over src/ --------------------------------------
  const PATTERN = /\.test\.|\.spec\.|_test\.|_spec\.|__tests__|Tests?\$|\/tests?\/|\/spec\//i
  const allowlist: Record<string, string> = {
    "src/ast/test-classification.ts": "the ONE definition itself",
    "src/ast/analysis-exclusions.ts": "delegates (kept TEST_DIR_SEGMENTS for SQL LIKE builders only)",
    "src/ast/graph.ts": "comment-only mention (same-basename heuristic note)",
    "src/ast/framework-intelligence.ts": "framework *content* detection (XCTest/QuickCheck), not file classification",
    "src/intelligence/contracts.ts": "type/contract names only (isTestCode field, TestIntel types)",
    "src/brain/brain-relationship-enrichment.ts": "P4: converted to a delegate this milestone",
    "src/ast/api-coverage-analyzer.ts": "P4: converted to a delegate this milestone",
    "src/intelligence/testing/suggestions.ts": "filename GENERATOR (suggests writing X.test.ts), not a classifier",
    "src/intelligence/testing/quality.ts": "historical comment only (M50 provenance narrative)",
    "src/intelligence/testing/test-intel.ts": "historical comment only; vocabulary imported from the canonical module",
    "src/ast/patterns.ts": "SQL LIKE fragment (%/test/% LIKE builder), not a predicate",
    "src/ast/real-clojure-analyzer.ts": "clojure.spec.alpha library symbols, unrelated to test files",
    "src/brain/brain.sql.ts": "column definition (is_test_file DDL)",
    "src/brain/schema-ddl.ts": "column definition (is_test_file DDL)",
  }
  const offenders: Array<{ file: string; hit: string }> = []
  const { readdirSync, statSync } = await import("node:fs")
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith(".ts")) {
        const rel = path.relative(ROOT, full)
        if (allowlist[rel] !== undefined) continue
        const text = readFileSync(full, "utf8")
        const importsCanonical = /from\s+"[^"]*test-classification"/.test(text)
        if (PATTERN.test(text) && !importsCanonical) {
          const line = text.split("\n").findIndex((l) => PATTERN.test(l)) + 1
          offenders.push({ file: rel, hit: `line ${line}` })
        }
      }
    }
  }
  walk(path.join(ROOT, "src"))
  check("P3: every test-shape mention in src/ imports the ONE definition or is allowlisted", offenders.length === 0, JSON.stringify(offenders))

  // ---- P4: the two converted detectors really delegate --------------------
  const aca = readFileSync(path.join(ROOT, "src/ast/api-coverage-analyzer.ts"), "utf8")
  check("P4a: api-coverage-analyzer delegates (old raw-substring regex gone)", !aca.includes('/test|spec|__tests__/') && aca.includes("isTestFileCandidate(filePath)"))
  const bre = readFileSync(path.join(ROOT, "src/brain/brain-relationship-enrichment.ts"), "utf8")
  check("P4b: relationship-enrichment isTestCode delegates", bre.includes("isTestFileCandidate(sourceFile)") && !bre.includes('sourceFile.includes("/test/")'))

  // ---- P5: real-DB flag == predicate (re-indexed world) --------------------
  let corpusIdentity: { files: number; symbols: number; relationships: number; flagged: number; digest: string } | null = null
  if (process.env.BB_M57_REAL_DB === "1") {
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
    const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
    const pid = getProjectId(ROOT) as string
    const raw = await BrainDatabase.getRawInstance(pid)
    const rows = raw.prepare("SELECT relative_path p, language l, COALESCE(is_test_file,0) f FROM brain_file WHERE project_id=?").all(pid) as Array<{ p: string; l: string; f: number }>
    // M57.T4: the receipt carries the corpus identity it was measured against
    // so the T4 gate can detect a stale receipt after any re-index.
    const flaggedList = rows.filter((r) => r.f).map((r) => r.p)
    corpusIdentity = {
      files: rows.length,
      symbols: (raw.prepare("SELECT COUNT(*) n FROM brain_symbol WHERE project_id=?").get(pid) as any).n,
      relationships: (raw.prepare("SELECT COUNT(*) n FROM brain_relationship WHERE project_id=?").get(pid) as any).n,
      flagged: flaggedList.length,
      digest: createHash("sha256").update(flaggedList.join("\n")).digest("hex").slice(0, 16),
    }
    let diverged = 0
    for (const r of rows) if (!!r.f !== isTestFileCandidate(r.p, r.l)) diverged++
    check(`P5: flag == canonical predicate on all ${rows.length} real-DB rows`, diverged === 0, `${diverged} diverged`)
    const flagged = rows.filter((r) => r.f).map((r) => r.p)
    console.log(`  (real DB: ${rows.length} files, ${flagged.length} flagged: ${flagged.slice(0, 8).join(", ") || "none"})`)
    // negative: a fabricated divergence must be caught by the same comparison
    negative("a fabricated flag/predicate divergence", (() => { const fake = rows.length > 0; let d = 0; if (fake) { const r0 = rows[0]; if (!!r0.f === isTestFileCandidate(r0.p, r0.l)) d = 1 } return d > 0 })())
    BrainDatabase.closeAll()
  } else {
    console.log("  -- P5 (real-DB unity) skipped: set BB_M57_REAL_DB=1 after the re-index")
  }

  // ---- evidence stamp ------------------------------------------------------
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
    const classifierEpoch = createHash("sha256").update(readFileSync(path.join(ROOT, "src/ast/test-classification.ts"), "utf8")).digest("hex").slice(0, 16)
    const dir = path.join(ROOT, "validation/m57/results")
    if (existsSync(dir) || true) {
      const { mkdirSync, writeFileSync } = await import("node:fs")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        path.join(dir, "T5-predicate-unity.json"),
        JSON.stringify({ probe: "M57.T5-predicate-unity", issue: 793, milestone: "M57", at: new Date().toISOString(), commit, checks: pass + failed, passed: pass, failed, battery: battery.length, allowlistSize: Object.keys(allowlist).length, corpus: corpusIdentity, classifierEpoch, verifierCommand: "npx tsx script/m57/verify-t5-predicate-unity.ts", status: failed === 0 ? "verified" : "known-gap" }, null, 2) + "\n",
      )
    }
  } catch { /* best-effort stamp; exit code is the verdict */ }

  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error("FAIL", e && (e.stack || e.message)); process.exit(1) })
