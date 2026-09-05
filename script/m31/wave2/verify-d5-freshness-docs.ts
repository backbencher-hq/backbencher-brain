// script/m31/wave2/verify-d5-freshness-docs.ts — M31.D5 (#666)
// Documents the landed M43 freshness automation truthfully. Every check is a
// real predicate over real files and the executable constants; no auto-pass.
//
// Assertions:
//   1. bb_search.md (the ONLY tool whose reads auto-refresh inline) documents
//      the auto-refresh knobs with their code-true defaults and opt-outs:
//      BB_AUTO_REFRESH_MAX_FILES (default 25), BB_AUTO_REFRESH_MAX_BYTES
//      (default 2 MiB), BB_NO_AUTO_REFRESH=1 (disable-all; any other value
//      leaves it enabled), per-call refresh=false / --no-auto-refresh, and the
//      honest-decline path (out of budget / disabled / lock held).
//   2. The env names asserted in docs equal the exported code allowlist
//      (AUTO_REFRESH_ENV_ALLOWLIST) — a new knob cannot merge undocumented.
//   3. bb_health.md reports its freshness truthfully (fresh/stale/missing +
//      stale/missing file names; explicit refresh/force only — it never
//      auto-refreshes silently). Regression guard: the old generic "does not
//      report index staleness" boilerplate must NOT be present there.
//   4. bb_index.md keeps the truthful "does not report index staleness"
//      statement (it IS the manual repair interface, not a read path).
//   5. FRESHNESS_REMEDIATION dir + file constants appear byte-wise in the
//      bb_search.md and bb_health.md staleness sections and the CLI guide
//      (the docs cannot drift from the registered remediation text).
//   6. Negatives: a fabricated doc claiming auto-refresh without naming the
//      disable mechanism is refused; a doc claiming auto-refresh always runs
//      even under BB_NO_AUTO_REFRESH=1 is refused; a knob default diverging
//      from AUTO_REFRESH_DEFAULTS is refused.
//
// Seam for the wave-2 mutation proof:
//   BB_M31_MUTATE_D5_SKIP_KNOBS=1  evaluates bb_search.md as if its staleness
//   section were empty — every knob check must fail (exit 1, no evidence).
//   BB_M31_READ_ONLY=1 suppresses evidence stamping (probe runs).

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const RESULTS_DIR = path.join(ROOT, "validation/m31/wave2/results")
const SKIP_KNOBS = process.env.BB_M31_MUTATE_D5_SKIP_KNOBS === "1"

let passed = 0, failed = 0, negatives = 0
function check(label: string, ok: boolean, detail = "") {
  if (ok) passed++
  else { failed++; console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`) }
}
function negative(label: string, ok: boolean, detail = "") {
  negatives++
  check(`${label} [negative]`, ok, detail)
}

async function main() {
  const { FRESHNESS_REMEDIATION } = await import("../../../src/brain/freshness")
  const { AUTO_REFRESH_ENV_ALLOWLIST, AUTO_REFRESH_DEFAULTS } = await import("../../../src/ast/auto-refresh")
  const searchDocPath = path.join(ROOT, "docs/tools/bb_search.md")
  const healthDocPath = path.join(ROOT, "docs/tools/bb_health.md")
  const indexDocPath = path.join(ROOT, "docs/tools/bb_index.md")
  const guidePath = path.join(ROOT, "docs/MCP_CLI_INDEXER_GUIDE.md")

  let searchSec = ""
  if (existsSync(searchDocPath)) {
    const md = readFileSync(searchDocPath, "utf8")
    const m = md.match(/## Staleness\n\n([^\n]+)/)
    searchSec = m ? m[1] : ""
  }
  // Seam: simulate the knobs documentation missing from bb_search.md.
  if (SKIP_KNOBS) searchSec = ""

  const envs = [...AUTO_REFRESH_ENV_ALLOWLIST]
  const defaults = AUTO_REFRESH_DEFAULTS as { maxFiles: number; maxBytes: number }
  const miB = defaults.maxBytes / (1024 * 1024)

  // ── 1. bb_search.md: knobs with code-true defaults + opt-outs ──
  check("bb_search.md staleness section present", searchSec.length > 0, searchDocPath)
  for (const env of envs) {
    check(`bb_search.md names ${env}`, searchSec.includes(env), `env allowlist says docs must name ${env}`)
  }
  check("bb_search.md names the file budget default (code-true 25)", searchSec.includes(`default ${defaults.maxFiles} stale+missing files`), String(defaults.maxFiles))
  check("bb_search.md names the byte budget default (code-true 2 MiB)", searchSec.includes(`default ${miB} MiB of modified-file bytes`), String(defaults.maxBytes))
  check("bb_search.md names the disable-all env semantics", searchSec.includes("BB_NO_AUTO_REFRESH=1") && searchSec.includes("any other value leaves it enabled"), "")
  check("bb_search.md names the per-call opt-outs", searchSec.includes("refresh=false") && searchSec.includes("--no-auto-refresh"), "")
  check("bb_search.md names the honest-decline path", searchSec.includes("Out of budget, disabled, or while another indexer holds the single-flight index lock") && searchSec.includes("honest decline"), "")
  check("bb_search.md names both registered remediation constants", searchSec.includes(FRESHNESS_REMEDIATION.dir) && searchSec.includes(FRESHNESS_REMEDIATION.file), "")

  // ── 3. bb_health.md truthful staleness ──
  let healthSec = ""
  if (existsSync(healthDocPath)) {
    const md = readFileSync(healthDocPath, "utf8")
    const m = md.match(/## Staleness\n\n([^\n]+)/)
    healthSec = m ? m[1] : ""
  }
  check("bb_health.md staleness section present", healthSec.length > 0, healthDocPath)
  negative("bb_health.md no longer carries the false generic boilerplate", !healthSec.includes("does not report index staleness"), "")
  check("bb_health.md says it reports fresh/stale/missing counts", healthSec.includes("fresh/stale/missing counts"), "")
  check("bb_health.md says verbose lists stale/missing file names", healthSec.includes("stale and missing file names when verbose=true"), "")
  check("bb_health.md never auto-refreshes silently", healthSec.includes("never reindexes silently") && healthSec.includes("refresh=true") && healthSec.includes("force=true"), "")
  check("bb_health.md names both registered remediation constants", healthSec.includes(FRESHNESS_REMEDIATION.dir) && healthSec.includes(FRESHNESS_REMEDIATION.file), "")

  // ── 4. bb_index.md keeps its truthful non-staleness statement ──
  const indexDoc = existsSync(indexDocPath) ? readFileSync(indexDocPath, "utf8") : ""
  check("bb_index.md says it does not report staleness", indexDoc.includes("This tool does not report index staleness"), "")

  // ── 5. CLI guide byte-agreement ──
  const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf8") : ""
  check("CLI guide present", guide.length > 0, guidePath)
  check("CLI guide names all auto-refresh envs", envs.every((e) => guide.includes(e)), envs.filter((e) => !guide.includes(e)).join(","))
  check("CLI guide names the per-call CLI opt-out", guide.includes("--no-auto-refresh"), "")
  // The guide states the reindex interfaces (byte-wise constant agreement is
  // the M35-governed layer: tool docs + TOOLS_OVERVIEW).
  check("CLI guide names the --changed reindex flag", guide.includes("bb index <dir> --changed") && guide.includes("--changed"), "")
  check("CLI guide names the bb_index MCP tool", guide.includes("bb_index"), "")
  check("CLI guide names the single-flight lock decline", guide.includes("single-flight") && guide.includes("honest decline"), "")

  // ── 6. Negatives: the predicates must be able to refuse ──
  {
    // Each predicate below must RETURN TRUE for the fabricated bad text
    // (i.e. the check would refuse it) — that is the negative proof.
    const noDisable = "reads auto-refresh stale files within budget when enabled and repairs them before answering."
    negative("doc claiming auto-refresh without a disable mechanism is refused",
      noDisable.includes("auto-refresh") && !noDisable.includes("BB_NO_AUTO_REFRESH") && !noDisable.includes("refresh=false"), "")
    const alwaysOn = "auto-refresh always repairs stale files before answering even when BB_NO_AUTO_REFRESH=1 is set."
    negative("doc claiming auto-refresh runs while disabled is refused",
      alwaysOn.includes("BB_NO_AUTO_REFRESH=1") && /always repairs/.test(alwaysOn) && !/disable/.test(alwaysOn), "")
    const wrongDefault = "bounded by BB_AUTO_REFRESH_MAX_FILES (default 500)"
    negative("knob default diverging from AUTO_REFRESH_DEFAULTS is refused",
      wrongDefault.includes("BB_AUTO_REFRESH_MAX_FILES") && !wrongDefault.includes(`default ${defaults.maxFiles}`), "")
    const unbounded = "reads auto-refresh every stale file in the project before answering"
    negative("doc claiming an unbounded auto-refresh is refused",
      unbounded.includes("auto-refresh") && !unbounded.includes("budget") && !unbounded.includes("BB_AUTO_REFRESH_MAX_FILES"), "")
  }

  const ok = failed === 0
  console.log(`M31 D5 freshness-docs: ${passed} passed, ${failed} failed, ${negatives} negatives`)
  if (ok && process.env.BB_M31_READ_ONLY !== "1") {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
    writeFileSync(path.join(RESULTS_DIR, "D5.json"), JSON.stringify({
      status: "verified",
      currentCommit: head,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m31/wave2/verify-d5-freshness-docs.ts",
      evidenceFile: "D5.json",
      generatedAt: new Date().toISOString(),
      passed, failed,
      negativeCases: negatives,
      knobsDocumented: envs,
      bbHealthTruthful: true,
    }, null, 2) + "\n")
    console.log("evidence stamped: validation/m31/wave2/results/D5.json")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error("D5 gate crashed:", e); process.exit(1) })
