// script/m59/probe-answer-determinism.ts — M59: does the SAME question on the
// SAME index get the SAME answer?
//
// Why this exists: two matrix runs over an identical index (both reported 150
// files / 19,082 relationships, 0 stored zeros) returned different call-site
// counts for the same callee through bb_graph (map: 199 then 161). If that
// reproduces, an agent asking twice gets two different answers, and every
// "verified" number above it inherits the nondeterminism. Measured, not assumed:
//
//   phase=index   build ONE persisted index from a corpus slice
//   phase=query   re-open it and hash the answer for each callee, N times
//
// The hash covers the ORDERED set of (file, line) call sites the tool reports,
// so a set change and an ordering change are both visible.

import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync, statSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../..")
const REPO = "$HOME/fixtures/repositories/cats-effect"
const META = "/tmp/m59-det-meta.json"
const SKIP_DIRS = new Set([".git", "node_modules", "build", "target", "dist", "out", ".gradle", "__pycache__", "vendor", "test", "perf", "gen", "generated"])

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1]
const phase = arg("phase") ?? "query"
const data = arg("data") ?? "/tmp/m59-det-data"
const files = Number(arg("files") ?? 150)
process.env.BB_DATA_DIR = data

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

async function main() {
  const { getProjectId } = await import(path.join(ROOT, "src/cli/index.ts"))
  const { indexProjectParallel } = await import(path.join(ROOT, "src/ast/parallel-indexer.ts"))
  const { createToolHandlers } = await import(path.join(ROOT, "src/mcp/tool-handlers.ts"))

  const rel = (f: string, repo: string) => path.relative(repo, f)

  if (phase === "index") {
    const slice = collectFiles(REPO, [".scala"], files)
    const proj = path.join(data, "slice")
    mkdirSync(proj, { recursive: true })
    for (const f of slice) {
      const dest = path.join(proj, rel(f, REPO))
      mkdirSync(path.dirname(dest), { recursive: true })
      copyFileSync(f, dest)
    }
    const pid = getProjectId(proj)
    const stats: any = await indexProjectParallel(pid, proj, {})
    const { BrainDatabase } = await import(path.join(ROOT, "src/brain/database.ts"))
    const db: any = await BrainDatabase.getRawInstance(pid)
    const totals = db
      .prepare(`SELECT COUNT(*) total, SUM(line_number=0) zero, SUM(line_number>0) real FROM brain_relationship`)
      .get()
    writeFileSync(META, JSON.stringify({ pid, proj, slice: slice.length, rels: totals, data }, null, 2))
    console.log(`indexed slice=${slice.length} pid=${pid} rels=${JSON.stringify(totals)}`)
    console.log(`slice fingerprint: ${createHash("sha1").update(slice.map((f) => rel(f, REPO)).join("\n")).digest("hex")}`)
    return
  }

  const meta = JSON.parse(readFileSync(META, "utf8"))
  const handlers: any = createToolHandlers()
  const rounds = Number(arg("rounds") ?? 3)
  const callees = (arg("callees") ?? "map,flatMap,liftF,delay").split(",")

  console.log(`querying pid=${meta.pid} with rounds=${rounds} (index rels=${JSON.stringify(meta.rels)})`)
  const fingerprints: string[] = []
  for (let r = 0; r < rounds; r++) {
    const parts: string[] = []
    for (const c of callees) {
      const res: any = await handlers.bb_graph({ symbol: c, maxDepth: 1 }, { projectId: meta.pid, projectPath: meta.proj })
      const text = res?.content?.[0]?.text ?? ""
      const parsed = JSON.parse(text)
      const sites: string[] = (parsed.callers ?? [])
        .filter((e: any) => e.callSite?.file)
        .map((e: any) => `${String(e.callSite.file).replace(/^\.\//, "")}:${e.callSite.line}`)
      parts.push(`${c} n=${sites.length} raw=${createHash("sha1").update(sites.join(",")).digest("hex").slice(0, 12)}`)
      // sorted fingerprint: catches a pure ORDER change too
      parts.push(`sorted=${createHash("sha1").update([...sites].sort().join(",")).digest("hex").slice(0, 12)}`)
    }
    const line = parts.join(" ")
    fingerprints.push(line)
    console.log(`round ${r + 1}: ${line}`)
  }
  const unique = new Set(fingerprints)
  console.log(
    unique.size === 1
      ? `DETERMINISTIC: ${rounds} rounds, one fingerprint`
      : `NONDETERMINISTIC: ${unique.size} distinct fingerprints across ${rounds} rounds — same question, same index, different answers`,
  )
  if (unique.size !== 1) process.exitCode = 1
}

main().catch((e) => {
  console.error("PROBE ERROR:", e?.stack ?? e)
  process.exitCode = 1
})
