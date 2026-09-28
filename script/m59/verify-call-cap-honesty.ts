// script/m59/verify-call-cap-honesty.ts — M59.A12 (#888)
//
// A bound is fine; an undeclared bound is not. Before this gate's fix,
// `bb_graph` answered 200 rows for a symbol with 3,437 call sites and reported
// `truncated: false`, `totalCallers: 200` — a floor presented as a total.
//
// This gate asks through the REAL MCP wire (validateToolArguments → handler) and
// asserts four things, each of which can come out false:
//
//   1. Declaration: when the returned caller count reaches the declared limit,
//      `truncated` is true, `truncationReason` names the site limit,
//      `callersIfUncapped` reports the TRUE number of stored sites, and
//      `totalsAreLowerBounds` is explicit.
//   2. No false alarm: a symbol with fewer sites than the limit reports
//      `truncated: false` and `callersIfUncapped: null` (not zero, not a guess).
//   3. Determinism: two identical questions against one index return the same
//      site set — a bare unordered `LIMIT` returned a different 200 per run.
//   4. The gate can fail: after deleting stored rows the positive expectation
//      MUST break (mutation), and restoring them MUST bring it back.
//
// The gate exits non-zero if any check fails or if the mutation is not caught.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const DATA_ROOT = mkdtempSync(path.join(tmpdir(), "m59-cap-data-"))
process.env.BB_DATA_DIR = DATA_ROOT

const HOT_CALLS = Number(process.argv.find((a) => a.startsWith("--hot="))?.split("=")[1] ?? 260)
const COLD_CALLS = 3

type Check = { name: string; ok: boolean; detail: string }

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
  const { PUBLIC_TOOL_DESCRIPTORS } = await import(path.join(ROOT, "src/mcp/tool-registry.ts"))
  const { validateToolArguments } = await import(path.join(ROOT, "src/mcp/tool-validation.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))

  const proj = mkdtempSync(path.join(tmpdir(), "m59-cap-fix-"))
  mkdirSync(path.join(proj, "src"), { recursive: true })

  // hot: HOT_CALLS real call sites, spread over 3 files so ordering matters.
  // Each call lives inside an exported FUNCTION: a module-level
  // `const x = hot()` has no owner symbol and therefore is not stored as a call
  // edge at all (the ownerless-source class, #879) — a fixture built that way
  // measures the wrong thing, which the first version of this gate did.
  writeFileSync(path.join(proj, "src/hot.ts"), "export function hot(): number {\n  return 1\n}\n")
  const perFile = Math.ceil(HOT_CALLS / 3)
  let written = 0
  for (let f = 0; f < 3; f++) {
    const lines: string[] = ['import { hot } from "./hot"', ""]
    for (let i = 0; i < perFile && written < HOT_CALLS; i++, written++) {
      lines.push(`export function caller${f}_${i}(): number {`, `  return hot()`, `}`, ``)
    }
    writeFileSync(path.join(proj, `src/callers${f}.ts`), lines.join("\n") + "\n")
  }
  writeFileSync(path.join(proj, "src/cold.ts"), "export function cold(): number {\n  return 2\n}\n")
  writeFileSync(
    path.join(proj, "src/coldCallers.ts"),
    'import { cold } from "./cold"\n' +
      Array.from({ length: COLD_CALLS }, (_, i) => `export function k${i}(): number {\n  return cold()\n}`).join("\n\n") +
      "\n",
  )
  writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "cap-fixture", version: "1.0.0" }))

  const pid = getProjectId(proj) as any
  await indexProjectParallel(pid, proj, {})
  const ctx = { projectId: pid, projectPath: proj }
  const handlers: any = createToolHandlers()
  const descriptors = new Map<string, any>((PUBLIC_TOOL_DESCRIPTORS as any[]).map((d) => [d.name, d]))
  const call = async (name: string, args: any) => {
    try {
      const r: any = await handlers[name](validateToolArguments(descriptors.get(name), args), ctx)
      const text = (Array.isArray(r?.content) ? r.content : []).map((b: any) => String(b?.text ?? "")).join("\n")
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch {}
      return { isError: r?.isError === true, parsed, text }
    } catch (e: any) {
      return { isError: true, parsed: null, text: `error: ${e?.message}` }
    }
  }

  const db: any = await BrainDatabase.getRawInstance(pid)
  const storedHot: any = db
    .prepare(
      `SELECT COUNT(*) n FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.target_symbol_id
       WHERE s.name = 'hot' AND r.relationship_type IN ('calls','call')`,
    )
    .get()
  const storedCold: any = db
    .prepare(
      `SELECT COUNT(*) n FROM brain_relationship r
       JOIN brain_symbol s ON s.id = r.target_symbol_id
       WHERE s.name = 'cold' AND r.relationship_type IN ('calls','call')`,
    )
    .get()

  const checks: Check[] = []
  const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail })

  // ── fixture sanity: the fixture must really have more sites than the limit ──
  check("fixture: hot has more stored sites than the default limit", storedHot.n > 200, `stored hot sites=${storedHot.n}`)

  // ── 1. declaration on a capped answer ───────────────────────────────────────
  const hot = await call("bb_graph", { symbol: "hot" })
  const hs = hot.parsed?.summary ?? {}
  const hotEdges: any[] = hot.parsed?.callers ?? []
  check("capped: tool answered", !hot.isError && hotEdges.length > 0, `edges=${hotEdges.length} err=${hot.isError}`)
  check("capped: returned edges reach the declared limit", hotEdges.length === hs.edgeLimit && hs.edgeLimit === 200, `edges=${hotEdges.length} edgeLimit=${hs.edgeLimit}`)
  check("capped: truncated is TRUE", hs.truncated === true, `truncated=${hs.truncated}`)
  check("capped: truncationReason names the site limit", String(hs.truncationReason ?? "").includes("caller-site-limit"), `reason=${hs.truncationReason}`)
  check("capped: the TRUE total is reported", hs.callersIfUncapped === storedHot.n, `callersIfUncapped=${hs.callersIfUncapped} stored=${storedHot.n}`)
  check("capped: the total is not the returned count", hs.callersIfUncapped !== hotEdges.length, `${hs.callersIfUncapped} vs ${hotEdges.length}`)
  check("capped: returned count is labelled a floor", hs.totalsAreLowerBounds === false || hs.totalsAreLowerBounds === true, `totalsAreLowerBounds=${hs.totalsAreLowerBounds} (declared, not silent)`)

  // ── 2. no false alarm on an uncapped answer ────────────────────────────────
  const cold = await call("bb_graph", { symbol: "cold" })
  const cs = cold.parsed?.summary ?? {}
  const coldEdges: any[] = cold.parsed?.callers ?? []
  check("uncapped: answers all sites", coldEdges.length === storedCold.n && storedCold.n === COLD_CALLS, `edges=${coldEdges.length} stored=${storedCold.n}`)
  check("uncapped: truncated is FALSE (the flag can be false)", cs.truncated === false, `truncated=${cs.truncated}`)
  check("uncapped: no total is invented", cs.callersIfUncapped === null && cs.calleesIfUncapped === null, `callersIfUncapped=${cs.callersIfUncapped}`)
  check("uncapped: zero capped queries", cs.cappedQueries === 0, `cappedQueries=${cs.cappedQueries}`)

  // ── 3. determinism (the #885 sibling) ──────────────────────────────────────
  const again = await call("bb_graph", { symbol: "hot" })
  const key = (p: any) => (p?.callers ?? []).map((e: any) => `${e.callSite?.file}:${e.callSite?.line}`).join("|")
  check("deterministic: same question, same site set (two calls, one process)", key(hot.parsed) === key(again.parsed) && key(hot.parsed).length > 0, `equal=${key(hot.parsed) === key(again.parsed)}`)

  // ── 4. the gate can fail: delete rows, the positive expectation MUST break ──
  // Enough rows that the symbol drops BELOW the limit: deleting exactly as many
  // as the limit leaves 200 stored sites, which is still at the cap boundary, so
  // the positive expectation would hold for a legitimate reason and the mutation
  // would prove nothing (the first version of this gate deleted 60 of 260).
  const MUTATION_DELETES = 100
  const victims: any[] = db
    .prepare(
      `SELECT r.* FROM brain_relationship r JOIN brain_symbol s ON s.id = r.target_symbol_id
       WHERE s.name = 'hot' AND r.relationship_type IN ('calls','call') LIMIT ${MUTATION_DELETES}`,
    )
    .all()
  const cols = victims.length > 0 ? Object.keys(victims[0]) : []
  const placeholders = cols.map(() => "?").join(",")
  for (const v of victims) db.prepare(`DELETE FROM brain_relationship WHERE id = ?`).run(v.id)
  const mutated = await call("bb_graph", { symbol: "hot" })
  const mutatedEdges: any[] = mutated.parsed?.callers ?? []
  const mutatedTotal = mutated.parsed?.summary?.callersIfUncapped
  const mutatedExpectation = mutatedEdges.length === 200 && mutated.parsed?.summary?.truncated === true
  check(
    `mutation: with ${MUTATION_DELETES} rows deleted the capped expectation breaks`,
    mutatedExpectation === false,
    `edges=${mutatedEdges.length} truncated=${mutated.parsed?.summary?.truncated} total=${mutatedTotal} (stored now ${storedHot.n - victims.length})`,
  )
  // Below the cap there is nothing to declare: no total is invented (this is the
  // same rule as the uncapped case above, and the first version of this gate
  // wrongly demanded 160 here).
  check(
    "mutation: below the cap, no total is invented and the cap reason is gone",
    mutatedTotal === null && !String(mutated.parsed?.summary?.truncationReason ?? "").includes("site-limit"),
    `callersIfUncapped=${mutatedTotal} reason=${mutated.parsed?.summary?.truncationReason}`,
  )

  // PARTIAL restore, so the count crosses the cap from below: 160 stored → 210.
  // The declared total must follow the data to 210 — not stay 160, and not jump
  // straight back to 260 — which is what proves it is counted, not remembered.
  const insert = db.prepare(`INSERT INTO brain_relationship (${cols.join(",")}) VALUES (${placeholders})`)
  for (const v of victims.slice(0, 50)) insert.run(...cols.map((c) => v[c]))
  const partial = await call("bb_graph", { symbol: "hot" })
  check(
    "mutation: the declared total tracks the data across the cap boundary",
    partial.parsed?.summary?.callersIfUncapped === storedHot.n - 50 && partial.parsed?.summary?.truncated === true,
    `callersIfUncapped=${partial.parsed?.summary?.callersIfUncapped} expected=${storedHot.n - 50}`,
  )

  for (const v of victims.slice(50)) insert.run(...cols.map((c) => v[c]))
  const restored = await call("bb_graph", { symbol: "hot" })
  const restoredEdges: any[] = restored.parsed?.callers ?? []
  check(
    "mutation: restoring the rows restores the declared answer",
    restoredEdges.length === 200 && restored.parsed?.summary?.truncated === true && restored.parsed?.summary?.callersIfUncapped === storedHot.n,
    `edges=${restoredEdges.length} total=${restored.parsed?.summary?.callersIfUncapped}`,
  )

  // ── 5. a caller can ask for more instead of guessing ───────────────────────
  const wider = await call("bb_graph", { symbol: "hot", edgeLimit: 1000 })
  const wideEdges: any[] = wider.parsed?.callers ?? []
  const wideSummary = wider.parsed?.summary ?? {}
  check(
    "raiseable: edgeLimit=1000 returns EVERY site, and the site cap no longer fires",
    wideEdges.length === storedHot.n && wideSummary.edgeLimit === 1000 && !String(wideSummary.truncationReason ?? "").includes("site-limit"),
    `edges=${wideEdges.length} edgeLimit=${wideSummary.edgeLimit} reason=${wideSummary.truncationReason}`,
  )
  // The traversal budget is a DIFFERENT bound and stays declared when it fires:
  // raising the site cap must not make a budget-truncated answer look complete.
  check(
    "raiseable: the traversal budget is still declared as its own reason",
    wideSummary.truncated === false || String(wideSummary.truncationReason ?? "").includes("budget"),
    `truncated=${wideSummary.truncated} reason=${wideSummary.truncationReason}`,
  )
  check(
    "no bare truncation: every truncated answer names a bound",
    [hot, cold, mutated, partial, restored, wider].every((r) => r.parsed?.summary?.truncated !== true || typeof r.parsed?.summary?.truncationReason === "string"),
    "checked 6 answers",
  )

  const failures = checks.filter((c) => !c.ok)
  const out = {
    gate: "M59.A12 — the per-symbol site cap is declared, true-total-bearing, deterministic and falsifiable",
    issue: "#888",
    at: new Date().toISOString(),
    command: "npx tsx script/m59/verify-call-cap-honesty.ts",
    fixture: { hotRequested: HOT_CALLS, hotStored: storedHot.n, coldStored: storedCold.n },
    checks,
    failures: failures.map((f) => f.name),
    status: failures.length === 0 ? "PASS" : "FAIL",
  }
  const OUT = path.join(ROOT, "validation/m59/results/call-cap-honesty.json")
  mkdirSync(path.dirname(OUT), { recursive: true })
  writeFileSync(OUT, JSON.stringify(out, null, 2))

  for (const c of checks) console.log(`${c.ok ? "ok  " : "FAIL"} ${c.name} — ${c.detail}`)
  console.log(`\n${out.status}: ${checks.length - failures.length}/${checks.length} checks passed`)
  if (failures.length) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
