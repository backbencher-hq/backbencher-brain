// script/m64/verify-health-deep.ts — M64 bb_health deep review, part 2.
//
// Pins the findings that are about HONESTY OF REPORTING rather than about the
// freshness sample (pinned separately in verify-sample-coverage.ts) or about
// refresh safety (verify-refresh-integrity.ts).
//
// Every check below was a runtime failure before this review; each carries the
// measured value that proved it, so a future regression shows the number, not
// just a red tick.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Harness } from "../m13/harness"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { runIndexHealthCheck, checkEmbeddingCoverage } from "../../src/brain/brain-index-health"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { PUBLIC_TOOL_DESCRIPTORS } from "../../src/mcp/tool-registry"
import { validateToolArguments } from "../../src/mcp/tool-validation"

const harness = new Harness({
  issue: "M64",
  code: "H64",
  tool: "bb_health",
  title: "bb_health: reporting honesty, the integrity battery, and the option surface",
  layers: ["unit", "integration"],
  decisions: {
    sample: "covered by verify-sample-coverage.ts; this file pins everything else",
    refreshSafety: "covered by verify-refresh-integrity.ts",
    stalenessMethods: "integrity's Hash Drift and main freshness now use one population and one deterministic stride, so they cannot disagree by construction",
    absentRecord: "a missing brain_index_status row prints as 'unrecorded', never as 0",
    census: "every count in the report is a COUNT(*), never a page length",
  },
  limitations: [
    "Real-index measurements were taken against this repo's own index; a re-measurement of the complete-scan wall time was blocked by concurrent machine load, so the controlled synthetic comparison is the perf evidence.",
  ],
})

const text = (r: any) => r.content.map((c: any) => c.text).join("\n")
const desc = PUBLIC_TOOL_DESCRIPTORS.find((d) => d.name === "bb_health")!

async function fixture(n: number, prefix = "f") {
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64-d-"))
  mkdirSync(path.join(root, "src"), { recursive: true })
  for (let i = 0; i < n; i++) writeFileSync(path.join(root, "src", `${prefix}${String(i).padStart(4, "0")}.ts`), `export function fn${i}(): number {\n  return ${i}\n}\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  return { root, pid }
}
const drop = (root: string, pid: string) => {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}

// ══ 1. The integrity battery is reproducible ═══════════════════════════════
// Before: `ORDER BY RANDOM()`. Five calls on an unchanging 400-file index with
// exactly 40 files (10.0%) staled reported 21, 17, 22, 19, 16 of 200 — five
// answers, and the warn/error threshold sits at 10%, so the verdict flipped.
//
// 250 files, not 400, and the period is 5 rather than 10. The historical
// numbers above are the evidence and they are recorded in the review; what this
// gate has to prove is the PROPERTY, and the property needs only that the
// corpus be larger than the 200-file sample the check takes. 250 is the
// smallest size that makes the sampled mode a genuine sample, and it cut this
// gate's runtime by ~40% for no loss of coverage.
{
  const { root, pid } = await fixture(250)
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    const paths = raw.prepare("SELECT relative_path FROM brain_file WHERE project_id=? ORDER BY relative_path, id").all(pid) as any[]
    const STALE_EVERY = 5
    for (const r of paths.filter((_, i) => i % STALE_EVERY === 0)) {
      const p = path.join(root, r.relative_path)
      writeFileSync(p, readFileSync(p, "utf8") + "\n// drift\n")
    }
    // The DEEP check (what bb_health integrity:true uses) must be exact; the
    // indexer's hot-path call keeps the cheap sampled mode.
    const drift = async (mode: "sample" | "complete" = "complete") => (await runIndexHealthCheck(pid as any, { diskScan: mode })).checks.find((c) => c.name.includes("Hash Drift"))!
    const counts: number[] = []
    const verdicts: string[] = []
    for (let i = 0; i < 5; i++) {
      const c = await drift()
      counts.push(c.value)
      verdicts.push(c.status)
    }
    harness.check("integrity: Hash Drift is reproducible across 5 identical calls", new Set(counts).size === 1, `drift counts ${counts.join(",")} statuses ${verdicts.join(",")} (pre-fix: ORDER BY RANDOM() gave 21,17,22,19,16 for a true 40 of 400, flipping warn<->error)`)

    const comp = await getUnifiedHealth(pid, root, { freshness: "complete" })
    const c = await drift("complete")
    harness.check("the deep integrity check EXACTLY matches main freshness (same population, same method)", c.value === comp.freshness.stale && c.total === comp.freshness.total, `integrity ${c.value}/${c.total} vs freshness ${comp.freshness.stale}/${comp.freshness.total} — the pre-fix pair used different populations (integrity excluded language='unknown') and disagreed by design`)
    harness.check("and their statuses agree, because both are measurements", (c.status === "error") === ((comp.freshness.stale / comp.freshness.total) * 100 > 10), `integrity=${c.status} trueRate=${((comp.freshness.stale / comp.freshness.total) * 100).toFixed(1)}%`)
    harness.check("the deep check declares itself exact, not an estimate", /EXACT: every indexed file was content-hashed/.test(c.description), c.description.slice(0, 100))

    // The sampled mode is retained for the indexer's hot path, and must say so.
    const sampled = await drift("sample")
    harness.check("the sampled mode (the indexer's hot path) declares itself an ESTIMATE", /ESTIMATE/.test(sampled.description), sampled.description.slice(0, 90))
    harness.check("and is still reproducible", (await drift("sample")).value === sampled.value, `${sampled.value} both times`)
    harness.check("the sampled mode is still unbiased (within 2% of the true rate)", Math.abs((sampled.value / sampled.total) * 100 - (comp.freshness.stale / comp.freshness.total) * 100) <= 2, `sampled ${((sampled.value / sampled.total) * 100).toFixed(1)}% vs true ${((comp.freshness.stale / comp.freshness.total) * 100).toFixed(1)}%`)

    const missing = (await runIndexHealthCheck(pid as any, { diskScan: "complete" })).checks.find((x) => x.name.includes("Missing from Disk"))!
    harness.check("Files Missing from Disk describes its own method honestly", /EXACT|ESTIMATE/.test(missing.description), missing.description.slice(0, 110))
  } finally { drop(root, pid) }
}

// ══ 2. The check count is derived, and the score ignores the always-ok ═════
// Before: "the 12-point index health check" in the tool description and the
// generated doc, against an array of 13. One of the 13 had a hardcoded "ok" and
// unreachable thresholds, so it contributed a constant +7.7 to every project.
{
  const { root, pid } = await fixture(20)
  try {
    const rep = await runIndexHealthCheck(pid as any)
    harness.check("the integrity report exposes a DERIVED count", rep.summary.total === rep.checks.length, `summary.total=${rep.summary.total} checks=${rep.checks.length}`)
    harness.check("informational checks are counted separately from scored ones", rep.summary.informational >= 1 && rep.summary.scored + rep.summary.informational === rep.checks.length, `scored=${rep.summary.scored} informational=${rep.summary.informational} total=${rep.summary.total}`)
    harness.check("overallHealth is a score over SCORED checks only", rep.overallHealth === Math.round((rep.summary.ok / Math.max(rep.summary.scored, 1)) * 100), `overallHealth=${rep.overallHealth} ok=${rep.summary.ok} scored=${rep.summary.scored} (pre-fix the denominator was 13, including one that can only be ok)`)
    harness.check("the always-ok check is marked informational, not scored", rep.checks.find((c) => c.name.includes("Synthetic Container"))?.kind === "informational", `kind=${rep.checks.find((c) => c.name.includes("Synthetic Container"))?.kind}`)

    // A project where one scored check genuinely fails must be able to say so.
    const raw = await BrainDatabase.getRawInstance(pid as any)
    raw.prepare("UPDATE brain_file SET has_syntax_errors = 1 WHERE project_id=?").run(pid)
    const bad = await runIndexHealthCheck(pid as any)
    harness.check("a real failure moves the score below 100", bad.overallHealth < 100, `overallHealth=${bad.overallHealth}% (warn=${bad.summary.warn} error=${bad.summary.error})`)
    harness.check("the score cannot be floored by the informational check", bad.overallHealth <= Math.round((bad.summary.ok / bad.summary.scored) * 100), `overallHealth=${bad.overallHealth} ok/scored=${bad.summary.ok}/${bad.summary.scored}`)
  } finally { drop(root, pid) }
}

// ══ 3. Remediation names commands that exist ══════════════════════════════
// Before: "Run bb2 brain --post to generate embeddings." There is no `bb2`
// binary and no `brain` subcommand in the CLI.
{
  const cli = readFileSync(path.resolve("src/cli/index.ts"), "utf8")
  const commands = [...cli.matchAll(/\.command\("([a-z0-9-]+)"\)/g)].map((m) => m[1])
  const { root, pid } = await fixture(20)
  try {
    const rep = await runIndexHealthCheck(pid as any)
    const rems = rep.checks.map((c) => c.remediation).filter(Boolean) as string[]
    const fake = rems.filter((r) => /\bbb2\b/.test(r))
    harness.check("no integrity remediation names a `bb2` command", fake.length === 0, `CLI commands are [${commands.join(", ")}]; the two embedding remediations now name bb_index mode=post / bb index`)

    // Every remediation that names a bb_* tool must name one that exists.
    const toolNames = new Set(PUBLIC_TOOL_DESCRIPTORS.map((d) => d.name))
    for (const r of rems) {
      for (const m of r.matchAll(/\bbb_[a-z_]+\b/g)) {
        harness.check(`remediation names a real tool: ${m[0]}`, toolNames.has(m[0]), r.slice(0, 90))
      }
    }
  } finally { drop(root, pid) }
}

// ══ 4. includeAnalysisRuns is a census, not a 100-row page ════════════════
// Before: 1,374 runs in the table, tool printed "analysis: 100 runs" because the
// getAnalysisHistory limit was hardcoded to 100 and its .length was reported.
{
  const { root, pid } = await fixture(5)
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    raw.exec(`CREATE TABLE IF NOT EXISTS brain_analysis_run (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, status TEXT, engine_version TEXT, input_hash TEXT, started_at INTEGER, completed_at INTEGER, finding_count INTEGER, error TEXT, time_created INTEGER, time_updated INTEGER)`)
    raw.exec(`CREATE TABLE IF NOT EXISTS brain_analysis_finding (id TEXT PRIMARY KEY, project_id TEXT, kind TEXT, fingerprint TEXT, rule TEXT, title TEXT, severity TEXT, state TEXT, confidence REAL, evidence TEXT, location TEXT, limitations TEXT, evidence_class TEXT, engine TEXT, engine_version TEXT, first_seen_at INTEGER, last_seen_at INTEGER, resolved_at INTEGER, suppressed_at INTEGER, mitigated_at INTEGER, occurrence_count INTEGER, time_created INTEGER, time_updated INTEGER)`)
    const RUNS = 1374
    const ins = raw.prepare("INSERT INTO brain_analysis_run (id,project_id,kind,status,engine_version,input_hash,started_at,finding_count,time_created,time_updated) VALUES (?,?,?,?,?,?,?,?,?,?)")
    const fin = raw.prepare("INSERT INTO brain_analysis_finding (id,project_id,kind,fingerprint,rule,title,severity,state,first_seen_at,last_seen_at,occurrence_count,time_created,time_updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    raw.transaction(() => {
      for (let i = 0; i < RUNS; i++) ins.run(`r${i}`, pid, "patterns", "completed", "m10.04", "h", 1000 + i, 1, 1, 1)
      for (let i = 0; i < 321; i++) fin.run(`f${i}`, pid, "patterns", `fp${i}`, "r", "t", "low", i % 3 === 0 ? "open" : "resolved", 1, 1, 1, 1, 1)
    })()
    const r = await getUnifiedHealth(pid, root, { includeAnalysisRuns: true })
    harness.check("includeAnalysisRuns reports the TRUE run count, not a 100-row page", r.analysisRuns?.runs === RUNS, `reported=${r.analysisRuns?.runs} table=${RUNS} (pre-fix: 100, from a hardcoded LIMIT)`)
    harness.check("the report declares the number is a census", r.analysisRuns?.runTotalKnown === true, `runTotalKnown=${r.analysisRuns?.runTotalKnown}`)
    harness.check("findings remain a true census too", r.analysisRuns?.findings === 321, `findings=${r.analysisRuns?.findings}`)
    const line = formatUnifiedHealth(r).split("\n").find((l) => l.startsWith("analysis:"))!
    harness.check("the analysis line names its method", /full-table counts/.test(line), line)
  } finally { drop(root, pid) }
}

// ══ 5. The option surface matches the description ═════════════════════════
// Before: the description said "complete=true for full (not sampled) freshness".
// No such property exists, so an agent following it got:
//   bb_health: unknown or irrelevant options: complete — accepted options: ...
{
  const h = createToolHandlers().bb_health
  const { root, pid } = await fixture(6)
  try {
    harness.check("the description no longer advertises a non-existent `complete` option", !/\bcomplete\s*=\s*true/.test(desc.description), desc.description.match(/[^.]*freshness[^.]*\./)?.[0]?.slice(0, 130) ?? "")
    harness.check("the description points at the real option", /freshness="complete"/.test(desc.description) && /not a `complete` option/.test(desc.description), "freshness=\"complete\" (not a `complete` option)")
    harness.check("the schema has no `complete` property and never did", !("complete" in desc.inputSchema.properties), `properties: ${Object.keys(desc.inputSchema.properties).join(", ")}`)
    try { validateToolArguments(desc, { complete: true } as any); harness.check("passing `complete` is refused", false, "it was accepted") }
    catch (e) { harness.check("passing `complete` is refused, and the error teaches", /unknown or irrelevant options: complete/.test((e as Error).message) && /accepted options:/.test((e as Error).message), (e as Error).message.slice(0, 130)) }
    const real = await h({ freshness: "complete" } as any, { projectId: pid, projectPath: root } as any)
    harness.check("the real option works", /6\/6 checked, complete/.test(text(real)), text(real).split("\n").find((l) => l.startsWith("freshness:")) ?? "")

    // The destructive option is labelled as destructive where it is declared.
    harness.check("force is declared destructive in its own schema description", /DESTRUCTIVE/.test(desc.inputSchema.properties.force.description), desc.inputSchema.properties.force.description.slice(0, 100))
    harness.check("wait=false declares that the next call reports the outcome", /NEXT call reports/.test(desc.inputSchema.properties.wait.description), desc.inputSchema.properties.wait.description.slice(0, 100))
    harness.negative("the integrity check count is no longer asserted in the description", !/\b12-point\b/.test(desc.description), "the count is derived and printed as `N checks`")
  } finally { drop(root, pid) }
}

// ══ 6. sampleSize edge values ═════════════════════════════════════════════
// Before: sampleSize 0 passed validation and became Math.max(1, 0) === 1, so
// bb_health({sampleSize: 0}) answered "1 fresh / 0 stale / 0 missing (1/8)".
{
  const h = createToolHandlers().bb_health
  const { root, pid } = await fixture(8)
  try {
    for (const [args, why] of [[{ sampleSize: 0 }, "0"], [{ sampleSize: -3 }, "negative"], [{ sampleSize: 2.5 }, "fractional"]] as any[]) {
      let msg = "ACCEPTED (defect)"
      try { validateToolArguments(desc, args); } catch (e) { msg = (e as Error).message }
      harness.check(`sampleSize ${why} is refused with the rule named`, /sampleSize/.test(msg) && !/^ACCEPTED/.test(msg), msg.slice(0, 120))
    }
    const ok = await h({ sampleSize: 1 } as any, { projectId: pid, projectPath: root } as any)
    harness.check("sampleSize 1 is accepted and labelled a SAMPLE", /1\/8 checked, sampled — SAMPLE, not a census/.test(text(ok)), text(ok).split("\n").find((l) => l.startsWith("freshness:")) ?? "")
  } finally { drop(root, pid) }
}

// ══ 7. A missing index-status record is absence, not zero ════════════════
// Before, on this repo's real index: "index: version=unknown indexedFiles=0
// status=unknown errors=0" printed directly under "files=1654", no warning.
{
  const { root, pid } = await fixture(6)
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    raw.prepare("DELETE FROM brain_index_status WHERE project_id=?").run(pid)
    const r = await getUnifiedHealth(pid, root, {})
    const rendered = formatUnifiedHealth(r)
    const indexLine = rendered.split("\n").find((l) => l.startsWith("index:"))!
    harness.check("an absent status record prints 'unrecorded', not 0", /indexedFiles=unrecorded/.test(indexLine) && !/indexedFiles=0/.test(indexLine), indexLine.slice(0, 120))
    harness.check("errors= is also unrecorded rather than a reassuring 0", /errors=unrecorded/.test(indexLine), indexLine.slice(0, 120))
    harness.check("and the absence raises a warning naming what is unrecorded", r.warnings.some((w) => w.code === "NO_INDEX_STATUS" && /UNRECORDED, not zero/.test(w.message)), r.warnings.find((w) => w.code === "NO_INDEX_STATUS")?.message?.slice(0, 120) ?? "missing")
    harness.check("the report exposes recordPresent so a consumer can branch", r.indexStatus.recordPresent === false && r.indexStatus.indexedFiles === null, `recordPresent=${r.indexStatus.recordPresent} indexedFiles=${r.indexStatus.indexedFiles}`)

    // The counts line is still a real measurement and must not be confused.
    harness.check("counts.files is still measured from brain_file", r.counts.files === 6, `files=${r.counts.files}`)

    // When the record EXISTS the line reports real values again, so the change
    // is not a permanent downgrade of a readable field. (The specific count is
    // the indexer's bookkeeping — an incremental pass over an unchanged tree
    // records indexed_files=0 with status=complete — so this asserts the
    // SHAPE, not a number that belongs to the indexer.)
    await indexProjectParallel(pid as any, root, {})
    const good = await getUnifiedHealth(pid as any, root, {})
    const goodLine = formatUnifiedHealth(good).split("\n").find((l) => l.startsWith("index:"))!
    harness.check("a present status record still reports real values", !/unrecorded/.test(goodLine) && /indexedFiles=\d+/.test(goodLine) && /errors=\d+/.test(goodLine), goodLine.slice(0, 120))
    harness.check("and the warning is gone once the record is back", !good.warnings.some((w) => w.code === "NO_INDEX_STATUS"), `warnings=${JSON.stringify(good.warnings.map((w) => w.code))}`)
  } finally { drop(root, pid) }
}

// ══ 8. The coverage figure says what it measures ═════════════════════════
// Before: "22% symbol coverage" = 9,895 embedded entities / 45,018 symbols, where
// the 9,895 are exactly function+class+method+interface and every other kind is
// not attempted at all.
{
  const { root, pid } = await fixture(30)
  try {
    const r = await getUnifiedHealth(pid, root, { verbose: true })
    const line = formatUnifiedHealth(r).split("\n").find((l) => l.startsWith("embeddings:"))!
    harness.check("the coverage line names both operands, not a bare percentage", /\d+ rows \/ \d+ entities \/ [\d.]+% of symbols/.test(line), line.slice(0, 120))
    harness.negative("it no longer claims to be a share of searchable code", !/symbol coverage/.test(line), "the old label implied 'this share of my code is semantically searchable'")
    const kv = formatUnifiedHealth(r).split("\n").find((l) => l.startsWith("embedded kinds:"))
    harness.check("verbose names which kinds were embedded", !!kv, kv?.slice(0, 110) ?? "missing")
    // This fixture is all `function` and every one is embedded, so there is
    // nothing unattempted — the line must be ABSENT, not empty. Then plant a
    // kind the embedder never writes and the line must appear.
    const ukNone = formatUnifiedHealth(r).split("\n").find((l) => l.startsWith("unembedded kinds:"))
    harness.check("with every kind embedded, no unembedded-kinds line is invented", ukNone === undefined, ukNone ?? "absent (correct)")

    const raw = await BrainDatabase.getRawInstance(pid as any)
    const fileId = (raw.prepare("SELECT id FROM brain_file WHERE project_id=? LIMIT 1").get(pid) as any).id
    raw.prepare("INSERT INTO brain_symbol (id,project_id,file_id,name,symbol_type,line_start,line_end,byte_start,byte_end) VALUES (?,?,?,?,?,?,?,?,?)").run("sym-planted", pid, fileId, "plantedVariable", "variable", 1, 1, 0, 10)
    const withGap = await getUnifiedHealth(pid, root, { verbose: true })
    const uk = formatUnifiedHealth(withGap).split("\n").find((l) => l.startsWith("unembedded kinds:"))
    harness.check("verbose names which kinds are unattempted, and says so", !!uk && /NOT semantically searchable \(never attempted/.test(uk), uk?.slice(0, 130) ?? "missing")
    harness.check("the unembedded census agrees with the symbol total", withGap.embeddings.embeddedByEntityType.reduce((a, k) => a + k.count, 0) + withGap.embeddings.unembeddedKinds.reduce((a, k) => a + k.count, 0) === withGap.counts.symbols, `embedded ${withGap.embeddings.embeddedByEntityType.reduce((a, k) => a + k.count, 0)} + unembedded ${withGap.embeddings.unembeddedKinds.reduce((a, k) => a + k.count, 0)} = symbols ${withGap.counts.symbols}`)
    harness.check("the report carries both as data, not only as text", Array.isArray(withGap.embeddings.embeddedByEntityType) && Array.isArray(withGap.embeddings.unembeddedKinds), `embedded=${withGap.embeddings.embeddedByEntityType.length} unembedded=${withGap.embeddings.unembeddedKinds.length}`)
    // M64.I4: the integrity check and the main report used to count DIFFERENT
    // things on one index — COUNT(DISTINCT entity_id) here, COUNT(*) there — so
    // two surfaces could report two coverages. They must now agree.
    const integrityCoverage = await checkEmbeddingCoverage(raw as any, pid)
    harness.check("the integrity check and the main report count the SAME thing", integrityCoverage.value === withGap.embeddings.embeddedEntities, `integrity=${integrityCoverage.value} report=${withGap.embeddings.embeddedEntities} (pre-fix: integrity used COUNT(*) and reported rows as symbols)`)
    const arithmetic = withGap.embeddings.embeddedByEntityType.reduce((a, k) => a + k.count, 0)
    harness.check("the entity-type census sums to the entity count it is a census of", arithmetic === withGap.embeddings.embeddedEntities, `${arithmetic} vs ${withGap.embeddings.embeddedEntities}`)
  } finally { drop(root, pid) }
}

// ══ 9. Verbose file lists are bounded and counted ═════════════════════════
// Before: 300 stale files produced one 3,911-char comma-separated line with no
// cap, no count, and nothing saying more existed.
//
// 40 files, not 300. The cap under test is 20 entries, so 40 stale files
// exercises both the capping and the "first 20 of N" arithmetic. The 3,911-char
// figure is the historical measurement and lives in the review; re-creating it
// to impressive-looking size every CI run bought nothing and cost minutes.
{
  const { root, pid } = await fixture(40)
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    for (const r of raw.prepare("SELECT relative_path FROM brain_file WHERE project_id=?").all(pid) as any[]) {
      const p = path.join(root, r.relative_path)
      writeFileSync(p, readFileSync(p, "utf8") + "\n// stale\n")
    }
    // ONE complete-mode call, reused by every assertion below. This section
    // used to make three, each re-stat'ing and re-hashing every file — the
    // dominant cost of the whole gate. The report is a pure function of the
    // index and the disk, so three calls returned three identical objects and
    // paid for it three times.
    const full = await getUnifiedHealth(pid, root, { verbose: true, freshness: "complete" })
    const rendered = formatUnifiedHealth(full)
    const staleLine = rendered.split("\n").find((l) => l.startsWith("stale files:"))!
    const N = full.freshness.total
    harness.check("the stale list is capped", staleLine.length < 1200, `line length ${staleLine.length} chars for ${N} stale files (pre-fix this was one unbounded line: 3,911 chars for 300 entries)`)
    harness.check("the stale list states the TOTAL, not just the page", new RegExp(`stale files: ${N} total, first \\d+:`).test(staleLine), staleLine.slice(0, 90))
    harness.check("the omission is pointed at, not silent", /freshness="complete"/.test(staleLine) && /staleFiles/.test(staleLine), staleLine.slice(-110))
    harness.check("the total matches the report's own stale count", new RegExp(`${N} total`).test(staleLine) && new RegExp(`${N} of ${N} stale`).test(rendered), rendered.split("\n").find((l) => l.startsWith("freshness:")) ?? "")
    harness.check("the cap keeps every path reachable in the data", full.freshness.staleFiles.length === N, `staleFiles holds all ${full.freshness.staleFiles.length} paths`)
  } finally { drop(root, pid) }
}

// ══ 10. Dead surface removed ══════════════════════════════════════════════
// parserStatus was typed "available" | "unknown", hardcoded to "unknown", and
// read by no code path in any mode. existsSync was imported and never called.
{
  const provider = readFileSync(path.resolve("src/intelligence/health/health-provider.ts"), "utf8")
  // The explanatory comments still NAME parserStatus (they have to — they are
  // why it is gone), so the assertions run against the code with comments
  // stripped. A grep that cannot tell code from prose about the code is not a
  // gate.
  const code = provider.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "")
  harness.negative("the runtime TYPE no longer declares a parser field", !/parserStatus/.test(code), "the type advertised a value the code could never produce")
  harness.negative("the runtime VALUE no longer hardcodes a parser status", !/parserStatus/.test(code), "")
  harness.negative("the unused existsSync import is gone", !/import \{ existsSync \}/.test(code), "")
  harness.check("the runtime object still reports what it can actually know", /runtime: \{ runtime:/.test(code) && /version: process\.version/.test(code), "runtime + version + database")
  const { root, pid } = await fixture(4)
  try {
    const r = await getUnifiedHealth(pid, root, { verbose: true })
    const rendered = formatUnifiedHealth(r)
    harness.negative("no output path mentions a parser status", !/parser/i.test(rendered), "it was never printed in any mode, default or verbose")
    harness.check("the emitted report has no parser key", !("parserStatus" in (r.runtime as any)), Object.keys(r.runtime).join(", "))
  } finally { drop(root, pid) }
}

harness.emit()
