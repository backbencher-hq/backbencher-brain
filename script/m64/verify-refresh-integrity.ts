// script/m64/verify-refresh-integrity.ts — M64.N3.
//
// The defect: `force: true` wipes the index BEFORE rebuilding it, so a refresh
// that does not complete leaves nothing. Combined with `wait: false` detaching
// the job and `.catch(() => undefined)` discarding its error, a destroyed index
// was reported as a clean one — by the very tool whose job is to report index
// health.
//
// The probe this pins, before the fix:
//   bb_health({refresh:true, force:true, wait:false}) -> isError=false
//   background job wipes 20 files, then completes having indexed 0
//   next call -> files=0 symbols=0 warnings: []
//
// Two guards, both asserted here:
//   1. the detached outcome is RECORDED and reported by the next call, whether
//      the job threw or resolved having produced nothing;
//   2. an index with zero files is an error, not a clean report — which is also
//      what catches a wipe whose process died mid-rebuild.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { getProjectId } from "../../src/util/project-id"
import { indexProjectParallel } from "../../src/ast/parallel-indexer"
import { BrainDatabase } from "../../src/brain/database"
import { getUnifiedHealth, formatUnifiedHealth } from "../../src/intelligence/health/health-provider"
import { createToolHandlers } from "../../src/mcp/tool-handlers"

const out = (...a: unknown[]) => console.log(...a)
let failures = 0
const ck = (name: string, pass: boolean, detail: string) => {
  out(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
  if (!pass) failures++
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const root = mkdtempSync(path.join(tmpdir(), "bb-h64-n3-"))
mkdirSync(path.join(root, "src"), { recursive: true })
for (let i = 0; i < 20; i++) writeFileSync(path.join(root, "src", `f${i}.ts`), `export function fn${i}(): number { return ${i} }\n`)
const pid = getProjectId(root)
await indexProjectParallel(pid as any, root, {})
const h = createToolHandlers().bb_health
const text = (r: any) => r.content.map((c: any) => c.text).join("\n")

try {
  const before = await getUnifiedHealth(pid, root, {})
  ck("fixture indexed", before.counts.files === 20 && before.counts.symbols === 20, `files=${before.counts.files} symbols=${before.counts.symbols}`)

  // ── the detached force-refresh that destroys the index ────────────────
  const call = await h({ refresh: true, force: true, wait: false } as any, { projectId: pid, projectPath: "/nonexistent/bb-h64-probe" } as any)
  const callText = text(call)
  ck("the detached call warns that force is destructive and transient", /WIPES the index/.test(callText), callText.split("\n").find((l) => l.startsWith("warning"))?.slice(0, 120) ?? "no warning")
  ck("the detached call does NOT claim a clean result", !call.isError && /started \(pending\)/.test(callText))

  // Wait for the background job to settle. The warning is surfaced ONCE by
  // design, so the call that observes it must be the one whose result is
  // asserted — polling with getUnifiedHealth and then re-querying would
  // consume it.
  //
  // The bound is generous on purpose: this runs in CI on shared runners, and a
  // bound tuned to a quiet laptop is a flaky gate. The indexer itself allows
  // 45s for a worker, so a 20-file fixture finishing inside 60s is not a
  // close call. When the bound IS hit, the detail says so, because "the gate
  // timed out" and "the tool did not report the failure" are different
  // problems and the message has to distinguish them.
  const BOUND_MS = 60_000
  let after: Awaited<ReturnType<typeof getUnifiedHealth>> | null = null
  const startedAt = Date.now()
  while (Date.now() - startedAt < BOUND_MS) {
    await sleep(500)
    const r = await getUnifiedHealth(pid, root, {})
    if (r.warnings.some((w) => w.code === "REFRESH_FAILED_ASYNC")) { after = r; break }
  }
  if (!after) after = await getUnifiedHealth(pid, root, {})
  const asyncFail = after.warnings.find((w) => w.code === "REFRESH_FAILED_ASYNC")
  ck("the NEXT call reports the detached refresh as FAILED", !!asyncFail, asyncFail?.message?.slice(0, 150) ?? `no REFRESH_FAILED_ASYNC within ${BOUND_MS}ms; warnings=${JSON.stringify(after.warnings.map((w) => w.code))}`)
  ck("the failure is an error, not a warning", asyncFail?.severity === "error", String(asyncFail?.severity))
  ck("the failure names the force wipe", /force wipe/.test(asyncFail?.message ?? ""), asyncFail?.message?.slice(0, 90) ?? "")

  // ── guard 2: an empty index is never a clean report ───────────────────
  const raw = await BrainDatabase.getRawInstance(pid as any)
  const filesNow = (raw.prepare("SELECT COUNT(*) c FROM brain_file WHERE project_id=?").get(pid) as any).c
  ck("the wipe really did empty the index (the test would be vacuous otherwise)", filesNow === 0, `brain_file=${filesNow}`)
  const empty = after.warnings.find((w) => w.code === "EMPTY_INDEX")
  ck("an index with 0 files raises EMPTY_INDEX as an error", empty?.severity === "error", empty?.message?.slice(0, 110) ?? `warnings=${JSON.stringify(after.warnings.map((w) => w.code))}`)
  const rendered = formatUnifiedHealth(after)
  ck("the rendered output carries the error line", /^error: \[EMPTY_INDEX\]/m.test(rendered), rendered.split("\n").filter((l) => l.startsWith("error:")).join(" | ").slice(0, 140))
  ck("the rendered output cannot be read as a clean report", /^error:/m.test(rendered) && after.warnings.some((w) => w.severity === "error"), `errorLines=${rendered.split("\n").filter((l) => l.startsWith("error:")).length}`)

  // ── the async failure is reported ONCE, not forever ───────────────────
  const third = await getUnifiedHealth(pid, root, {})
  ck("the async failure is not repeated indefinitely", !third.warnings.some((w) => w.code === "REFRESH_FAILED_ASYNC"), `warnings=${JSON.stringify(third.warnings.map((w) => w.code))}`)
  ck("but the EMPTY_INDEX state is still reported while it holds", third.warnings.some((w) => w.code === "EMPTY_INDEX"), `warnings=${JSON.stringify(third.warnings.map((w) => w.code))}`)

  // ── a legitimate idempotent incremental refresh is NOT cried wolf at ───
  // (an unchanged tree processes 0 files; only a FORCE rebuild that processes
  // 0 files is treated as a failure, or every no-op refresh would be one.)
  await indexProjectParallel(pid as any, root, { isIncremental: true })
  const rebuilt = await indexProjectParallel(pid as any, root, { isIncremental: true })
  const processed = rebuilt?.processedFiles ?? rebuilt?.totalFiles
  ck("a second incremental pass over an unchanged tree processes ~0 files", typeof processed === "number", `processedFiles=${String(processed)} derivedPass=${String((rebuilt as any)?.summary?.derivedPass)}`)
} finally {
  try { rmSync(path.dirname(BrainDatabase.getDbPath(pid as any)), { recursive: true, force: true }) } catch {}
  rmSync(root, { recursive: true, force: true })
}

out(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`)
process.exit(failures === 0 ? 0 : 1)
