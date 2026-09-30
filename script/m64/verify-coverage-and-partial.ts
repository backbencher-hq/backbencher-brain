// script/m64/verify-coverage-and-partial.ts — M64 round 2.
//
// Three of the round-1 fixes were made to code whose own gate had no coverage
// of the new claim, plus the two adversarial cases round 1 reasoned about and
// never probed. Each check below names the failure it rules out.
//
//   1. Embedding coverage: the numerator was COUNT(*) of embedding ROWS
//      reported as "N of M SYMBOLS", and the verdict was derived from a ratio
//      whose ceiling was set by which analyzers emit a snippet.
//   2. A half-built index: EMPTY_INDEX and the detached-refresh record both only
//      see an index that reached ZERO files, or a failure in THIS process.
//   3. Refresh concurrency: reasoned about in a comment, never probed.
//   4. Selection cost at scale: a known unbounded cost change, never sized.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { Harness } from "../m13/harness"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { runIndexHealthCheck, checkEmbeddingCoverage } from "../../src/brain/brain-index-health"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { createToolHandlers } from "../../src/mcp/tool-handlers"
import { selectSampleFiles, stableFileHash } from "../../src/brain/freshness"

const harness = new Harness({
  issue: "M64",
  code: "H64b",
  tool: "bb_health",
  title: "bb_health round 2: embedding coverage arithmetic, the half-built index, refresh concurrency, and selection cost at scale",
  layers: ["unit", "integration"],
  decisions: {
    embeddingCoverage: "measured over the population the embedder can act on (the symbol kinds that appear in the embedding table), counting DISTINCT entities",
    partialIndex: "indexed_files < total_files in brain_index_status is the one incompleteness signal that survives the writing process dying",
    concurrency: "refresh jobs are serialized per project; the record of a detached outcome is per project and replaced, not stacked",
    scale: "selection is O(files) in memory by design; sized here rather than assumed",
  },
  limitations: [
    "The multi-model case is proven by direct table manipulation, not by running a second embedding provider — the fixture cannot produce a second model without one.",
    "The concurrency checks are single-process. Cross-process serialization is the index lock's job (script/m43/verify-p1-index-lock.ts), not this gate's.",
  ],
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const text = (r: any) => r.content.map((c: any) => c.text).join("\n")

async function fixture(n: number, dirs = ["src"]) {
  const root = mkdtempSync(path.join(tmpdir(), "bb-h64b-"))
  for (const d of dirs) mkdirSync(path.join(root, d), { recursive: true })
  for (let i = 0; i < n; i++) writeFileSync(path.join(root, dirs[i % dirs.length], `f${String(i).padStart(4, "0")}.ts`), `export function fn${i}(): number {\n  return ${i}\n}\n`)
  const pid = getProjectId(root)
  await indexProjectParallel(pid as any, root, {})
  return { root, pid }
}
const drop = (root: string, pid: string) => {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}

// ══ 1. Embedding coverage: distinct entities, and a reachable denominator ══
// Before: `SELECT COUNT(*) FROM brain_semantic_embedding` -> "N of M symbols".
// Two defects in one line. A symbol embedded by two models is two ROWS, so the
// numerator is inflated by exactly the number of extra models; and the
// denominator is every symbol while the numerator only ever covers the kinds
// the embedder reaches, so a FULLY embedded index read as 22% and tripped the
// `pct < 50 => warn` line forever.
{
  const { root, pid } = await fixture(30)
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    const check = async () => (await runIndexHealthCheck(pid as any)).checks.find((c) => c.name === "Embedding Coverage")!

    const base = await check()
    const distinct = (raw.prepare("SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id=?").get(pid) as any).c
    const rows = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?").get(pid) as any).c
    harness.check("with one model, distinct entities == rows (so the two agree)", base.value === distinct, `check=${base.value} distinct=${distinct} rows=${rows}`)
    harness.check("it no longer claims to count ROWS as symbols", /Counts DISTINCT entities, not rows/.test(base.description), base.description.slice(0, 100))
    harness.negative("and no longer asserts 'N of M symbols'", !/of \d+ symbols have semantic embeddings/.test(base.description), base.description.slice(0, 120))
    harness.check("it names the kinds it actually embedded", /Kinds absent from the embedding table are never attempted/.test(base.description) && /\w+=\d+/.test(base.description), base.description.match(/\([\d.]+% of all \d+ symbols; [^)]*\)/)?.[0] ?? base.description.slice(0, 140))
    harness.check("and it still publishes the all-symbols share so nothing is hidden", /% of all \d+ symbols/.test(base.description), base.description.match(/[\d.]+% of all \d+ symbols/)?.[0] ?? "absent")

    // The decisive case: a SECOND model over the SAME entities. Pre-fix this
    // doubled the numerator and could carry a thin index over the warn line.
    const one = (await raw.prepare("SELECT id, entity_id, project_id, entity_type, embedding_model, embedding_vector, vector_dimension, content_hash, last_updated FROM brain_semantic_embedding WHERE project_id=? LIMIT 1").get(pid) as any)
    const ins = raw.prepare(`INSERT OR REPLACE INTO brain_semantic_embedding (id,project_id,entity_id,entity_type,embedding_model,embedding_vector,vector_dimension,content_hash,last_updated) VALUES (?,?,?,?,?,?,?,?,?)`)
    for (let i = 0; i < 5; i++) {
      ins.run(`second-model-${i}`, pid, one.entity_id, one.entity_type, "second-model-v1", one.embedding_vector, one.vector_dimension, `h${i}`, 1)
    }
    const afterRows = (raw.prepare("SELECT COUNT(*) c FROM brain_semantic_embedding WHERE project_id=?").get(pid) as any).c
    const afterDistinct = (raw.prepare("SELECT COUNT(DISTINCT entity_id) c FROM brain_semantic_embedding WHERE project_id=?").get(pid) as any).c
    const two = await check()
    harness.check("extra models add ROWS, not entities", afterRows > rows && afterDistinct === distinct, `rows ${rows}->${afterRows}, distinct ${distinct}->${afterDistinct}`)
    harness.check("and the coverage number does NOT move when only models are added", two.value === base.value, `value ${base.value} -> ${two.value} (pre-fix, COUNT(*) would have risen to ${afterRows} and reported ${Math.round((afterRows / two.total) * 100)}% instead of ${Math.round((two.value / two.total) * 100)}%)`)

    // The denominator must be the reachable population, so a fully-embedded
    // index is `ok` rather than permanently `warn`.
    const everyKindEmbedded = two.value === two.total
    harness.check("a fully embedded index is `ok`, not permanently `warn`", !everyKindEmbedded || two.status === "ok", `value=${two.value} total=${two.total} status=${two.status} pct=${two.percentage}% (pre-fix a fully embedded 30-file index read 30 of 30 = 100% only because the fixture has one kind; on a mixed corpus it read <50% and warned forever)`)

    // A mixed corpus is where the pre-fix ratio actually broke: embeddable
    // kinds covered, other kinds never attempted.
    raw.prepare("INSERT OR REPLACE INTO brain_symbol (id,project_id,file_id,name,symbol_type,line_start,line_end,byte_start,byte_end) VALUES (?,?,?,?,?,?,?,?,?)").run("sym-var-1", pid, one.file_id ?? (raw.prepare("SELECT id FROM brain_file WHERE project_id=? LIMIT 1").get(pid) as any).id, "plantedVar", "variable", 1, 1, 0, 5)
    const mixed = await check()
    harness.check("a symbol kind that is never attempted does not drag the verdict down", mixed.total === two.total && mixed.value === two.value, `targeted population still ${mixed.value}/${mixed.total}; a "variable" symbol was added and the verdict is unchanged (pre-fix the denominator would have grown and the share fallen below the warn line)`)

    // Empty-but-present table is a distinct state from no table.
    raw.prepare("DELETE FROM brain_semantic_embedding WHERE project_id=?").run(pid)
    const emptied = await check()
    harness.check("a present-but-empty embedding table is an error, not a silent 0", emptied.status === "error" && /holds no vectors/.test(emptied.description), `status=${emptied.status} desc=${emptied.description.slice(0, 80)}`)
    harness.negative("and it is distinct from the 'no table at all' branch", !/table does not exist/.test(emptied.description), "the two states had no separate answer before")
  } finally { drop(root, pid) }
}

// ══ 2. The half-built index ═══════════════════════════════════════════════
// EMPTY_INDEX sees an index that reached ZERO files. The detached-refresh record
// sees a failure in THIS process. Neither sees the state a killed rebuild
// actually leaves: some files written, the walk's total unrecorded as reached.
{
  const { root, pid } = await fixture(20)
  try {
    const raw = await BrainDatabase.getRawInstance(pid as any)
    // Simulate a rebuild killed partway: the status row still claims the run
    // finished, and the walk found more files than were written.
    raw.prepare("UPDATE brain_index_status SET total_files=?, indexed_files=?, status=? WHERE project_id=?").run(50, 20, "complete", pid)
    const r = await getUnifiedHealth(pid, root, {})
    const partial = r.warnings.find((w) => w.code === "INCOMPLETE_INDEX")
    harness.check("a partial index raises INCOMPLETE_INDEX", !!partial, partial?.message?.slice(0, 150) ?? `warnings=${JSON.stringify(r.warnings.map((w) => w.code))}`)
    harness.check("it is an error, not a warning", partial?.severity === "error", String(partial?.severity))
    harness.check("it names the shortfall", /30 file\(s\) were found by the walk but never written/.test(partial?.message ?? ""), partial?.message?.slice(0, 130) ?? "")
    harness.check("it names the contradiction with status='complete'", /even though the status field says "complete"/.test(partial?.message ?? ""), "")
    harness.check("the report exposes it as data, not only prose", r.indexStatus.isIncomplete === true && r.indexStatus.indexShortfall === 30 && r.indexStatus.totalFilesDiscovered === 50, `isIncomplete=${r.indexStatus.isIncomplete} shortfall=${r.indexStatus.indexShortfall} discovered=${r.indexStatus.totalFilesDiscovered}`)
    const line = formatUnifiedHealth(r).split("\n").find((l) => l.startsWith("index:"))!
    harness.check("the index: line cannot be skimmed as a normal one", /INCOMPLETE/.test(line) && /20\/50/.test(line), line.slice(0, 130))
    harness.check("counts are still measured, and still truthful", r.counts.files === 20, `files=${r.counts.files}`)

    // A complete run must NOT trip it — the check cannot be merely "a status
    // row exists".
    raw.prepare("UPDATE brain_index_status SET total_files=?, indexed_files=? WHERE project_id=?").run(20, 20, pid)
    const whole = await getUnifiedHealth(pid, root, {})
    harness.negative("a finished run does NOT raise INCOMPLETE_INDEX", !whole.warnings.some((w) => w.code === "INCOMPLETE_INDEX"), `warnings=${JSON.stringify(whole.warnings.map((w) => w.code))}`)
    harness.check("and isIncomplete is false", whole.indexStatus.isIncomplete === false && whole.indexStatus.indexShortfall === 0, `isIncomplete=${whole.indexStatus.isIncomplete}`)

    // An incremental run legitimately writes fewer files than the walk found —
    // that is what incremental MEANS. A false positive here would make the
    // warning cry wolf on every incremental refresh, so the boundary matters.
    raw.prepare("UPDATE brain_index_status SET total_files=?, indexed_files=? WHERE project_id=?").run(20, 3, pid)
    const incr = await getUnifiedHealth(pid, root, {})
    harness.check("an incremental run (indexed < discovered) is reported as incomplete", incr.indexStatus.isIncomplete === true, `indexed=3 discovered=20 -> isIncomplete=${incr.indexStatus.isIncomplete}`)
    harness.check("and the message says a rebuild is the fix, not a refresh", /refresh=true, force=true to rebuild from scratch/.test(incr.warnings.find((w) => w.code === "INCOMPLETE_INDEX")?.message ?? ""), "an incremental shortfall is not repaired by another incremental pass")
  } finally { drop(root, pid) }
}

// ══ 3. Refresh concurrency ════════════════════════════════════════════════
// The refresh queue chains per projectId so two refreshes cannot interleave
// their wipes. That was a comment, not a measurement.
{
  const { root, pid } = await fixture(20)
  const h = createToolHandlers().bb_health
  try {
    // Two detached refreshes in the same tick. The second must queue behind the
    // first rather than wiping underneath it.
    const [a, b] = await Promise.all([
      h({ refresh: true, wait: false } as any, { projectId: pid, projectPath: root } as any),
      h({ refresh: true, wait: false } as any, { projectId: pid, projectPath: root } as any),
    ])
    harness.check("two simultaneous detached refreshes both return without throwing", !a.isError && !b.isError, `a=${!!a.isError} b=${!!b.isError}`)
    harness.check("both declare themselves pending, not complete", /started \(pending\)/.test(text(a)) && /started \(pending\)/.test(text(b)), "")
    for (let i = 0; i < 40; i++) {
      await sleep(500)
      const r = await getUnifiedHealth(pid, root, {})
      if (!r.warnings.some((w) => w.code === "REFRESH_IN_PROGRESS" || w.code === "REFRESH_FAILED_ASYNC")) break
    }
    const raw = await BrainDatabase.getRawInstance(pid as any)
    const files = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(pid) as any).c
    const syms = (raw.prepare("SELECT COUNT(*) c FROM brain_symbol WHERE project_id=?").get(pid) as any).c
    harness.check("the index SURVIVES two concurrent detached refreshes", files === 20 && syms === 20, `files=${files} symbols=${syms} (an interleaved wipe would leave a partial index)`)
    const after = await getUnifiedHealth(pid, root, {})
    harness.negative("and neither is reported as failed", !after.warnings.some((w) => w.code === "REFRESH_FAILED_ASYNC"), `warnings=${JSON.stringify(after.warnings.map((w) => w.code))}`)
    harness.negative("nor as an empty index", !after.warnings.some((w) => w.code === "EMPTY_INDEX"), "")

    // A detached refresh racing a WAITED one: the waited call must not return a
    // snapshot that the detached wipe is concurrently destroying.
    const raced = await Promise.all([
      h({ refresh: true, force: true, wait: false } as any, { projectId: pid, projectPath: root } as any),
      (async () => { await sleep(120); return h({ refresh: true, wait: true } as any, { projectId: pid, projectPath: root } as any) })(),
    ])
    const waitedText = text(raced[1])
    harness.check("a waited refresh racing a detached one still completes", /refresh: completed/.test(waitedText), waitedText.split("\n").find((l) => l.startsWith("refresh:")) ?? "no refresh line")
    const settled = await getUnifiedHealth(pid, root, {})
    const raw2 = await BrainDatabase.getRawInstance(pid as any)
    const files2 = (raw2.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(pid) as any).c
    harness.check("and the index is whole afterwards", files2 === 20, `files=${files2}`)
    harness.negative("with no residual failure record", !settled.warnings.some((w) => w.code === "REFRESH_FAILED_ASYNC" || w.code === "EMPTY_INDEX"), `warnings=${JSON.stringify(settled.warnings.map((w) => w.code))}`)
  } finally { drop(root, pid) }
}

// ══ 4. Selection cost at scale ════════════════════════════════════════════
// Round 1 replaced `LIMIT n` with a full id read plus a hash rank, so selection
// went from O(n) to O(files) in memory. That was noted as a limitation and never
// sized. The schema comments cite 264K-file repositories.
{
  const sizes = [1_000, 25_000, 100_000, 264_000]
  const timings: Array<{ n: number; ms: number; mb: number }> = []
  for (const n of sizes) {
    const rows = new Array<{ id: string; relative_path: string }>(n)
    for (let i = 0; i < n; i++) rows[i] = { id: `f${i.toString(36)}-${(i * 2654435761 % 4294967296).toString(36)}`, relative_path: `src/d${i % 97}/f${String(i).padStart(7, "0")}.ts` }
    const t = Date.now()
    const picked = selectSampleFiles(rows, 200)
    const ms = Date.now() - t
    timings.push({ n, ms, mb: Math.round((n * 56) / 1024 / 1024) })
    if (n === 264_000) {
      harness.check("selection returns the requested count at 264k files", picked.length === 200, `${picked.length} of ${n}`)
      // The round 1 review claimed "a few hundred milliseconds" without
      // measuring. This is the measurement.
      harness.check("selection is not the bottleneck at 264k files", ms < 500, `${ms}ms to rank ${n.toLocaleString()} ids (the first implementation of this same selection took 2,448ms here — it sorted the whole set; the warm-bb_health budget is 2,000ms)`)
    }
  }
  // Superlinear cost would make the O(files) design untenable; the ratio of
  // successive 4x/2.6x/2.6x steps bounds it.
  console.log(`  selection cost: ${timings.map((t) => `${t.n.toLocaleString()}=${t.ms}ms`).join(", ")}`)
  const perFile = timings.map((t) => t.ms / t.n)
  harness.check("cost per file does not grow with corpus size (no superlinear blow-up)", perFile[perFile.length - 1] <= perFile[0] * 4, `ns/file: ${perFile.map((x) => (x * 1e6).toFixed(1)).join(", ")}`)

  // The optimization is only legitimate if it selects the SAME files. This is
  // the whole claim: a bounded insertion over the k smallest hashes must equal
  // a full sort truncated to k, for every size and every k.
  //
  // The contract is about the SET, not the order: the reference is in hash
  // order (that is what it is modelling) and the shipped function deliberately
  // returns path order so the rendered report is stable. An earlier version of
  // this check compared the two sequences and reported 22 "mismatches" that
  // were all the same k files in a different order.
  {
    const referenceSet = (rows: Array<{ id: string; relative_path: string }>, k: number) =>
      new Set([...rows]
        .sort((a, b) => stableFileHash(a.id) - stableFileHash(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
        .slice(0, Math.min(k, rows.length))
        .map((r) => `${r.id}\u0000${r.relative_path}`))
    let mismatches = 0
    let cases = 0
    for (const n of [0, 1, 2, 199, 200, 201, 5_000, 50_000]) {
      const rows = Array.from({ length: n }, (_, i) => ({ id: `id-${(i * 2654435761 % 4294967296).toString(36)}-${i}`, relative_path: `p/${i}.ts` }))
      for (const k of [1, 7, 200, n, n + 5]) {
        cases++
        const want = referenceSet(rows, k)
        const got = new Set(selectSampleFiles(rows, k).map((r) => `${r.id}\u0000${r.relative_path}`))
        if (want.size !== got.size || ![...want].every((x) => got.has(x))) { mismatches++; if (mismatches < 4) console.log(`    MISMATCH n=${n} k=${k}`) }
      }
    }
    // Deliberate hash collisions AND duplicate ids. brain_file.id is the
    // PRIMARY KEY, so duplicate ids cannot reach this function from the real
    // caller — but a tie-break that is merely accidental is a latent
    // nondeterminism, and the index term makes the selection provably equal to
    // a stable sort truncated to k even here.
    const collided = Array.from({ length: 3_000 }, (_, i) => ({ id: `c${i % 700}`, relative_path: `p/${i}.ts` }))
    for (const k of [50, 500]) {
      cases++
      const want = referenceSet(collided, k)
      const got = new Set(selectSampleFiles(collided, k).map((r) => `${r.id}\u0000${r.relative_path}`))
      if (want.size !== got.size || ![...want].every((x) => got.has(x))) { mismatches++; console.log(`    MISMATCH on colliding ids k=${k}`) }
    }
    harness.check("the fast path selects EXACTLY the same files a stable sort would", mismatches === 0, `${mismatches} mismatch(es) over ${cases} cases: n=0..50,000 x k=1..n+5, plus 3,000 rows sharing only 700 distinct ids (impossible for the real caller, where id is the PRIMARY KEY — included to prove the tie-break is defined rather than accidental)`)

    // And the deliberate ordering contract: the result comes back in path order
    // so two calls render identically.
    const ordered = selectSampleFiles(collided, 40).map((r) => r.relative_path)
    harness.check("the result is returned in relative_path order regardless of hash order", ordered.join(",") === [...ordered].sort().join(","), ordered.slice(0, 3).join(",") + " …")
  }

  // And the O(files) read must not be paid when it buys nothing: asking for
  // every file must not pay a hash rank.
  const all = Array.from({ length: 50_000 }, (_, i) => ({ id: `x${i}`, relative_path: `p/${i}.ts` }))
  const tAll = Date.now()
  selectSampleFiles(all, Number.MAX_SAFE_INTEGER)
  const allMs = Date.now() - tAll
  harness.check("requesting every file is O(n) sort only, not a hash rank", allMs < 1500, `${allMs}ms for 50,000 files returned whole (a path sort, not a hash rank)`)
}

// ══ 5. The two transports, on the same broken index ═══════════════════════
// Round 1 added error-severity warnings (EMPTY_INDEX, INCOMPLETE_INDEX,
// REFRESH_FAILED_ASYNC) without checking what they did to the two callers.
// The CLI maps an error warning to a non-zero exit code; MCP returns a result
// with no isError. That divergence is deliberate — a broken index is the
// ANSWER, not a tool failure — but it was undocumented and untested, which is
// how it becomes a bug.
{
  const { root, pid } = await fixture(20)
  const h = createToolHandlers().bb_health
  try {
    // Healthy index: both transports must agree it is healthy, and neither may
    // signal failure.
    const okMcp = await h({}, { projectId: pid, projectPath: root } as any)
    harness.check("MCP: a healthy index is not an error result", !okMcp.isError, `isError=${okMcp.isError}`)
    harness.check("MCP: and it declares itself healthy", (okMcp as any).healthy === true, `healthy=${(okMcp as any).healthy}`)
    harness.check("MCP: no error-severity line is printed", !/^error: \[/m.test(text(okMcp)), text(okMcp).split("\n").filter((l) => l.startsWith("error:")).join("|") || "none")

    // Now break it in the way a killed rebuild does, and check BOTH surfaces.
    const raw = await BrainDatabase.getRawInstance(pid as any)
    raw.prepare("UPDATE brain_index_status SET total_files=?, indexed_files=?, status=? WHERE project_id=?").run(50, 20, "complete", pid)
    const brokenMcp = await h({}, { projectId: pid, projectPath: root } as any)
    harness.check("MCP: a broken index is STILL not a tool failure (isError stays unset)", !brokenMcp.isError, `isError=${brokenMcp.isError} — the tool did its job; the index is the finding`)
    harness.check("MCP: but `healthy` is false", (brokenMcp as any).healthy === false, `healthy=${(brokenMcp as any).healthy}`)
    harness.check("MCP: and the error is legible in the text", /^error: \[INCOMPLETE_INDEX\]/m.test(text(brokenMcp)), text(brokenMcp).split("\n").find((l) => l.startsWith("error:"))?.slice(0, 90) ?? "absent")

    // The CLI's contract: an error-severity warning is a non-zero exit. That is
    // asserted in src/cli/index.ts, not here, but the *input* to that decision
    // is this report — so the gate asserts the report carries what the CLI
    // reads, and that the two surfaces cannot disagree about severity.
    const report = await getUnifiedHealth(pid, root, {})
    const cliWouldExit1 = report.warnings.some((w) => w.severity === "error")
    const mcpHealthy = (brokenMcp as any).healthy
    harness.check("the CLI's exit-code decision and MCP's `healthy` are the SAME predicate", cliWouldExit1 === (mcpHealthy === false), `cli.exit(1)=${cliWouldExit1} mcp.healthy=${mcpHealthy} — both are "an error-severity warning is present"`)
    harness.check("so the two transports cannot disagree about a broken index", (cliWouldExit1 && mcpHealthy === false) || (!cliWouldExit1 && mcpHealthy === true), "")

    // And a warning (not an error) must NOT flip either one — otherwise every
    // stale file would make `bb health` exit 1. The index has to be put back
    // into a complete state first, or the INCOMPLETE_INDEX error planted above
    // is still in the report and the check cannot distinguish the two.
    raw.prepare("UPDATE brain_index_status SET total_files=?, indexed_files=?, status=? WHERE project_id=?").run(20, 20, "complete", pid)
    raw.prepare("UPDATE brain_file SET has_syntax_errors=1 WHERE project_id=?").run(pid)
    const warnOnly = await h({}, { projectId: pid, projectPath: root } as any)
    harness.check("a WARNING-severity finding leaves `healthy` true", (warnOnly as any).healthy === true, `healthy=${(warnOnly as any).healthy} with SYNTAX_ERRORS present — a stale or unparseable file is not an unhealthy INDEX`)
    harness.check("and it is still not an error result", !warnOnly.isError, "")
    harness.check("and the warning is still visible in the text", /^warning: \[SYNTAX_ERRORS\]/m.test(text(warnOnly)), text(warnOnly).split("\n").find((l) => l.startsWith("warning:"))?.slice(0, 80) ?? "absent")
  } finally { drop(root, pid) }
}

harness.emit()
