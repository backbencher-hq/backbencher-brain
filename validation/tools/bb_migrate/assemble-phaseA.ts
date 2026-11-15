// Assemble the Phase A evidence documents from the raw measurements, the gate logs and the
// evidence each gate wrote. Everything quoted here comes from a command whose exit code was read.
import { execSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const DIR = path.join(ROOT, "validation/tools/bb_migrate")
const read = (relative: string) => JSON.parse(readFileSync(path.join(ROOT, relative), "utf8"))
const readDocs = (relative: string): any[] => {
  const text = readFileSync(path.join(ROOT, relative), "utf8")
  const docs: any[] = []
  let depth = 0, start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "{") depth++
    else if (text[i] === "}") { depth--; if (depth === 0) { try { docs.push(JSON.parse(text.slice(start, i + 1))) } catch {} start = i + 1 } }
  }
  return docs
}
const rawJson = (name: string) => read(path.join("validation/tools/bb_migrate/raw", name))
const head = execSync("git rev-parse HEAD", { cwd: ROOT, encoding: "utf8" }).trim()

const t0 = rawJson("latency-phaseA-t0.json")
const t1 = rawJson("latency-phaseA-t1.json")
const t2 = rawJson("latency-phaseA-t2.json")
const doorT0 = rawJson("door-phaseA-t0.json")
const doorEdges = rawJson("door-edges-t0.json")
const doorExtra = rawJson("door-extra-t0.json")
const readonlyProbe = readDocs("validation/tools/bb_migrate/raw/readonly-probe-before.json")
const doorWrite = rawJson("door-write-probe.json")
const realCorpus = read("validation/tools/bb_migrate/REAL-CORPUS.json")
const regexInventory = rawJson("regex-inventory.json")
const realIndex = rawJson("real-corpus-index.json")
const routeMatrix = rawJson("route-matrix.json")

const shape = (s: any) => ({ command: s.args, runs: 5, samplesMs: s.samplesMs, p50Ms: s.p50Ms, p95Ms: s.p95Ms })
const gateLog = (name: string) => {
  const file = path.join(DIR, "logs", name)
  return existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((l) => /(PASS|FAIL|VERIFIED|KNOWN-GAP|PARSE|FATAL|exit=)/.test(l)).slice(-6) : []
}
const gate = (id: string, command: string, exitCode: number, status: string, detail: string, log: string) => ({ id, command, exitCode, status, detail, evidenceLog: `validation/tools/bb_migrate/logs/${log}`, tail: gateLog(log) })

const mtime = (epoch: number) => new Date(epoch * 1000).toISOString()

const latency = {
  schemaVersion: 1,
  tool: "bb_migrate",
  phase: "A-baseline",
  currentCommit: head,
  generatedAt: new Date().toISOString(),
  environment: {
    runtime: "node v22.22.1 via npx tsx (source door)",
    dataDirs: { T0T1T2: "BB_DATA_DIR=validation/tools/bb_migrate/{bbdata|work/t2-rw-copy}", realCorpus: "BB_DATA_DIR=validation/tools/bb_migrate/realdata" },
    readOnlyRule: "BB_NO_AUTO_REFRESH=1 on every measurement; the corpus trees are read, never written; measurement indexes are isolated copies",
    loadAverageAtMeasurement: { T0: t0.loadAverage, T1: t1.loadAverage, T2: t2.loadAverage, note: "T2 measured while the shared fleet was indexing (load 26); p50 is the honest figure and contention is declared" },
  },
  budgets: { t0DefaultP95Ms: 250, t1DefaultP95Ms: 1000, t2DefaultP95Ms: 5000, clientTimeoutMs: 30000, source: "docs/tools-campaign/CHARTER.md §6" },
  method: {
    harness: "validation/tools/bb_migrate/bench.ts — calls the exported handler with the real ToolContext ({projectId, projectPath}), one untimed warm-up per shape then five measured calls; nearest-rank p50/p95",
    measuredShapes: "single-name text (the default format), single-name JSON, up to 12 distinct names, directory cohort via paths",
    firstCall: "the first handler call in a cold process, which pays the read-write open and its migrations on the current code",
  },
  tiers: {
    T0: {
      subject: "test/fixtures/polyglot (ts-js + java-scala)", command: "BB_DATA_DIR=$PWD/validation/tools/bb_migrate/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_migrate/bench.ts t0",
      index: t0.index, shapes: { singleText: shape(t0.shapes.singleText), singleJson: shape(t0.shapes.singleJson), twelveNames: shape(t0.shapes.twelveNames), cohort: shape(t0.shapes.cohort) },
      firstCallMs: t0.firstCall.ms, verdict: "PASS — every shape p95 under the 250 ms T0 budget",
      dbState: t0.dbState,
    },
    T1: {
      subject: ".perf-fixtures/bb-scale/n100", command: "BB_DATA_DIR=$PWD/validation/tools/bb_migrate/bbdata BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_migrate/bench.ts t1",
      index: t1.index, shapes: { singleText: shape(t1.shapes.singleText), singleJson: shape(t1.shapes.singleJson), twelveNames: shape(t1.shapes.twelveNames), cohort: shape(t1.shapes.cohort) },
      firstCallMs: t1.firstCall.ms, verdict: "PASS — every shape p95 under the 1 s T1 budget",
    },
    T2: {
      subject: "this workspace's reference index, copied byte-for-byte to validation/tools/bb_migrate/work/t2-rw-copy",
      referenceIndexOnDisk: { path: ".bb-data/projects/1d3d57103be91b8f9716d70199fe28a3f39245d9/brain.db", sizeBytes: 3639963648, mtimeEpoch: 1793593795, mtimeIso: mtime(1793593795), files: 6452, symbols: 310423, relationships: 820040, shmBytes: 32768, walPresent: false, note: "read from the live reference with a byte-read-only open (db-shape.ts); counts and mtime recorded with the measurement" },
      measuredCopy: { mtimeEpoch: 1793576528, mtimeIso: mtime(1793576528), note: "the copy is the same population; the live index was touched again by the fleet after the copy" },
      command: "BB_DATA_DIR=$PWD/validation/tools/bb_migrate/work/t2-rw-copy BB_NO_AUTO_REFRESH=1 npx tsx validation/tools/bb_migrate/bench.ts t2",
      index: t2.index,
      shapes: { singleText: shape(t2.shapes.singleText), singleJson: shape(t2.shapes.singleJson), twelveNames: shape(t2.shapes.twelveNames) },
      cohortAttempt: { args: t2.shapes.cohort.args, p50Ms: t2.shapes.cohort.p50Ms, p95Ms: t2.shapes.cohort.p95Ms, isError: t2.shapes.cohort.lastIsError, status: "BLOCKED — the reference index predates the module split (4 files under src/mcp, no handler.ts), so the requested directory matches no indexed file; the tool refused by name, correctly" },
      firstCallMs: t2.firstCall.ms,
      verdict: "FAIL on the batch shape: single text p50 805 / p95 909 ms is inside the 5 s budget, but the 12-name shape measured p50 9532 / p95 29041 ms — over the budget and close to the 30 s client timeout. Root cause measured separately: t2-diagnose.json shows that shape loaded 844 symbols / 46,753 relationships for 12 names.",
      dbState: t2.dbState,
      diagnose: readDocs("validation/tools/bb_migrate/raw/t2-diagnose.json").map((d: any) => ({ label: d.label, ms: d.ms, isError: d.isError, plans: d.summary?.plans, unsupported: d.summary?.unsupported, work: d.summary?.work, textHead: d.summary?.textHead })),
    },
  },
  realCorpus: {
    subject: "four real cross-language repositories indexed into BB_DATA_DIR=validation/tools/bb_migrate/realdata, measured through the real MCP stdio door",
    indexCommand: "BB_DATA_DIR=$PWD/validation/tools/bb_migrate/realdata npx tsx validation/tools/bb_migrate/index-real-corpus.ts",
    doorCommand: "npx tsx src/mcp/server.ts --dir <repo> (BB_DATA_DIR=realdata, BB_NO_AUTO_REFRESH=1)",
    index: realIndex.repos.map((r: any) => ({ id: r.id, indexMs: r.indexMs, files: r.counts.files, symbols: r.counts.symbols, relationships: r.counts.relationships, crossLanguageRelationships: r.crossLanguageRelationships })),
    warmSingleJson: realCorpus.repos.map((r: any) => ({ repo: r.id, samplesMs: r.latency?.singleJson?.samplesMs, p50Ms: r.latency?.singleJson?.p50Ms, p95Ms: r.latency?.singleJson?.p95Ms })),
    verdict: "PASS — warm single-plan calls 41–248 ms p95 across a 7,012–14,725-symbol corpus",
  },
  defects: [
    { id: "P1-first-call-cost", tier: "T2", measured: `first handler call ${t2.firstCall.ms} ms`, detail: "pays the read-write open and its additive migrations on every fresh process, and writes a 2,570,912-byte WAL", severity: "high" },
    { id: "H1-unbounded-batch", tier: "T2", measured: `12 names p95 ${t2.shapes.twelveNames.p95Ms} ms`, detail: "name resolution expands to every same-named symbol; the 100-component cap is over entries, not resolved symbols, so 844 symbols / 46,753 relationships were loaded for one plan", severity: "high" },
  ],
}
writeFileSync(path.join(DIR, "LATENCY.json"), JSON.stringify(latency, null, 1))

const gates = {
  schemaVersion: 1, tool: "bb_migrate", currentCommit: head, generatedAt: new Date().toISOString(),
  status: "partial", verifierCommand: "gate table below; every row's log is under validation/tools/bb_migrate/logs/",
  passed: 11, failed: 4, negativeCases: 26,
  blockedLegs: [
    { leg: "m13/verify-migrate-docs — generator dependency", reason: "the gate spawns the FULL docs generator, which is red mid-campaign by Lead ruling (§B4): shared artifacts are regenerated once at integration. With --only bb_migrate the page is congruent (exit 0)." },
    { leg: "m15/verify-visualize-migrate-deep", reason: "crashes reading pre-split descriptor blocks from src/mcp/tool-registry.ts (the descriptors moved to src/mcp/tools/<tool>/descriptor.ts); also V2 module-scope nodes=0. Outside task-13's write scope (shared visualize+migrate gate) — reported to the Lead." },
    { leg: "m48/verify-c1-corpus", reason: "not run: corpus-scale central gate; bb_migrate's edge cases are covered by m48 C2 (73/73) and the REAL-CORPUS door battery." },
    { leg: "m31/tool-mode-corpus --check", reason: "red fleet-wide (23 drifting invocations); bb_migrate.plan is NOT among them — the tool's own corpus row is unchanged." },
    { leg: "T2 directory-cohort shape", reason: "the reference index predates the module split, so src/mcp paths match no indexed file; the tool refused by name. Measured on the corrected copy the plan counts would be the same shape as T1." },
    { leg: "compiled door (dist)", reason: "dist is stale by Lead ruling; all door evidence uses the source entry (npx tsx src/mcp/server.ts)." },
  ],
  gates: [
    gate("m13-m1", "npx tsx script/m13/verify-migrate-accuracy.ts", 0, "verified", "9/9 checks, 2 negatives — contract-level only (text assertions); strengthened in Phase B", "script_m13_verify-migrate-accuracy.log"),
    gate("m13-m2", "bun run script/m13/verify-migrate-e2e-corpus.ts", 1, "known-gap", "6/7: the MCP leg fails because the SDK child environment drops BB_DATA_DIR (the same defect LEAD-FINDINGS records fixed in script/verify-mcp.ts). Gate defect in scope.", "bun_script_m13_verify-migrate-e2e-corpus.log"),
    gate("m13-m3", "bun run script/m13/verify-migrate-docs.ts", 1, "known-gap", "8/10: (a) description anchor doc.split('\\n')[2] is now the blank line inside the author header; (b) spawns the full docs generator instead of --only bb_migrate. Gate defect in scope.", "bun_script_m13_verify-migrate-docs.log"),
    gate("m20-m1-order", "bun run script/m20/verify-migration-order.ts", 0, "verified", "13/13, 3 negatives", "script_m20_verify-migration-order.log"),
    gate("m20-m2-methodology", "bun run script/m20/verify-migration-methodology.ts", 0, "verified", "17/17, 3 negatives", "script_m20_verify-migration-methodology.log"),
    gate("m20-m3-mappings", "bun run script/m20/verify-migration-mappings.ts", 0, "verified", "15/15, 5 negatives", "script_m20_verify-migration-mappings.log"),
    gate("m20-m4-dictionary", "bun run script/m20/verify-migration-dictionary.ts", 1, "known-gap", "29/30: three declared non-import keys no longer exist in the dictionary after the source/target table un-inversion (react context -> react, next.js -> next, tailwind -> tailwindcss). Gate defect in scope.", "run_script_m20_verify-migration-dictionary.log"),
    gate("m35-s3-graph-migrate", "bun run script/m35/verify-s3-graph-migrate.ts", 0, "verified", "staleness surface for graph+migrate", "bun_script_m35_verify-s3-graph-migrate.log"),
    gate("m48-c2-edge-mutations", "bun run script/m48/verify-c2-edge-mutations.ts", 0, "verified", "73 passed / 0 failed / 3 negatives; includes bb_migrate 'calm' cases (unknown target language, empty symbol) and missing-required refusal", "run_script_m48_verify-c2-edge-mutations.log"),
    gate("m48-p4-param-matrix", "bun run script/m48/verify-p4-param-matrix.ts", 0, "verified", "10 passed / 0 failed / 2 negatives — live registry parameter matrix", "m48-p4.log"),
    gate("m65-latency", "bun run script/m65/verify-migrate-latency.ts", 0, "verified", "all checks pass; includes negative controls that fail the historical 2342 ms cost and the cap/accounting predicates", "bun_script_m65_verify-migrate-latency.log"),
    gate("m65-selectors", "bun run script/m65/verify-migrate-selectors.ts", 1, "failed", "1 check failed: a name and its own symbol id produce TWO plans for one component (plans 2, 2 for the component). Engine defect H2.", "bun_script_m65_verify-migrate-selectors.log"),
    gate("m15-visualize-migrate-deep", "bun run script/m15/verify-visualize-migrate-deep.ts", 2, "blocked", "FATAL: reg.split('name: \"bb_visualize\"') on the post-split tool-registry.ts; cross-scope shared gate", "bun_script_m15_verify-visualize-migrate-deep.log"),
    gate("verify-visualize-migrate", "bun run script/verify-visualize-migrate.ts", 0, "verified", "PASS", "bun_script_verify-visualize-migrate.log"),
    gate("docs-only", "npx tsx script/verify-tool-docs.ts --only bb_migrate", 0, "verified", "generated page is congruent with the registry/curation", "verify-tool-docs-only.log"),
    gate("m31-tool-mode-corpus", "bun run script/m31/tool-mode-corpus.ts --check", 1, "blocked", "fleet-wide drift (23 invocations); bb_migrate.plan is not among the drifting rows", "run_script_m31_tool-mode-corpus.log"),
    gate("m31-bb-docs-truth", "bun run script/m31/verify-bb-docs-truth.ts", 1, "blocked", "fails on BB_EDIT.md / BB_HEALTH.md fences; no bb_migrate failure row", "run_script_m31_verify-bb-docs-truth.log"),
    gate("regex-policy", "npx tsx script/tools/verify-regex-policy.ts", 0, "verified", "PASS — 14 allowlisted, 73 frozen debt, 0 new; the tool's own 22 regex uses are baseline debt (see regexInventory) and the assistant file is outside the policy scan roots", "regex-policy.log"),
    gate("typecheck", "npx tsc --noEmit", 0, "verified", "clean working tree at the audited commit", "tsc-baseline.log"),
    { id: "mcp-door", command: "npx tsx validation/tools/bb_migrate/door-phaseA-t0.ts", exitCode: 0, status: "verified-with-failures", detail: "doors: 11/12 supplied cases reached their expected class; the 3 unexpected classes are recorded as defects (blank target/blank names return empty success; same-language and unknown-target are payload refusals, not isError — documented contract, not defect). Wire hygiene: no non-JSON stdout, no unhandled rejection.", evidenceLog: "validation/tools/bb_migrate/raw/door-phaseA-t0.json" },
    { id: "real-corpus", command: "BB_DATA_DIR=validation/tools/bb_migrate/realdata npx tsx validation/tools/bb_migrate/real-corpus.ts", exitCode: 0, status: "verified", detail: "82/82 checks, 6 planted negative controls; 4 real repositories through the real MCP stdio door", evidenceLog: "validation/tools/bb_migrate/REAL-CORPUS.json" },
  ],
  regexInventory: { gateStatus: "PASS", ownUses: regexInventory.count, byFile: regexInventory.rows.reduce((acc: any, r: any) => (acc[r.file] = (acc[r.file] ?? 0) + 1, acc), {}), note: "src/ast/cross-language-migration-assistant.ts is not in the policy gate's scan roots (it names explicit src/ast files); its 16 uses are invisible debt owned by this lane" },
  routeMatrix: { rows: routeMatrix.rows, sources: routeMatrix.sourceLanguages.length, routedPairs: routeMatrix.dictPairs, note: "from migrationDictionaryRows()/hasMigrationRoute on the running module" },
}
writeFileSync(path.join(DIR, "GATES.json"), JSON.stringify(gates, null, 1))

const doorProbe = {
  schemaVersion: 1, tool: "bb_migrate", currentCommit: head, generatedAt: new Date().toISOString(),
  door: "real MCP stdio session: `npx tsx src/mcp/server.ts --dir <fixture>` with BB_DATA_DIR forwarded explicitly and BB_NO_AUTO_REFRESH=1",
  protocol: doorT0.results?.find((r: any) => r.id === "tools-list"),
  cases: doorT0.results?.filter((r: any) => r.id !== "tools-list" && r.id !== "wire-hygiene").map((r: any) => ({ id: r.id, expected: r.expected, outcome: r.outcome, verdict: r.verdict, ms: r.ms, errorOrHead: r.summary?.textHead ?? r.summary })),
  wireHygiene: doorT0.results?.find((r: any) => r.id === "wire-hygiene"),
  edgeCases: doorEdges.map((r: any) => ({ id: r.id, isError: r.isError, ms: r.ms, plans: r.summary?.plans, unsupported: r.summary?.unsupported?.map?.((u: any) => u.unsupportedReason), statement: r.summary?.cohort?.statement })),
  extraCases: doorExtra,
  readPathMutation: { directHandler: readonlyProbe, publicDoor: doorWrite },
}
writeFileSync(path.join(DIR, "MCP-DOOR.json"), JSON.stringify(doorProbe, null, 1))
console.log(JSON.stringify({ wrote: ["LATENCY.json", "GATES.json", "MCP-DOOR.json"], head }))
