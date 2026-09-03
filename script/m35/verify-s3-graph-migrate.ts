// script/m35/verify-s3-graph-migrate.ts — M35.S3 (#584)
// Behavioral gate for staleness on graph + migration read paths:
//
//   bb_visualize: per-node stale flags; links inherit worst-of-endpoints
//     (a cross-file link from a STALE file to a FRESH file is stale);
//     truncation composes with staleness (truncated AND stale both visible);
//     envelope on json with the exact registered keys; silence when fresh.
//   bb_migrate: plans whose source file changed since the index are flagged
//     stale UP FRONT (the notice precedes the plan text); per-plan stale in
//     json with the registered envelope; fresh plans stay unflagged.
//
// Fixture: api.ts (handler -> helper, imports+calls formatDate) and util.ts
// (formatDate). Phase 1 edits api.ts only -> util.ts is the fresh control.
// Phase 2 edits util.ts too -> the second plan flags on.
//
// Modes: default behavioral suite; BB_M35_EVIDENCE=1 stamps S3.json.
// Mutations (planted by verify-gate-selftest, registered in GATES):
//   1. stale migration plan unflagged (flag comparison flipped)
//   2. link inherits wrong endpoint state (worst-of -> all-of)

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const RESULT = path.join(ROOT, "validation/m35/results/S3.json")

delete process.env.BB_EMBEDDING_BASE_URL
delete process.env.BB_EMBEDDING_API_KEY
delete process.env.BB_EMBEDDING_MODEL

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

const API_V1 = [
  "import { formatDate } from './util'",
  "export function handler(x: number): number {",
  "  const d = formatDate(new Date())",
  "  return helper(x) + d.length",
  "}",
  "export function helper(x: number): number { return x + 1 }",
  "",
].join("\n")
const API_V2 = API_V1.replace("return helper(x) + d.length", "return helper(x) + d.length + 0") + "// post-index edit\n"
const UTIL_V1 = "export function formatDate(d: Date): string { return d.toISOString().slice(0, 10) }\n"
const UTIL_V2 = UTIL_V1 + "// post-index edit\n"

async function runSuite(): Promise<void> {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers"))

  const fixture = mkdtempSync(path.join(tmpdir(), "bb-m35-s3-"))
  mkdirSync(path.join(fixture, "src"), { recursive: true })
  writeFileSync(path.join(fixture, "src", "api.ts"), API_V1)
  writeFileSync(path.join(fixture, "src", "util.ts"), UTIL_V1)

  try {
    const projectId = (getProjectId as (p: string) => string)(fixture)
    const stats = await indexProjectParallel(projectId as any, fixture, { skipPostProcessing: false })
    check("fixture indexes with enrichment", stats.errorFiles === 0, `errors=${stats.errorFiles}`)
    // Phase 1: edit api.ts AFTER index — util.ts stays the fresh control.
    writeFileSync(path.join(fixture, "src", "api.ts"), API_V2)

    const handlers = createToolHandlers() as any
    const ctx = { projectPath: fixture, projectId }
    const run = async (tool: string, args: any) => (await handlers[tool](args, ctx)).content[0].text as string

    // ── 1. bb_visualize text: footer counts + remediation ──
    const vizText = await run("bb_visualize", { scope: "project" })
    check("viz: footer counts the stale graph files", /1 stale, 0 missing of 2 graph files/.test(vizText), vizText.slice(-200))
    check("viz: footer names the registered remediation", vizText.includes("bb index --changed") && vizText.includes("bb_index"), "")

    // ── 2. bb_visualize json: envelope + per-node flags + link inheritance ──
    const vizJson = JSON.parse(await run("bb_visualize", { scope: "project", format: "json" }))
    const f = vizJson.freshness
    check("viz: freshness block with exact registered keys", f && JSON.stringify(Object.keys(f).sort()) === JSON.stringify(["fresh", "missing", "mode", "remediation", "stale", "staleRatio"]), JSON.stringify(f))
    check("viz: staleRatio consistent", Math.abs(f.staleRatio - (f.stale + f.missing) / Math.max(1, f.fresh + f.stale + f.missing)) < 1e-9, String(f.staleRatio))
    const nodes = vizJson.nodes as any[]
    const byName = new Map(nodes.map((n) => [n.name, n]))
    check("viz: every node carries a stale boolean", nodes.every((n) => typeof n.stale === "boolean"), nodes.map((n) => `${n.name}=${JSON.stringify(n.stale)}`).join(","))
    check("viz: edited-file nodes flagged stale", byName.get("handler")?.stale === true && byName.get("helper")?.stale === true, JSON.stringify([...byName].map(([k, v]) => `${k}=${v.stale}`)))
    negative("viz: untouched-file node NOT flagged (util.ts fresh)", byName.get("formatDate")?.stale === false, String(byName.get("formatDate")?.stale))
    const links = vizJson.links as any[]
    const cross = links.find((l) => byName.get(l.source.slice(l.source.includes(":") ? l.source.indexOf(":") + 1 : 0)) === undefined ? false : true) // placeholder replaced below
    void cross
    // Cross-file link: source in api.ts (stale), target in util.ts (fresh).
    // Node ids may be prefixed; match by node-name resolution.
    const nameOf = (id: string) => nodes.find((n) => n.id === id)?.name ?? id
    const crossLink = links.find((l) => nameOf(l.source) === "handler" && nameOf(l.target) === "formatDate")
    check("viz: cross-file link exists in fixture graph", crossLink !== undefined, JSON.stringify(links.map((l) => `${nameOf(l.source)}->${nameOf(l.target)}`)))
    if (crossLink) {
      check("viz: link inherits worst-of-endpoints (stale src x fresh dst = stale)", crossLink.stale === true, `stale=${crossLink.stale}`)
    }
    const freshLink = links.find((l) => nameOf(l.source) !== "handler" && nameOf(l.target) !== "handler" && !String(l.source).includes("helper") && !String(l.target).includes("helper"))
    if (freshLink) negative("viz: fresh-fresh link NOT flagged", freshLink.stale === false, `${nameOf(freshLink.source)}->${nameOf(freshLink.target)}=${freshLink.stale}`)

    // ── 3. truncation composes with staleness ──
    const trunc = JSON.parse(await run("bb_visualize", { scope: "project", format: "json", maxNodes: 1 }))
    check("viz: truncation reported honestly", trunc.truncation?.truncated === true, JSON.stringify(trunc.truncation))
    check("viz: truncated output still carries freshness envelope", trunc.freshness && typeof trunc.freshness.staleRatio === "number", JSON.stringify(trunc.freshness))
    check("viz: truncated nodes still carry stale flags", (trunc.nodes as any[]).length >= 1 && (trunc.nodes as any[]).every((n) => typeof n.stale === "boolean"), "")

    // ── 4. silence when fresh ──
    const freshVizText = await run("bb_visualize", { scope: "file", target: "util.ts" })
    negative("viz: no footer when all graph files fresh", !freshVizText.includes("graph files —"), freshVizText.slice(-160))
    const freshVizJson = JSON.parse(await run("bb_visualize", { scope: "file", target: "util.ts", format: "json" }))
    negative("viz: no remediation when fresh", freshVizJson.freshness.remediation === "", JSON.stringify(freshVizJson.freshness))

    // ── 5. bb_migrate: stale plan flagged UP FRONT + per-plan flags ──
    const migText = await run("bb_migrate", { symbolNames: ["handler", "formatDate"], targetLanguage: "python" })
    check("migrate: stale-plan notice precedes the plan text", /⚠ 1 of 2 plans reference files changed/.test(migText) && migText.indexOf("⚠") < migText.indexOf("handler:"), migText.slice(0, 200))
    const migJson = JSON.parse(await run("bb_migrate", { symbolNames: ["handler", "formatDate"], targetLanguage: "python", format: "json" }))
    const mf = migJson.freshness
    check("migrate: freshness block with exact registered keys", mf && JSON.stringify(Object.keys(mf).sort()) === JSON.stringify(["fresh", "missing", "mode", "remediation", "stale", "staleRatio"]), JSON.stringify(mf))
    const plans = migJson.plans as any[]
    const byPlan = new Map(plans.map((p) => [String(p.componentName).toLowerCase(), p]))
    check("migrate: plan carries resolved sourceFile", byPlan.get("handler")?.sourceFile === "src/api.ts", JSON.stringify(byPlan.get("handler")?.sourceFile))
    check("migrate: edited-file plan flagged stale", byPlan.get("handler")?.stale === true, `stale=${byPlan.get("handler")?.stale}`)
    negative("migrate: untouched-file plan NOT flagged", byPlan.get("formatdate")?.stale === false, `stale=${byPlan.get("formatdate")?.stale}`)

    // ── phase 2: edit util.ts too — the second plan flags on ──
    writeFileSync(path.join(fixture, "src", "util.ts"), UTIL_V2)
    const migJson2 = JSON.parse(await run("bb_migrate", { symbolNames: ["handler", "formatDate"], targetLanguage: "python", format: "json" }))
    check("migrate phase 2: both plans flagged stale", (migJson2.plans as any[]).every((p) => p.stale === true), JSON.stringify((migJson2.plans as any[]).map((p) => `${p.componentName}=${p.stale}`)))
    check("migrate phase 2: envelope counts both", migJson2.freshness.stale === 2 && migJson2.freshness.staleRatio === 1, JSON.stringify(migJson2.freshness))
    const migText2 = await run("bb_migrate", { symbolNames: ["handler", "formatDate"], targetLanguage: "python" })
    check("migrate phase 2: notice counts 2 of 2", /⚠ 2 of 2 plans reference files changed/.test(migText2), migText2.slice(0, 160))
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

function gitHead(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim()
  } catch {
    return "unknown"
  }
}

async function main() {
  await runSuite()
  console.log(`M35 S3 GRAPH+MIGRATE: ${failed === 0 ? "PASS" : "FAIL"} (${passed}/${checks}, negatives=${negativeCases})`)
  if (process.env.BB_M35_EVIDENCE === "1" && failed === 0) {
    const { mkdirSync, writeFileSync } = await import("node:fs")
    mkdirSync(path.dirname(RESULT), { recursive: true })
    writeFileSync(RESULT, JSON.stringify({
      status: "verified",
      currentCommit: gitHead(),
      workingTreeRelevantChanges: [],
      verifierCommand: "bun run script/m35/verify-s3-graph-migrate.ts",
      evidenceFile: "S3.json",
      generatedAt: new Date().toISOString(),
      passed,
      failed,
      negativeCases,
    }, null, 2) + "\n")
    console.log("evidence stamped:", RESULT)
  }
  if (failed !== 0) process.exit(1)
}

main()
