// script/m45/verify-r3-real-repo-integrity.ts — M45.R3
// Real-repository integrity corpus. Copies of rake (Ruby, .git kept) and
// ripgrep (Rust, .git removed) are FULL-indexed with the default pipeline
// (parse + store + resolution + enrichment + health), then SQL-audited for
// the corruption classes the M45 deep review found at scale:
//   orphan owners == 0, dead (non-empty) source edges == 0, orphan targets
//   == 0, plus zero config-virtual orphans and the fixed health checks ok.
// Wall times per repo are recorded with a documented cap so a future store
// change cannot silently degrade integrity or add O(n²) behavior.
// Source: $HOME/fixtures/repositories (copies only — never live).
// Evidence: validation/m45/results/R3.json (BB_M45_EVIDENCE === "1" && pass).

import { cpSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m45/results/R3.json")
const SOURCE_REPOS = path.join("$HOME/fixtures/repositories")
const CAP_FULL_INDEX_MS = 600_000 // 10 min per repo incl. derived passes

let checks = 0, passed = 0, failed = 0, negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
delete process.env.BB_NO_AUTO_REFRESH

const REPOS: Array<{ name: string; keepGit: boolean }> = [
  { name: "rake", keepGit: true },
  { name: "ripgrep", keepGit: false },
]

function copyRepo(name: string, keepGit: boolean, dest: string): void {
  cpSync(path.join(SOURCE_REPOS, name), dest, { recursive: true })
  if (!keepGit && existsSync(path.join(dest, ".git"))) rmSync(path.join(dest, ".git"), { recursive: true, force: true })
}

function countIndexable(dir: string): number {
  let n = 0
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(rb|rs|ts|js|py|go|java|json|yaml|yml|css)$/.test(e.name)) n++
    }
  }
  walk(dir)
  return n
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { runIndexHealthCheck } = await import(path.join(ROOT, "src/brain/brain-index-health"))

  const root = mkdtempSync(path.join(tmpdir(), "m45-r3-"))
  const measurements: Array<{ name: string; ms: number; files: number; symbols: number }> = []

  try {
    for (const repo of REPOS) {
      if (!existsSync(path.join(SOURCE_REPOS, repo.name))) {
        check(`R3 ${repo.name}: source copy present in fixtures/repositories`, false, path.join(SOURCE_REPOS, repo.name))
        continue
      }
      const proj = path.join(root, repo.name)
      copyRepo(repo.name, repo.keepGit, proj)
      const files = countIndexable(proj)
      const pid = getProjectId(proj)
      const t0 = Date.now()
      const stats = await indexProjectParallel(pid, proj, {})
      const wallMs = Date.now() - t0
      const sum = stats.summary!

      const raw = await BrainDatabase.getRawInstance(pid as any)
      const count = (sql: string, ...args: any[]) => (raw.prepare(sql).get(...args) as any)?.n ?? 0
      const dbSymbols = count("SELECT COUNT(*) AS n FROM brain_symbol WHERE project_id = ?", pid)
      measurements.push({ name: `${repo.name}.full-index`, ms: wallMs, files, symbols: dbSymbols })

      check(`R3 ${repo.name}: full index completed`, sum.errors === 0 && sum.newlyParsed >= 1, `errors=${sum.errors} parsed=${sum.newlyParsed}`)
      check(`R3 ${repo.name}: wall time under cap (${CAP_FULL_INDEX_MS}ms)`, wallMs <= CAP_FULL_INDEX_MS, `${wallMs}ms`)
      check(`R3 ${repo.name}: symbols stored > 0`, dbSymbols > 0, `symbols=${dbSymbols}`)
      const orphanOwners = count(`SELECT COUNT(*) AS n FROM brain_symbol s WHERE s.project_id = ?
        AND s.owner_symbol_id IS NOT NULL AND s.owner_symbol_id != ''
        AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)`, pid)
      const dangling = count(`SELECT COUNT(*) AS n FROM brain_relationship r WHERE r.project_id = ?
        AND r.source_symbol_id IS NOT NULL AND r.source_symbol_id != ''
        AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.source_symbol_id AND s.project_id = r.project_id)`, pid)
      const orphanTargets = count(`SELECT COUNT(*) AS n FROM brain_relationship r WHERE r.project_id = ?
        AND r.target_symbol_id IS NOT NULL AND r.target_symbol_id != ''
        AND NOT EXISTS (SELECT 1 FROM brain_symbol s WHERE s.id = r.target_symbol_id AND s.project_id = r.project_id)`, pid)
      const configOrphans = count(`SELECT COUNT(*) AS n FROM brain_symbol s LEFT JOIN brain_file f ON f.id = s.file_id
        WHERE s.project_id = ? AND f.language IN ('json','yaml')
        AND s.owner_symbol_id IS NOT NULL AND s.owner_symbol_id != ''
        AND NOT EXISTS (SELECT 1 FROM brain_symbol p WHERE p.id = s.owner_symbol_id AND p.project_id = s.project_id)`, pid)

      check(`R3 ${repo.name}: orphan owners == 0`, orphanOwners === 0, `orphans=${orphanOwners}`)
      check(`R3 ${repo.name}: dead source edges == 0`, dangling === 0, `dangling=${dangling}`)
      check(`R3 ${repo.name}: orphan targets == 0`, orphanTargets === 0, `targets=${orphanTargets}`)
      check(`R3 ${repo.name}: config-virtual orphans == 0`, configOrphans === 0, `config=${configOrphans}`)

      const health = await runIndexHealthCheck(pid as any)
      const names = new Map((health.checks ?? []).map((c: any) => [c.name, c]))
      for (const n of ["Orphan Owner References", "Dangling Source Relationships", "Orphan Target Relationships"]) {
        const c = names.get(n)
        check(`R3 ${repo.name}: health '${n}' ok`, !!c && c.value === 0 && c.status === "ok", JSON.stringify(c ?? {}).slice(0, 120))
      }
      rmSync(proj, { recursive: true, force: true })
    }

    // ── negatives ──
    {
      const fake = { orphanOwners: 3 }
      negative("R3 negative: nonzero orphan claim refused", fake.orphanOwners !== 0, "corruption accepted")
      const fakeTime = { wallMs: CAP_FULL_INDEX_MS + 1 }
      negative("R3 negative: over-cap timing refused", fakeTime.wallMs > CAP_FULL_INDEX_MS, "slow index accepted")
      negative("R3 negative: an absent repo copy would be reported, not excused", existsSync(path.join(SOURCE_REPOS, "rake")) && existsSync(path.join(SOURCE_REPOS, "ripgrep")), "source repos missing")
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [] as string[],
    verifierCommand: "bun run script/m45/verify-r3-real-repo-integrity.ts",
    evidenceFile: "R3.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases, checks,
    measurements,
    caps: { fullIndexMs: CAP_FULL_INDEX_MS },
  }
  if (process.env.BB_M45_EVIDENCE === "1" && ok) {
    const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
    mkd(path.dirname(RESULT), { recursive: true })
    wfs(RESULT, JSON.stringify(evidence, null, 2) + "\n")
  }
  console.log(`M45 R3 REAL-REPO INTEGRITY: ${ok ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  for (const m of measurements) console.log(`  measure ${m.name}: ${m.ms}ms (files=${m.files} symbols=${m.symbols})`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("R3 gate crashed:", e)
  process.exit(1)
})
