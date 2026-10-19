/**
 * CSHARP LANE — .NET citation-claim emission count (task-37 follow-up 2, LIGHT).
 *
 * Counts, over a bounded symlink-aware corpus stride, how many `imports` edges carry the committed
 * `.NET platform libraries` namespace claim (`metadata.languageNamespace` + `strict-absent`) and
 * their target distribution. This is the ANALYZER-side count for the lead's citation arm — the
 * arm's gate table is the authority for the classification movement (ext? → extOK).
 *
 * CLI: bun run script/m14/csharp-citation-count.ts [--sample N]
 * EXIT 0 measured · 2 usage
 */
import { readdirSync, statSync } from "node:fs"
import * as path from "node:path"
import { parseFile } from "../../src/ast/pool-worker"

const argv = process.argv.slice(2)
const i = argv.indexOf("--sample")
const SAMPLE = i >= 0 ? Number(argv[i + 1]) : 400
const CORPUS = process.env.BB_CORPUS_ROOT ?? path.resolve(".corpus")

function walk(dir: string, out: string[]): void {
  let entries: import("node:fs").Dirent[]
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const abs = path.join(dir, e.name)
    let isDir = e.isDirectory()
    if (!isDir && e.isSymbolicLink()) { try { isDir = statSync(abs).isDirectory() } catch { isDir = false } }
    if (isDir) walk(abs, out)
    else if (e.name.endsWith(".cs") || e.name.endsWith(".csx")) out.push(abs)
  }
}
const files: string[] = []
walk(CORPUS, files)
files.sort()
// deterministic stride: one file every ceil(total/sample), spread over the whole corpus
const step = Math.max(1, Math.ceil(files.length / SAMPLE))
const sample = files.filter((_, idx) => idx % step === 0).slice(0, SAMPLE)

let importsTotal = 0, claimed = 0, policyOk = 0
const byTarget = new Map<string, number>()
const byFile = new Map<string, number>()
for (const f of sample) {
  let r: any
  try { r = await parseFile(f, path.dirname(f)) } catch { continue }
  const repo = f.split(`.corpus${path.sep}`)[1]?.split(path.sep)[0] ?? "?"
  for (const rel of (r?.relationships ?? []) as any[]) {
    if (String(rel.type) !== "imports") continue
    importsTotal++
    const md = rel.metadata ?? {}
    const roots = md.languageNamespace
    if (Array.isArray(roots) && roots.length > 0) {
      claimed++
      if (md.languageNamespacePolicy === "strict-absent") policyOk++
      const key = `${String(rel.target)} [${roots.join(",")}]`
      byTarget.set(key, (byTarget.get(key) ?? 0) + 1)
      byFile.set(repo, (byFile.get(repo) ?? 0) + 1)
    }
  }
}
const out = {
  corpusFiles: files.length,
  sample: sample.length,
  importsTotal,
  claimed,
  claimedShare: importsTotal > 0 ? Number((claimed / importsTotal).toFixed(4)) : 0,
  policyStrictAbsent: policyOk,
  perFileOfSample: sample.length > 0 ? Number((claimed / sample.length).toFixed(4)) : 0,
  projectedClaimedOnArm: Math.round((claimed / sample.length) * 14424),
  byRepo: Object.fromEntries([...byFile.entries()].sort((a, b) => b[1] - a[1])),
  byTarget: Object.fromEntries([...byTarget.entries()].sort((a, b) => b[1] - a[1])),
}
console.log(JSON.stringify(out, null, 2))
