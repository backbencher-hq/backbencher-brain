// script/m14/tmp/c909-size-cost.ts — adjudicate #909's number honestly.
//
// The committed `c-complexity.json` records `corpus_subset:c` at 400 files /
// 58,278ms (= 145.7ms/file) with `userCpuMs: 52,523` — real CPU burned in that
// process, which "the box was busy" cannot produce. So the audit's "~10x
// inflated, environmental" reading may have been an apples-to-oranges
// comparison: the audit re-measured the M12 slice (small files), while the
// harness was pointed at `/tmp/c-corpus-copy`, a directory that no longer exists
// and that the artifact never described.
//
// This probe separates the two explanations by measuring the SAME production
// entry on two deliberately different 400-file sets drawn from the real corpora:
//   A = the M12 slice rule (sorted first 400 files >= 1KB, zig's C corpus)
//   B = the 400 LARGEST C files <= 1MB (the harness's own size cap) across the
//       C-dominant corpora
// If B lands near 145ms/file, the recorded number was real for a heavy file set
// and the defect is attribution (no manifest, no size distribution, no load
// context, a temp path that is gone) — not an inflated measurement.
//
// Run: bun script/m14/tmp/c909-size-cost.ts
import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { parseFile } from "../../../src/ast/pool-worker"

const REPOS = ["<corpus-root>/bb_tests/repositories/zig", "<corpus-root>/bb_tests/repositories/sqlite", "<corpus-root>/bb_tests/repositories/jq"]
const EXTS = new Set([".c", ".h"])
const CAP = 1024 * 1024 // the harness's own per-file cap

function walk(root: string): string[] {
  const out: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: string[] = []
    try {
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const e of entries) {
      if (e === ".git" || e === "node_modules") continue
      const p = join(dir, e)
      let st
      try {
        st = statSync(p)
      } catch {
        continue
      }
      if (st.isDirectory()) stack.push(p)
      else if (st.isFile() && EXTS.has(p.slice(p.lastIndexOf("."))) && st.size > 0 && st.size <= CAP) out.push(p)
    }
  }
  return out.sort()
}

async function timeSet(label: string, files: string[]): Promise<void> {
  // digest of the drawn set, so the claim is re-checkable even though the files
  // live outside the repo
  const bytes = files.map((f) => `${f}:${statSync(f).size}`).join("\n")
  const digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16)
  const avgKb = files.reduce((a, f) => a + statSync(f).size, 0) / files.length / 1024
  const t0 = performance.now()
  let symbols = 0
  let rels = 0
  for (const f of files) {
    try {
      const r: any = await parseFile(f, "<corpus-root>/mcp/backbencher-brain")
      symbols += r.symbols?.length ?? 0
      rels += r.relationships?.length ?? 0
    } catch {}
  }
  const ms = performance.now() - t0
  console.log(
    `${label}: files=${files.length} avgSize=${avgKb.toFixed(1)}KB wall=${(ms / 1000).toFixed(1)}s ` +
      `${(ms / files.length).toFixed(1)}ms/file symbols=${symbols} rels=${rels} setHash=${digest}`,
  )
}

const all = REPOS.flatMap(walk)
const zig = all.filter((f) => f.includes("/zig/")).filter((f) => statSync(f).size >= 1024)
const m12Rule = zig.slice(0, 400)
const largest = [...all].sort((a, b) => statSync(b).size - statSync(a).size).slice(0, 400)

console.log(`pool: ${all.length} C/H files <= 1MB across zig+sqlite+jq`)
console.log(`recorded artifact: 400 files, 145.7ms/file, userCpu 52.5s, peakRSS 953MB`)
await timeSet("A  M12 rule (first 400 zig >=1KB)", m12Rule)
await timeSet("B  400 largest <=1MB", largest)
