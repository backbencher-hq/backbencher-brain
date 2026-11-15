// script/m14/tmp/published-patterns-after-align.ts — what did the alignment actually do?
//
// A fix that restores agreement by DELETING entries has to be measured in both directions:
// that nothing unaligned survives, and that nothing ALIGNED was dropped. The second half is
// the one a "0 findings" row cannot show.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "/home/ishaq2321/bb_tests/repositories"

const LANES: { lang: string; ext: string; repo: string }[] = [
  { lang: "ruby", ext: ".rb", repo: "rake" },
  { lang: "python", ext: ".py", repo: "requests" },
  { lang: "php", ext: ".php", repo: "phpunit" },
  { lang: "csharp", ext: ".cs", repo: "powershell" },
  { lang: "objective-c", ext: ".m", repo: "afnetworking" },
  { lang: "swift", ext: ".swift", repo: "alamofire" },
  { lang: "dart", ext: ".dart", repo: "dart-http" },
]

function filesIn(repo: string, ext: string, cap: number): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    let entries: string[]
    try { entries = readdirSync(dir) } catch { return }
    for (const e of entries.sort()) {
      const p = path.join(dir, e)
      let st
      try { st = statSync(p) } catch { continue }
      if (st.isDirectory()) { if (e !== ".git") walk(p); continue }
      if (e.endsWith(ext)) out.push(p)
    }
  }
  walk(path.join(CORPUS, repo))
  return out.sort().slice(0, cap)
}

const { ASTEngine } = await import(path.join(ROOT, "src/ast/engine"))
const CAP = 60
for (const lane of LANES) {
  let checked = 0, withPatterns = 0, entries = 0, stray = 0
  const strayNames = new Set<string>()
  for (const f of filesIn(lane.repo, lane.ext, CAP)) {
    let src: string
    try { src = readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400_000) continue
    let pub: any
    try { pub = await (ASTEngine as any).parseFile(f, src, { language: lane.lang }) } catch { continue }
    const m = pub?.metadata
    if (!m) continue
    checked++
    const pats: any[] = Array.isArray(m.frameworkPatterns) ? m.frameworkPatterns : []
    if (pats.length) withPatterns++
    const det: string[] = Array.isArray(m.detectedFrameworks) ? m.detectedFrameworks : []
    for (const p of pats) {
      entries++
      if (!det.includes(String(p?.framework))) { stray++; strayNames.add(String(p?.framework)) }
    }
  }
  console.log(`${lane.lang.padEnd(14)} files=${String(checked).padStart(4)} | files with patterns=${String(withPatterns).padStart(4)} | entries=${String(entries).padStart(4)} | stray=${stray}${stray ? " " + [...strayNames].join(",") : ""}`)
}
