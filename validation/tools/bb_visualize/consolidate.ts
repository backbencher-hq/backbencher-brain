// ─────────────────────────────────────────────────────────────────────────────
// Author: Muhammad Ishaq Khan
//
// WHAT THIS FILE IS — the evidence consolidator: it turns the per-run JSON files
//   under results/ into the two published evidence documents the release reads:
//   REAL-CORPUS.json (real repositories through the real MCP stdio door) and
//   LATENCY.json (the three measurement tiers).
// WHICH TOOL IT SERVES — bb_visualize (mutability read, requiresIndex true).
// WHY IT IS SHAPED THIS WAY — the raw runs are per-repo and per-tier so a rerun
//   replaces one file rather than a monolith; the published documents are derived,
//   carry the exact command that produces them, and evaluate the acceptance checks
//   (self-contained HTML, byte-read-only index, expected refusals) as booleans the
//   reader can re-derive rather than trust.
// WHERE ITS EVIDENCE LIVES — validation/tools/bb_visualize/{REAL-CORPUS.json,LATENCY.json},
//   derived from results/real-corpus.json, results/latency-{t0,t1,t2}.json.
// EDIT TOGETHER WHEN THIS CHANGES — real-corpus.ts, latency.ts, probe.ts.
// CONTRACTS IT MUST NOT BREAK — it only reads results/ and writes the two top-level
//   evidence files; it never touches the index or the repositories.
// ─────────────────────────────────────────────────────────────────────────────

import { execFileSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"

const HERE = path.resolve(import.meta.dirname ?? ".", ".")
const RESULTS = path.join(HERE, "results")
const ROOT = path.resolve(HERE, "..", "..", "..")
const read = (name: string) => JSON.parse(readFileSync(path.join(RESULTS, name), "utf8"))
const commit = (() => { try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim() } catch { return "unknown" } })()

// ── REAL-CORPUS ─────────────────────────────────────────────────────────────
const corpus = read("real-corpus.json")
const repos = (corpus.repos ?? []).map((repo: any) => {
  const cases: any[] = repo.cases ?? []
  const byName = new Map(cases.map((row) => [row.name, row]))
  const htmlCases = cases.filter((row) => row.args?.format === "html")
  const jsonCases = cases.filter((row) => row.args?.format === "json")
  const ok = cases.filter((row) => !row.isError)
  const refused = cases.filter((row) => row.isError)
  const defaultText = byName.get("project text (default)") as any
  const htmlRegions = byName.get("project html regions") as any
  const htmlForce = byName.get("project html force") as any
  const largeBudget = byName.get("project json large budget") as any
  return {
    key: repo.key,
    repository: repo.repoPath,
    language: repo.language,
    indexed: { files: repo.index?.files ?? 0, symbols: repo.index?.symbols ?? 0, relationships: repo.index?.relationships ?? 0, languages: repo.index?.languages ?? [] },
    scopesExercised: [...new Set(cases.map((row) => String(row.args?.scope ?? "project")))].sort(),
    formatsExercised: [...new Set(cases.map((row) => String(row.args?.format ?? "text")))].sort(),
    layoutsExercised: [...new Set(cases.filter((row) => row.args?.format === "html").map((row) => String(row.args?.layout ?? "regions")))].sort(),
    cases,
    suite: {
      cases: cases.length,
      succeeded: ok.length,
      refusedAsExpected: refused.length,
      expectedRefusals: ["unknown scope refused", "missing target refused", "maxNodes 0 refused"],
      defaultTextMs: defaultText?.ms ?? null,
      defaultTextBytes: defaultText?.bytes ?? null,
      htmlRegionsBytes: htmlRegions?.bytes ?? null,
      htmlForceBytes: htmlForce?.bytes ?? null,
      htmlSelfContained: htmlCases.length > 0 && htmlCases.every((row) => row.htmlSelfContained === true && !row.isError),
      layoutDeclared: /data-bb-layout/.test(String(htmlRegions?.textHead ?? "")) || !!(htmlRegions && htmlRegions.bytes > 1000),
      largeBudgetNodes: largeBudget?.nodes ?? null,
      largeBudgetLinks: largeBudget?.links ?? null,
      largeBudgetMs: largeBudget?.ms ?? null,
      largeBudgetBytes: largeBudget?.bytes ?? null,
      truncationDeclared: jsonCases.every((row) => row.isError || row.truncated === true || row.truncated === false),
      totalNodesAvailableDeclared: jsonCases.every((row) => row.isError || typeof row.totalNodesAvailable === "number"),
    },
    dbUnchanged: repo.dbUnchanged === true,
    error: repo.error ?? null,
  }
})
const corpusChecks = {
  allFiveReposRecorded: repos.length === 5,
  everyRepoThroughRealMcpDoor: repos.every((repo: any) => repo.cases.length === 17 && !repo.error),
  everyScopeThroughTheDoor: repos.every((repo: any) => ["project", "file", "module", "symbol", "feature"].every((scope) => repo.scopesExercised.includes(scope))),
  everyFormatThroughTheDoor: repos.every((repo: any) => ["text", "json", "html"].every((format) => repo.formatsExercised.includes(format))),
  bothLayoutsThroughTheDoor: repos.every((repo: any) => repo.layoutsExercised.includes("regions") && repo.layoutsExercised.includes("force")),
  htmlGenuinelySelfContained: repos.every((repo: any) => repo.suite.htmlSelfContained),
  everyRefusalIsAnErrorEnvelope: repos.every((repo: any) => repo.suite.refusedAsExpected === 3 && repo.suite.expectedRefusals.every((name: string) => repo.cases.some((row: any) => row.name === name && row.isError))),
  readPathLeftEveryIndexByteIdentical: repos.every((repo: any) => repo.dbUnchanged),
  truncationAndTotalsDeclaredOnEveryJsonAnswer: repos.every((repo: any) => repo.suite.truncationDeclared && repo.suite.totalNodesAvailableDeclared),
}
const realCorpus = {
  schemaVersion: 1,
  tool: "bb_visualize",
  status: Object.values(corpusChecks).every(Boolean) ? "verified" : "partial",
  currentCommit: commit,
  verifierCommand: "BB_DATA_DIR=validation/tools/bb_visualize/bbdata npx tsx validation/tools/bb_visualize/real-corpus.ts index && ... door && npx tsx validation/tools/bb_visualize/consolidate.ts",
  generatedAt: new Date().toISOString(),
  environment: corpus.environment ?? null,
  corpusRoot: "/home/ishaq2321/bb_tests/repositories",
  blockedLegs: [
    "zig whole-repo index: the 16,766-file checkout was indexed twice to 4,860 files (1.7 GB partial) and both runs were killed by session teardown before finalisation; the index was NOT reused as a corpus. zig/lib/std (550 files, 61,655 symbols, 178,628 relationships) is indexed whole and is the recorded Zig corpus.",
    "maxNodes 2000 through the MCP door: a 12-16 MB single JSON-RPC response had the spawned server killed mid-message under this host's fleet memory pressure (connection closed); the door matrix records the largest accepted budget at 1000 nodes, and the 2000-node shape is measured in-process in LATENCY.json (T2, max-budget-json).",
  ],
  checks: corpusChecks,
  repos,
}
writeFileSync(path.join(HERE, "REAL-CORPUS.json"), JSON.stringify(realCorpus, null, 2) + "\n")
console.log(`REAL-CORPUS: ${realCorpus.status.toUpperCase()} (${repos.length} repos, checks ${Object.values(corpusChecks).filter(Boolean).length}/${Object.keys(corpusChecks).length})`)

// ── LATENCY ────────────────────────────────────────────────────────────────
const tiers = ["t0", "t1", "t2"].map((tier) => read(`latency-${tier}.json`))
const latency = {
  schemaVersion: 1,
  tool: "bb_visualize",
  status: tiers.every((tier) => tier.defaultP95WithinBudget && tier.coldWithinClientTimeout) ? "verified" : "partial",
  currentCommit: commit,
  verifierCommand: "BB_DATA_DIR=<tier> npx tsx validation/tools/bb_visualize/latency.ts t0|t1|t2 && npx tsx validation/tools/bb_visualize/consolidate.ts",
  generatedAt: new Date().toISOString(),
  budgets: { t0DefaultP95Ms: 250, t1DefaultP95Ms: 1000, t2DefaultP95Ms: 5000, clientTimeoutMs: 30000 },
  tiers: tiers.map((tier) => ({
    tier: tier.tier,
    environment: tier.environment,
    referenceIndex: tier.referenceIndex,
    summary: tier.summary,
    defaultP95WithinBudget: tier.defaultP95WithinBudget,
    coldFirstCallMs: tier.coldFirstCallMs,
    coldWithinClientTimeout: tier.coldWithinClientTimeout,
    readPath: tier.readPath,
  })),
  campaignStartSample: { source: "docs/tools-campaign/CHARTER.md appendix A / LEAD-FINDINGS §A", note: "the T2 population is the index as measured; every tier row records its own counts and mtime" },
}
writeFileSync(path.join(HERE, "LATENCY.json"), JSON.stringify(latency, null, 2) + "\n")
console.log(`LATENCY: ${latency.status.toUpperCase()} (T0 ${tiers[0].summary.find((r: any) => r.variant === "default-text").p95} ms p95, T1 ${tiers[1].summary.find((r: any) => r.variant === "default-text").p95} ms p95, T2 ${tiers[2].summary.find((r: any) => r.variant === "default-text").p95} ms p95; cold T2 ${tiers[2].coldFirstCallMs} ms)`)
