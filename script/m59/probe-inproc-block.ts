// script/m59/probe-inproc-block.ts — M59 #887: the tool-level leg (negative result, kept on purpose)
//
// #887 was filed as "tool calls block for minutes in the same process that just
// indexed". The freeze was real and deterministic (the matrix printed 2 of 8
// cells and stalled, `real 9m0s / user 0.840s`), but the cause turned out to be
// the harness's OWN source predicate spinning — see probe-predicate-loop.ts.
//
// This probe exists to REFUTE the product as the cause, on the same slice: it
// indexes and then calls the real handlers in the same process and bounds every
// call, so "hung" is a verdict rather than a stall. Result: 16/16 calls, 0
// blocked, 7–57 ms. Its value is the negative — do not delete it, and do not
// read a pass here as evidence that the matrix's freeze is fixed; that proof is
// in probe-predicate-loop.ts.
//
// An earlier version of this comment claimed the variable was "two languages in
// one process". That was refuted: kotlin ALONE freezes too. The language count
// was never the trigger, and the corrected conclusion is the one above.
//
// Diagnostics, because the point is to NAME the mechanism, not to nod at it:
//   - the callee name is printed BEFORE its calls, so a freeze still says who did it
//   - a heartbeat proves whether the EVENT LOOP is still alive during a slow call
//   - process.getActiveResourcesInfo() shows what the loop is waiting on
//   - both handler calls are bounded, so "hung" is a verdict and not a stall
//
// Usage: npx tsx script/m59/probe-inproc-block.ts [--langs=scala,kotlin] [--files=150] [--bound-ms=60000]

import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, existsSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const CORPUS = "$HOME/fixtures/repositories"
const arg = (n: string, d?: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d
const CAP = Number(arg("files", "150"))
const boundMs = Number(arg("bound-ms", "60000"))
const ONLY = (arg("langs", "") ?? "").split(",").map((s) => s.trim()).filter(Boolean)
const DATA_ROOT = mkdtempSync(path.join(tmpdir(), "m59-inproc-data-"))
process.env.BB_DATA_DIR = DATA_ROOT

// Identical to matrix-tool-language.ts (a different walk picks a different
// slice, and a different slice picks different top callees — exactly how the
// first probe missed the blocking name).
const SKIP_DIRS = new Set([
  ".git", "node_modules", "build", "target", "dist", "out", ".gradle", "__pycache__", "vendor",
  "test", "perf", "Microbenchmarks", "wwwroot", "testassets", "benchmarkapps", "testData",
  "coverage", "generated", "__generated__",
])

function collectFiles(root: string, exts: string[], cap: number): string[] {
  const found: string[] = []
  const stack = [root]
  while (stack.length && found.length < cap) {
    const dir = stack.pop()!
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of [...entries].sort()) {
      if (found.length >= cap) break
      if (SKIP_DIRS.has(e)) continue
      const p = path.join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(p)
      else if (st.size > 0 && st.size < 400_000 && exts.some((x) => p.endsWith(x))) found.push(p)
    }
  }
  return found
}

const LANGS: Array<{ lang: string; repo: string; ext: string[] }> = [
  { lang: "scala", repo: "cats-effect", ext: [".scala"] },
  { lang: "kotlin", repo: "Exposed", ext: [".kt"] },
]

function resourceSummary(): string {
  const info = (process as unknown as { getActiveResourcesInfo?: () => string[] }).getActiveResourcesInfo
  if (!info) return "n/a"
  const counts = new Map<string, number>()
  for (const r of info()) counts.set(r, (counts.get(r) ?? 0) + 1)
  return [...counts.entries()].map(([k, v]) => `${k}${v > 1 ? `(${v})` : ""}`).join(" ")
}

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))
  const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
  const handlers: any = createToolHandlers()

  let ticks = 0
  const hb = setInterval(() => {
    ticks++
    console.log(`      [heartbeat ${ticks * 5}s alive | resources: ${resourceSummary()}]`)
  }, 5000)

  let blocked = 0
  for (const spec of LANGS) {
    if (ONLY.length && !ONLY.includes(spec.lang)) continue
    const repoPath = path.join(CORPUS, spec.repo)
    if (!existsSync(repoPath)) {
      console.log(`\n=== ${spec.lang}: corpus absent (${repoPath}) ===`)
      continue
    }
    const files = collectFiles(repoPath, spec.ext, CAP)
    if (files.length === 0) {
      console.error(`FATAL: ${spec.lang} slice empty`)
      process.exitCode = 1
      continue
    }
    const proj = mkdtempSync(path.join(tmpdir(), `m59-inproc-${spec.lang}-`))
    for (const f of files) {
      const rel = path.relative(repoPath, f)
      const dest = path.join(proj, rel)
      mkdirSync(path.dirname(dest), { recursive: true })
      copyFileSync(f, dest)
    }

    const pid = getProjectId(proj) as any
    const t0 = Date.now()
    await indexProjectParallel(pid, proj, {})
    const db: any = await BrainDatabase.getRawInstance(pid)
    const rels = db.prepare(`SELECT COUNT(*) n FROM brain_relationship`).get().n
    const names = db
      .prepare(
        `SELECT s.name name, COUNT(DISTINCT s.id) syms, COUNT(*) n FROM brain_relationship r
         JOIN brain_symbol s ON s.id = r.target_symbol_id
         WHERE r.relationship_type IN ('calls','call') GROUP BY s.name ORDER BY n DESC LIMIT 8`,
      )
      .all() as Array<{ name: string; n: number; syms: number }>
    console.log(
      `\n=== ${spec.lang} — ${spec.repo}: ${files.length} files indexed in ${((Date.now() - t0) / 1000).toFixed(1)}s; relationships=${rels} ===`,
    )
    names.forEach((n) => console.log(`   candidate: ${n.name}  sites=${n.n} symbols=${n.syms}`))

    const timed = async (label: string, fn: () => Promise<any>) => {
      const s = Date.now()
      const tickAtStart = ticks
      let note = ""
      try {
        await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("BOUND")), boundMs))])
      } catch (e: any) {
        note = e?.message === "BOUND" ? `  <-- BLOCKED > ${boundMs}ms` : `  ERROR ${e?.message}`
      }
      const ms = Date.now() - s
      const lived = ticks > tickAtStart
      console.log(
        `    ${label.padEnd(24)} ${String(ms).padStart(8)}ms${note}${ms > 5000 ? ` (event-loop-alive=${lived})` : ""}`,
      )
      return ms
    }

    for (const { name } of names) {
      console.log(`\n  --- ${spec.lang} / ${name} ---`)
      const a = await timed("bb_graph maxDepth=1", () =>
        handlers.bb_graph({ symbol: name, maxDepth: 1 }, { projectId: pid, projectPath: proj }),
      )
      const b = await timed("bb_analyze callers", () =>
        handlers.bb_analyze({ target: name, mode: "callers" }, { projectId: pid, projectPath: proj }),
      )
      if (a >= boundMs || b >= boundMs) blocked++
    }
  }

  clearInterval(hb)
  console.log(`\nSUMMARY: ${blocked} blocked call(s) (bound ${boundMs}ms)`)
  console.log(
    blocked > 0
      ? "VERDICT: #887 REPRODUCED — a same-process call blocks where a fresh process answers in ms"
      : "VERDICT: no block observed in this run",
  )
  if (blocked > 0) process.exitCode = 1
}

main().catch((e) => {
  console.error("PROBE ERROR:", e?.stack ?? e)
  process.exitCode = 2
})
