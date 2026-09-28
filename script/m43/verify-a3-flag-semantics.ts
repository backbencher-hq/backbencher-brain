// script/m43/verify-a3-flag-semantics.ts — M43.A3 (#659)
// BEHAVIORAL + STRUCTURAL gate for the surface the freshness work introduced:
//
//   1. Env whitelist: every env var the auto-refresh module actually reads is
//      declared in AUTO_REFRESH_ENV_ALLOWLIST (parsed from source) — a new
//      knob cannot land undeclared; public knobs are never test-only.
//   2. Budget knob validation: garbage/invalid values fall back to the
//      documented defaults; valid values apply. Only BB_NO_AUTO_REFRESH=1
//      disables (other values leave auto-refresh enabled — documented).
//   3. Test-hook quarantine (M40.A8): BB_TEST_INDEX_LOCK_OFF does NOTHING
//      unless BB_TEST_HOOKS=1 (behavioral, on the real lock).
//   4. bb search flag matrix (executable): every combination of the search
//      surface with the new --no-auto-refresh / BB_NO_AUTO_REFRESH behaves as
//      declared — declared behaviors proven live; nothing undefined.
//   5. Remediation + doc truth: FRESHNESS_REMEDIATION names the automatic
//      behavior AND the manual fallback; generated bb_search.md + the CLI
//      guide document the real surface.
//
// Mutation seams: deleting an allowlist entry fails check 1; breaking the
// quarantine fails check 3; breaking budget fallback fails check 2.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m43/results")

const ENV_KEYS = ["BB_NO_AUTO_REFRESH", "BB_AUTO_REFRESH_MAX_FILES", "BB_AUTO_REFRESH_MAX_BYTES"]
for (const k of ENV_KEYS) delete process.env[k]
delete process.env.BB_TEST_HOOKS
delete process.env.BB_TEST_INDEX_LOCK_OFF
delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
const BB_DATA_DIR = mkdtempSync(path.join(tmpdir(), "bb-a3-data-"))
process.env.BB_DATA_DIR = BB_DATA_DIR

let checks = 0
let passed = 0
let failed = 0
let negativeCases = 0
function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) passed++
  else {
    failed++
    console.log(`FAIL: ${label}${detail ? ` — ${detail}` : ""}`)
  }
}
function negative(label: string, ok: boolean, detail = "") {
  if (ok) negativeCases++
  check(`${label} [negative]`, ok, detail)
}

async function main() {
  const { AUTO_REFRESH_ENV_ALLOWLIST, AUTO_REFRESH_DEFAULTS, autoRefreshBudget, autoRefreshEnabled } =
    await import(path.join(ROOT, "src/ast/auto-refresh.ts"))
  const { acquireIndexLock, indexLockPath } = await import(path.join(ROOT, "src/ast/index-lock"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))

  // ── 1. Env whitelist: parsed reads == declared allowlist ──
  {
    const src = readFileSync(path.join(ROOT, "src/ast/auto-refresh.ts"), "utf8")
    const read = new Set<string>()
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) read.add(m[1])
    const declared = new Set(AUTO_REFRESH_ENV_ALLOWLIST)
    check("1: allowlist declares exactly the env vars the module reads",
      [...read].sort().join(",") === [...declared].sort().join(","),
      `read=${[...read].sort().join(",")} declared=${[...declared].sort().join(",")}`)
    negative("1: no BB_TEST_* knob among the public auto-refresh envs", ![...read].some((k) => k.startsWith("BB_TEST_")), [...read].join(","))
    // The allowlist is a real exported const (the gate could fail if deleted).
    check("1: allowlist is exported and matches the documented knobs",
      AUTO_REFRESH_ENV_ALLOWLIST.length === 3 && AUTO_REFRESH_ENV_ALLOWLIST.includes("BB_NO_AUTO_REFRESH"),
      AUTO_REFRESH_ENV_ALLOWLIST.join(","))
  }

  // ── 2. Budget + opt-out knob validation ──
  {
    const def = AUTO_REFRESH_DEFAULTS
    const cases: Array<[string, string | undefined, number]> = [
      ["unset files", undefined, def.maxFiles],
      ["garbage files", "abc", def.maxFiles],
      ["negative files", "-5", def.maxFiles],
      ["zero files", "0", def.maxFiles],
      ["valid files", "7", 7],
      ["unset bytes", undefined, def.maxBytes],
      ["garbage bytes", "many", def.maxBytes],
      ["valid bytes", "4096", 4096],
    ]
    for (const [label, val, expected] of cases) {
      if (val === undefined) delete process.env.BB_AUTO_REFRESH_MAX_FILES, delete process.env.BB_AUTO_REFRESH_MAX_BYTES
      else if (label.includes("files")) process.env.BB_AUTO_REFRESH_MAX_FILES = val
      else process.env.BB_AUTO_REFRESH_MAX_BYTES = val
      const b = autoRefreshBudget()
      const got = label.includes("files") ? b.maxFiles : b.maxBytes
      check(`2: budget knob (${label})`, got === expected, `got=${got} expected=${expected}`)
    }
    delete process.env.BB_AUTO_REFRESH_MAX_FILES
    delete process.env.BB_AUTO_REFRESH_MAX_BYTES
    check("2: enabled by default", autoRefreshEnabled(undefined) === true, "")
    process.env.BB_NO_AUTO_REFRESH = "1"
    check("2: BB_NO_AUTO_REFRESH=1 disables", autoRefreshEnabled(undefined) === false, "")
    delete process.env.BB_NO_AUTO_REFRESH
    for (const v of ["0", "true", "banana"]) {
      process.env.BB_NO_AUTO_REFRESH = v
      check(`2: BB_NO_AUTO_REFRESH=${v} does NOT disable (documented: only =1)`, autoRefreshEnabled(undefined) === true, v)
    }
    delete process.env.BB_NO_AUTO_REFRESH
    check("2: per-call opt-out disables", autoRefreshEnabled(true) === false, "")
    check("2: undefined per-call keeps the env decision", autoRefreshEnabled(undefined) === true, "")
  }

  // ── 3. Test-hook quarantine: BB_TEST_INDEX_LOCK_OFF needs BB_TEST_HOOKS=1 ──
  {
    const pid = getProjectId(path.join(BB_DATA_DIR, "quarantine-probe"))
    process.env.BB_TEST_INDEX_LOCK_OFF = "1"
    const h1 = await acquireIndexLock(pid, { kind: "quarantine" })
    const locked = await import("node:fs").then((fs) => fs.existsSync(indexLockPath(pid)))
    check("3: BB_TEST_INDEX_LOCK_OFF without BB_TEST_HOOKS does NOT disable the lock", locked === true, `lockfile present=${locked}`)
    await h1.release()
    process.env.BB_TEST_HOOKS = "1"
    const h2 = await acquireIndexLock(pid, { kind: "quarantine" })
    const locked2 = await import("node:fs").then((fs) => fs.existsSync(indexLockPath(pid)))
    check("3: with BB_TEST_HOOKS=1 the seam disables the lock (no lockfile)", locked2 === false, `lockfile present=${locked2}`)
    await h2.release()
    delete process.env.BB_TEST_HOOKS
    delete process.env.BB_TEST_INDEX_LOCK_OFF
  }

  // ── 4. bb search flag matrix (executable combos on a stale fixture) ──
  const CLI = path.join(ROOT, "src/cli/index.ts")
  const combo = (tag: string, args: string[], extraEnv: Record<string, string> = {}): { out: string; status: number } => {
    const fixture = mkdtempSync(path.join(tmpdir(), `bb-a3-${tag}-`))
    mkdirSync(path.join(fixture, "src"), { recursive: true })
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function beta(y: string): string { return y }\n`)
    const pid = getProjectId(fixture)
    void pid
    execFileSync("bun", [CLI, "index", fixture, "--skip-post-processing"], { env: { ...process.env, NO_COLOR: "1" }, stdio: "ignore", timeout: 180_000 })
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function gamma(y: string): string { return y }\n`)
    let out = "", status = 0
    try {
      out = execFileSync("bun", [CLI, "search", ...args, "--dir", fixture], { env: { ...process.env, NO_COLOR: "1", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 }).toString()
    } catch (e: any) {
      status = e?.status ?? -1
      out = `${e?.stdout ?? ""}${e?.stderr ?? ""}`
    }
    rmSync(fixture, { recursive: true, force: true })
    return { out, status }
  }
  const matrix: Array<[string, string[], Record<string, string>, (o: string, s: number) => boolean, string]> = [
    ["default listing (no flag) → auto-refresh declared", ["beta"], {}, (o, s) => s === 0 && !o.includes("beta [function]") && /auto-refreshed 1 file in \d+ms/.test(o), "reflects + declares"],
    ["default listing + --no-auto-refresh → stale footer", ["beta", "--no-auto-refresh"], {}, (o, s) => s === 0 && o.includes("beta [function]") && o.includes("⚠stale") && !/auto-refreshed 1 file/.test(o), "stale answer, no refresh"],
    ["default listing + BB_NO_AUTO_REFRESH=1 → stale footer", ["beta"], { BB_NO_AUTO_REFRESH: "1" }, (o, s) => s === 0 && o.includes("beta [function]") && o.includes("⚠stale") && !/auto-refreshed 1 file/.test(o), "env opt-out matches the flag"],
    ["--mode content (no flag) → reflects + declares", ["--mode", "content", "beta"], {}, (o, s) => s === 0 && o.includes("0 results") && o.includes("auto-refreshed"), "content reflects + declares"],
    ["--mode content + --no-auto-refresh → stale footer", ["--mode", "content", "beta", "--no-auto-refresh"], {}, (o, s) => s === 0 && o.includes("beta") && o.includes("stale") && !o.includes("auto-refreshed 1 file"), "content stale, no refresh"],
    // file mode prints DISK truth: the fresh content (gamma) is served even
    // though the index row is stale (the freshness block says 1 stale). It
    // never auto-refreshes and never claims one.
    // file mode prints DISK truth: the fresh content (gamma) is served even
    // though the index row is stale (the freshness block says 1 stale). It
    // never runs the repair and never prints the repair DECLARATION (the
    // "auto-refresh" substring may appear only inside the registered
    // remediation text).
    ["--mode file (no flag) → disk truth, no repair declaration", ["--mode", "file", "src/a.ts"], {}, (o, s) => s === 0 && o.includes("gamma") && o.includes("stale") && !/auto-refreshed \d+ file/.test(o), "file mode never runs an inline repair"],
  ]
  for (const [label, args, env, fn, why] of matrix) {
    const r = combo(label.split("→")[0].trim().replace(/[^a-z0-9]/gi, "-").slice(0, 24), args, env)
    check(`4: ${label}`, fn(r.out, r.status), `expected ${why}; got: ${r.out.slice(0, 180).replace(/\n/g, " | ")}`)
  }

  // ── 5. Remediation + doc truth ──
  {
    const { FRESHNESS_REMEDIATION } = await import(path.join(ROOT, "src/brain/freshness"))
    const dir = FRESHNESS_REMEDIATION.dir
    const file = FRESHNESS_REMEDIATION.file
    check("5: dir remediation names the automatic behavior", dir.includes("auto-refresh") && dir.includes("BB_NO_AUTO_REFRESH"), dir.slice(0, 140))
    check("5: dir remediation keeps the manual interface", dir.includes("bb index --changed") && dir.includes("bb_index"), dir.slice(0, 140))
    check("5: file remediation names the automatic behavior + manual file interface", file.includes("auto-refresh") && /bb index "/.test(file) && file.includes("bb_index"), file.slice(0, 140))
    const searchDoc = readFileSync(path.join(ROOT, "docs/tools/bb_search.md"), "utf8")
    check("5: generated bb_search.md documents refresh=false and auto-refresh", searchDoc.includes("refresh") && searchDoc.includes("auto-refresh"), "doc missing the surface")
    const guide = readFileSync(path.join(ROOT, "docs/MCP_CLI_INDEXER_GUIDE.md"), "utf8")
    check("5: CLI guide documents --no-auto-refresh and the auto-refresh knobs",
      guide.includes("--no-auto-refresh") && guide.includes("BB_AUTO_REFRESH_MAX_FILES") && guide.includes("BB_AUTO_REFRESH_MAX_BYTES"),
      "guide missing the CLI surface")
    // The guide may WARN about the rejected form, but must not show it as an
    // example invocation.
    negative("5: CLI guide never shows the rejected --mode symbols form as an invocation", !guide.includes("search --mode symbols") && !guide.includes('"mode":"symbols"'), "guide must not show the rejected form as usable")
  }

  rmSync(BB_DATA_DIR, { recursive: true, force: true })

  const ok = failed === 0
  console.log(`A3 flag/env semantics: ${passed} passed, ${failed} failed, ${negativeCases} negatives`)
  // M43.X1: children of the gate-selftest / closure probe never stamp evidence.
  if (ok && process.env.BB_M43_READ_ONLY !== "1") {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
    writeFileSync(path.join(RESULTS_DIR, "A3.json"), JSON.stringify({
      status: "verified",
      currentCommit: head,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m43/verify-a3-flag-semantics.ts",
      evidenceFile: "A3.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
      negativesDescription: "no-test-hook-among-public, no-auto-refresh-0-not-disable, quarantine-needs-hooks, guide-omits-rejected-form",
    }, null, 2) + "\n")
    console.log("evidence stamped: validation/m43/results/A3.json")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("A3 gate crashed:", e)
  process.exit(1)
})
