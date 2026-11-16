// script/m14/tmp/published-primary-values.ts — what does the PUBLISHED payload carry in
// `framework` when `detectedFrameworks` is empty?
//
// The published sweep convicts `framework: "unknown"` on ~1,000 real files. Before scoping
// that assertion, measure which values actually appear: a rule written from the observed
// population, not from the one sample that happened to be printed.
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname ?? ".", "../../..")
const CORPUS = "<corpus-root>/bb_tests/repositories"

const LANES: { lang: string; ext: string; repo: string }[] = [
  { lang: "ruby", ext: ".rb", repo: "rake" },
  { lang: "ruby", ext: ".rb", repo: "rack" },
  { lang: "python", ext: ".py", repo: "requests" },
  { lang: "python", ext: ".py", repo: "cython" },
  { lang: "php", ext: ".php", repo: "phpunit" },
  { lang: "php", ext: ".php", repo: "slim" },
  { lang: "csharp", ext: ".cs", repo: "powershell" },
  { lang: "objective-c", ext: ".m", repo: "afnetworking" },
  { lang: "objective-c", ext: ".m", repo: "sdwebimage" },
  { lang: "swift", ext: ".swift", repo: "alamofire" },
  { lang: "swift", ext: ".swift", repo: "swift-nio" },
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
const empty = new Map<string, number>()
const nonEmptyNotListed = new Map<string, number>()
let checked = 0
for (const lane of LANES) {
  for (const f of filesIn(lane.repo, lane.ext, CAP)) {
    let src: string
    try { src = readFileSync(f, "utf8") } catch { continue }
    if (src.length > 400_000) continue
    let pub: any
    try { pub = await (ASTEngine as any).parseFile(f, src, { language: lane.lang }) } catch { continue }
    const m = pub?.metadata
    if (!m) continue
    checked++
    const det: string[] = Array.isArray(m.detectedFrameworks) ? m.detectedFrameworks : []
    const key = `${JSON.stringify(m.framework)}|${JSON.stringify(m.frameworkPatterns?.length ?? null)}`
    if (det.length === 0) empty.set(key, (empty.get(key) ?? 0) + 1)
    else if (m.framework !== undefined && !det.includes(m.framework)) nonEmptyNotListed.set(`${m.framework}|${det.join(",")}`, (nonEmptyNotListed.get(`${m.framework}|${det.join(",")}`) ?? 0) + 1)
  }
}
console.log(`checked ${checked} published payload(s), capped ${CAP}/repo`)
console.log("\nprimary|patternCount when detection is EMPTY:")
for (const [k, n] of [...empty.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(4)}  ${k}`)
console.log("\nprimary NOT IN detectedFrameworks when detection is NON-empty:")
if (!nonEmptyNotListed.size) console.log("  (none)")
for (const [k, n] of [...nonEmptyNotListed.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${n.toString().padStart(4)}  ${k}`)
