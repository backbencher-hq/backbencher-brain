// script/m43/verify-a1-mcp-auto-refresh.ts — M43.A1 (#657)
// BEHAVIORAL gate for the MCP read-path auto-refresh (bb_search family).
// In-process handler calls on deterministic fixtures. Every check exercises a
// real code path; no auto-pass, no tautologies.
//
// Acceptance criteria exercised:
//  1. Edit outside bb_edit -> read -> answer reflects the edit WITH the
//     auto-refresh declaration (symbols listing + content + symbol modes).
//  2. Budget exceeded -> honest decline naming the reason; stale rows stay
//     flagged (never silently stale, never silently refreshed).
//  3. Opt-out honored (refresh=false arg).
//  4. P1 lock held by another indexer -> declared-stale answer, no blocking.
//  5. Mutation proof: with auto-refresh disabled the same edit scenario
//     answers STALE instead of reflecting — so a regression that disables the
//     refresh path changes this gate's outcome (the gate can fail).
//
// Honest boundary (asserted as a negative): a query that matches NO indexed
// row cannot repair anything (there is no stale row to detect) — that case is
// the documented manual/remediation path, not a silent auto-refresh.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULTS_DIR = path.join(ROOT, "validation/m43/results")

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL
delete process.env.BB_NO_AUTO_REFRESH

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

const SRCS = { a: `export function alpha(x: number): number { return x }\nexport function beta(y: string): string { return y }\n` }
function writeFixture(root: string, files: Array<[string, string]>) {
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (const [name, content] of files) writeFileSync(path.join(root, "src", name), content)
}

type HandlerCtx = { projectId: string; projectPath: string }

async function main() {
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const handlers = createToolHandlers()
  const run = async (tool: string, args: Record<string, unknown>, ctx: HandlerCtx): Promise<string> =>
    (await handlers[tool](args, ctx)).content[0].text

  // ── 0. Control: fresh read has NO autoRefresh key (silence when fresh) ──
  {
    const fixture = mkdtempSync(path.join(tmpdir(), "bb-a1-ctl-"))
    writeFixture(fixture, [["a.ts", SRCS.a]])
    const pid = getProjectId(fixture)
    await indexProjectParallel(pid, fixture, { skipPostProcessing: true })
    const ctx: HandlerCtx = { projectId: pid, projectPath: fixture }
    const listing = await run("bb_search", { query: "beta" }, ctx)
    check("0: fresh symbols listing has no autoRefresh line", !listing.includes("auto-refresh") && listing.includes("beta [function]"), listing.slice(0, 120))
    const content = JSON.parse(await run("bb_search", { mode: "content", query: "beta" }, ctx)) as any
    check("0: fresh content read has no autoRefresh key", content.autoRefresh === undefined && content.total >= 1, JSON.stringify({ ar: content.autoRefresh, total: content.total }))
    rmSync(fixture, { recursive: true, force: true })
  }

  // ── 1. Edit -> read reflects the edit with the declaration (3 modes) ──
  // Each mode gets its OWN fixture: the first read of a mode repairs the stale
  // file, so a later mode on the same fixture would see a fresh index and have
  // nothing to declare — every mode must prove the edit-reflect + declaration
  // on a genuinely stale index.
  const editFixture = async (tag: string) => {
    const fixture = mkdtempSync(path.join(tmpdir(), `bb-a1-${tag}-`))
    writeFixture(fixture, [["a.ts", SRCS.a]])
    const pid = getProjectId(fixture)
    await indexProjectParallel(pid, fixture, { skipPostProcessing: true })
    // Edit OUTSIDE bb_edit: rename beta -> gamma in a.ts.
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function gamma(y: string): string { return y }\n`)
    return { fixture, pid, ctx: { projectId: pid, projectPath: fixture } as HandlerCtx }
  }
  {
    // symbols listing mode
    const { fixture, ctx } = await editFixture("listing")
    try {
      const listing = await run("bb_search", { query: "beta" }, ctx)
      check("1: symbols listing reflects the edit (no stale beta)", !/beta \[function\]/.test(listing) && listing.includes("no results"), listing.slice(0, 200))
      check("1: symbols listing declares the auto-refresh", /auto-refreshed 1 file in \d+ms/.test(listing), listing.slice(0, 200))
      const gamma = await run("bb_search", { query: "gamma" }, ctx)
      check("1: post-refresh index has the new symbol gamma", gamma.includes("gamma [function]"), gamma.slice(0, 200))
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }
  {
    // content mode: the edited file's OLD content must no longer answer.
    const { fixture, ctx } = await editFixture("content")
    try {
      const content = JSON.parse(await run("bb_search", { mode: "content", query: "beta" }, ctx)) as any
      check("1: content mode reflects the edit (beta gone)", content.total === 0 && Array.isArray(content.results) && content.results.length === 0, JSON.stringify({ total: content.total }))
      check("1: content mode declares the auto-refresh", typeof content.autoRefresh === "string" && content.autoRefresh.includes("auto-refreshed"), String(content.autoRefresh))
      const gamma = JSON.parse(await run("bb_search", { mode: "content", query: "gamma" }, ctx)) as any
      check("1: content mode finds the post-edit symbol gamma", gamma.total >= 1, JSON.stringify({ total: gamma.total }))
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }
  {
    // symbol mode: findSymbol beta must come back empty after the repair.
    const { fixture, ctx } = await editFixture("symbol")
    try {
      const sym = JSON.parse(await run("bb_search", { mode: "symbol", symbolName: "beta" }, ctx)) as any
      const symMatches = (sym.matches ?? []) as any[]
      check("1: symbol mode reflects the edit (no beta match)", symMatches.length === 0, JSON.stringify(symMatches.length))
      check("1: symbol mode declares the auto-refresh", typeof sym.autoRefresh === "string" && sym.autoRefresh.includes("auto-refreshed"), String(sym.autoRefresh))
    } finally { rmSync(fixture, { recursive: true, force: true }) }
  }

  // ── 2. Budget exceeded -> honest decline; stale rows stay flagged ──
  {
    const fixture = mkdtempSync(path.join(tmpdir(), "bb-a1-budget-"))
    const files: Array<[string, string]> = []
    for (let i = 0; i < 4; i++) files.push([`m${i}.ts`, `export function fn${i}(x: number): number { return x + ${i} }\n`])
    writeFixture(fixture, files)
    const pid = getProjectId(fixture)
    await indexProjectParallel(pid, fixture, { skipPostProcessing: true })
    // Stale 3 of the 4 files; budget capped at 2 files.
    for (let i = 0; i < 3; i++) writeFileSync(path.join(fixture, "src", `m${i}.ts`), `export function fn${i}(x: number): number { return x + ${i} + 1 }\n`)
    const ctx: HandlerCtx = { projectId: pid, projectPath: fixture }
    process.env.BB_AUTO_REFRESH_MAX_FILES = "2"
    try {
      const listing = await run("bb_search", { query: "fn", limit: 30 }, ctx)
      check("2: budget exceeded -> honest decline names the file budget", listing.includes("exceeds the 2-file budget"), listing.slice(0, 200))
      check("2: budget exceeded -> stale rows stay flagged [STALE]", listing.includes("[STALE]"), listing.slice(0, 200))
      negative("2: decline does NOT claim a refresh happened", !listing.includes("auto-refreshed"), listing.slice(0, 120))
    } finally {
      delete process.env.BB_AUTO_REFRESH_MAX_FILES
    }
    // Byte-budget variant on the same fixture: cap bytes below file sizes.
    process.env.BB_AUTO_REFRESH_MAX_BYTES = "10"
    try {
      const listing = await run("bb_search", { query: "fn", limit: 30 }, ctx)
      check("2: byte budget exceeded -> honest decline names the byte budget", listing.includes("exceeds the 10-byte budget"), listing.slice(0, 200))
    } finally {
      delete process.env.BB_AUTO_REFRESH_MAX_BYTES
    }
    rmSync(fixture, { recursive: true, force: true })
  }

  // ── 3. Opt-out: refresh=false -> disabled decline, stale stays flagged ──
  {
    const fixture = mkdtempSync(path.join(tmpdir(), "bb-a1-opt-"))
    writeFixture(fixture, [["a.ts", SRCS.a]])
    const pid = getProjectId(fixture)
    await indexProjectParallel(pid, fixture, { skipPostProcessing: true })
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function gamma(y: string): string { return y }\n`)
    const ctx: HandlerCtx = { projectId: pid, projectPath: fixture }
    const listing = await run("bb_search", { query: "beta", refresh: false }, ctx)
    check("3: refresh=false honored (disabled decline)", listing.includes("disabled") && listing.includes("BB_NO_AUTO_REFRESH"), listing.slice(0, 200))
    check("3: refresh=false -> stale answer stays flagged", listing.includes("[STALE]"), listing.slice(0, 200))
    negative("3: opt-out does NOT claim a refresh happened", !listing.includes("auto-refreshed"), listing.slice(0, 120))
    rmSync(fixture, { recursive: true, force: true })
  }

  // ── 4. P1 lock held -> declared-stale answer, no blocking, no corruption ──
  {
    const fixture = mkdtempSync(path.join(tmpdir(), "bb-a1-lock-"))
    writeFixture(fixture, [["a.ts", SRCS.a]])
    const pid = getProjectId(fixture)
    await indexProjectParallel(pid, fixture, { skipPostProcessing: true })
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function gamma(y: string): string { return y }\n`)
    const { acquireIndexLock } = await import(path.join(ROOT, "src/ast/index-lock"))
    const held = await acquireIndexLock(pid, { kind: "a1-gate-holder" })
    const ctx: HandlerCtx = { projectId: pid, projectPath: fixture }
    try {
      const listing = await run("bb_search", { query: "beta" }, ctx)
      check("4: lock held -> decline names the active indexer", listing.includes("another index run is active"), listing.slice(0, 200))
      check("4: lock held -> stale answer stays flagged (declared, not blocked)", listing.includes("[STALE]"), listing.slice(0, 200))
      const duration = await (async () => { const t0 = performance.now(); await run("bb_search", { query: "beta" }, ctx); return performance.now() - t0 })()
      check("4: lock held -> no blocking wait (fast decline)", duration < 5_000, `${Math.round(duration)}ms`)
    } finally {
      await held.release()
    }
    // After release the same read repairs and reflects (lock no longer blocks).
    const after = await run("bb_search", { query: "beta" }, ctx)
    check("4: after release the read auto-refreshes normally", /auto-refreshed 1 file in \d+ms/.test(after) && !/[STALE]/.test(after), after.slice(0, 160))
    rmSync(fixture, { recursive: true, force: true })
  }

  // ── 5. Mutation proof: auto-refresh disabled -> the SAME edit scenario
  //      answers STALE instead of reflecting (the gate can fail) ──
  {
    const fixture = mkdtempSync(path.join(tmpdir(), "bb-a1-mut-"))
    writeFixture(fixture, [["a.ts", SRCS.a]])
    const pid = getProjectId(fixture)
    await indexProjectParallel(pid, fixture, { skipPostProcessing: true })
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function gamma(y: string): string { return y }\n`)
    const ctx: HandlerCtx = { projectId: pid, projectPath: fixture }
    process.env.BB_NO_AUTO_REFRESH = "1"
    try {
      const listing = await run("bb_search", { query: "beta" }, ctx)
      check("5: disabled -> stale beta still reported [STALE]", listing.includes("[STALE]") && listing.includes("beta [function]"), listing.slice(0, 200))
      negative("5: disabled -> no auto-refresh claim", !listing.includes("auto-refreshed"), listing.slice(0, 120))
      // The outcome DIFFERS from scenario 1's control — proving scenario 1's
      // assertions exercise the real refresh path and would FAIL without it.
      const reflects = !/beta \[function\]/.test(listing)
      negative("5: disabled outcome differs from the enabled control", !reflects, "enabled control reflects; disabled must not")
    } finally {
      delete process.env.BB_NO_AUTO_REFRESH
    }
    rmSync(fixture, { recursive: true, force: true })
  }

  // ── 6. Honest boundary (negative): a query matching NO indexed row cannot
  //      repair — no silent full-project refresh on every no-result query ──
  {
    const fixture = mkdtempSync(path.join(tmpdir(), "bb-a1-boundary-"))
    writeFixture(fixture, [["a.ts", SRCS.a]])
    const pid = getProjectId(fixture)
    await indexProjectParallel(pid, fixture, { skipPostProcessing: true })
    writeFileSync(path.join(fixture, "src", "a.ts"), `export function alpha(x: number): number { return x }\nexport function brandNewSym(y: string): string { return y }\n`)
    const ctx: HandlerCtx = { projectId: pid, projectPath: fixture }
    // brandNewSym exists on disk but was never indexed: a search for it has no
    // stale ROW to detect. The honest answer is "no results" (remediation
    // path), NOT a silent full-project re-index.
    const listing = await run("bb_search", { query: "brandNewSym" }, ctx)
    check("6: unindexed-new-symbol boundary stays honest (no results, no silent refresh)", listing.includes("no results") && !listing.includes("auto-refresh"), listing.slice(0, 160))
    rmSync(fixture, { recursive: true, force: true })
  }

  const ok = failed === 0
  console.log(`A1 MCP auto-refresh: ${passed} passed, ${failed} failed, ${negativeCases} negatives`)
  // M43.X1: children of the gate-selftest / closure probe never stamp evidence.
  if (ok && process.env.BB_M43_READ_ONLY !== "1") {
    mkdirSync(RESULTS_DIR, { recursive: true })
    const head = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()
    writeFileSync(path.join(RESULTS_DIR, "A1.json"), JSON.stringify({
      status: "verified",
      currentCommit: head,
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m43/verify-a1-mcp-auto-refresh.ts",
      evidenceFile: "A1.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
      negativesDescription: "decline-not-refresh, budget-decline, opt-out-not-refresh, disabled-not-refresh, disabled-differs-from-control, boundary-no-silent-refresh",
    }, null, 2) + "\n")
    console.log("evidence stamped: validation/m43/results/A1.json")
  }
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error("A1 gate crashed:", e)
  process.exit(1)
})
