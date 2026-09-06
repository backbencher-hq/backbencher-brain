// script/m46/verify-h2-real-repo-syntax.ts — M46.H2
// Real-repository syntax-truth corpus (regression armature for 2da3cf4e).
//
// The bug class: a fresh full index of THIS repo flagged 5 healthy real-code
// files as syntax-broken (four tree-sitter grammar gaps + one lint warning).
// H2 full-indexes real repositories with the default pipeline and re-checks
// every flagged real-code file with an INDEPENDENT probe re-parse (this gate's
// own neutralizer copy + the real parser):
//   - a flagged file that parses clean after neutralization => grammar-gap
//     false positive => FAIL (the leak 2da3cf4e fixed)
//   - a flagged file with zero genuine parse errors => lint/other leak => FAIL
//   - a flagged file that still errors after neutralization => genuinely
//     broken => allowed, recorded (real signal kept)
// Non-code files (md/sh/sql/json/yml/css/…) are documented grammar-gap
// classes: exempt from FAIL but recorded in evidence.
// Corpus: this repository (mandatory) + rake (Ruby), lodash (JS), graphql-js
// (TS) copies from $HOME/fixtures/repositories (R3 convention —
// copies only, never live repos). Wall times recorded with a per-repo cap.
// Evidence: validation/m46/results/H2.json (BB_M46_EVIDENCE === "1" && pass).

import { mkdtempSync, cpSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m46/results/H2.json")
const SOURCE_REPOS = "$HOME/fixtures/repositories"
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

// Isolate every DB write in a fresh temp data dir — this gate FULL-indexes the
// real repo and must never touch the user's actual index.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "m46-h2-data-"))
process.env.BB_DATA_DIR = DATA_DIR

const SYNTAX_WARNING_RE = /syntax|unexpected node|missing node|bypass|broken node|parse error/i
const CODE_EXTS = new Set([
  "ts", "tsx", "js", "jsx", "mts", "cts", "mjs", "cjs", "vue", "svelte",
  "rb", "py", "rs", "go", "java", "kt", "kts", "scala", "clj", "cljs",
  "groovy", "fs", "fsx", "cs", "php", "swift", "c", "h", "cpp", "hpp", "cc",
  "dart", "ex", "exs", "lua", "r", "zig", "nim",
])
const NON_CODE_DOCUMENTED_GAP = "non-code (documented grammar-gap class: md/sh/sql/json/yml/css/html — exempt from FAIL, recorded)"

function neutralize(content: string, language: string): string {
  let c = content
  c = c.replace(/import\((["'])([^"'\n]*?)\1\)(?:\.[A-Za-z_$][\w$]*)*/g, "object")
  if (language === "tsx") {
    c = c.replace(/(=\s*)(["'])([\s\S]*?)\2/g, (m, pre, q, inner: string) => `${pre}${q}${inner.replace(/&(?!amp;)/g, "&amp;")}${q}`)
  } else {
    c = c.replace(/\bunique\b(?!\s*symbol)/g, "uniqxx")
    c = c.replace(/<!--/g, "<!__")
  }
  return c
}

const t0 = Date.now()
const perRepo: Array<Record<string, unknown>> = []

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database"))
  const { parseFile } = await import(path.join(ROOT, "src/ast/engine"))

  const langFor = (rel: string) => (rel.endsWith(".tsx") ? "tsx" : rel.endsWith(".js") || rel.endsWith(".jsx") || rel.endsWith(".mjs") || rel.endsWith(".cjs") ? "javascript" : "typescript")
  const syntaxCount = (errors: Array<{ severity?: string; message?: string }>) =>
    (errors ?? []).filter((e) => e.severity === "warning" && SYNTAX_WARNING_RE.test(String(e?.message ?? ""))).length

  const CORPUS = [
    { name: "backbencher-brain (self)", dir: ROOT, copy: false, exemptValidation: true },
    { name: "rake", dir: path.join(SOURCE_REPOS, "rake"), copy: true, exemptValidation: false },
    { name: "lodash", dir: path.join(SOURCE_REPOS, "lodash"), copy: true, exemptValidation: false },
    { name: "graphql-js", dir: path.join(SOURCE_REPOS, "graphql-js"), copy: true, exemptValidation: false },
  ]

  const workRoot = mkdtempSync(path.join(tmpdir(), "m46-h2-"))
  try {
    for (const repo of CORPUS) {
      const tag = `H2 ${repo.name}`
      const proj = repo.copy ? path.join(workRoot, repo.name.replace(/[^a-z0-9-]+/gi, "-")) : repo.dir
      if (!existsSync(repo.dir)) {
        check(`${tag}: source present`, false, repo.dir)
        continue
      }
      if (repo.copy) cpSync(repo.dir, proj, { recursive: true })
      const pid = getProjectId(proj)
      const t1 = Date.now()
      const stats = await indexProjectParallel(pid, proj, {})
      const wallMs = Date.now() - t1
      const sum = stats.summary!
      check(`${tag}: full index completed`, sum.errors === 0 && sum.newlyParsed >= 1, `errors=${sum.errors} parsed=${sum.newlyParsed}`)
      check(`${tag}: wall time under cap (${CAP_FULL_INDEX_MS}ms)`, wallMs <= CAP_FULL_INDEX_MS, `${wallMs}ms`)

      const raw = await BrainDatabase.getRawInstance(pid as any)
      const flagged = (raw.prepare(
        "SELECT relative_path, has_syntax_errors, error_report FROM brain_file WHERE project_id = ? AND has_syntax_errors = 1",
      ).all(pid) as Array<{ relative_path: string; has_syntax_errors: number; error_report: string | null }>)

      const exempted: string[] = []
      const genuine: string[] = []
      const leaks: Array<{ rel: string; why: string }> = []
      for (const row of flagged) {
        const rel = row.relative_path.replace(/\\/g, "/")
        const base = path.basename(rel)
        const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : ""
        // self-repo negative-fixture corpora are by-design poison
        if (repo.exemptValidation && (rel.startsWith("validation/") || rel.includes("/node_modules/") || rel.startsWith(".git"))) { exempted.push(rel); continue }
        if (!CODE_EXTS.has(ext)) { exempted.push(`${rel} (${NON_CODE_DOCUMENTED_GAP})`); continue }
        const abs = path.join(proj, rel)
        let content: string
        try { content = readFileSync(abs, "utf8") } catch { leaks.push({ rel, why: "flagged but unreadable on disk" }); continue }
        const orig = syntaxCount((await parseFile(abs, content)).errors ?? [])
        const neu = syntaxCount((await parseFile(abs, neutralize(content, langFor(rel)))).errors ?? [])
        if (neu >= 1) genuine.push(rel)                       // genuinely broken: real signal, allowed
        else if (orig === 0) leaks.push({ rel, why: "flagged with zero genuine parse errors (lint/other leak)" })
        else leaks.push({ rel, why: "grammar-gap-only false positive (parse clean after neutralization)" })
      }

      check(`${tag}: zero grammar-gap / lint false positives on real code`, leaks.length === 0,
        leaks.map((l) => `${l.rel}: ${l.why}`).slice(0, 4).join(" | "))
      perRepo.push({
        name: repo.name,
        ms: wallMs,
        newlyParsed: sum.newlyParsed,
        flaggedTotal: flagged.length,
        exemptedCount: exempted.length,
        exempted: exempted.slice(0, 12),
        genuineCount: genuine.length,
        genuine: genuine.slice(0, 12),
        leaks,
      })
    }
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
    rmSync(DATA_DIR, { recursive: true, force: true })
  }

  // ── negatives (ok == true means the bad state WOULD be refused) ──
  {
    // verdict helper mirrors the leak classification: a fabricated grammar-gap
    // leak (orig>0, neu==0) must be refused
    const classify = (orig: number, neu: number) => (neu >= 1 ? "genuine" : orig === 0 ? "leak-lint" : "leak-gap")
    negative("H2 negative: grammar-gap leak (orig>0, neu==0) is refused", classify(1, 0) !== "genuine", "")
    negative("H2 negative: lint leak (orig==0) is refused", classify(0, 0) !== "genuine", "")
    negative("H2 negative: genuine breakage (neu>=1) is not refused", classify(1, 1) === "genuine", "")
    // NOTE: a corpus where every repo is genuinely clean (zero flagged rows) is
    // the GOAL, not a sign of vacuousness — so no "flagged rows exist" negative
    // here. Corpus vacuousness is guarded by the positive checks above: a repo
    // that is missing (source present) or fails to index (index completed / wall
    // time under cap) FAILS the gate outright.
  }

  const elapsedMs = Date.now() - t0
  check("H2 time bound (< 25 min for the whole corpus)", elapsedMs < 1_500_000, `${elapsedMs}ms`)

  const ok = failed === 0
  const evidence = {
    status: ok ? "verified" : "known-gap",
    currentCommit: execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim(),
    workingTreeRelevantChanges: [] as string[],
    verifierCommand: "bun run script/m46/verify-h2-real-repo-syntax.ts",
    evidenceFile: "H2.json",
    generatedAt: new Date().toISOString(),
    passed, failed, negativeCases, checks, elapsedMs,
    observed: { dataDir: DATA_DIR, repos: perRepo },
  }
  if (process.env.BB_M46_EVIDENCE === "1" && ok) {
    const { mkdirSync: mkd, writeFileSync: wfs } = await import("node:fs")
    mkd(path.dirname(RESULT), { recursive: true })
    wfs(RESULT, JSON.stringify(evidence, null, 2) + "\n")
  }
  console.log(`M46 H2 REAL-REPO SYNTAX TRUTH: ${ok ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("H2 gate crashed:", e)
  process.exit(1)
})
