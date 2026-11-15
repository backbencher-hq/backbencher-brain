// CLJ-DEEP · INSTRUMENT 3 — the core-suppression IMPACT census.
//
// Answers the only question that matters for the finding: how many EMITTED
// relationships in the real corpora name a var that `clojure/clojure`'s own
// `core.clj` says is part of clojure.core? Each one is a `calls` edge to
// standard library that the lane's declared contract ("builtin/special forms
// never produce Calls") says must not exist — and none of them can be seen by
// F5, because the oracle imports the same list by reference.
//
// Reports per-name counts, the owning files, and the CALLERS, so a reviewer can
// read a real site rather than take the number on trust. Shardable.
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS_ROOT = process.env.BB_CORPUS_ROOT ?? "/home/sano/ishaq/bb_tests/repositories"
const CORE_VARS = new Set<string>(JSON.parse(readFileSync(process.env.BB_CORE_VARS ?? "/tmp/opencode/clj-core-vars.json", "utf8")).derived)

function listFiles(repo: string): string[] {
  const dir = path.join(CORPUS_ROOT, repo)
  if (!existsSync(dir)) return []
  let tracked: string[] = []
  try {
    tracked = execSync(`git -C ${JSON.stringify(dir)} ls-files`, { encoding: "utf8", maxBuffer: 1 << 28 }).split("\n").filter(Boolean)
  } catch { tracked = [] }
  if (tracked.length === 0) return []
  return tracked.filter(f => /\.(clj|cljc|cljs)$/i.test(f)).map(f => path.join(dir, f)).sort()
}

async function main() {
  const repo = process.argv[2] ?? "clojure"
  const shard = process.argv[3] ? parseInt(process.argv[3]) : 0
  const nshards = process.argv[4] ? parseInt(process.argv[4]) : 1
  const out = process.argv[5] ?? `/tmp/opencode/clj-core-impact-${repo}-${shard}.json`

  const engine: any = await import(path.join(ROOT, "src/ast/engine.ts"))
  const parser = await engine.ASTEngine.getParser("clojure")
  const mod: any = await import(path.join(ROOT, "src/ast/real-clojure-analyzer.ts"))
  const analyzer = new mod.RealClojureAnalyzer()
  const have: Record<string, boolean> = mod.CLOJURE_CORE_BUILTINS

  let files = listFiles(repo).filter((_, i) => i % nshards === shard)
  if (process.env.BB_LIMIT) files = files.slice(0, parseInt(process.env.BB_LIMIT))

  const hits = new Map<string, { count: number; files: string[]; callers: string[] }>()
  let fileCount = 0, relCount = 0, callCount = 0, filesWithHits = 0

  for (const file of files) {
    let content: string
    try { content = readFileSync(file, "utf8") } catch { continue }
    if (content.length > 400_000) continue
    let root: any
    try { root = parser.parse(content).rootNode } catch { continue }
    let res: any
    try { res = analyzer.analyze(root, content, file) } catch { continue }
    fileCount++
    const rels = res.relationships ?? []
    relCount += rels.length
    // In-file declarations: a name the FILE defines is the user's own var, and
    // a core-suppression must not silence it (the shadow guard).
    const declared = new Set<string>((res.symbols ?? []).map((s: any) => s.name))
    let hit = 0
    for (const r of rels) {
      if (r.type !== "calls") continue
      callCount++
      const t = String(r.target)
      if (!CORE_VARS.has(t)) continue
      const shadowed = declared.has(t)
      const key = shadowed ? `${t} [SHADOWED-by-in-file-def]` : t
      const e = hits.get(key)
      if (e) {
        e.count++
        if (e.files.length < 4) e.files.push(path.relative(CORPUS_ROOT, file))
        if (e.callers.length < 4) e.callers.push(`${r.source} -[calls${r.metadata?.callArity !== undefined ? "/" + r.metadata.callArity : ""}]-> ${t} @L${r.line_number}`)
      } else {
        hits.set(key, { count: 1, files: [path.relative(CORPUS_ROOT, file)], callers: [`${r.source} -[calls${r.metadata?.callArity !== undefined ? "/" + r.metadata.callArity : ""}]-> ${t} @L${r.line_number}`] })
      }
      hit++
    }
    if (hit > 0) filesWithHits++
  }

  const total = [...hits.values()].reduce((a, b) => a + b.count, 0)
  writeFileSync(out, JSON.stringify({
    repo, shard, nshards, fileCount, filesWithHits, relCount, callCount,
    coreCallableEdges: total,
    distinctNames: hits.size,
    alreadyInAnalyzerList: [...hits.keys()].filter(k => have[k.split(" ")[0]]).length,
    hits: Object.fromEntries([...hits.entries()].sort((a, b) => b[1].count - a[1].count)),
  }, null, 1))
  console.log(`${repo} shard ${shard}/${nshards}: files=${fileCount} rels=${relCount} calls=${callCount} files-with-core-call-edges=${filesWithHits}`)
  console.log(`  derived-core CALL EDGES = ${total}  across ${hits.size} distinct names`)
  console.log(`  written ${out}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
