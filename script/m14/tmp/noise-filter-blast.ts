// script/m14/tmp/noise-filter-blast.ts — blast radius of the pool-worker
// `filterNoiseRelationships` leaf bug fixed in the objc lane (M60, 2026-09-25).
//
// The filter computed the relationship target's "leaf" as the LAST `:`-separated
// segment. An Objective-C selector ends in `:` (that colon IS the arity), so the
// last segment was empty and `leaf.length < 1` dropped the row. This probe runs
// the ENGINE (unfiltered — exactly the filter's input) over the pinned corpora and
// counts, per repo/language, the relationships whose OLD leaf was empty: those are
// the rows the fix now keeps. Full extent for the objc corpora; a sorted sample of
// BB_CAP files (default 60) elsewhere to show whether any other lane is affected.
//
// MEASURED (2026-09-25, this probe): objc owns the class — sdwebimage 3,641 of
// 17,696 relationships (318 files, full extent: .m + .h) and afnetworking 1,724 of
// 8,333 (113 files, full extent) were being dropped, plus Clyde 161; every other
// repo in the sample moved by 1-12 rows, and those are MARKDOWN/YAML heading keys
// whose text ends in ':' (`Breaking changes:`) — the same bug, on the only other
// shape whose name legitimately ends in a colon. The M12 cross-lane check
// (script/m14/tmp/m12-cross-lane-filter-check.ts) confirms it at fixture level: of
// 41 languages, ONLY objective-c's differential changes (TP 72->89, FN 17->0) when
// this fix is applied to an otherwise identical tree.
//
// Run: bun script/m14/tmp/noise-filter-blast.ts [reposDir] [cap]
import * as fs from "node:fs"
import * as path from "node:path"

const ROOT = "/home/ishaq2321/mcp/backbencher-brain"
const REPOS = process.argv[2] ?? "/home/ishaq2321/bb_tests/repositories"
const CAP = Number(process.argv[3] ?? process.env["BB_CAP"] ?? 60)
const FULL = new Set(["sdwebimage", "afnetworking"])

const EXTS = new Set([
  ".m", ".h", ".mm", ".c", ".cc", ".cpp", ".cxx", ".hpp", ".cs", ".java", ".kt", ".kts",
  ".swift", ".dart", ".py", ".rb", ".php", ".go", ".rs", ".ts", ".tsx", ".js", ".jsx",
  ".vue", ".svelte", ".scala", ".clj", ".cljs", ".ex", ".exs", ".erl", ".hrl", ".hs",
  ".fs", ".fsx", ".lua", ".pl", ".pm", ".r", ".R", ".sh", ".bash", ".ps1", ".sql",
  ".graphql", ".gql", ".json", ".yaml", ".yml", ".hcl", ".tf", ".mk", ".md", ".css", ".scss",
])

function oldLeaf(name: string): string {
  const noLine = name.replace(/:\d+$/, "")
  const segments = noLine.split(":")
  const last = segments[segments.length - 1]
  const dotParts = last.split(".")
  return dotParts[dotParts.length - 1]
}

// The shipped fix: skip EMPTY colon segments before taking the last one. Rows
// whose target ends with `.` (markdown prose) still have an empty leaf and stay
// dropped — only the trailing-COLON class moves.
function newLeaf(name: string): string {
  const noLine = name.replace(/:\d+$/, "")
  const segments = noLine.split(":").filter((s) => s.length > 0)
  const last = segments[segments.length - 1] ?? ""
  const dotParts = last.split(".")
  return dotParts[dotParts.length - 1]
}

async function main() {
  const engine: any = await import(path.join(ROOT, "src/ast/engine"))
  const repos = fs.readdirSync(REPOS).filter((r) => fs.statSync(path.join(REPOS, r)).isDirectory()).sort()
  const totals: Record<string, { files: number; rels: number; dropped: number; examples: string[] }> = {}
  for (const repo of repos) {
    const base = path.join(REPOS, repo)
    const files: string[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > 8) return
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "vendor") continue
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p, depth + 1)
        else if (EXTS.has(path.extname(e.name))) files.push(p)
      }
    }
    walk(base, 0)
    files.sort()
    const cap = FULL.has(repo) ? files.length : Math.min(CAP, files.length)
    let rels = 0
    let dropped = 0
    let stillDropped = 0
    const examples: string[] = []
    for (let i = 0; i < cap; i++) {
      const f = files[i]
      let content: string
      try { content = fs.readFileSync(f, "utf8") } catch { continue }
      if (content.length > 1024 * 1024) continue
      let parsed: any
      try { parsed = await engine.ASTEngine.parseFile(f, content) } catch { continue }
      const lang = parsed?.language ?? path.extname(f)
      if (!totals[lang]) totals[lang] = { files: 0, rels: 0, dropped: 0, examples: [] }
      totals[lang].files++
      for (const r of parsed?.relationships ?? []) {
        rels++
        totals[lang].rels++
        const target = String(r.target ?? "")
        if (!target) continue
        const wasDropped = oldLeaf(target) === ""
        const nowDropped = newLeaf(target) === ""
        if (wasDropped && nowDropped) stillDropped += 1
        if (wasDropped && !nowDropped) {
          dropped++
          totals[lang].dropped++
          const row = `${r.type} ${String(r.source).slice(0, 40)} -> ${JSON.stringify(target.slice(0, 60))}  [${repo}/${path.basename(f)}]`
          if (totals[lang].examples.length < 6) totals[lang].examples.push(row)
          if (examples.length < 8) examples.push(row)
        }
      }
    }
    console.log(`${repo.padEnd(22)} files=${String(cap).padStart(4)}/${String(files.length).padStart(4)} rels=${String(rels).padStart(7)} newly-kept=${String(dropped).padStart(5)} still-dropped-by-leaf=${String(stillDropped).padStart(5)}`)
    if (dropped) for (const ex of examples) console.log(`      e.g. ${ex}`)
  }
  console.log("\n== per language ==")
  for (const [lang, t] of Object.entries(totals).sort((a, b) => b[1].dropped - a[1].dropped)) {
    console.log(`${lang.padEnd(16)} files=${String(t.files).padStart(5)} rels=${String(t.rels).padStart(8)} dropped=${String(t.dropped).padStart(6)}`)
    for (const ex of t.examples) console.log(`    e.g. ${ex}`)
  }
  const grand = Object.values(totals).reduce((s, t) => s + t.dropped, 0)
  console.log(`\nTOTAL rows the fix now KEEPS: ${grand}`)
}
main()
