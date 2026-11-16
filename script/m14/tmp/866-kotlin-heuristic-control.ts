// F5 flagged `Exposed:kotlin` with heuristic 57 -> 96 while missing and
// unexplained both stayed 0. F5's baseline rows carry no sample pin, so a rotated
// sample is compared against a pinned baseline — but that must be PROVEN for the
// lane this round actually touched, not assumed. This probe counts the analyzer's
// heuristic-class edges (anything whose confidence is below 1.0, broken out by
// type) over the SAME corpus files in two trees, so #866's own effect on the
// metric is isolated from the sample rotation. java and groovy are the control:
// this round did not touch them.
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"

const ROOT =
  process.argv.find((a) => a.startsWith("--root="))?.slice("--root=".length) ??
  "<corpus-root>/mcp/backbencher-brain"
const LANG = process.argv.find((a) => a.startsWith("--lang="))?.slice("--lang=".length) ?? "kotlin"
const CORPUS_ROOT = "<corpus-root>/bb_tests/repositories"
const REPOS: Record<string, { exts: string[]; repos: string[] }> = {
  kotlin: { exts: [".kt"], repos: ["Exposed", "kotlinx-coroutines"] },
  java: { exts: [".java"], repos: ["grails-core", "clojure"] },
  groovy: { exts: [".groovy"], repos: ["grails-core", "geb"] },
}
const LIMIT = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice("--limit=".length) ?? "120")

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "build" || e.name === "target") continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, exts, out)
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p)
  }
  return out
}

async function main() {
  const cfg = REPOS[LANG]
  const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine.ts"))
  const files: string[] = []
  for (const r of cfg.repos) files.push(...walk(path.join(CORPUS_ROOT, r), cfg.exts))
  files.sort()
  files.length = Math.min(files.length, LIMIT)

  const byType = new Map<string, number>()
  const byConf = new Map<string, number>()
  let total = 0
  for (const f of files) {
    const text = readFileSync(f, "utf8")
    const res: any = await ASTEngine.parseFile(f, text)
    for (const r of res.relationships ?? []) {
      total++
      const conf = typeof r.confidence === "number" ? r.confidence : 1
      if (conf >= 1) continue
      const t = String(r.type ?? r.relationshipType)
      byType.set(t, (byType.get(t) ?? 0) + 1)
      const k = `${t}@${conf}`
      byConf.set(k, (byConf.get(k) ?? 0) + 1)
    }
  }
  console.log(`ROOT=${ROOT}`)
  console.log(`lang=${LANG} files=${files.length} relationships=${total}`)
  console.log(`sub-1.0-confidence edges: ${[...byType.values()].reduce((a, b) => a + b, 0)}`)
  for (const [k, v] of [...byConf.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${k}: ${v}`)
}

main()
